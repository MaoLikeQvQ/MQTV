import { NextResponse } from 'next/server';
import { recordVisit } from '@/lib/visitor-store';
import { VISITOR_KEY_PATTERN, visitorDay } from '@/lib/visitor-types';

export const runtime = 'nodejs';

/** 公开的最小上报接口，仅接收随机访客标识，不返回统计或授予任何权限。 */
export async function POST(req: Request) {
  if (req.headers.get('sec-fetch-site') === 'cross-site') {
    return NextResponse.json({ error: '不接受跨站上报' }, { status: 403 });
  }
  if (!req.headers.get('content-type')?.startsWith('application/json')) {
    return NextResponse.json({ error: '请使用 JSON 上报' }, { status: 415 });
  }
  if (Number(req.headers.get('content-length')) > 256) return new NextResponse(null, { status: 413 });
  let ukey: unknown;
  try {
    const body = await req.text();
    if (Buffer.byteLength(body) > 256) return new NextResponse(null, { status: 413 });
    ukey = JSON.parse(body)?.ukey;
  } catch { return NextResponse.json({ error: '上报内容无效' }, { status: 400 }); }
  if (typeof ukey !== 'string' || !VISITOR_KEY_PATTERN.test(ukey)) {
    return NextResponse.json({ error: '访客标识无效' }, { status: 400 });
  }
  try {
    const now = new Date();
    await recordVisit(ukey, now);
    return NextResponse.json({ day: visitorDay(now) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '访问统计记录失败' }, { status: 500 });
  }
}
