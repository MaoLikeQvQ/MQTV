import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PUT } from './route';
import { GET as status } from '@/app/api/status/route';
import { GET as inspectSubscription } from '@/app/api/admin/source-list/route';
import { GET as authStatus, POST as login } from '@/app/api/auth/route';
import { guardRequest } from '@/lib/api-guard';
import { readSiteConfig, saveSiteConfig } from '@/lib/site-config';
import { SESSION_COOKIE, signSession } from '@/lib/auth';
import type { SiteConfig } from '@/lib/site-config-types';

// 此文件测试鉴权与持久化，项目源快照的初始化另有专项测试。
vi.mock('@/lib/source-presets', () => ({
  getSourcePresets: async () => [],
  refreshCatalogSubscription: async (subscriptions: SiteConfig['subscriptions']) => subscriptions,
}));

let directory: string;
const ADMIN_KEY = 'isolated-test-admin-key';

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'libretv-admin-test-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.stubEnv('ADMIN_KEY', ADMIN_KEY);
  vi.stubEnv('PASSWORD', 'visitor-password');
  vi.stubEnv('AUTH_DISABLED', 'false');
  vi.stubEnv('DEFAULT_SOURCES', '');
  vi.stubEnv('DEFAULT_LIVE_SOURCES', '');
  vi.stubEnv('DEFAULT_SUBSCRIPTIONS', '');
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

