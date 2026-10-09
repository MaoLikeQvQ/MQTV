import type { SourceConfig } from './types';

/** This address is a source identity only; it is never fetched. */
export const DRPY_SOURCE_URL = 'https://drpy.libretv.invalid/api/cctv-public';
export const SPIDER_EPISODE_PREFIX = 'spider:';

export function isSpiderSource(source: Pick<SourceConfig, 'type'>): boolean {
  return source.type === 't4' || source.type === 'drpy';
}

export function drpyModule(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://drpy.libretv.invalid' || parsed.search || parsed.hash) return undefined;
    return /^\/api\/([a-zA-Z0-9_-]{1,100})$/.exec(parsed.pathname)?.[1];
  } catch { return undefined; }
}
