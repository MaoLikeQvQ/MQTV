import { beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';
import { readSiteConfig } from '@/lib/site-config';
import { DEFAULT_SITE } from '@/lib/site-config-types';

vi.mock('@/lib/site-config', () => ({ readSiteConfig: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });

it('健康检查只返回状态和版本，不返回私有源或凭证', async () => {
  vi.mocked(readSiteConfig).mockResolvedValue({ version: 1, revision: 0, site: DEFAULT_SITE,
    sources: [{ key: 'private', name: '私有源', url: 'https://private.example.com/api', enabled: true }], liveSources: [], subscriptions: [] });
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, version: process.env.APP_VERSION || 'dev' });
});

it('配置无法读取时返回503，让部署健康检查失败', async () => {
  vi.mocked(readSiteConfig).mockRejectedValue(new Error('private path or credentials'));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ ok: false });
});
