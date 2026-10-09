import { NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/admin-guard';
import { readVisitorStats } from '@/lib/visitor-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guarded = guardAdminRequest(req);
  if (guarded) return guarded;
  try {
    return NextResponse.json(await readVisitorStats(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '访问统计读取失败，请检查服务器数据目录' }, { status: 500 });
  }
}
