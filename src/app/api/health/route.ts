import { NextResponse } from 'next/server';
import { readSiteConfig } from '@/lib/site-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 检查应用及配置可读取性，不返回数据源或凭证，不请求上游。 */
export async function GET() {
  try {
    await readSiteConfig();
    return NextResponse.json({ ok: true, version: process.env.APP_VERSION || 'dev' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
