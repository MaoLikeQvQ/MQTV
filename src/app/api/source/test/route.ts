import { NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/admin-guard';
import { checkSourceAllowed, searchSpider } from '@/lib/spider-bridge';
import { isSpiderSource } from '@/lib/spider-source';
import type { SourceConfig } from '@/lib/types';
import { fetchUpstream } from '@/lib/fetch-utils';
import { parseSearchList } from '@/lib/cms-parser';
import { isCctvSource } from '@/lib/cctv-source';
import { searchCctv } from '@/lib/cctv-spider';

export const runtime = 'nodejs';

/** 点播源探活：以搜索 "test" 的响应耗时与结果量衡量可用性 */
export async function POST(req: Request) {
  const guarded = await guardAdminRequest(req);
  if (guarded) return guarded;

  let url = '';
  let type: SourceConfig['type'];
  try {
    const body = (await req.json()) as { url?: string; type?: SourceConfig['type'] };
    url = (body.url || '').trim().replace(/\/+$/, '');
    type = body.type;
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 });
  }
  if (!/^https?:\/\//.test(url)) {
    return NextResponse.json({ error: '无效的源地址' }, { status: 400 });
  }

  const verdict = await checkSourceAllowed({ url, type });
  if (!verdict.ok) {
    return NextResponse.json({ ok: false, ms: 0, error: verdict.reason });
  }

  const start = Date.now();
  try {
    if (isSpiderSource({ type })) {
      const { list } = await searchSpider({ key: 'test', name: 'test', url, type }, '新闻', 1, AbortSignal.timeout(6000));
      return NextResponse.json({ ok: true, ms: Date.now() - start, count: list.length });
    }
    if (isCctvSource(url)) {
      const { list } = await searchCctv({ key: 'test', name: '央视公开点播', url }, '新闻联播', 1, AbortSignal.timeout(6000));
      return NextResponse.json({ ok: true, ms: Date.now() - start, count: list.length });
    }
    const res = await fetchUpstream(`${url}?ac=videolist&wd=test`, {
      timeoutMs: 6000,
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36', Accept: 'application/json' },
    });
    const ms = Date.now() - start;
    if (!res.ok) {
      return NextResponse.json({ ok: false, ms, error: `HTTP ${res.status}` });
    }
    const data = await res.json();
    const list = parseSearchList(data, { key: 'test', name: 'test', url });
    return NextResponse.json({ ok: true, ms, count: list.length });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      ms: Date.now() - start,
      error: err instanceof Error ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? '超时' : err.message) : '请求失败',
    });
  }
}
