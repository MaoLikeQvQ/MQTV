import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchDoubanRecommend } from '@/lib/douban';

export const runtime = 'nodejs';

/** 豆瓣推荐：服务端直连 + 缓存，替代旧版浏览器经公共 CORS 代理的方案 */
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;

  const url = new URL(req.url);
  const type = url.searchParams.get('type') === 'tv' ? 'tv' : 'movie';
  const tag = (url.searchParams.get('tag') || '热门').slice(0, 20);
  const pageStart = Math.max(0, parseInt(url.searchParams.get('pageStart') || '0', 10) || 0);
  const pageSize = Math.min(50, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25', 10) || 25));

  try {
    const items = await fetchDoubanRecommend(type, tag, pageStart, pageSize);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '豆瓣推荐获取失败' },
      { status: 502 }
    );
  }
}
