import { NextResponse } from 'next/server';
import { readSiteConfig } from '@/lib/site-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 只下发已启用的源快照，订阅地址与管理凭证留在后台。 */
export async function GET(_req: Request) {
  void _req;
  const config = await readSiteConfig();
  const enabled = config.subscriptions.filter((s) => s.enabled);
  function unique<T extends { key: string; url: string }>(list: T[]): T[] {
    const keys = new Set<string>();
    const urls = new Set<string>();
    return list.filter((s) => {
      if (keys.has(s.key) || urls.has(s.url)) return false;
      keys.add(s.key); urls.add(s.url); return true;
    });
  }
  const sources = unique([
    ...config.sources.filter((s) => s.enabled).map(({ key, name, url, detail, isAdult, type }) => ({ key, name, url, detail, isAdult, type })),
    ...enabled.flatMap((s) => s.sources ?? []).filter((s) => s.enabled !== false)
      .map(({ key, name, url, detail, isAdult, type }) => ({ key, name, url, detail, isAdult, type })),
  ]);
  const liveSources = unique([
    ...config.liveSources.filter((s) => s.enabled).map(({ key, name, url, epg }) => ({ key, name, url, epg })),
    ...enabled.flatMap((s) => s.liveSources ?? []).filter((s) => s.enabled !== false)
      .map(({ key, name, url, epg }) => ({ key, name, url, epg })),
  ]);
  return NextResponse.json({
    passwordRequired: false, authDisabled: true, verified: true,
    site: config.site, version: process.env.APP_VERSION || 'dev',
    defaultSources: sources, defaultLiveSources: liveSources, defaultSubscriptions: [],
    defaultRecommendSource: config.site.recommendSource, defaultImageMode: config.site.imageMode,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
