import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readSiteConfig } from './site-config';
import { getSourcePresets } from './source-presets';
import { DEFAULT_SITE } from './site-config-types';
import { snapshot, catalog } from './testing/catalog-fixture';
import { GET as status } from '@/app/api/status/route';
import { DRPY_SOURCE_URL } from './spider-source';
import { CCTV_SOURCE_URL } from './cctv-source';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'libretv-presets-test-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.stubEnv('DRPY_ENABLED', '0');
  for (const name of ['DEFAULT_SOURCES', 'DEFAULT_LIVE_SOURCES', 'DEFAULT_SUBSCRIPTIONS']) vi.stubEnv(name, '');
  await writeFile(path.join(directory, 'source-presets.json'), JSON.stringify(snapshot));
  await writeFile(path.join(directory, 'tvbox-catalog.json'), JSON.stringify(catalog));
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe('私有资源快照读取', () => {
  it('没有私有文件时首次启动源列表为空，不附带真实目录', async () => {
    await rm(path.join(directory, 'source-presets.json'));
    await rm(path.join(directory, 'tvbox-catalog.json'));
    expect(await readSiteConfig()).toMatchObject({ site: { name: 'MQTV' }, sources: [], liveSources: [], subscriptions: [] });
    vi.stubEnv('DRPY_ENABLED', '1');
    expect((await readSiteConfig()).subscriptions).toEqual([]);
  });

  it('损坏的私有目录明确报错，不静默回落预置数据', async () => {
    await rm(path.join(directory, 'source-presets.json'));
    await writeFile(path.join(directory, 'tvbox-catalog.json'), '{');
    await expect(readSiteConfig()).rejects.toThrow();
  });

  it('首次启动通过私有目录订阅下发点播与直播源', async () => {
    const config = await readSiteConfig();
    expect(config.subscriptions).toHaveLength(1);
    expect(config.subscriptions[0]).toMatchObject({ url: snapshot.catalogSource, enabled: true });
    const publicStatus = await (await status(new Request('http://localhost/api/status'))).json();
    expect(publicStatus.defaultSources).toHaveLength(2);
    expect(publicStatus.defaultLiveSources).toHaveLength(1);
    expect(publicStatus.defaultSubscriptions).toEqual([]);
    expect(JSON.stringify(publicStatus)).not.toContain('catalogSource');
    const again = await getSourcePresets();
    config.subscriptions[0].enabled = false;
    expect(again[0].enabled).toBe(true);
  });

  it('服务器刷新后读取持久化快照，保留网站、手动源、订阅及单源停用选择', async () => {
    const config = await readSiteConfig();
    config.revision = 3;
    config.site.name = '管理员网站';
    config.sources = [{ key: 'manual', name: '手动源', url: 'https://manual.example.com/api', enabled: true }];
    config.subscriptions[0].enabled = false;
    config.subscriptions[0].sources![0].enabled = false;
    await writeFile(path.join(directory, 'site-config.json'), JSON.stringify(config));
    const updated = structuredClone(snapshot);
    updated.syncedAt = '2026-10-13T00:00:00.000Z';
    updated.sources[0].name = '更新后的名称';
    updated.sources.push({ key: 'catalog_vod_new', name: '新增源', url: 'https://new.example.com/api', enabled: true, subscriptionUrls: [] });
    await writeFile(path.join(directory, 'source-presets.json'), JSON.stringify(updated));
    const current = await readSiteConfig();
    expect(current).toMatchObject({ revision: 3, site: { name: '管理员网站' }, sources: config.sources });
    expect(current.subscriptions[0]).toMatchObject({ enabled: false, syncedAt: Date.parse(updated.syncedAt) });
    expect(current.subscriptions[0].sources![0]).toMatchObject({ name: '更新后的名称', enabled: false });
    expect(current.subscriptions[0].sources!.at(-1)).toMatchObject({ key: 'catalog_vod_new', enabled: true });
  });

  it('部署启用drpy后下发协议并保留管理员停用，关闭服务移除托管源', async () => {
    vi.stubEnv('DRPY_ENABLED', '1');
    const config = await readSiteConfig();
    const item = config.subscriptions[0].sources!.find((entry) => entry.url === DRPY_SOURCE_URL)!;
    expect(item).toMatchObject({ type: 'drpy', enabled: true });
    item.enabled = false;
    await writeFile(path.join(directory, 'site-config.json'), JSON.stringify(config));
    expect((await readSiteConfig()).subscriptions[0].sources!.find((entry) => entry.url === DRPY_SOURCE_URL)?.enabled).toBe(false);
    item.enabled = true;
    await writeFile(path.join(directory, 'site-config.json'), JSON.stringify(config));
    const publicStatus = await (await status(new Request('http://localhost/api/status'))).json();
    expect(publicStatus.defaultSources.find((entry: { url: string }) => entry.url === DRPY_SOURCE_URL)).toMatchObject({ type: 'drpy' });
    vi.stubEnv('DRPY_ENABLED', '0');
    expect((await readSiteConfig()).subscriptions[0].sources!.some((entry) => entry.url === DRPY_SOURCE_URL)).toBe(false);
  });

  it('显式环境订阅替换项目默认订阅', async () => {
    vi.stubEnv('DEFAULT_SUBSCRIPTIONS', '[{"name":"管理员预置","url":"https://example.com/feed.json"}]');
    expect((await readSiteConfig()).subscriptions).toEqual([{ name: '管理员预置', url: 'https://example.com/feed.json', enabled: true }]);
  });

  it('升级旧持久化目录时加入央视适配源，后续读取保留管理员停用选择', async () => {
    const old = structuredClone(snapshot);
    old.sources = old.sources.filter((source) => source.url !== CCTV_SOURCE_URL);
    await writeFile(path.join(directory, 'source-presets.json'), JSON.stringify(old));
    const config = await readSiteConfig();
    const source = config.subscriptions[0].sources!.find((item) => item.url === CCTV_SOURCE_URL)!;
    expect(source).toMatchObject({ name: '央视公开点播', enabled: true });
    source.enabled = false;
    await writeFile(path.join(directory, 'site-config.json'), JSON.stringify(config));
    const current = await readSiteConfig();
    expect(current.subscriptions[0].sources!.filter((item) => item.url === CCTV_SOURCE_URL)).toEqual([source]);
    expect((await (await status(new Request('http://localhost/api/status'))).json()).defaultSources
      .some((item: { url: string }) => item.url === CCTV_SOURCE_URL)).toBe(false);
  });

  it('已保存的空列表不会被项目快照自动补回', async () => {
    await writeFile(path.join(directory, 'site-config.json'), JSON.stringify({
      version: 1, revision: 2, site: { ...DEFAULT_SITE, name: '已保存的网站' },
      sources: [], liveSources: [], subscriptions: [],
    }));
    const config = await readSiteConfig();
    expect(config.site.name).toBe('已保存的网站');
    expect(config.subscriptions).toEqual([]);
  });
});
