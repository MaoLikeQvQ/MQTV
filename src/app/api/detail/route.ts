import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { cmsRequestHeaders, parseDetail, parseDetailPageHtml } from '@/lib/cms-parser';
import { fetchUpstream, getCache, setCache } from '@/lib/fetch-utils';
import { checkUpstreamAllowed } from '@/lib/ssrf';
import { isCctvSource } from '@/lib/cctv-source';
import { checkSourceAllowed, detailSpider } from '@/lib/spider-bridge';
import { isSpiderSource } from '@/lib/spider-source';
import { detailCctv } from '@/lib/cctv-spider';
import type { SourceConfig, VideoDetail } from '@/lib/types';

export const runtime = 'nodejs';

/** 详情结果短缓存：换源测速/多人观看同一影片时避免重复打上游 */
const DETAIL_CACHE_TTL = 60 * 1000;

function parseSource(raw: string | null): SourceConfig | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as SourceConfig;
    if (!obj || !/^https?:\/\//.test(obj.url || '')) return null;
    return obj;
  } catch {
    return null;
  }
}

/**
 * 视频详情：优先走列表接口 ?ac=videolist&ids=，
 * 拿不到播放地址时（部分源需要爬详情页）降级到 detail 页 HTML 提取。
 */
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;

  const url = new URL(req.url);
  const id = (url.searchParams.get('id') || '').trim();
  const source = parseSource(url.searchParams.get('source'));
  const baseUrl = (url.searchParams.get('baseUrl') || '').trim(); // 可选：详情页根地址

  if (!id || id.length > 12000 || !/^[\w-]+$/.test(id)) {
    return NextResponse.json({ error: '无效的视频ID' }, { status: 400 });
  }
  if (!source) {
    return NextResponse.json({ error: '无效的点播源配置' }, { status: 400 });
  }

  try {
    // 命中 60s 缓存直接返回（仅缓存成功拿到剧集的结果）
    const detailRootForCache = (source.detail || baseUrl || '').replace(/\/+$/, '');
    const cacheKey = `detail:${source.type || 'cms'}:${source.url}|${detailRootForCache}|${id}`;
    const cached = getCache<VideoDetail>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // 用户可控地址发起服务端请求，先过 SSRF 校验（协议白名单 + 内网/保留地址）
    const listVerdict = await checkSourceAllowed(source);
    if (!listVerdict.ok) {
      return NextResponse.json({ error: listVerdict.reason }, { status: 400 });
    }

    if (isSpiderSource(source)) {
      const detail = await detailSpider(source, id);
      setCache(cacheKey, detail, DETAIL_CACHE_TTL);
      return NextResponse.json(detail);
    }

    if (isCctvSource(source.url)) {
      const detail = await detailCctv(source, id);
      setCache(cacheKey, detail, DETAIL_CACHE_TTL);
      return NextResponse.json(detail);
    }

    let resolved: VideoDetail | null = null;

    // 1) 标准列表接口
    const api = `${source.url.replace(/\/+$/, '')}?ac=videolist&ids=${encodeURIComponent(id)}`;
    const res = await fetchUpstream(api, { timeoutMs: 10000, headers: cmsRequestHeaders() });
    if (res.ok) {
      const data = await res.json();
      try {
        const detail = parseDetail(data, source);
        if (detail.episodes.length > 0) {
          resolved = detail;
        }
        // 有详情但无播放地址 → 继续尝试详情页
      } catch {
        // 列表接口无内容 → 继续尝试详情页
      }
    }

    // 2) 详情页 HTML 提取（detail 地址优先，否则用 API 地址推导）
    const detailRoot = (source.detail || baseUrl || '').replace(/\/+$/, '');
    if (!resolved && detailRoot && /^https?:\/\//.test(detailRoot)) {
      const detailVerdict = await checkUpstreamAllowed(detailRoot);
      if (!detailVerdict.ok) {
        return NextResponse.json({ error: detailVerdict.reason }, { status: 400 });
      }
      const detailUrl = `${detailRoot}/index.php/vod/detail/id/${id}.html`;
      const detailRes = await fetchUpstream(detailUrl, {
        timeoutMs: 10000,
        headers: { 'User-Agent': cmsRequestHeaders()['User-Agent'] },
      });
      if (detailRes.ok) {
        const html = await detailRes.text();
        resolved = parseDetailPageHtml(html, source);
      }
    }

    if (!resolved || resolved.episodes.length === 0) {
      return NextResponse.json({ error: '未找到播放资源' }, { status: 404 });
    }
    setCache(cacheKey, resolved, DETAIL_CACHE_TTL);
    return NextResponse.json(resolved);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '获取详情失败' },
      { status: 502 }
    );
  }
}
