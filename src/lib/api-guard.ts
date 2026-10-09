import { NextResponse } from 'next/server';

/** 前台公开访问。管理操作必须使用独立的 guardAdminRequest。 */
export async function guardRequest(_req: Request): Promise<NextResponse | null> {
  void _req;
  return null;
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}
