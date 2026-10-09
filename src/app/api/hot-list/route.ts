import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/api-guard';
import { fetchHotList, isHotListId } from '@/lib/douban-weekly';

export const runtime = 'nodejs';

/** 影视热榜（经 60s API 免 key）：豆瓣五个周榜 + 百度热播剧，服务端转发 + 缓存 */
export async function GET(req: Request) {
  const guarded = await guardRequest(req);
  if (guarded) return guarded;

  const id = new URL(req.url).searchParams.get('id') || '';
  if (!isHotListId(id)) {
    return NextResponse.json({ error: `未知榜单: ${id.slice(0, 30)}` }, { status: 400 });
  }

  try {
    const items = await fetchHotList(id);
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '榜单获取失败' },
      { status: 502 }
    );
  }
}
