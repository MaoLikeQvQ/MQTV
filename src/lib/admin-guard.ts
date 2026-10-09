import crypto from 'node:crypto';
import { NextResponse } from 'next/server';

/** 管理鉴权独立于访客密码、Cookie 和免密码开关，每次请求都必须携带密钥。 */
export function guardAdminRequest(req: Request): NextResponse | null {
  const secret = process.env.ADMIN_KEY;
  if (!secret) return NextResponse.json({ error: '服务器未配置 ADMIN_KEY，管理功能不可用' }, { status: 503 });
  const header = req.headers.get('authorization') || '';
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  const hash = (value: string) => crypto.createHash('sha256').update(value).digest();
  if (!match || !crypto.timingSafeEqual(hash(match[1]), hash(secret))) {
    return NextResponse.json({ error: '管理密钥无效' }, { status: 401 });
  }
  return null;
}
