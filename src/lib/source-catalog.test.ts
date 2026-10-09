import { describe, expect, it } from 'vitest';
import { snapshot, catalog } from './testing/catalog-fixture';
import { assembleCatalog, catalogKey, catalogUrl, latestCatalogSlot, nextCatalogSlot } from './source-catalog';

describe('目录全局去重与标识', () => {
  it('跨订阅合并点播 URL 与列表参数，记录出处并按 URL 稳定生成 key', () => {
    const feeds = [
      { name: 'A', url: 'https://feed.example.com/a', payload: { sources: [{ name: '源', url: 'https://CMS.example.com:443/api.php/provide/vod/?ac=list' }], liveSources: [] } },
      { name: 'B', url: 'https://feed.example.com/b', payload: { sources: [{ name: '另一名称', url: 'https://cms.example.com/api.php/provide/vod' }], liveSources: [] } },
    ];
    const result = assembleCatalog(feeds, snapshot.syncedAt, catalog.sourceUrl);
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ url: 'https://cms.example.com/api.php/provide/vod', subscriptionUrls: feeds.map((f) => f.url) });
    expect(assembleCatalog(feeds.toReversed(), snapshot.syncedAt, catalog.sourceUrl).sources[0].key).toBe(result.sources[0].key);
    expect(result.subscriptions.every((s) => !('sources' in s) && !('liveSources' in s))).toBe(true);
  });

  it('不同 URL 即使上游 key 相同也保留，直播签名参数保持原样并补齐 EPG', () => {
    const feeds = [
      { name: 'A', url: 'https://feed.example.com/a', payload: { sources: [
        { name: '源一', url: 'https://one.example.com/api', key: 'duplicate' },
        { name: '源二', url: 'https://two.example.com/api', key: 'duplicate' },
      ], liveSources: [{ name: '直播', url: 'https://live.example.com/list.m3u?token=abc&ac=list' }] } },
      { name: 'B', url: 'https://feed.example.com/b', payload: { sources: [], liveSources: [{ name: '直播重复', url: 'https://live.example.com/list.m3u?token=abc&ac=list', epg: 'https://epg.example.com/e.xml' }] } },
    ];
    const result = assembleCatalog(feeds, snapshot.syncedAt, catalog.sourceUrl);
    expect(result.sources).toHaveLength(2);
    expect(new Set(result.sources.map((s) => s.key)).size).toBe(2);
    expect(result.liveSources).toHaveLength(1);
    expect(result.liveSources[0]).toMatchObject({ url: 'https://live.example.com/list.m3u?token=abc&ac=list', epg: 'https://epg.example.com/e.xml' });
  });

  it('自动目录保留T4协议和查询参数，未验证的远程引擎默认停用', () => {
    const result = assembleCatalog([{ name: 'T4订阅', url: 'https://feed.example.com/t4', payload: {
      sources: [{ name: 'T4', url: 'https://t4.example.com/api?id=bMTV', type: 't4' }], liveSources: [],
    } }], snapshot.syncedAt, catalog.sourceUrl);
    expect(result.sources[0]).toMatchObject({ type: 't4', url: 'https://t4.example.com/api?id=bMTV', enabled: false });
  });

  it('同一 URL 被放进不同源类型时显式报错', () => {
    expect(() => assembleCatalog([{ name: '冲突', url: 'https://feed.example.com/a', payload: {
      sources: [{ name: '点播', url: 'https://same.example.com/api' }],
      liveSources: [{ name: '直播', url: 'https://same.example.com/api' }],
    } }], snapshot.syncedAt, catalog.sourceUrl)).toThrow('同时被声明为点播和直播');
  });

  it('实际目录入口、两类快照的 URL 和 key 全局唯一', () => {
    const urls = Object.values(catalog.groups).flat().map((s) => catalogUrl(s.url, 'subscription'));
    expect(new Set(urls).size).toBe(urls.length);
    const all = [...snapshot.sources, ...snapshot.liveSources];
    expect(new Set(all.map((s) => s.url)).size).toBe(all.length);
    expect(new Set(all.map((s) => s.key)).size).toBe(all.length);
    for (const [kind, entries] of [['vod', snapshot.sources], ['live', snapshot.liveSources]] as const) {
      for (const s of entries) expect(s.key).toBe(catalogKey(catalogUrl(s.url, kind), kind));
    }
  });
});

describe('北京时间每四天 05:00', () => {
  it('05:00 边界和跨月都保持四天间隔，执行耗时不改变下个时间', () => {
    expect(new Date(nextCatalogSlot(Date.parse('2026-10-09T14:00:00+08:00'))).toISOString()).toBe('2026-10-12T21:00:00.000Z');
    const before = Date.parse('2026-10-13T04:59:59+08:00');
    expect(nextCatalogSlot(before)).toBe(Date.parse('2026-10-13T05:00:00+08:00'));
    expect(latestCatalogSlot(before + 1000)).toBe(before + 1000);
    expect(nextCatalogSlot(Date.parse('2026-10-29T06:00:00+08:00'))).toBe(Date.parse('2026-11-02T05:00:00+08:00'));
  });
});
