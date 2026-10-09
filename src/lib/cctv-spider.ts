import { fetchUpstream } from './fetch-utils';
import { checkUpstreamAllowed } from './ssrf';
import { CCTV_SOURCE_URL } from './cctv-source';
import type { SearchResultItem, SourceConfig, VideoDetail } from './types';

function videoPage(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== 'tv.cctv.com' || url.port || url.username || url.password
    || url.search || url.hash || !/^\/\d{4}\/\d{2}\/\d{2}\/VIDE[A-Za-z0-9]+\.shtml$/.test(url.pathname)) {
    throw new Error('无效的央视视频页');
  }
  return url.href;
}

async function request(url: string, signal?: AbortSignal) {
  const res = await fetchUpstream(url, { timeoutMs: 8000, signal, headers: { Accept: 'application/json,text/html' } });
  if (!res.ok) throw new Error(`央视接口返回 HTTP ${res.status}`);
  return res;
}

interface CctvSearchItem {
  all_title?: string; title?: string; urllink?: string; imglink?: string;
  channel?: string; uploadtime?: string;
}

/** 只读取公开搜索接口，不加载或执行订阅中的 JAR/JS/Python。 */
export async function searchCctv(source: SourceConfig, wd: string, page: number, signal?: AbortSignal) {
  const url = new URL(CCTV_SOURCE_URL);
  url.search = new URLSearchParams({ page: String(page), qtext: wd, sort: 'relevance', pageSize: '20',
    type: 'video', vtime: '-1', datepid: '1', channel: '', pageflag: '0' }).toString();
  const data = await (await request(url.href, signal)).json() as { list?: CctvSearchItem[]; totalpage?: number };
  if (!Array.isArray(data.list)) throw new Error('央视搜索响应格式无效');
  const list: SearchResultItem[] = [];
  for (const item of data.list) {
    if (!item.urllink) continue;
    let pageUrl: string;
    try { pageUrl = videoPage(item.urllink); } catch { continue; }
    const name = (item.all_title || item.title || '').replace(/<[^>]*>/g, '').trim();
    if (!name) continue;
    list.push({ sourceKey: source.key, sourceName: source.name, sourceUrl: source.url,
      vodId: Buffer.from(pageUrl).toString('base64url'), name, pic: item.imglink,
      typeName: item.channel, year: String(item.uploadtime ?? '').match(/\d{4}/)?.[0] });
  }
  return { list, pagecount: data.totalpage };
}

export async function detailCctv(source: SourceConfig, id: string): Promise<VideoDetail> {
  // ID 只能还原成官方视频页，不能让用户传入任意抓取地址。
  if (!/^[\w-]{1,512}$/.test(id)) throw new Error('无效的央视视频ID');
  const decoded = Buffer.from(id, 'base64url').toString('utf8');
  if (Buffer.from(decoded).toString('base64url') !== id) throw new Error('无效的央视视频ID');
  const pageUrl = videoPage(decoded);
  const signal = AbortSignal.timeout(10000);
  const html = await (await request(pageUrl, signal)).text();
  const guid = /(?:guid|videoCenterId)\s*[:=]\s*["']([a-f0-9]{32})["']/i.exec(html)?.[1];
  if (!guid) throw new Error('央视视频页未提供播放标识');
  const data = await (await request(`https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}`, signal)).json() as {
    hls_url?: string; title?: string; image?: string; is_protected?: string | number; is_invalid_copyright?: string | number;
  };
  if (String(data.is_protected) === '1' || String(data.is_invalid_copyright) === '1') {
    throw new Error('该央视视频未提供公开播放权限');
  }
  if (!data.hls_url) throw new Error('该央视视频未提供公开 HLS 地址');
  const verdict = await checkUpstreamAllowed(data.hls_url);
  if (!verdict.ok) throw new Error(verdict.reason);
  return { episodes: [data.hls_url], videoInfo: {
    title: data.title || '央视视频', cover: data.image, sourceKey: source.key,
    sourceName: source.name, sourceUrl: source.url,
  } };
}
