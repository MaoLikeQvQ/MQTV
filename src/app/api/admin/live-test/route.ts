import { guardAdminRequest } from '@/lib/admin-guard';
import { GET as playlist } from '@/app/api/live/playlist/route';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 后台检测复用直播解析与 SSRF 校验，并先验证管理员密钥。 */
export async function GET(req: Request) {
  const denied = guardAdminRequest(req);
  if (denied) return denied;
  return playlist(req);
}
