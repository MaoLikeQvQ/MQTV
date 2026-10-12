import { NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/admin-guard';
import { checkSourceAllowed, searchSpider } from '@/lib/spider-bridge';
import { isSpiderSource } from '@/lib/spider-source';
import type { SourceConfig } from '@/lib/types';
import { fetchUpstream } from '@/lib/fetch-utils';
import { cmsListUrl, cmsRequestHeaders, parseSearchList } from '@/lib/cms-parser';
import { probeSearchCapability, type SourceCapabilities } from '@/lib/source-capability';
import { isCctvSource } from '@/lib/cctv-source';
import { searchCctv } from '@/lib/cctv-spider';

export const runtime = 'nodejs';

/** 分别检测列表可用性与关键词搜索能力，列表响应不能作为搜索成功证据。 */
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
  const capabilities: SourceCapabilities = { list: null, search: 'unknown' };
  let listError: string | undefined;
  try {
    const source = { key: 'test', name: 'test', url, type };
    let readSearch: (keyword: string) => Promise<{ name?: string }[]>;
    let keyword = '新闻';
    if (isSpiderSource({ type })) {
      readSearch = async (wd) => (await searchSpider(source, wd, 1, AbortSignal.timeout(6000))).list;
    } else if (isCctvSource(url)) {
      keyword = '新闻联播';
      readSearch = async (wd) => (await searchCctv(source, wd, 1, AbortSignal.timeout(6000))).list;
    } else {
      const readCms = async (wd?: string) => {
        const res = await fetchUpstream(cmsListUrl(url, wd), { timeoutMs: 6000, retries: 0, headers: cmsRequestHeaders() });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data || !Object.prototype.hasOwnProperty.call(data, 'list')) throw new Error('接口未返回资源列表');
        return parseSearchList(data, source);
      };
      capabilities.list = false;
      try {
        const list = await readCms();
        capabilities.list = true;
        keyword = list.find((item) => item.name.trim())?.name || '';
      } catch (error) {
        listError = error instanceof Error ? error.message : '列表请求失败';
      }
      readSearch = readCms;
    }
    const result = await probeSearchCapability(readSearch, keyword);
    capabilities.search = result.search;
    return NextResponse.json({ ok: result.search === 'supported', ms: Date.now() - start, count: result.count, capabilities, listError,
      ...(result.search !== 'supported' ? { error: result.search === 'unsupported' ? '接口未按关键词筛选，不能用于搜索' : '搜索能力未确认' } : {}),
    });
  } catch (err) {
    return NextResponse.json({
      ok: false,
      capabilities,
      listError,
      ms: Date.now() - start,
      error: err instanceof Error ? (err.name === 'TimeoutError' || err.name === 'AbortError' ? '超时' : err.message) : '请求失败',
    });
  }
}
