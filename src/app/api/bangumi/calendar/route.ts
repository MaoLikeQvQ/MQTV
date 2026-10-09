import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchBangumiCalendar } from '@/lib/bangumi';

export const runtime = 'nodejs';

/** Bangumi 每日放送（免 key）：服务端直连 + 缓存，作为首页推荐的备用数据源 */
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;

  try {
    const days = await fetchBangumiCalendar();
    return NextResponse.json({
      days: Object.entries(days).map(([weekday, items]) => ({ weekday: Number(weekday), items })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '新番放送表获取失败' },
      { status: 502 }
    );
  }
}