function request(method = 'GET', key: string | null = ADMIN_KEY, body?: unknown, extra: Record<string, string> = {}) {
  return new Request('http://localhost/api/admin/config', {
    method, headers: { ...(key ? { authorization: `Bearer ${key}` } : {}), ...extra },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

describe('独立管理密钥与配置持久化', () => {
  it('页面 Referer、访客 Cookie 和访客密码都不能代替管理密钥', async () => {
    const { token } = signSession();
    for (const req of [
      request('GET', null), request('GET', 'wrong'), request('GET', 'visitor-password'),
      request('GET', null, undefined, { cookie: `${SESSION_COOKIE}=${token}`, referer: 'http://localhost/admin' }),
      new Request(`http://localhost/api/admin/config?key=${ADMIN_KEY}`),
    ]) expect((await GET(req)).status).toBe(401);
    expect((await PUT(request('PUT', null, {}))).status).toBe(401);
  });

  it('未配置管理员密钥时拒绝访问，免密码模式也不会开放管理接口', async () => {
    vi.stubEnv('ADMIN_KEY', ''); vi.stubEnv('AUTH_DISABLED', 'true');
    expect((await GET(request())).status).toBe(503);
    expect((await PUT(request('PUT', ADMIN_KEY, {}))).status).toBe(503);
  });

  it('正确密钥读取管理配置，响应不缓存且不包含密钥和密码', async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    expect(text).not.toContain(ADMIN_KEY); expect(text).not.toContain('visitor-password');
  });

  it('从环境变量初始化后，保存的空列表优先且未知凭证字段不落盘', async () => {
    vi.stubEnv('DEFAULT_SOURCES', JSON.stringify([{ name: '环境源', url: 'https://vod.example.com/api.php' }]));
    const initial = await readSiteConfig();
    expect(initial.sources).toHaveLength(1);
    const response = await PUT(request('PUT', ADMIN_KEY, { ...initial, sources: [], ADMIN_KEY: 'must-not-persist' }));
    expect(response.status).toBe(200);
    const saved = await readSiteConfig();
    expect(saved.sources).toEqual([]); expect(saved.revision).toBe(1);
    expect(await readFile(path.join(directory, 'site-config.json'), 'utf8')).not.toContain('must-not-persist');
  });

  it('免密码访问不需要 PASSWORD 或 Cookie，但管理接口仍需密钥', async () => {
    vi.stubEnv('PASSWORD', '');
    const initial = await readSiteConfig();
    await saveSiteConfig({ ...initial, site: { ...initial.site, authDisabled: true } });
    const req = new Request('http://localhost/api/status');
    expect(await guardRequest(req)).toBeNull();
    expect(await (await status(req)).json()).toMatchObject({ authDisabled: true, verified: true, passwordRequired: false });
    expect(await (await authStatus(req)).json()).toMatchObject({ verified: true });
    expect((await login(new Request('http://localhost/api/auth', { method: 'POST' }))).status).toBe(200);
    expect((await GET(request('GET', null))).status).toBe(401);
  });

  it('旧 PASSWORD、AUTH_DISABLED 和旧文件都不能重新开启访客密码验证', async () => {
    const initial = await readSiteConfig();
    await writeFile(path.join(directory, 'site-config.json'), JSON.stringify({
      ...initial, site: { ...initial.site, authDisabled: false },
    }));
    expect((await readSiteConfig()).site.authDisabled).toBe(true);
    const req = new Request('http://localhost/api/search');
    expect(await guardRequest(req)).toBeNull();
    vi.stubEnv('PASSWORD', '');
    expect(await guardRequest(req)).toBeNull();
    const response = await PUT(request('PUT', ADMIN_KEY, { ...initial, site: { ...initial.site, authDisabled: false } }));
    expect(response.status).toBe(200);
    expect((await readSiteConfig()).site.authDisabled).toBe(true);
  });

  it('迁移旧网站文件时补齐新增设置，已有值不丢失', async () => {
    const config = await readSiteConfig();
    const { name, description, announcement, recommendSource, imageMode } = config.site;
    await writeFile(path.join(directory, 'site-config.json'), JSON.stringify({ ...config,
      site: { name, description, announcement, recommendSource, imageMode, authDisabled: false },
    }));
    expect((await readSiteConfig()).site).toMatchObject({
      authDisabled: true, yellowFilter: true, adFilter: true, doubanEnabled: true,
      autoplayNext: true, cacheEnabled: true, customImageProxy: '',
    });
  });

  it('统一播放与封面设置白名单保存，自定义代理必须包含 URL 占位符', async () => {
    const config = await readSiteConfig();
    expect((await PUT(request('PUT', ADMIN_KEY, { ...config, site: {
      ...config.site, imageMode: 'custom', customImageProxy: 'https://proxy.example.com/image',
    } }))).status).toBe(400);
    await saveSiteConfig({ ...config, site: { ...config.site, adFilter: false, cacheEnabled: false,
      imageMode: 'custom', customImageProxy: 'https://proxy.example.com/?url={url}',
    } });
    expect((await readSiteConfig()).site).toMatchObject({ adFilter: false, cacheEnabled: false,
      imageMode: 'custom', customImageProxy: 'https://proxy.example.com/?url={url}' });
  });

  it('订阅快照只在启用时发布，并按地址去重，不暴露订阅地址', async () => {
    const config = await readSiteConfig();
    const source = { key: 'manual', name: '手动', url: 'https://vod.example.com/on', enabled: true };
    await saveSiteConfig({ ...config, sources: [source], subscriptions: [
      { name: '启用', url: 'https://feed.example.com/private', enabled: true, syncedAt: 123,
        sources: [{ ...source, key: 'duplicate' }, { key: 'snapshot', name: '订阅源', url: 'https://vod.example.com/sub' },
          { key: 'snapshot-off', name: '禁用订阅单项', url: 'https://vod.example.com/sub-off', enabled: false }],
        liveSources: [{ key: 'live', name: '直播', url: 'https://live.example.com/list.m3u' },
          { key: 'live-off', name: '禁用直播', url: 'https://live.example.com/off.m3u', enabled: false }] },
      { name: '停用', url: 'https://feed.example.com/disabled', enabled: false,
        sources: [{ key: 'disabled', name: '停用源', url: 'https://vod.example.com/off' }] },
    ] });
    const data = await (await status(new Request('http://localhost/api/status'))).json();
    expect(data.defaultSources.map((s: { key: string }) => s.key)).toEqual(['manual', 'snapshot']);
    expect(data.defaultLiveSources.map((s: { key: string }) => s.key)).toEqual(['live']);
    expect(data.defaultSubscriptions).toEqual([]);
    expect(data.defaultSources[1]).not.toHaveProperty('enabled');
    expect(data.defaultLiveSources[0]).not.toHaveProperty('enabled');
    const persisted = await readSiteConfig();
    expect(persisted.subscriptions[0].sources?.[1].enabled).toBe(true);
    expect(persisted.subscriptions[0].sources?.[2].enabled).toBe(false);
    expect(persisted.subscriptions[0].liveSources?.[1].enabled).toBe(false);
    expect(JSON.stringify(data)).not.toContain('feed.example.com');
  });

  it('公开状态仅下发启用条目，不下发管理密钥', async () => {
    const config = await readSiteConfig();
    await saveSiteConfig({ ...config,
      sources: [
        { key: 'on', name: '启用', url: 'https://vod.example.com/on', enabled: true },
        { key: 'off', name: '停用', url: 'https://vod.example.com/off', enabled: false },
      ],
      subscriptions: [{ name: '停用订阅', url: 'https://feed.example.com/off', enabled: false }],
    });
    const response = await status(new Request('http://localhost/api/status'));
    const data = await response.json();
    expect(data.defaultSources.map((s: { key: string }) => s.key)).toEqual(['on']);
    expect(data.defaultSubscriptions).toEqual([]);
    expect(JSON.stringify(data)).not.toContain(ADMIN_KEY);
  });

  it('拒绝旧修订号和并发覆盖，写入后可重新读取完整配置', async () => {
    const initial = await readSiteConfig();
    const results = await Promise.all([
      PUT(request('PUT', ADMIN_KEY, { ...initial, site: { ...initial.site, name: '甲' } })),
      PUT(request('PUT', ADMIN_KEY, { ...initial, site: { ...initial.site, name: '乙' } })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const stored = JSON.parse(await readFile(path.join(directory, 'site-config.json'), 'utf8')) as SiteConfig;
    expect(stored.revision).toBe(1); expect(['甲', '乙']).toContain(stored.site.name);
  });

  it('拒绝非法数据、重复标识、凭证 URL、超限和坏 JSON', async () => {
    const initial = await readSiteConfig();
    const source = { key: 'same', name: '源', url: 'https://vod.example.com/api', enabled: true };
    for (const body of [
      { ...initial, site: { ...initial.site, authDisabled: 'true' } },
      { ...initial, sources: [source, { ...source, url: 'https://other.example.com/api' }] },
      { ...initial, sources: [{ ...source, url: 'https://user:secret@vod.example.com/api' }] },
      { ...initial, sources: Array(101).fill(source) },
    ]) expect((await PUT(request('PUT', ADMIN_KEY, body))).status).toBe(400);
    expect((await PUT(new Request('http://localhost/api/admin/config', { method: 'PUT', headers: { authorization: `Bearer ${ADMIN_KEY}` }, body: '{' }))).status).toBe(400);
    expect((await PUT(request('PUT', ADMIN_KEY, 'x'.repeat(256 * 1024)))).status).toBe(413);
    expect((await readSiteConfig()).revision).toBe(0);
  });

  it('损坏的磁盘配置报错，不静默回落环境变量或伪造成功', async () => {
    await writeFile(path.join(directory, 'site-config.json'), '{');
    expect((await GET(request())).status).toBe(500);
  });

  it('后台订阅接口在鉴权前不访问第三方，非法内网目标仍被拒绝', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const target = 'http://localhost/api/admin/source-list?url=http://127.0.0.1/config';
    expect((await inspectSubscription(new Request(target))).status).toBe(401);
    expect((await inspectSubscription(new Request(target, { headers: { authorization: `Bearer ${ADMIN_KEY}` } }))).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
