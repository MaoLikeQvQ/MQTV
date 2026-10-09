import { parseDetail, parseSearchList } from './cms-parser';
import { fetchUpstream, getCache, setCache } from './fetch-utils';
import { checkUpstreamAllowed } from './ssrf';
import { drpyModule, SPIDER_EPISODE_PREFIX } from './spider-source';
import type { SourceConfig, VideoDetail } from './types';

const ID_PREFIX = 'spider_';
interface Episode { id: string; index: number }
interface Playback { token: string; flag: string }

function encode(value: string): string { return Buffer.from(value).toString('base64url'); }
function decode(value: string): string {
  if (!value || value.length > 12000 || !/^[\w-]+$/.test(value)) throw new Error('无效的 Spider 标识');
  const decoded = Buffer.from(value, 'base64url').toString('utf8');
  if (encode(decoded) !== value) throw new Error('无效的 Spider 标识');
  return decoded;
}
function originalId(id: string): string {
  if (!id.startsWith(ID_PREFIX)) throw new Error('无效的 Spider 视频标识');
  return decode(id.slice(ID_PREFIX.length));
}

/** The only private-network exception is a deployment-owned origin and allowlisted local module. */
export async function checkSourceAllowed(source: Pick<SourceConfig, 'url' | 'type'>) {
  if (source.type !== undefined && source.type !== 't4' && source.type !== 'drpy') return { ok: false as const, reason: '点播源类型无效' };
  if (source.type !== 'drpy') return checkUpstreamAllowed(source.url);
  const moduleName = drpyModule(source.url);
  const allowed = (process.env.DRPY_MODULES || 'cctv-public').split(',').map((item) => item.trim());
  if (process.env.DRPY_ENABLED !== '1' || !moduleName || !allowed.includes(moduleName)) {
    return { ok: false as const, reason: '此托管 Spider 未启用或不在允许列表中' };
  }
  return { ok: true as const };
}

async function call(source: SourceConfig, params: Record<string, string>, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const verdict = await checkSourceAllowed(source);
  if (!verdict.ok) throw new Error(verdict.reason);
  let endpoint = new URL(source.url);
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (source.type === 'drpy') {
    const base = new URL(process.env.DRPY_BASE_URL || 'http://127.0.0.1:5757');
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('托管 Spider 服务地址配置无效');
    if (!process.env.DRPY_API_KEY) throw new Error('托管 Spider 服务密钥未配置');
    endpoint = new URL(`/api/${drpyModule(source.url)}`, base);
    headers['x-api-key'] = process.env.DRPY_API_KEY;
  }
  for (const [key, value] of Object.entries(params)) endpoint.searchParams.set(key, value);
  try {
    // Do not follow a private worker redirect: this exception must never extend to another host.
    const res = await fetchUpstream(endpoint.href, {
      timeoutMs: 10000, headers, signal,
      ...(source.type === 'drpy' ? { safeRedirects: false, redirect: 'error' as const } : {}),
    });
    if (!res.ok) throw new Error(`Spider HTTP ${res.status}`);
    const data: unknown = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Spider 响应格式无效');
    return data as Record<string, unknown>;
  } catch (error) {
    if (source.type === 'drpy' && !(error instanceof Error && /^Spider /.test(error.message))) {
      const sanitized = new Error('托管 Spider 请求失败，请检查服务运行状态');
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) sanitized.name = error.name;
      throw sanitized;
    }
    throw error;
  }
}

export async function searchSpider(source: SourceConfig, wd: string, page: number, signal?: AbortSignal) {
  const data = await call(source, { wd, pg: String(page) }, signal);
  if (!Array.isArray(data.list)) throw new Error('Spider 搜索响应缺少 list');
  return { ...data, list: parseSearchList(data, source).filter((item) => item.vodId).map((item) => ({ ...item, vodId: `${ID_PREFIX}${encode(item.vodId)}` })) };
}

async function loadDetail(source: SourceConfig, id: string): Promise<{ detail: VideoDetail; playback: Playback[] }> {
  const key = `spider-detail:${source.type}:${source.url}:${id}`;
  const cached = getCache<{ detail: VideoDetail; playback: Playback[] }>(key);
  if (cached) return cached;
  const data = await call(source, { ac: 'detail', ids: originalId(id) });
  const detail = parseDetail(data, source);
  const vod = (data.list as Record<string, unknown>[])[0];
  const flags = String(vod.vod_play_from || '').split('$$$');
  const groups = String(vod.vod_play_url || '').split('$$$');
  const selected = groups.findIndex((group) => group.includes('$'));
  const playback = selected < 0 ? [] : groups[selected].split('#').flatMap((episode) => {
    const separator = episode.indexOf('$');
    const token = separator < 0 ? '' : episode.slice(separator + 1);
    return token && token.length <= 8192 ? [{ token, flag: flags[selected] || '' }] : [];
  });
  if (!playback.length) throw new Error('Spider 未返回可解析的剧集');
  detail.episodes = playback.map((_, index) => `${SPIDER_EPISODE_PREFIX}${encode(JSON.stringify({ id, index }))}`);
  detail.videoInfo.sourceType = source.type;
  const result = { detail, playback };
  setCache(key, result, 60000);
  return result;
}

export async function detailSpider(source: SourceConfig, id: string): Promise<VideoDetail> {
  return (await loadDetail(source, id)).detail;
}

/** Resolve one listed episode lazily; arbitrary play tokens are never accepted from clients. */
export async function resolveSpiderEpisode(source: SourceConfig, episode: string): Promise<string> {
  if (!episode.startsWith(SPIDER_EPISODE_PREFIX)) throw new Error('无效的 Spider 剧集');
  const descriptor = JSON.parse(decode(episode.slice(SPIDER_EPISODE_PREFIX.length))) as Episode;
  if (typeof descriptor.id !== 'string' || !Number.isInteger(descriptor.index) || descriptor.index < 0) throw new Error('无效的 Spider 剧集');
  const { playback } = await loadDetail(source, descriptor.id);
  const selected = playback[descriptor.index];
  if (!selected) throw new Error('Spider 剧集不存在');
  const data = await call(source, { play: selected.token, flag: selected.flag });
  if (data.parse !== undefined && Number(data.parse) !== 0) throw new Error('此线路仍需网页解析，暂不支持播放');
  if (data.header && Object.keys(data.header).length) throw new Error('此线路需要专用播放请求头，暂不支持播放');
  if (typeof data.url !== 'string') throw new Error('Spider 未返回播放地址');
  const media = new URL(data.url);
  if (media.username || media.password) throw new Error('播放地址不能携带凭证');
  const verdict = await checkUpstreamAllowed(media.href);
  if (!verdict.ok) throw new Error(verdict.reason);
  // A webpage is not a playable media URL, even when a plugin labels it parse=0.
  const response = await fetchUpstream(media.href, { timeoutMs: 8000, headers: { Range: 'bytes=0-4095' } });
  if (!response.ok) throw new Error(`播放地址 HTTP ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  const reader = response.body?.getReader();
  let prefix = '';
  if (reader) {
    const first = await reader.read();
    prefix = new TextDecoder().decode(first.value?.slice(0, 4096)).trimStart();
    await reader.cancel();
  }
  if (/^(?:<!doctype|<html)/i.test(prefix) || /text\/html/i.test(contentType)) throw new Error('Spider 返回的是网页，无法直接播放');
  if (!prefix.startsWith('#EXTM3U') && !/^(?:video|audio)\//i.test(contentType)) throw new Error('Spider 返回的地址不是可识别的媒体');
  return media.href;
}
