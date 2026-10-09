import { NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/admin-guard';
import { readSourceCatalog } from '@/lib/source-catalog-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guarded = guardAdminRequest(req);
  if (guarded) return guarded;
  try {
    return NextResponse.json(await readSourceCatalog(), { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ error: '私有资源目录读取失败，请检查服务器数据目录' }, { status: 500 });
  }
}
