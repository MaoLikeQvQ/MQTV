import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

export const runtime = 'nodejs';

/** 兼容旧客户端：公开前台无需访客登录，也不再签发访客会话。 */
export async function POST(_req: Request) {
  void _req;
  return NextResponse.json({ success: true, verified: true });
}

export async function GET(_req: Request) {
  void _req;
  return NextResponse.json({ success: true, verified: true });
}

export async function DELETE() {
  const response = NextResponse.json({ success: true, verified: true });
  response.cookies.set(SESSION_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' });
  return response;
}
