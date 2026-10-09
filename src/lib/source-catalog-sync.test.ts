import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { snapshot, catalog } from './testing/catalog-fixture';
import { fetchUpstream } from './fetch-utils';
import { checkUpstreamAllowed } from './ssrf';
import { checkCatalogSchedule, refreshSourceCatalog } from './source-catalog-sync';

vi.mock('./fetch-utils', () => ({ fetchUpstream: vi.fn() }));
vi.mock('./ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));

let directory: string;
const raw = catalog.groups.示例[0].url;
const cdn = catalog.groups.示例[1].url;
const sourceUrl = 'https://vod.example.com/api';
const response = () => new Response(JSON.stringify({ sources: [{ name: '示例源', url: sourceUrl }], liveSources: [] }));

beforeEach(async () => {
  vi.clearAllMocks();
  directory = await mkdtemp(path.join(os.tmpdir(), 'libretv-catalog-sync-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.stubEnv('DRPY_ENABLED', '0');
  await writeFile(path.join(directory, 'source-presets.json'), JSON.stringify(snapshot));
  await writeFile(path.join(directory, 'tvbox-catalog.json'), JSON.stringify(catalog));
  vi.mocked(fetchUpstream).mockImplementation(async () => response());
  vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: true });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe('目录实际刷新流程', () => {
  it('没有私有目录时不发起任何上游请求', async () => {
    await rm(path.join(directory, 'tvbox-catalog.json'));
    await checkCatalogSchedule();
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
  it('每个入口都访问，两个配置地址共同贡献一个接口，源对象只存一份', async () => {
    const result = await refreshSourceCatalog(Date.parse('2026-10-13T05:00:00+08:00'));
    expect(fetchUpstream).toHaveBeenCalledWith(raw, expect.anything());
    expect(fetchUpstream).toHaveBeenCalledWith(cdn, expect.anything());
    expect(fetchUpstream).toHaveBeenCalledTimes(Object.values(catalog.groups).flat().length);
    expect(result.sources).toHaveLength(2);
    expect(result.sources[0].subscriptionUrls).toEqual(expect.arrayContaining([raw, cdn]));
    const saved = JSON.parse(await readFile(path.join(directory, 'source-presets.json'), 'utf8'));
    expect(saved.sources).toHaveLength(2);
    expect(saved.subscriptions.every((s: object) => !('sources' in s) && !('liveSources' in s))).toBe(true);
  });

  it('一个配置失败仍使用另一个配置，新成功源和失败入口的旧源都保留', async () => {
    vi.mocked(fetchUpstream).mockImplementation(async (url) => {
      if (url === raw) throw new Error('连接超时');
      return response();
    });
    const result = await refreshSourceCatalog();
    expect(fetchUpstream).toHaveBeenCalledWith(cdn, expect.anything());
    const source = result.sources.filter((s) => s.url === sourceUrl);
    expect(source).toHaveLength(1);
    expect(source[0].subscriptionUrls).toEqual(expect.arrayContaining([raw, cdn]));
    const report = JSON.parse(await readFile(path.join(directory, 'source-sync-report.json'), 'utf8'));
    expect(report.results.find((r: { url: string }) => r.url === raw)).toMatchObject({ success: false, retained: true, error: '连接超时' });
    expect(report.results.find((r: { url: string }) => r.url === cdn)).toMatchObject({ success: true });
  });

  it('全部失败保留快照原文并写报告，同一调度周期重启后也不重复请求', async () => {
    const original = JSON.stringify(snapshot);
    await writeFile(path.join(directory, 'source-presets.json'), original);
    vi.mocked(fetchUpstream).mockRejectedValue(new Error('网络不可用'));
    const now = Date.parse('2026-10-13T05:00:00+08:00');
    await expect(refreshSourceCatalog(now)).rejects.toThrow('全部订阅刷新失败');
    expect(await readFile(path.join(directory, 'source-presets.json'), 'utf8')).toBe(original);
    const calls = vi.mocked(fetchUpstream).mock.calls.length;
    await checkCatalogSchedule(now + 60_000);
    expect(fetchUpstream).toHaveBeenCalledTimes(calls);
  });

  it('05:00 前不执行，到点执行一次，持久化报告防止重复补跑', async () => {
    const now = Date.parse('2026-10-13T05:00:00+08:00');
    await checkCatalogSchedule(now - 1);
    expect(fetchUpstream).not.toHaveBeenCalled();
    await checkCatalogSchedule(now);
    const calls = vi.mocked(fetchUpstream).mock.calls.length;
    expect(calls).toBeGreaterThan(0);
    await checkCatalogSchedule(now + 60_000);
    expect(fetchUpstream).toHaveBeenCalledTimes(calls);
  });
});
