import { catalogKey, type CatalogSnapshot } from '../source-catalog';
import type { SourceCatalog } from '../source-catalog-types';
import { CCTV_SOURCE_URL } from '../cctv-source';

/** 仅虚构订阅与源地址；测试不能依赖部署者的私有文件。 */
export const catalog: SourceCatalog = {
  sourceUrl: 'https://catalog.example.com/index', fetchedAt: '2026-10-09T00:00:00.000Z',
  groups: { 示例: [
    { name: '示例入口 A', url: 'https://feed.example.com/a.json', description: '测试订阅' },
    { name: '示例入口 B', url: 'https://feed.example.com/b.json', description: '测试订阅' },
  ] },
};

const feedUrls = catalog.groups.示例.map((item) => item.url);
const vodUrl = 'https://vod.example.com/api';
const liveUrl = 'https://live.example.com/list.m3u';
export const snapshot: CatalogSnapshot = {
  version: 2, name: '测试快照', catalogSource: catalog.sourceUrl, syncedAt: catalog.fetchedAt,
  subscriptions: feedUrls.map((url) => ({ name: '测试订阅', url, enabled: true, syncedAt: Date.parse(catalog.fetchedAt) })),
  sources: [
    { key: catalogKey(vodUrl, 'vod'), name: '示例源', url: vodUrl, enabled: true, subscriptionUrls: feedUrls },
    { key: catalogKey(CCTV_SOURCE_URL, 'vod'), name: '央视公开点播', url: CCTV_SOURCE_URL, enabled: true, subscriptionUrls: [] },
  ],
  liveSources: [{ key: catalogKey(liveUrl, 'live'), name: '示例直播', url: liveUrl, enabled: true, subscriptionUrls: feedUrls }],
};
