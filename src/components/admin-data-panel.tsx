'use client';

import { useEffect, useState, type ChangeEvent, type ReactNode } from 'react';
import { db, exportConfig, MAX_HISTORY, type HistoryEntry } from '@/lib/db';
import { PERSIST_KEY, flushPendingPersist } from '@/lib/persist-storage';
import type { SiteConfig } from '@/lib/site-config-types';
import { MAX_CONFIG_BYTES, parseSiteConfig } from '@/lib/site-config-validation';
import { keyBelongsToSubscription, subKeyPrefix, useAppStore } from '@/lib/store';
import { clearVideoCache, getCacheSummary, loadCacheSettings, saveCacheSettings, VIDEO_CACHE_NAME, type CacheSummary } from '@/lib/video-cache';

interface Props {
  config: SiteConfig;
  onChange: (config: SiteConfig) => void;
  request: <T>(url: string, init?: RequestInit) => Promise<T>;
  report: (message: string) => void;
}

function download(name: string, value: unknown) {
  const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${name}_${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置内容必须是对象');
  return value as Record<string, unknown>;
}

function browserSettings(): Record<string, unknown> {
  const managedSnapshot = useAppStore.getState().managedLocalConfig;
  if (managedSnapshot) return managedSnapshot as unknown as Record<string, unknown>;
  flushPendingPersist();
  const raw = localStorage.getItem(PERSIST_KEY);
  return raw ? record(record(JSON.parse(raw)).state) : {};
}

/** 合并到草稿并保留原浏览器快照；管理员保存后才会影响其他访客。 */
export function migrateBrowserSettings(config: SiteConfig, state: Record<string, unknown>): SiteConfig {
  const site = { ...config.site };
  for (const field of ['yellowFilter', 'adFilter', 'doubanEnabled', 'autoplayNext'] as const) {
    if (typeof state[field] === 'boolean') site[field] = state[field];
  }
  if (['douban', 'bangumi', 'hot-list'].includes(String(state.recommendSource))) site.recommendSource = state.recommendSource as typeof site.recommendSource;
  if (['direct', 'proxy', 'custom'].includes(String(state.imageProxyMode))) site.imageMode = state.imageProxyMode as typeof site.imageMode;
  if (typeof state.customImageProxy === 'string') site.customImageProxy = state.customImageProxy;
  const sources = [...config.sources];
  const liveSources = [...config.liveSources];
  const subscriptions = [...config.subscriptions];
  const selected = Array.isArray(state.selectedKeys) ? state.selectedKeys : [];
  const liveSelected = Array.isArray(state.liveSelectedUrls) ? state.liveSelectedUrls : [];
  const localSubscriptions = (Array.isArray(state.subscriptions) ? state.subscriptions : []).map(record);
  const migratedSubscriptions = new Map<string, SiteConfig['subscriptions'][number]>();
  const existingVodUrls = new Set([...config.sources, ...config.subscriptions.flatMap((s) => s.sources ?? [])].map((s) => s.url));
  const existingLiveUrls = new Set([...config.liveSources, ...config.subscriptions.flatMap((s) => s.liveSources ?? [])].map((s) => s.url));
  for (const subscription of localSubscriptions) {
    const url = String(subscription.url || '');
    if (subscriptions.some((s) => s.url === url)) continue;
    const next = { name: String(subscription.name || url), url, enabled: subscription.enabled !== false, sources: [], liveSources: [] };
    subscriptions.push(next);
    migratedSubscriptions.set(url, next);
  }
  for (const value of Array.isArray(state.customAPIs) ? state.customAPIs : []) {
    const source = record(value);
    if (existingVodUrls.has(String(source.url))) continue;
    const next = { ...source, key: `migrated_${crypto.randomUUID()}`, enabled: selected.includes(source.key) } as SiteConfig['sources'][number];
    const owners = localSubscriptions.filter((subscription) => keyBelongsToSubscription(String(source.key), subKeyPrefix(String(subscription.url))));
    if (owners.length) {
      // 订阅已停用时，仍保留成员的勾选状态；整体开关决定是否发布这些成员。
      for (const owner of owners) {
        const target = migratedSubscriptions.get(String(owner.url));
        if (target && !target.sources?.some((s) => s.url === next.url)) target.sources?.push(next);
      }
    } else if (!sources.some((s) => s.url === next.url)) sources.push(next);
  }
  for (const value of Array.isArray(state.liveSubscriptions) ? state.liveSubscriptions : []) {
    const source = record(value);
    if (existingLiveUrls.has(String(source.url))) continue;
    const next = { key: `migrated_${crypto.randomUUID()}`, name: String(source.name || source.url || ''), url: String(source.url || ''), ...(source.epg ? { epg: String(source.epg) } : {}), enabled: liveSelected.includes(source.url) };
    const references = Array.isArray(source.fromSubscriptions) ? source.fromSubscriptions : [];
    const owners = localSubscriptions.filter((subscription) => references.includes(subscription.url));
    if (owners.length) {
      for (const owner of owners) {
        const target = migratedSubscriptions.get(String(owner.url));
        if (target && !target.liveSources?.some((s) => s.url === next.url)) target.liveSources?.push(next);
      }
    } else if (!liveSources.some((s) => s.url === next.url)) liveSources.push(next);
  }
  return parseSiteConfig({ ...config, site, sources, liveSources, subscriptions });
}

interface DeviceImport {
  settings?: string;
  history: HistoryEntry[];
  cache?: Record<string, unknown>;
}

export function parseDeviceBackup(value: unknown): DeviceImport {
  const file = record(value);
  if (file.name !== 'LibreTV-Settings') throw new Error('请选择 LibreTV 的浏览器配置文件');
  const data = record(file.data);
  let settings: string | undefined;
  if (data[PERSIST_KEY] !== undefined) {
    if (typeof data[PERSIST_KEY] !== 'string') throw new Error('浏览器设置格式无效');
    const stored = record(JSON.parse(data[PERSIST_KEY]));
    const state = record(stored.state);
    for (const key of ['customAPIs', 'selectedKeys', 'subscriptions', 'liveSubscriptions', 'liveSelectedUrls', 'liveFavorites', 'liveRecent']) {
      if (state[key] !== undefined && !Array.isArray(state[key])) throw new Error(`浏览器设置 ${key} 格式无效`);
    }
    for (const key of ['selectedKeys', 'liveSelectedUrls', 'liveFavorites']) {
      if (Array.isArray(state[key]) && state[key].some((value) => typeof value !== 'string')) throw new Error(`浏览器设置 ${key} 格式无效`);
    }
    for (const key of ['yellowFilter', 'adFilter', 'doubanEnabled', 'autoplayNext', 'recommendSourceTouched', 'imageProxyModeTouched']) {
      if (state[key] !== undefined && typeof state[key] !== 'boolean') throw new Error(`浏览器设置 ${key} 格式无效`);
    }
    if (state.recommendSource !== undefined && !['douban', 'bangumi', 'hot-list'].includes(String(state.recommendSource))) throw new Error('首页推荐来源无效');
    if (state.imageProxyMode !== undefined && !['direct', 'proxy', 'custom'].includes(String(state.imageProxyMode))) throw new Error('封面加载方式无效');
    if (state.customImageProxy !== undefined && typeof state.customImageProxy !== 'string') throw new Error('自定义封面代理格式无效');
    settings = JSON.stringify(stored);
  }
  let history: HistoryEntry[] = [];
  if (data.viewingHistory !== undefined) {
    if (typeof data.viewingHistory !== 'string') throw new Error('观看历史格式无效');
    const rows: unknown = JSON.parse(data.viewingHistory);
    if (!Array.isArray(rows)) throw new Error('观看历史必须是列表');
    history = rows.slice(0, MAX_HISTORY).map((value) => {
      const entry = record(value);
      const sourceKey = String(entry.sourceKey ?? entry.sourceCode ?? entry.sourceName ?? '');
      const vodId = String(entry.vodId ?? entry.vod_id ?? '');
      if (!sourceKey || !vodId) throw new Error('观看历史缺少数据源或视频标识');
      const number = (key: string, fallback = 0) => typeof entry[key] === 'number' && Number.isFinite(entry[key]) ? Math.max(0, entry[key] as number) : fallback;
      return {
        id: `${sourceKey}_${vodId}`, sourceKey, vodId, title: String(entry.title || '未知视频'),
        ...(typeof entry.sourceUrl === 'string' ? { sourceUrl: entry.sourceUrl } : {}),
        ...(entry.sourceType === 't4' || entry.sourceType === 'drpy' ? { sourceType: entry.sourceType } : {}),
        ...(typeof entry.pic === 'string' ? { pic: entry.pic } : {}),
        episodeIndex: number('episodeIndex'), totalEpisodes: number('totalEpisodes', Array.isArray(entry.episodes) ? entry.episodes.length : 0),
        playbackPosition: number('playbackPosition'), duration: number('duration'), timestamp: number('timestamp', Date.now()),
      };
    });
  }
  const cache = data.videoCacheSettings === undefined ? undefined : record(data.videoCacheSettings);
  if (cache) {
    if (cache.enabled !== undefined && typeof cache.enabled !== 'boolean') throw new Error('缓存开关格式无效');
    for (const key of ['horizonSeconds', 'maxBytesPerEpisode', 'maxTotalBytes']) {
      if (cache[key] !== undefined && (typeof cache[key] !== 'number' || !Number.isFinite(cache[key]))) throw new Error('缓存容量设置格式无效');
    }
  }
  if (!settings && history.length === 0 && !cache) throw new Error('文件中没有可导入的浏览器数据');
  return { settings, history, cache };
}

function Group({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <section className="card p-5 sm:p-6"><h2 className="text-base font-semibold">{title}</h2><p className="text-sm text-muted mt-1 leading-relaxed">{description}</p><div className="mt-5 flex flex-wrap items-center gap-3">{children}</div></section>;
}

export function AdminDataPanel({ config, onChange, request, report }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<CacheSummary | null>(null);
  const [published, setPublished] = useState<{ url: string; provider: string } | null>(null);
  const health = useAppStore((state) => state.sourceHealth);
  const disabledCount = Object.values(health).filter((entry) => entry.permanent || (entry.disabledUntil ?? 0) > Date.now()).length;

  useEffect(() => { void getCacheSummary().then(setSummary); }, []);

  const run = async (action: () => Promise<void> | void) => {
    setBusy(true);
    setError('');
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : '操作失败，请重试'); }
    finally { setBusy(false); }
  };

  const pick = (event: ChangeEvent<HTMLInputElement>, action: (file: File) => Promise<void>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void run(() => action(file));
  };

  const sourceList = () => {
    const enabledSubscriptions = config.subscriptions.filter((s) => s.enabled);
    const vod = [...config.sources.filter((s) => s.enabled), ...enabledSubscriptions.flatMap((s) => s.sources ?? []).filter((s) => s.enabled !== false)];
    const live = [...config.liveSources.filter((s) => s.enabled), ...enabledSubscriptions.flatMap((s) => s.liveSources ?? []).filter((s) => s.enabled !== false)];
    return {
      name: config.site.name, version: 2, exportedAt: Date.now(),
      sources: [...new Map([...vod].reverse().map((s) => [s.url, { name: s.name, url: s.url, ...(s.type ? { type: s.type } : {}), ...(s.detail ? { detail: s.detail } : {}), ...(s.isAdult ? { isAdult: true } : {}) }])).values()],
      liveSources: [...new Map([...live].reverse().map((s) => [s.url, { name: s.name, url: s.url, ...(s.epg ? { epg: s.epg } : {}) }])).values()],
    };
  };

  return <div className="space-y-5">
    {error && <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</p>}
    <Group title="全站配置备份" description="备份网站设置、点播源、直播源和订阅。导入只替换后台草稿，点击保存后全站生效。">
      <button className="btn-ghost" disabled={busy} onClick={() => void run(() => { download('LibreTV-SiteConfig', parseSiteConfig(config)); report('全站配置已导出'); })}>导出全站配置</button>
      <label className={`btn-ghost cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>导入全站配置<input className="hidden" type="file" accept=".json,application/json" disabled={busy} onChange={(e) => pick(e, async (file) => {
        if (file.size > MAX_CONFIG_BYTES) throw new Error('全站配置文件不能超过 256 KB');
        const next = parseSiteConfig(JSON.parse(await file.text()));
        if (!window.confirm(`将导入「${next.site.name}」：${next.sources.length} 个点播源、${next.liveSources.length} 个直播源、${next.subscriptions.length} 个订阅，并替换当前未保存草稿。是否继续？`)) return;
        onChange({ ...next, revision: config.revision });
        report('已导入全站配置到草稿，请保存配置');
      })} /></label>
    </Group>
    <Group title="数据源分享" description="导出草稿中已启用的点播源和直播源，可用于其他 LibreTV 的数据源订阅。">
      <button className="btn-ghost" disabled={busy} onClick={() => void run(() => { download('LibreTV-SourceList', sourceList()); report('数据源列表已导出'); })}>导出数据源列表</button>
      <button className="btn-ghost" disabled={busy} onClick={() => void run(async () => {
        const payload = sourceList();
        if (!payload.sources.length && !payload.liveSources.length) throw new Error('请先启用至少一个数据源');
        if (!window.confirm('将把已启用的数据源名称和地址上传至第三方公开粘贴板（paste.rs 或 0x0.st），生成任何人都可读取的订阅链接。请确认这些地址可公开，是否发布？')) return;
        const result = await request<{ url: string; provider: string }>('/api/publish', { method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' } });
        setPublished(result);
        report(`数据源已发布到 ${result.provider}`);
      })}>{busy ? '正在处理…' : '发布为公开链接'}</button>
      {published && <div className="w-full rounded-xl border border-line p-4"><p className="text-xs text-muted mb-2">已发布至 {published.provider}</p><div className="flex flex-wrap gap-2"><input className="input min-w-0 flex-1" aria-label="公开订阅链接" readOnly value={published.url} /><button className="btn-ghost" onClick={() => void run(async () => { await navigator.clipboard.writeText(published.url); report('订阅链接已复制'); })}>复制链接</button></div></div>}
    </Group>
    <Group title="迁移旧版浏览器设置" description="将当前浏览器原有的偏好设置、点播源、直播源和订阅合并到全站草稿。同地址的源保留现有全站配置，原浏览器数据保留。">
      <button className="btn-ghost" disabled={busy} onClick={() => void run(() => {
        const state = browserSettings();
        if (!Object.keys(state).length) throw new Error('当前浏览器没有旧版配置');
        const next = migrateBrowserSettings(config, state);
        next.site.cacheEnabled = loadCacheSettings().enabled;
        if (!window.confirm(`将合并为 ${next.sources.length} 个点播源、${next.liveSources.length} 个直播源、${next.subscriptions.length} 个订阅，并将旧偏好写入草稿。是否继续？`)) return;
        onChange(next);
        report('浏览器设置已迁移到草稿，请保存配置；订阅可在数据源页面重新同步');
      })}>将旧设置导入全站草稿</button>
    </Group>
    <Group title="当前浏览器的设备数据" description="导出或恢复当前浏览器的观看历史与旧版设置。恢复会覆盖设备设置、合并观看历史；全站配置仍由后台保存的设置决定。">
      <button className="btn-ghost" disabled={busy} onClick={() => void run(async () => {
        const data = JSON.parse(await exportConfig());
        data.data.videoCacheSettings = loadCacheSettings();
        download('LibreTV-Settings', data);
        report('当前浏览器配置与观看历史已导出');
      })}>导出浏览器数据</button>
      <label className={`btn-ghost cursor-pointer ${busy ? 'opacity-50 pointer-events-none' : ''}`}>恢复浏览器数据<input className="hidden" type="file" accept=".json,application/json" disabled={busy} onChange={(e) => pick(e, async (file) => {
        if (file.size > 5 * 1024 * 1024) throw new Error('浏览器配置文件不能超过 5 MB');
        const next = parseDeviceBackup(JSON.parse(await file.text()));
        if (next.settings) migrateBrowserSettings({ ...config, sources: [], liveSources: [], subscriptions: [] }, record(record(JSON.parse(next.settings)).state));
        if (!window.confirm(`将恢复当前浏览器${next.settings ? '的设备设置和' : '的'} ${next.history.length} 条观看历史。其他访客与全站草稿不受影响，是否继续？`)) return;
        // 当前导出使用 sourceKey/vodId；同时兼容旧 sourceCode/vod_id，先解析完再写入。
        if (next.history.length) await db.transaction('rw', db.history, async () => {
          await db.history.bulkPut(next.history);
          const excess = await db.history.count() - MAX_HISTORY;
          if (excess > 0) await db.history.bulkDelete((await db.history.orderBy('timestamp').limit(excess).toArray()).map((entry) => entry.id));
        });
        if (next.settings) {
          flushPendingPersist(); localStorage.setItem(PERSIST_KEY, next.settings);
          await useAppStore.persist.rehydrate();
          // 管理页恢复设备配置后，后续迁移应读取刚恢复的数据，而非旧的运行时快照。
          useAppStore.setState({ managed: false, managedLocalConfig: undefined });
        }
        if (next.cache) saveCacheSettings(next.cache);
        report('当前浏览器数据已恢复；旧设置可另行迁移到全站草稿');
      })} /></label>
    </Group>
    <Group title="当前浏览器的视频缓存" description="缓存开关在内容与播放中统一设置。这里仅清理当前浏览器的缓存，不会清理其他访客的数据或下载记录。">
      <p className="text-sm flex-1 min-w-48">{summary ? `${summary.episodes} 部已缓存剧集 · ${summary.segments} 个片段 · ${(summary.bytes / 1024 / 1024).toFixed(1)} MB` : '正在读取缓存…'}</p>
      <button className="btn-ghost" disabled={busy} onClick={() => void run(async () => {
        if (!window.confirm('清空当前浏览器的视频片段缓存？下次播放会重新加载。')) return;
        await clearVideoCache();
        const remaining = await db.segmentMeta.count();
        const cacheExists = typeof caches !== 'undefined' && await caches.has(VIDEO_CACHE_NAME);
        if (remaining || cacheExists) throw new Error('缓存未完全清理，请检查浏览器存储权限后重试');
        const next = await getCacheSummary();
        setSummary(next);
        report('当前浏览器的视频缓存已清空');
      })}>清空视频缓存</button>
    </Group>
    <Group title="当前浏览器的数据源健康状态" description="连续请求失败的数据源会在当前浏览器暂时停用。恢复后，下次搜索会重新尝试全站已启用的数据源。">
      <p className="text-sm flex-1">{disabledCount} 个源被自动停用</p>
      <button className="btn-ghost" disabled={busy || !Object.keys(health).length} onClick={() => void run(() => {
        const state = useAppStore.getState();
        for (const key of Object.keys(state.sourceHealth)) state.clearSourceHealth(key);
        report('当前浏览器的数据源健康状态已重置');
      })}>恢复源健康状态</button>
    </Group>
  </div>;
}
