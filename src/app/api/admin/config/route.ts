import { NextResponse } from 'next/server';
import { guardAdminRequest } from '@/lib/admin-guard';
import { ConfigError, MAX_CONFIG_BYTES, readSiteConfig, saveSiteConfig } from '@/lib/site-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function failure(error: unknown): NextResponse {
  return NextResponse.json({ error: error instanceof ConfigError ? error.message : '配置读取或保存失败，请检查服务器数据目录' },
    { status: error instanceof ConfigError ? error.status : 500, headers: { 'Cache-Control': 'no-store' } });
}

export async function GET(req: Request) {
  const guarded = guardAdminRequest(req);
  if (guarded) return guarded;
  try {
    return NextResponse.json(await readSiteConfig(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}

export async function PUT(req: Request) {
  const guarded = guardAdminRequest(req);
  if (guarded) return guarded;
  try {
    if (Number(req.headers.get('content-length')) > MAX_CONFIG_BYTES) throw new ConfigError('配置内容过大', 413);
    const body = await req.text();
    if (Buffer.byteLength(body) > MAX_CONFIG_BYTES) throw new ConfigError('配置内容过大', 413);
    let config: unknown;
    try { config = JSON.parse(body); } catch { throw new ConfigError('配置不是合法 JSON'); }
    return NextResponse.json(await saveSiteConfig(config), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return failure(error); }
}
