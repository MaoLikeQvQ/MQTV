import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getEnvSources } from './env-sources';
import { getEnvLiveSources } from './env-live-sources';
import { getEnvSubscriptions } from './env-subscriptions';
import { getSourcePresets, refreshCatalogSubscription } from './source-presets';
import { getEnvRecommendSource } from './env-recommend-source';
import { getEnvImageMode } from './env-image-mode';
import { DEFAULT_SITE, type SiteConfig } from './site-config-types';
import { ConfigError, MAX_CONFIG_BYTES, parseSiteConfig } from './site-config-validation';
export { ConfigError, MAX_CONFIG_BYTES } from './site-config-validation';

function configPath(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'site-config.json');
}

/** 仅配置文件不存在时读取初始配置；已保存空列表不会被项目快照补回。 */
export async function readSiteConfig(): Promise<SiteConfig> {
  try {
    const contents = await readFile(configPath(), 'utf8');
    if (Buffer.byteLength(contents) > MAX_CONFIG_BYTES) throw new ConfigError('配置文件过大', 500);
    const config = parseSiteConfig(JSON.parse(contents));
    return { ...config, subscriptions: await refreshCatalogSubscription(config.subscriptions) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      version: 1, revision: 0,
      site: { ...DEFAULT_SITE, authDisabled: true,
        recommendSource: getEnvRecommendSource() ?? DEFAULT_SITE.recommendSource,
        imageMode: getEnvImageMode() ?? DEFAULT_SITE.imageMode },
      sources: getEnvSources().map((s) => ({ ...s, enabled: true })),
      liveSources: getEnvLiveSources().map((s) => ({ ...s, enabled: true })),
      subscriptions: process.env.DEFAULT_SUBSCRIPTIONS?.trim()
        ? getEnvSubscriptions().map((s) => ({ ...s, name: s.name || '预置订阅', enabled: true }))
        : await getSourcePresets(),
    };
  }
}

let writeQueue: Promise<unknown> = Promise.resolve();

/** 单实例内串行写入 + 修订号检查 + 同目录原子替换，防止并发覆盖与半文件。 */
export function saveSiteConfig(value: unknown): Promise<SiteConfig> {
  const config = parseSiteConfig(value);
  const task = writeQueue.then(async () => {
    const current = await readSiteConfig();
    if (config.revision !== current.revision) throw new ConfigError('配置已被其他页面更新，请重新加载后再保存', 409);
    const saved = { ...config, revision: current.revision + 1 };
    const contents = JSON.stringify(saved, null, 2);
    if (Buffer.byteLength(contents) > MAX_CONFIG_BYTES) throw new ConfigError('配置内容过大', 413);
    const target = configPath();
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, contents, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, target);
    } finally { await rm(temporary, { force: true }); }
    return saved;
  });
  writeQueue = task.catch(() => {});
  return task;
}
