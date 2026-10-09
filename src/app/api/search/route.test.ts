import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import type { SearchResponse, SearchStreamEvent } from '@/lib/types';
import { SESSION_COOKIE, signSession } from '@/lib/auth';

/**
 * 聚合搜索接口单测：跨源聚合、同源去重、完成顺序稳定、成人内容过滤、
 * 失败源不影响整体、SSRF 字面量拒绝。上游一律 mock fetch，无真实网络。
 */

function cmsList(items: Array<Record<string, unknown>>, pagecount = 1): string {
  return JSON.stringify({ code: 1, pagecount, list: items });
}

/** 按 URL 分发的上游 mock：cms-a 正常、cms-b 500、cms-c 与 a 有重叠条目 */
function mockUpstream(): void {
  const fn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('cms-a.example')) {
      return new Response(
        cmsList([
          { vod_id: 1, vod_name: '测试剧', type_name: '国产剧' },
          { vod_id: 2, vod_name: '测试剧外传', type_name: '国产剧' },
          { vod_id: 3, vod_name: '福利速递', type_name: '福利视频' },
          // 同源同 vod_id 的重复条目：聚合时须按 sourceKey_vodId 去重
          { vod_id: 1, vod_name: '测试剧', type_name: '国产剧' },
        ]),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    }
    if (url.includes('cms-b.example')) {
      return new Response('server error', { status: 500 });
    }
    return new Response('not found', { status: 404 });
  });
  vi.stubGlobal('fetch', fn);
}

