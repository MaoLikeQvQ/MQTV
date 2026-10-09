import { createHash } from 'node:crypto';
import type { LiveSourceConfig, SourceConfig, SourceListPayload } from './types';
import { DRPY_SOURCE_URL } from './spider-source';
import { CCTV_SOURCE_URL } from './cctv-source';

export type CatalogVod = SourceConfig & { enabled: boolean; subscriptionUrls: string[] };
export type CatalogLive = LiveSourceConfig & { enabled: boolean; subscriptionUrls: string[] };
export interface CatalogSnapshot {
  version: 2;
  name: string;
  catalogSource: string;
  syncedAt: string;
  subscriptions: { name: string; url: string; enabled: boolean; syncedAt?: number }[];
  sources: CatalogVod[];
  liveSources: CatalogLive[];
}

/** 仅点播接口移除列表操作参数；直播签名、查询串及路径保持原样。 */
export function catalogUrl(raw: string, kind: 'vod' | 'live' | 'subscription'): string {
  const url = new URL(raw.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('目录地址必须是无凭证的 http/https URL');
  url.hash = '';
  if (kind === 'vod') {
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    if (['list', 'videolist'].includes(url.searchParams.get('ac') ?? '')) url.searchParams.delete('ac');
  }
  return url.href.replace(/\?$/, '');
}

/** key 只依赖类型与规范地址，订阅顺序、名称及上游 key 变化不会改变标识。 */
export function catalogKey(url: string, kind: 'vod' | 'live'): string {
  return `catalog_${kind}_${createHash('sha256').update(url).digest('hex').slice(0, 20)}`;
}

/** 内置适配器也只占一个源对象；不伪造订阅配置或上游 JAR 的运行结果。 */
export function includeBuiltinSources(snapshot: CatalogSnapshot): CatalogSnapshot {
  if (!snapshot.sources.some((source) => source.url === CCTV_SOURCE_URL)) {
    snapshot.sources.push({ key: catalogKey(CCTV_SOURCE_URL, 'vod'), name: '央视公开点播',
      url: CCTV_SOURCE_URL, enabled: true, subscriptionUrls: [] });
  }
  if (process.env.DRPY_ENABLED === '1' && !snapshot.sources.some((source) => source.url === DRPY_SOURCE_URL)) {
    snapshot.sources.push({ key: catalogKey(DRPY_SOURCE_URL, 'vod'), name: '央视公开点播（drpy）',
      url: DRPY_SOURCE_URL, type: 'drpy', enabled: true, subscriptionUrls: [] });
  }
  if (process.env.DRPY_ENABLED !== '1') snapshot.sources = snapshot.sources.filter((source) => source.type !== 'drpy');
  return snapshot;
}

export function assembleCatalog(
  feeds: { name: string; url: string; payload?: SourceListPayload; syncedAt?: number }[],
  syncedAt: string,
  catalogSource: string,
): CatalogSnapshot {
  const sources = new Map<string, CatalogVod>();
  const liveSources = new Map<string, CatalogLive>();
  const subscriptions = new Map<string, CatalogSnapshot['subscriptions'][number]>();
  const keys = new Set<string>();
  for (const feed of feeds) {
    const subscriptionUrl = catalogUrl(feed.url, 'subscription');
    subscriptions.set(subscriptionUrl, { name: feed.name, url: subscriptionUrl, enabled: !!feed.payload,
      ...(feed.payload ? { syncedAt: feed.syncedAt ?? Date.parse(syncedAt) } : {}) });
    for (const [kind, items] of [['vod', feed.payload?.sources ?? []], ['live', feed.payload?.liveSources ?? []]] as const) {
      for (const item of items) {
        const url = catalogUrl(item.url, kind);
        const own = kind === 'vod' ? sources : liveSources;
        const other = kind === 'vod' ? liveSources : sources;
        if (other.has(url)) throw new Error(`同一 URL 同时被声明为点播和直播：${url}`);
        const existing = own.get(url);
        if (existing) {
          if (!existing.subscriptionUrls.includes(subscriptionUrl)) existing.subscriptionUrls.push(subscriptionUrl);
          // 同 URL 的直播源合并可用 EPG，不重复存储源对象。
          if (kind === 'live' && 'epg' in item && item.epg && !('epg' in existing && existing.epg)) {
            (existing as CatalogLive).epg = item.epg;
          }
          continue;
        }
        const key = catalogKey(url, kind);
        if (keys.has(key)) throw new Error(`目录 key 冲突：${key}`);
        keys.add(key);
        // Imported T4 metadata has not passed a playback check; do not auto-enable remote engines.
        const entry = { ...item, url, key, enabled: !('type' in item && item.type === 't4'), subscriptionUrls: [subscriptionUrl] };
        if (kind === 'vod') sources.set(url, entry as CatalogVod);
        else liveSources.set(url, entry as CatalogLive);
      }
    }
  }
  return { version: 2, name: '资源目录统一源快照', catalogSource, syncedAt,
    subscriptions: [...subscriptions.values()], sources: [...sources.values()], liveSources: [...liveSources.values()] };
}

// 北京时间 2026-10-09 05:00 为固定锚点，跨月也严格间隔四天。
const ANCHOR = Date.parse('2026-10-09T05:00:00+08:00');
const PERIOD = 4 * 24 * 60 * 60 * 1000;
export function latestCatalogSlot(now: number): number {
  return ANCHOR + Math.floor((now - ANCHOR) / PERIOD) * PERIOD;
}
export function nextCatalogSlot(now: number): number {
  return latestCatalogSlot(now) + PERIOD;
}
