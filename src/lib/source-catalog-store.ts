import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { catalogUrl } from './source-catalog';
import type { SourceCatalog } from './source-catalog-types';

export function sourceDataPath(name: string): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), name);
}

/** 文件缺失表示尚未配置；损坏配置必须报错，不能静默清空。 */
export async function readSourceCatalog(): Promise<SourceCatalog> {
  let value: SourceCatalog;
  try {
    value = JSON.parse(await readFile(sourceDataPath('tvbox-catalog.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return { sourceUrl: '', fetchedAt: '', groups: {} };
  }
  if (!value || typeof value.sourceUrl !== 'string' || !Number.isFinite(Date.parse(value.fetchedAt))
    || !value.groups || typeof value.groups !== 'object' || Array.isArray(value.groups)) {
    throw new Error('私有资源目录格式无效');
  }
  catalogUrl(value.sourceUrl, 'subscription');
  for (const items of Object.values(value.groups)) {
    if (!Array.isArray(items)) throw new Error('私有资源目录分组格式无效');
    for (const item of items) {
      if (!item || typeof item.name !== 'string' || !item.name.trim()
        || typeof item.url !== 'string' || typeof item.description !== 'string') throw new Error('私有资源目录条目格式无效');
      catalogUrl(item.url, 'subscription');
    }
  }
  return value;
}
