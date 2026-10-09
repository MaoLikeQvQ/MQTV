import { describe, expect, it, vi } from 'vitest';
import { setSourceEnabled, subscribedSources } from './admin-source-editor';
import { DEFAULT_SITE, type SiteConfig } from '@/lib/site-config-types';

vi.mock('./icon', () => ({ Icon: () => null }));

function fixture(): SiteConfig {
  return { version: 1, revision: 3, site: { ...DEFAULT_SITE }, sources: [], liveSources: [], subscriptions: [
    { name: '停用的订阅', url: 'https://example.com/one.json', enabled: false, sources: [{ key: 'shared', name: '共享源', url: 'https://example.com/api', enabled: true }] },
    { name: '启用的订阅', url: 'https://example.com/two.json', enabled: true, sources: [{ key: 'shared', name: '共享源', url: 'https://example.com/api', enabled: true }] },
  ] };
}

describe('后台共享源管理', () => {
  it('重复源优先显示启用的订阅成员，关闭时停用全部同地址成员', () => {
    const config = fixture();
    const [entry] = subscribedSources(config, 'sources');
    expect(subscribedSources(config, 'sources')).toHaveLength(1);
    expect(entry.subscriptionIndex).toBe(1);
    const next = setSourceEnabled(config, 'sources', entry.item.url, false, entry.subscriptionIndex);
    expect(next.subscriptions.every((s) => s.sources?.[0].enabled === false)).toBe(true);
    expect(config.subscriptions[1].sources?.[0].enabled).toBe(true);
  });

  it('重新启用一个所属订阅与成员，不改网站设置和另一订阅', () => {
    const config = setSourceEnabled(fixture(), 'sources', 'https://example.com/api', false);
    const next = setSourceEnabled(config, 'sources', 'https://example.com/api', true, 0);
    expect(next.subscriptions[0]).toMatchObject({ enabled: true, sources: [{ enabled: true }] });
    expect(next.subscriptions[1].sources?.[0].enabled).toBe(false);
    expect(next.site).toEqual(config.site);
    expect(next.revision).toBe(config.revision);
  });

  it('手动源与订阅同地址时只显示手动行，停用操作覆盖全部来源', () => {
    const config = fixture();
    config.sources.push({ key: 'manual', name: '手动源', url: 'https://example.com/api', enabled: false });
    expect(subscribedSources(config, 'sources')).toHaveLength(0);
    const next = setSourceEnabled(config, 'sources', 'https://example.com/api', false);
    expect(next.sources[0].enabled).toBe(false);
    expect(next.subscriptions.every((s) => s.sources?.[0].enabled === false)).toBe(true);
  });
});
