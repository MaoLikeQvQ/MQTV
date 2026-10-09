import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { GET } from '@/app/api/admin/visitors/route';
import { readVisitorStats, recordVisit } from '@/lib/visitor-store';
import { visitorDay } from '@/lib/visitor-types';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

const KEY_A = '12345678-1234-4123-8123-123456789abc';
const KEY_B = '22345678-1234-4123-8123-123456789abc';
let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'libretv-visitors-test-'));
  vi.stubEnv('DATA_DIR', directory);
  vi.stubEnv('ADMIN_KEY', 'isolated-statistics-admin-key');
  vi.stubEnv('PASSWORD', 'isolated-visitor-password');
});

afterEach(async () => {
  vi.useRealTimers(); vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

function request(body: unknown, extra: Record<string, string> = {}) {
  return new Request('http://localhost/api/visit', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body),
  });
}

describe('新增浏览器访客与每日回访', () => {
  it('同一标识并发刷新与多标签上报不重复计数，大小写也不会产生新身份', async () => {
    const date = new Date('2026-10-09T02:00:00Z');
    await Promise.all(Array.from({ length: 20 }, (_, i) => recordVisit(i % 2 ? KEY_A.toUpperCase() : KEY_A, date)));
    const stats = await readVisitorStats(date);
    expect(stats.totalVisitors).toBe(1);
    expect(stats.today).toEqual({ date: '2026-10-09', newVisitors: 1, activeVisitors: 1, returningVisitors: 0 });
    const log = await readFile(path.join(directory, 'visitor-events.jsonl'), 'utf8');
    expect(log.trim().split('\n')).toHaveLength(1);
    expect(log).not.toContain(KEY_A);
    expect(Object.keys(JSON.parse(log))).toEqual(['hash', 'day']);
  });

  it('北京时间午夜跨日：旧标识计回访，新标识计新增，累计只增长一次', async () => {
    const before = new Date('2026-10-09T15:59:59Z');
    const after = new Date('2026-10-09T16:00:00Z');
    expect(visitorDay(before)).toBe('2026-10-09'); expect(visitorDay(after)).toBe('2026-10-10');
    await recordVisit(KEY_A, before);
    await recordVisit(KEY_A, after);
    await recordVisit(KEY_B, after);
    const stats = await readVisitorStats(after);
    expect(stats.totalVisitors).toBe(2);
    expect(stats.today).toMatchObject({ newVisitors: 1, activeVisitors: 2, returningVisitors: 1 });
    expect(stats.days.find((day) => day.date === '2026-10-09')).toMatchObject({ newVisitors: 1, activeVisitors: 1 });
    expect(stats.days).toHaveLength(30);
  });

  it('服务器时间决定统计日期，忽略客户端日期、路径和伪造新增字段', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T02:00:00Z'));
    const response = await POST(request({ ukey: KEY_A, day: '2099-01-01', isNew: false, path: '/watch?secret=x' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ day: '2026-10-09' });
    const log = await readFile(path.join(directory, 'visitor-events.jsonl'), 'utf8');
    expect(log).not.toContain('2099'); expect(log).not.toContain('secret');
    expect((await readVisitorStats()).today.newVisitors).toBe(1);
  });

  it('没有访问时填补零值日期，不将累计用户误算为当日活跃', async () => {
    await recordVisit(KEY_A, new Date('2026-09-01T00:00:00Z'));
    const stats = await readVisitorStats(new Date('2026-10-09T00:00:00Z'));
    expect(stats.totalVisitors).toBe(1);
    expect(stats.today.activeVisitors).toBe(0);
    expect(stats.days.every((day) => day.newVisitors === 0 && day.activeVisitors === 0)).toBe(true);
  });

  it('切换数据目录后重读持久记录，重复访客不因索引重新初始化被算作新增', async () => {
    const today = new Date('2026-10-09T00:00:00Z');
    await recordVisit(KEY_A, today);
    vi.stubEnv('DATA_DIR', path.join(directory, 'other'));
    await recordVisit(KEY_B, today);
    vi.stubEnv('DATA_DIR', directory);
    await recordVisit(KEY_A, today);
    expect((await readVisitorStats(today)).totalVisitors).toBe(1);
    expect((await readFile(path.join(directory, 'visitor-events.jsonl'), 'utf8')).trim().split('\n')).toHaveLength(1);
  });

  it('不完整尾行只在写入初始化时修复，完整坏记录报错而不显示虚假零值', async () => {
    await writeFile(path.join(directory, 'visitor-events.jsonl'), '{"hash":"interrupted');
    await recordVisit(KEY_A, new Date('2026-10-09T00:00:00Z'));
    expect((await readVisitorStats(new Date('2026-10-09T00:00:00Z'))).totalVisitors).toBe(1);
    await writeFile(path.join(directory, 'visitor-events.jsonl'), 'invalid-json\n');
    const response = await GET(new Request('http://localhost/api/admin/visitors', { headers: { authorization: 'Bearer isolated-statistics-admin-key' } }));
    expect(response.status).toBe(500);
  });

  it('统计查询要求管理员密钥，访客标识和有效访客 Cookie 不能授权', async () => {
    const { token } = signSession();
    const attempts: Record<string, string>[] = [
      {}, { authorization: `Bearer ${KEY_A}` }, { cookie: `${SESSION_COOKIE}=${token}` },
    ];
    for (const headers of attempts) expect((await GET(new Request('http://localhost/api/admin/visitors', { headers }))).status).toBe(401);
    const response = await GET(new Request('http://localhost/api/admin/visitors', { headers: { authorization: 'Bearer isolated-statistics-admin-key' } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.text();
    expect(body).not.toContain(KEY_A); expect(body).not.toContain('hash');
    vi.stubEnv('ADMIN_KEY', '');
    expect((await GET(new Request('http://localhost/api/admin/visitors'))).status).toBe(503);
  });

  it('拒绝非法标识、大请求、坏 JSON 和跨站上报', async () => {
    for (const body of [{}, { ukey: 'not-a-uuid' }, { ukey: 123 }, null]) expect((await POST(request(body))).status).toBe(400);
    expect((await POST(request({ ukey: KEY_A }, { 'sec-fetch-site': 'cross-site' }))).status).toBe(403);
    expect((await POST(request({ ukey: KEY_A }, { 'Content-Type': 'text/plain' }))).status).toBe(415);
    expect((await POST(request({ ukey: 'x'.repeat(256) }))).status).toBe(413);
    expect((await POST(new Request('http://localhost/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }))).status).toBe(400);
    expect((await readVisitorStats()).totalVisitors).toBe(0);
  });

  it('磁盘写入失败返回失败，不伪造成功', async () => {
    const blocked = path.join(directory, 'blocked');
    await writeFile(blocked, 'not-a-directory'); vi.stubEnv('DATA_DIR', blocked);
    expect((await POST(request({ ukey: KEY_A }))).status).toBe(500);
  });
});
