import { guardAdminRequest } from '@/lib/admin-guard';
import { handleSourceListRequest } from '@/lib/source-list-handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const guarded = guardAdminRequest(req);
  if (guarded) return guarded;
  const response = await handleSourceListRequest(req);
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
