import { readFile } from 'node:fs/promises';
import { DEFAULT_SITE, type ManagedSubscription } from './site-config-types';
import { parseSiteConfig } from './site-config-validation';
import { includeBuiltinSources, type CatalogSnapshot } from './source-catalog';
import { readSourceCatalog, sourceDataPath } from './source-catalog-store';

/** 仅运行时读取私有快照；镜像不携带数据源。 */
export async function readCatalogSnapshot(): Promise<CatalogSnapshot> {
  let value: CatalogSnapshot;
  try {
    value = JSON.parse(await readFile(sourceDataPath('source-presets.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const catalog = await readSourceCatalog();
    value = { version: 2, name: '资源目录统一源快照', catalogSource: catalog.sourceUrl,
      syncedAt: '1970-01-01T00:00:00.000Z', sources: [], liveSources: [], subscriptions: [] };
  }
  if (!value || value.version !== 2 || typeof value.catalogSource !== 'string'
    || !Number.isFinite(Date.parse(value.syncedAt))) throw new Error('资源目录快照版本、地址或同步时间无效');
  if (value.catalogSource) includeBuiltinSources(value);
  // 在运行时也校验 URL、key 和列表上限，损坏的文件不能静默覆盖内置快照。
  parseSiteConfig({ version: 1, revision: 0, site: DEFAULT_SITE,
    sources: value.sources, liveSources: value.liveSources, subscriptions: value.subscriptions });
  return value;
}

/** 两份全局去重列表通过一条目录订阅读取，不再每个入口复制源对象。 */
export async function getSourcePresets(): Promise<ManagedSubscription[]> {
  const value = await readCatalogSnapshot();
  if (!value.catalogSource) return [];
  return parseSiteConfig({
    version: 1, revision: 0, site: DEFAULT_SITE,
    sources: [], liveSources: [], subscriptions: [{
      name: '资源目录自动更新', url: value.catalogSource, enabled: true,
      syncedAt: Date.parse(value.syncedAt), sources: value.sources, liveSources: value.liveSources,
    }],
  }).subscriptions;
}

/** 保存的启停选择优先；仅替换已订阅的目录，空配置和手动订阅不自动补回。 */
export async function refreshCatalogSubscription(subscriptions: ManagedSubscription[]): Promise<ManagedSubscription[]> {
  if (!subscriptions.length) return subscriptions;
  const snapshot = await readCatalogSnapshot();
  if (!snapshot.catalogSource || !subscriptions.some((s) => s.url === snapshot.catalogSource)) return subscriptions;
  const [current] = await getSourcePresets();
  return subscriptions.map((s) => {
    if (s.url !== current.url) return s;
    const merge = (kind: 'sources' | 'liveSources') => (current[kind] ?? []).map((item) => {
      const old = s[kind]?.find((previous) => previous.key === item.key || previous.url === item.url);
      return { ...item, enabled: old?.enabled ?? item.enabled };
    });
    return { ...s, syncedAt: current.syncedAt, sources: merge('sources'), liveSources: merge('liveSources') };
  });
}
