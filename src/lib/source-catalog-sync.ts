import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { readSourceCatalog, sourceDataPath } from './source-catalog-store';
import { assembleCatalog, includeBuiltinSources, catalogUrl, latestCatalogSlot, nextCatalogSlot, type CatalogSnapshot } from './source-catalog';
import { readCatalogSnapshot } from './source-presets';
import { fetchUpstream } from './fetch-utils';
import { checkUpstreamAllowed } from './ssrf';
import { describeParseStats, parseSubscriptionJson, parseSubscriptionPayload, withSkipped } from './tvbox-parser';
import type { SourceListPayload, SubscriptionParseStats } from './types';
import { DEFAULT_SITE } from './site-config-types';
import { parseSiteConfig } from './site-config-validation';

export function catalogDataPath(name: string): string {
  return sourceDataPath(name);
}

async function writeJson(target: string, value: unknown) {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

interface Result {
  name: string; url: string; success: boolean; retained?: boolean; error?: string;
  vodCount?: number; liveCount?: number; stats?: SubscriptionParseStats;
}

/** 复用订阅解析与公网校验；不访问媒体文件，不把解析成功当播放验证。 */
async function fetchFeed(url: string): Promise<SourceListPayload> {
  const response = await fetchUpstream(url, { timeoutMs: 8000, headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`订阅地址返回 HTTP ${response.status}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > 3 * 1024 * 1024) throw new Error('订阅内容超过 3 MiB');
  const parsed = parseSubscriptionPayload(parseSubscriptionJson(text));
  const sources = [];
  for (const source of parsed.sources) {
    if ((await checkUpstreamAllowed(source.url)).ok) {
      const detail = source.detail && (await checkUpstreamAllowed(source.detail)).ok ? source.detail : undefined;
      sources.push({ ...source, detail });
    }
  }
  const liveSources = [];
  for (const source of parsed.liveSources) {
    if ((await checkUpstreamAllowed(source.url)).ok) {
      const epg = source.epg && (await checkUpstreamAllowed(source.epg)).ok ? source.epg : undefined;
      liveSources.push({ ...source, epg });
    }
  }
  const stats = withSkipped(parsed.stats, 'invalidUrl', parsed.sources.length + parsed.liveSources.length - sources.length - liveSources.length);
  if (!sources.length && !liveSources.length) throw new Error(`未导入可用源：${describeParseStats(stats)}`);
  return { sources, liveSources, stats };
}

export async function refreshSourceCatalog(now = Date.now()): Promise<CatalogSnapshot> {
  const catalog = await readSourceCatalog();
  const previous = await readCatalogSnapshot();
  if (!catalog.sourceUrl || !Object.values(catalog.groups).some((items) => items.length)) return previous;
  const unique = new Map<string, { name: string; url: string }>();
  for (const item of Object.values(catalog.groups).flat()) {
    const url = catalogUrl(item.url, 'subscription');
    if (!unique.has(url)) unique.set(url, { name: item.name, url });
  }
  const entries = [...unique.values()];
  const results: Result[] = [];
  const feeds: Parameters<typeof assembleCatalog>[0] = [];
  // 有界并发，按目录顺序组装，避免最快返回者改变源名称。
  for (let index = 0; index < entries.length; index += 4) {
    const batch = await Promise.all(entries.slice(index, index + 4).map(async (entry) => {
      try {
        const payload = await fetchFeed(entry.url);
        return { feed: { ...entry, payload }, result: { ...entry, success: true,
          vodCount: payload.sources.length, liveCount: payload.liveSources.length, stats: payload.stats } as Result };
      } catch (error) {
        const payload = previousPayload(previous, entry.url);
        const old = previous.subscriptions.find((s) => catalogUrl(s.url, 'subscription') === entry.url);
        return { feed: { ...entry, payload, syncedAt: old?.syncedAt }, result: { ...entry, success: false,
          retained: !!payload, error: error instanceof Error ? error.message : String(error) } as Result };
      }
    }));
    for (const item of batch) { feeds.push(item.feed); results.push(item.result); }
  }
  const successful = results.filter((r) => r.success).length;
  const snapshot = includeBuiltinSources(assembleCatalog(feeds, new Date(now).toISOString(), catalog.sourceUrl));
  parseSiteConfig({ version: 1, revision: 0, site: DEFAULT_SITE,
    sources: snapshot.sources, liveSources: snapshot.liveSources, subscriptions: snapshot.subscriptions });
  // 全部拉取失败时只落报告，保留完整旧快照与旧同步时间。
  if (successful) await writeJson(catalogDataPath('source-presets.json'), snapshot);
  await writeJson(catalogDataPath('source-sync-report.json'), {
    attemptedAt: new Date(now).toISOString(), nextRunAt: new Date(nextCatalogSlot(now)).toISOString(),
    total: entries.length, successful, failed: entries.length - successful,
    uniqueVodSources: successful ? snapshot.sources.length : previous.sources.length,
    uniqueLiveSources: successful ? snapshot.liveSources.length : previous.liveSources.length, results,
  });
  if (!successful) throw new Error('全部订阅刷新失败，旧快照已保留，详见 source-sync-report.json');
  return snapshot;
}

function previousPayload(snapshot: CatalogSnapshot, url: string): SourceListPayload | undefined {
  const belongs = (s: { subscriptionUrls: string[] }) => s.subscriptionUrls.includes(url);
  const sources = snapshot.sources.filter(belongs).map(({ subscriptionUrls, ...s }) => { void subscriptionUrls; return s; });
  const liveSources = snapshot.liveSources.filter(belongs).map(({ subscriptionUrls, ...s }) => { void subscriptionUrls; return s; });
  return sources.length || liveSources.length ? { sources, liveSources } : undefined;
}

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
let failedSlot: number | undefined;
export async function checkCatalogSchedule(now = Date.now()) {
  if (running || failedSlot === latestCatalogSlot(now)) return;
  running = true;
  try {
    const catalog = await readSourceCatalog();
    if (!catalog.sourceUrl || !Object.values(catalog.groups).some((items) => items.length)) return;
    const snapshot = await readCatalogSnapshot();
    let lastAttempt = Date.parse(snapshot.syncedAt);
    try {
      const report = JSON.parse(await readFile(catalogDataPath('source-sync-report.json'), 'utf8'));
      lastAttempt = Math.max(lastAttempt, Date.parse(report.attemptedAt ?? report.syncedAt));
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (!Number.isFinite(lastAttempt)) throw new Error('资源目录同步时间无效');
    if (lastAttempt >= latestCatalogSlot(now)) return;
    const updated = await refreshSourceCatalog(now);
    console.info(`[LibreTV] 资源目录已更新：${updated.sources.length} 点播，${updated.liveSources.length} 直播`);
  } catch (error) {
    failedSlot = latestCatalogSlot(now);
    console.error('[LibreTV] 资源目录自动刷新失败：', error);
  } finally { running = false; }
}

export function startCatalogScheduler() {
  if (timer) return;
  console.info(`[LibreTV] 资源目录每四天北京时间 05:00 刷新，下次 ${new Date(nextCatalogSlot(Date.now())).toISOString()}`);
  void checkCatalogSchedule();
  timer = setInterval(() => { void checkCatalogSchedule(); }, 60_000);
  timer.unref();
}
