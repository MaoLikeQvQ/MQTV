import { describe, expect, it } from 'vitest';
import { migrateBrowserSettings, parseDeviceBackup } from './admin-data-panel';
import { DEFAULT_SITE, type SiteConfig } from '@/lib/site-config-types';
import { PERSIST_KEY } from '@/lib/persist-storage';
import { subKeyPrefix } from '@/lib/store';

describe('后台设备配置迁移', () => {
  it('恢复当前导出的历史结构，保留播放位置、封面和原始数据源地址', () => {
    const entry = { id: 'old_1', sourceKey: 'old', vodId: '1', sourceUrl: 'https://example.com/api', title: '测试视频', pic: 'https://example.com/cover.jpg', episodeIndex: 3, totalEpisodes: 12, playbackPosition: 48, duration: 100, timestamp: 123456 };
    const result = parseDeviceBackup({ name: 'LibreTV-Settings', data: { viewingHistory: JSON.stringify([entry]) } });
    expect(result.history).toEqual([entry]);
  });

  it('兼容旧版观看历史，同时拒绝损坏的历史定位信息', () => {
    const result = parseDeviceBackup({ name: 'LibreTV-Settings', data: { viewingHistory: JSON.stringify([{ sourceCode: 'legacy', vod_id: '8', title: '旧剧集', episodes: ['a', 'b'], episodeIndex: 1 }]) } });
    expect(result.history[0]).toMatchObject({ id: 'legacy_8', sourceKey: 'legacy', vodId: '8', totalEpisodes: 2, episodeIndex: 1 });
    expect(() => parseDeviceBackup({ name: 'LibreTV-Settings', data: { viewingHistory: '[{"title":"缺少定位信息"}]' } })).toThrow('缺少');
  });

  it('在写入前拒绝错误的设备设置类型', () => {
    expect(() => parseDeviceBackup({ name: 'LibreTV-Settings', data: { [PERSIST_KEY]: JSON.stringify({ state: { selectedKeys: ['valid', 1] } }) } })).toThrow('格式无效');
    expect(() => parseDeviceBackup({ name: 'LibreTV-Settings', data: { videoCacheSettings: { maxTotalBytes: 'unknown' } } })).toThrow('缓存容量设置格式无效');
  });

  it('迁移偏好与新数据源，保留已有同地址全站源和原浏览器数据', () => {
    const config: SiteConfig = { version: 1, revision: 4, site: { ...DEFAULT_SITE }, sources: [{ key: 'global', name: '全站名称', url: 'https://example.com/api', enabled: false }], liveSources: [], subscriptions: [] };
    const state = { customAPIs: [{ key: 'old', name: '旧名称', url: 'https://example.com/api' }, { key: 'new', name: '新源', url: 'https://other.example.com/api' }], selectedKeys: ['old', 'new'], imageProxyMode: 'custom', customImageProxy: 'https://image.example.com/?url={url}', adFilter: false, liveSubscriptions: [], subscriptions: [] };
    const before = JSON.stringify({ config, state });
    const next = migrateBrowserSettings(config, state);
    expect(next.sources).toHaveLength(2);
    expect(next.sources[0]).toEqual(config.sources[0]);
    expect(next.sources[1]).toMatchObject({ name: '新源', enabled: true });
    expect(next.site).toMatchObject({ imageMode: 'custom', customImageProxy: state.customImageProxy, adFilter: false });
    expect(next.revision).toBe(4);
    expect(JSON.stringify({ config, state })).toBe(before);
  });

  it('保留停用订阅的点播/直播归属和成员勾选状态，不将其提升为手动启用源', () => {
    const config: SiteConfig = { version: 1, revision: 0, site: { ...DEFAULT_SITE }, sources: [], liveSources: [], subscriptions: [] };
    const subscriptionUrl = 'https://subscription.example.com/list.json';
    const vodKey = `${subKeyPrefix(subscriptionUrl)}_0`;
    const otherVodKey = `${subKeyPrefix(subscriptionUrl)}_1`;
    const liveUrl = 'https://live.example.com/channels.m3u';
    const next = migrateBrowserSettings(config, {
      subscriptions: [{ url: subscriptionUrl, name: '旧订阅', enabled: false }],
      customAPIs: [{ key: vodKey, name: '订阅点播', url: 'https://vod.example.com/api' }, { key: otherVodKey, name: '未勾选点播', url: 'https://off.example.com/api' }], selectedKeys: [vodKey],
      liveSubscriptions: [{ name: '订阅直播', url: liveUrl, fromSubscriptions: [subscriptionUrl] }], liveSelectedUrls: [liveUrl],
    });
    expect(next.sources).toEqual([]);
    expect(next.liveSources).toEqual([]);
    expect(next.subscriptions).toHaveLength(1);
    expect(next.subscriptions[0]).toMatchObject({ enabled: false, sources: [{ name: '订阅点播', enabled: true }, { name: '未勾选点播', enabled: false }], liveSources: [{ url: liveUrl, enabled: true }] });
  });
});
