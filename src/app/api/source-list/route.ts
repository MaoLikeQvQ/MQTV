import { guardAdminRequest } from '@/lib/admin-guard';
import { handleSourceListRequest } from '@/lib/source-list-handler';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const guarded = await guardAdminRequest(req);
  if (guarded) return guarded;
  return handleSourceListRequest(req);
}
