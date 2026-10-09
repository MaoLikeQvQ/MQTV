import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { GET } from './route';
import { catalog } from '@/lib/testing/catalog-fixture';

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'mqtv-private-catalog-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.stubEnv('ADMIN_KEY', 'test-admin-key');
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });
const request = (authorized = true) => new Request('http://localhost/api/admin/catalog', {
  headers: authorized ? { Authorization: 'Bearer test-admin-key' } : {},
});

it('私有目录仅在管理员鉴权后读取，访客请求不读取损坏文件', async () => {
  await writeFile(path.join(directory, 'tvbox-catalog.json'), '{');
  expect((await GET(request(false))).status).toBe(401);
  expect((await GET(request())).status).toBe(500);
  await writeFile(path.join(directory, 'tvbox-catalog.json'), JSON.stringify(catalog));
  const response = await GET(request());
  expect(await response.json()).toEqual(catalog);
  expect(response.headers.get('cache-control')).toBe('no-store');
});

it('没有私有目录时返回空目录，凭证地址不被接受', async () => {
  expect(await (await GET(request())).json()).toEqual({ sourceUrl: '', fetchedAt: '', groups: {} });
  await writeFile(path.join(directory, 'tvbox-catalog.json'), JSON.stringify({ ...catalog, sourceUrl: 'https://user:secret@example.com/catalog' }));
  expect((await GET(request())).status).toBe(500);
});
