import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

const upstream = vi.hoisted(() => vi.fn());
vi.mock('@/lib/fetch-utils', () => ({ fetchUpstream: upstream }));
vi.mock('@/lib/ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));

beforeEach(() => {
  vi.stubEnv('ADMIN_KEY', 'isolated-probe-key');
  vi.stubEnv('PASSWORD', 'visitor-key');
  upstream.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe('点播源管理测活', () => {
  it('没有管理密钥时不访问上游，访客会话与页面来源均无效', async () => {
    const requests: Record<string, string>[] = [
      {},
      { cookie: `${SESSION_COOKIE}=${signSession().token}`, referer: 'http://localhost/admin' },
      { authorization: 'Bearer wrong' },
    ];
    for (const headers of requests) {
      expect((await POST(new Request('http://localhost/api/source/test', {
        method: 'POST', headers, body: JSON.stringify({ url: 'https://vod.example.com/api' }),
      }))).status).toBe(401);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it('正确密钥可测活并保留解析结果', async () => {
    upstream.mockResolvedValue(new Response(JSON.stringify({ list: [] }), { status: 200 }));
    const response = await POST(new Request('http://localhost/api/source/test', {
      method: 'POST', headers: { authorization: 'Bearer isolated-probe-key' },
      body: JSON.stringify({ url: 'https://vod.example.com/api' }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, count: 0 });
    expect(upstream).toHaveBeenCalledOnce();
  });

  it('央视源通过官方搜索探活，不拼接CMS参数', async () => {
    upstream.mockResolvedValue(new Response(JSON.stringify({ totalpage: 1, list: [{
      all_title: '新闻联播', urllink: 'https://tv.cctv.com/2026/10/08/VIDEabc.shtml',
    }] })));
    const response = await POST(new Request('http://localhost/api/source/test', {
      method: 'POST', headers: { authorization: 'Bearer isolated-probe-key' },
      body: JSON.stringify({ url: 'https://search.cctv.com/ifsearch.php' }),
    }));
    expect(await response.json()).toMatchObject({ ok: true, count: 1 });
    const url = new URL(upstream.mock.calls[0][0]);
    expect(url.searchParams.get('qtext')).toBe('新闻联播');
    expect(url.searchParams.has('ac')).toBe(false);
  });
});