function makeRequest(body: unknown, stream = false): Request {
  const { token } = signSession();
  return new Request(`https://local.test/api/search${stream ? '?stream=1' : ''}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: `${SESSION_COOKIE}=${token}`,
    },
    body: JSON.stringify(body),
  });
}

const SOURCES = [
  { key: 'a', name: '源A', url: 'https://cms-a.example.com/api.php' },
  { key: 'b', name: '源B', url: 'https://cms-b.example.com/api.php' },
];

beforeAll(() => {
  process.env.PASSWORD = 'test-password-123';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('POST /api/search', () => {
  it('央视适配沿用聚合搜索并读取官方分页，返回可用于详情的ID', async () => {
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const page = url.searchParams.get('page');
      expect(url.searchParams.get('qtext')).toBe('央视分页验证');
      expect(url.searchParams.has('ac')).toBe(false);
      return new Response(JSON.stringify({ totalpage: 2, list: [{ all_title: `央视分页验证${page}`,
        urllink: `https://tv.cctv.com/2026/10/08/VIDEpage${page}.shtml` }] }));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const response = await POST(makeRequest({ wd: '央视分页验证', sources: [{
      key: 'cctv', name: '央视公开点播', url: 'https://search.cctv.com/ifsearch.php',
    }] }));
    const data = await response.json() as SearchResponse;
    expect(data.failures).toEqual([]);
    expect(data.list.map((item) => item.name)).toEqual(['央视分页验证1', '央视分页验证2']);
    expect(Buffer.from(data.list[0].vodId, 'base64url').toString()).toContain('tv.cctv.com');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('目录超过50个源时，末尾的央视源仍参与搜索', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).includes('search.cctv.com') ? { totalpage: 1, list: [{
        all_title: '目录末尾验证', urllink: 'https://tv.cctv.com/2026/10/08/VIDElast.shtml',
      }] } : { pagecount: 1, list: [] }
    ))));
    const response = await POST(makeRequest({ wd: '目录末尾验证', sources: [
      ...Array.from({ length: 50 }, (_, i) => ({ ...SOURCES[0], key: `cms${i}` })),
      { key: 'last', name: '央视公开点播', url: 'https://search.cctv.com/ifsearch.php' },
    ] }));
    expect((await response.json() as SearchResponse).list).toMatchObject([{ sourceKey: 'last', name: '目录末尾验证' }]);
  });
  it('聚合多源结果：同源去重、成人内容过滤、失败源进 failures', async () => {
    mockUpstream();
    const res = await POST(makeRequest({ wd: '测试剧', sources: SOURCES, filterAdult: true }));
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      list: Array<{ sourceKey: string; vodId: string; name: string }>;
      failures: Array<{ sourceKey: string; error: string }>;
    };

    // 源A 的 4 条 → 去重后 2 条有效 + 成人条目被过滤
    const aItems = data.list.filter((i) => i.sourceKey === 'a');
    expect(aItems).toHaveLength(2);
    expect(aItems.map((i) => i.vodId).sort()).toEqual(['1', '2']);

    // 源B 500 → 记入 failures，不影响源A 的结果
    expect(data.failures).toHaveLength(1);
    expect(data.failures[0].sourceKey).toBe('b');
    expect(data.failures[0].error).toContain('500');
  });

  it('保持源内返回顺序，不在结束时把精确命中重新置顶', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(cmsList([
      { vod_id: 2, vod_name: '顺序检测外传' },
      { vod_id: 1, vod_name: '顺序检测' },
    ]))));
    const res = await POST(makeRequest({ wd: '顺序检测', sources: [SOURCES[0]], filterAdult: true }));
    const data = await res.json() as SearchResponse;
    expect(data.list.map((i) => i.name)).toEqual(['顺序检测外传', '顺序检测']);
  });

  it.each([false, true])('并发请求，按完成顺序合并并缓存，stream=%s', async (stream) => {
    const wd = `并发顺序${stream}`;
    let releaseSlow!: () => void;
    let releaseFast!: () => void;
    const slow = new Promise<void>((resolve) => { releaseSlow = resolve; });
    const fast = new Promise<void>((resolve) => { releaseFast = resolve; });
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const isSlow = String(input).includes('cms-a.example');
      await (isSlow ? slow : fast);
      return new Response(cmsList([
        { vod_id: 1, vod_name: `${wd}${isSlow ? '慢源' : '快源外传'}` },
        { vod_id: 2, vod_name: wd },
        { vod_id: 3, vod_name: '福利速递', type_name: '福利视频' },
        { vod_id: 4, vod_name: '完全无关的影片' },
      ]));
    });
    vi.stubGlobal('fetch', fetchSpy);
    const responsePromise = POST(makeRequest({ wd, sources: SOURCES, filterAdult: true }, stream));
    // 两个请求均已发出才能放行，验证慢源没有阻塞快源启动。
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    releaseFast();
    let data: SearchResponse;
    if (stream) {
      const res = await responsePromise;
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      const first = JSON.parse(decoder.decode((await reader.read()).value!).trim()) as SearchStreamEvent;
      expect(first.type).toBe('source');
      if (first.type !== 'source') throw new Error('快源应先推送');
      expect(first.sourceKey).toBe('b');
      expect(first.list.map((i) => i.name)).toEqual([`${wd}快源外传`, wd]);
      releaseSlow();
      let rest = '';
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        rest += decoder.decode(chunk.value, { stream: true });
      }
      const events = rest.trim().split('\n').map((line) => JSON.parse(line) as SearchStreamEvent);
      const final = events.at(-1)!;
      expect(final.type).toBe('done');
      if (final.type !== 'done') throw new Error('缺少最终结果');
      data = final;
      const second = events[0];
      expect(second.type).toBe('source');
      if (second.type !== 'source') throw new Error('缺少慢源结果');
      expect(data.list).toEqual([...first.list, ...second.list]);
    } else {
      // 等快源完成解析，再让慢源结束。
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      releaseSlow();
      data = await (await responsePromise).json() as SearchResponse;
    }
    expect(data.list.map((i) => i.sourceKey)).toEqual(['b', 'b', 'a', 'a']);
    const cached = await POST(makeRequest({ wd, sources: SOURCES, filterAdult: true }));
    expect((await cached.json() as SearchResponse).list).toEqual(data.list);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('内网字面量地址在发起请求前被 SSRF 校验拒绝', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const res = await POST(
      makeRequest({
        wd: 'x',
        sources: [{ key: 'evil', name: '内网', url: 'http://192.168.1.100/api.php' }],
        filterAdult: false,
      })
    );
    const data = (await res.json()) as { failures: Array<{ sourceKey: string; error: string }> };
    expect(data.failures[0]?.sourceKey).toBe('evil');
    // 上游一次请求都不应发生
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('stream=1 以 NDJSON 逐源推送并以 done 事件收尾', async () => {
    mockUpstream();
    // 用不同关键词避开同键短缓存（缓存命中时只推 done 事件，见 route.ts 缓存分支）
    const res = await POST(makeRequest({ wd: '流式检测关键词', sources: SOURCES, filterAdult: true }, true));
    expect(res.status).toBe(200);
    const text = await res.text();
    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; sourceKey?: string });
    const sources = lines.filter((l) => l.type === 'source');
    const done = lines.filter((l) => l.type === 'done');
    // 每个源恰好一条 source 事件（含失败的源B），最后一条是 done
    expect(sources.map((l) => l.sourceKey).sort()).toEqual(['a', 'b']);
    expect(done).toHaveLength(1);
    expect(lines[lines.length - 1].type).toBe('done');
  });

  it('前台无需 Cookie 或 PASSWORD，仍执行请求校验', async () => {
    vi.stubGlobal('fetch', vi.fn());
    vi.stubEnv('PASSWORD', '');
    const request = new Request('https://local.test/api/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wd: '', sources: [] }),
    });
    expect((await POST(request)).status).toBe(400);
  });
});
