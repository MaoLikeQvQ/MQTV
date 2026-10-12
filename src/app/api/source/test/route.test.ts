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

  it('空列表只能证明列表可达，不能证明搜索能力', async () => {
    upstream.mockImplementation(async () => new Response(JSON.stringify({ list: [] }), { status: 200 }));
    const response = await POST(new Request('http://localhost/api/source/test', {
      method: 'POST', headers: { authorization: 'Bearer isolated-probe-key' },
      body: JSON.stringify({ url: 'https://vod.example.com/api' }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: false, count: 0, capabilities: { list: true, search: 'unknown' } });
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it('央视源通过官方搜索探活，不拼接CMS参数', async () => {
    upstream.mockImplementation(async (input: string) => new Response(JSON.stringify({ totalpage: 1, list: new URL(input).searchParams.get('qtext') === '新闻联播' ? [{
      all_title: '新闻联播', urllink: 'https://tv.cctv.com/2026/10/08/VIDEabc.shtml',
    }] : [] })));
    const response = await POST(new Request('http://localhost/api/source/test', {
      method: 'POST', headers: { authorization: 'Bearer isolated-probe-key' },
      body: JSON.stringify({ url: 'https://search.cctv.com/ifsearch.php' }),
    }));
    expect(await response.json()).toMatchObject({ ok: true, count: 1 });
    const url = new URL(upstream.mock.calls[1][0]);
    expect(url.searchParams.get('qtext')).toBe('新闻联播');
    expect(url.searchParams.has('ac')).toBe(false);
  });

  it('列表被拒绝时仍独立验证搜索能力', async () => {
    upstream.mockImplementation(async (input: string) => {
      const wd = new URL(input).searchParams.get('wd');
      if (wd === null) return new Response('', { status: 403 });
      return new Response(JSON.stringify({ list: wd === '新闻' ? [{ vod_id: 1, vod_name: '新闻联播' }] : [] }));
    });
    const response = await POST(new Request('http://localhost/api/source/test', {
      method: 'POST', headers: { authorization: 'Bearer isolated-probe-key' },
      body: JSON.stringify({ url: 'https://vod.example.com/api?ac=list' }),
    }));
    expect(await response.json()).toMatchObject({ ok: true, capabilities: { list: false, search: 'supported' }, listError: 'HTTP 403' });
  });

  it('非空默认列表不能被探活标记为搜索可用', async () => {
    upstream.mockImplementation(async () => new Response(JSON.stringify({ list: [{ vod_id: 1, vod_name: '金牌调解' }] })));
    const response = await POST(new Request('http://localhost/api/source/test', {
      method: 'POST', headers: { authorization: 'Bearer isolated-probe-key' },
      body: JSON.stringify({ url: 'https://vod.example.com/api?ac=list' }),
    }));
    expect(await response.json()).toMatchObject({ ok: false, capabilities: { list: true, search: 'unsupported' } });
  });
});
