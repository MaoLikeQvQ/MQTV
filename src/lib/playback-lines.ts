import type { SearchResultItem } from './types';

export function playbackLinesKey(title: string, year: string, selectedKeys: string[], filterAdult: boolean) {
  return ['playback-lines', title, year, selectedKeys, filterAdult] as const;
}

/** 只接受同一影片的线路，明确不同年份的翻拍不混入；先显示的线路保持位置。 */
export function mergePlaybackLines(previous: SearchResultItem[], incoming: SearchResultItem[], title: string, year: string): SearchResultItem[] {
  const seen = new Set<string>();
  const versions = [...previous, ...incoming].filter((item) => item.name.trim() === title.trim());
  const targetYear = year || versions.find((item) => item.year?.trim())?.year?.trim();
  return versions.filter((item) => {
    if (targetYear && item.year?.trim() && item.year.trim() !== targetYear) return false;
    const key = JSON.stringify([item.sourceKey, item.vodId]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
