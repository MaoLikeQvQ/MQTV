import { randomUUID } from 'node:crypto';
import { filterRelevantResults } from './cms-parser';

export interface SourceCapabilities {
  list: boolean | null;
  search: 'supported' | 'unsupported' | 'unknown';
}

/** 用已知标题和随机不存在的关键词对照，HTTP 200 或空结果本身不证明可搜索。 */
export async function probeSearchCapability(
  read: (keyword: string) => Promise<{ name?: string }[]>,
  keyword: string,
): Promise<{ search: SourceCapabilities['search']; count: number }> {
  const absent = `MQTV不存在${randomUUID().replaceAll('-', '')}`;
  const negative = await read(absent);
  if (negative.length > 0) return { search: 'unsupported', count: 0 };
  if (!keyword.trim()) return { search: 'unknown', count: 0 };
  const positive = await read(keyword);
  const matching = filterRelevantResults(positive, keyword);
  return { search: matching.length > 0 ? 'supported' : positive.length > 0 ? 'unsupported' : 'unknown', count: matching.length };
}
