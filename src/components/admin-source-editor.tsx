'use client';

import { useEffect, useState, type ReactNode } from 'react';
import type { SiteConfig } from '@/lib/site-config-types';
import type { LivePlaylistResponse } from '@/lib/types';
import type { SourceCatalog } from '@/lib/source-catalog-types';
import { copyToClipboard } from '@/lib/clipboard';
import { Icon } from './icon';
import { Switch } from './settings-shared';

type Kind = 'sources' | 'liveSources' | 'subscriptions';
type RequestFn = <T>(url: string, init?: RequestInit) => Promise<T>;

export function subscribedSources(config: SiteConfig, kind: 'sources' | 'liveSources') {
  const manualUrls = new Set(config[kind].map((s) => s.url));
  const entries = config.subscriptions.flatMap((subscription, subscriptionIndex) =>
    (subscription[kind] ?? []).map((item) => ({ item, subscription, subscriptionIndex })));
  const byUrl = new Map<string, typeof entries[number]>();
  for (const entry of entries) {
    if (manualUrls.has(entry.item.url)) continue;
    const existing = byUrl.get(entry.item.url);
    // 同地址被多个订阅收录时，展示实际向访客下发的启用成员。
    if (!existing || (entry.subscription.enabled && entry.item.enabled !== false)) byUrl.set(entry.item.url, entry);
  }
  return [...byUrl.values()];
}

export function setSourceEnabled(config: SiteConfig, kind: 'sources' | 'liveSources', url: string, enabled: boolean, subscriptionIndex?: number): SiteConfig {
  return { ...config,
    [kind]: config[kind].map((s) => s.url === url ? { ...s, enabled } : s),
    subscriptions: config.subscriptions.map((s, i) => (enabled ? i === subscriptionIndex : s[kind]?.some((source) => source.url === url)) ? {
      ...s, enabled: enabled ? true : s.enabled,
      [kind]: s[kind]?.map((source) => source.url === url ? { ...source, enabled } : source),
    } : s),
  };
}

export function AdminSourceEditor({ kind, config, onChange, request, onSync, report }: {
  kind: Kind; config: SiteConfig; onChange: (value: SiteConfig) => void; request: RequestFn;
  onSync: (url: string, name?: string) => Promise<boolean>; report: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});
  const list = config[kind];
  const keyword = query.toLowerCase().trim();
  const activeSubscribedUrls = new Set(kind === 'subscriptions' ? [] : config.subscriptions.filter((s) => s.enabled).flatMap((s) => (s[kind] ?? []).filter((item) => item.enabled !== false).map((item) => item.url)));
  const subscribed = kind === 'subscriptions' ? [] : subscribedSources(config, kind);
  const isEnabled = (item: typeof list[number]) => item.enabled || activeSubscribedUrls.has(item.url);
  const subscribedVisible = subscribed.filter(({ item, subscription }) =>
    `${item.name} ${item.url} ${subscription.name}`.toLowerCase().includes(keyword) &&
    (filter === 'all' || (subscription.enabled && item.enabled !== false) === (filter === 'enabled')));
  const visible = list.map((item, index) => ({ item, index })).filter(({ item }) =>
    `${item.name} ${item.url}`.toLowerCase().includes(keyword) && (filter === 'all' || isEnabled(item) === (filter === 'enabled')));
  const totalCount = list.length + subscribed.length;
  const enabledCount = list.filter(isEnabled).length + subscribed.filter(({ item, subscription }) => subscription.enabled && item.enabled !== false).length;
  const title = kind === 'sources' ? '点播源' : kind === 'liveSources' ? '直播源' : '订阅';

  function add() {
    const item = kind === 'subscriptions' ? { name: '', url: '', enabled: true } : { key: `admin_${crypto.randomUUID()}`, name: '', url: '', enabled: true };
    onChange({ ...config, [kind]: [...list, item] });
  }
  function change(index: number, field: string, value: string | boolean) {
    if (kind !== 'subscriptions' && field === 'enabled' && typeof value === 'boolean') {
      onChange(setSourceEnabled(config, kind, list[index].url, value));
      return;
    }
    onChange({ ...config, [kind]: list.map((s, i) => i === index ? { ...s, [field]: field === 'type' && value === '' ? undefined : value,
      // 更改订阅地址时清除旧地址快照，避免新地址误下发原来的源。
      ...(kind === 'subscriptions' && field === 'url' && value !== s.url ? { sources: undefined, liveSources: undefined, syncedAt: undefined } : {}),
    } : s) });
  }
  function changeVisible(enabled: boolean) {
    const next = kind === 'subscriptions'
      ? { ...config, subscriptions: config.subscriptions.map((s, i) => visible.some((v) => v.index === i) ? { ...s, enabled } : s) }
      : visible.reduce((current, { item }) => setSourceEnabled(current, kind, item.url, enabled), config);
    onChange(next);
  }
  async function test(item: { url: string; type?: 't4' | 'drpy' }) {
    setResults((current) => ({ ...current, [item.url]: '正在检测…' }));
    try {
      if (kind === 'sources') {
        const result = await request<{ ok: boolean; ms?: number; count?: number; error?: string }>('/api/source/test', { method: 'POST', body: JSON.stringify({ url: item.url, type: item.type }) });
        setResults((current) => ({ ...current, [item.url]: result.ok ? `可达 · ${result.ms} ms · ${result.count || 0} 条搜索结果` : `检测失败：${result.error || '源无响应'}` }));
      } else {
        const result = await request<LivePlaylistResponse>(`/api/admin/live-test?force=1&url=${encodeURIComponent(item.url)}`);
        setResults((current) => ({ ...current, [item.url]: `已解析 ${result.channels.length} 个频道 · ${result.groups.length} 个分组` }));
      }
    } catch (error) { setResults((current) => ({ ...current, [item.url]: `检测失败：${error instanceof Error ? error.message : '请求失败'}` })); }
  }
  async function testAll() {
    setTesting(true);
    try {
      // 三个并发，避免对同一来源发起大量同时请求。
      const items = [...visible.map((s) => s.item), ...subscribedVisible.map((s) => s.item)];
      let cursor = 0;
      await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
        while (cursor < items.length) await test(items[cursor++]);
      }));
    } finally { setTesting(false); }
  }
  async function syncAll() {
    const failed: string[] = [];
    let count = 0;
    for (const { item } of visible) {
      if (item.url && await onSync(item.url, item.name)) count++;
      else failed.push(item.name || '未命名订阅');
    }
    report(`已同步 ${count} 个订阅到草稿${failed.length ? `；${failed.length} 个失败并保留原快照：${failed.join('、')}` : ''}。保存后生效。`);
  }
  async function exportM3u(index: number) {
    const item = list[index];
    try {
      const result = await request<LivePlaylistResponse>(`/api/admin/live-test?url=${encodeURIComponent(item.url)}`);
      const clean = (value: string) => value.replace(/["\r\n]/g, "'");
      const lines = ['#EXTM3U', ...result.channels.flatMap((channel) => [
        `#EXTINF:-1 tvg-id="${clean(channel.tvgId || channel.id)}" tvg-logo="${clean(channel.logo || '')}" group-title="${clean(channel.group || '')}",${clean(channel.name)}`,
        channel.url,
      ])];
      const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'LibreTV-Live.m3u'; anchor.click(); URL.revokeObjectURL(url);
      report(`已导出 ${result.channels.length} 个直播频道`);
    } catch (error) { report(`导出失败：${error instanceof Error ? error.message : '请求失败'}`); }
  }

  return <section className="space-y-4">
    <div className="card px-5 py-4 flex flex-wrap gap-4 items-center justify-between">
      <div><span className="text-2xl font-semibold tabular-nums">{totalCount}</span><span className="text-sm text-muted ml-2">个{title}</span><span className="text-xs text-muted ml-4">{enabledCount} 个启用</span></div>
      <button className="btn-primary min-h-11" onClick={add}><Icon name="plus" className="w-4 h-4" />添加{title}</button>
    </div>
    {kind === 'subscriptions' && <p className="text-sm text-muted leading-6">同步后生成源列表快照，保存配置后下发到全站。关闭或删除订阅会同时停用其数据源。重新同步会替换旧快照。</p>}
    <div className="flex flex-wrap gap-2 items-center">
      <input className="input flex-1 min-w-[160px]" aria-label={`搜索${title}`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`搜索${title}名称或地址…`} />
      <select className="input" aria-label="启用状态筛选" value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">全部状态</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select>
      <button className="btn-ghost min-h-11" disabled={testing || (!visible.length && !subscribedVisible.length)} onClick={() => void (kind === 'subscriptions' ? syncAll() : testAll())}>{kind === 'subscriptions' ? '同步筛选订阅' : testing ? '检测中…' : '批量检测'}</button>
    </div>
    <div className="flex items-center flex-wrap gap-3 text-xs text-muted"><span>显示 {visible.length + subscribedVisible.length} / {totalCount} 条</span>{!!visible.length && <><button className="text-accent min-h-9" onClick={() => changeVisible(true)}>启用筛选的{kind === 'subscriptions' ? '订阅' : '手动条目'}</button><button className="text-muted min-h-9" onClick={() => changeVisible(false)}>停用筛选的{kind === 'subscriptions' ? '订阅' : '手动条目'}</button></>}</div>
    {!visible.length && !subscribedVisible.length && <div className="card px-6 py-12 text-center"><Icon name="link" className="w-7 h-7 mx-auto text-faint mb-3" /><h2 className="text-sm font-medium">{totalCount ? '没有匹配的条目' : `还没有${title}`}</h2><p className="text-xs text-muted mt-2">{totalCount ? '调整关键词或状态筛选。' : '添加一条来源，保存后即可使用。'}</p></div>}
    <div className="space-y-3">
      {visible.map(({ item, index }) => <article key={'key' in item ? item.key : index} className="card overflow-hidden">
        <div className="px-5 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0"><h2 className="font-medium text-sm truncate">{item.name || `新${title}`}</h2><p className="text-xs text-muted truncate mt-1.5">{item.url || '请展开填写地址'}</p></div>
          <Switch label={`启用${item.name || title}`} checked={isEnabled(item)} onChange={(v) => change(index, 'enabled', v)} />
        </div>
        {kind === 'subscriptions' && 'syncedAt' in item && item.syncedAt && <div className="px-5 pb-3 text-xs text-muted">{item.sources?.length || 0} 个点播源 · {item.liveSources?.length || 0} 个直播源 · 同步于 {new Date(item.syncedAt).toLocaleString('zh-CN')}</div>}
        {kind === 'subscriptions' && (!('syncedAt' in item) || !item.syncedAt) && <p className="text-xs text-warning px-5 pb-3">尚未同步，暂不向访客下发数据源。</p>}
        <details open={!item.name || !item.url} className="border-t border-line group">
          <summary className="px-5 py-3 text-xs text-muted cursor-pointer select-none hover:bg-hover">编辑配置</summary>
          <div className="border-t border-line p-5 space-y-4 bg-surface/50">
            <div className="grid sm:grid-cols-[1fr_2fr] gap-4"><Field label="名称"><input className="input w-full" maxLength={128} value={item.name} onChange={(e) => change(index, 'name', e.target.value)} /></Field><Field label="地址"><input className="input w-full" type="url" maxLength={2048} placeholder="https://…" value={item.url} onChange={(e) => change(index, 'url', e.target.value)} /></Field></div>
            {kind === 'sources' && <Field label="接口类型"><select className="input w-full" value={'type' in item ? item.type || '' : ''} onChange={(e) => change(index, 'type', e.target.value)}><option value="">CMS / 内置公开接口</option><option value="t4">T4 Spider HTTP 接口</option><option value="drpy">托管 Node drpy 规则</option></select></Field>}
            {kind === 'sources' && <div className="grid sm:grid-cols-[2fr_1fr] gap-4"><Field label="详情地址（可选）"><input className="input w-full" type="url" value={'detail' in item ? item.detail || '' : ''} onChange={(e) => change(index, 'detail', e.target.value)} /></Field><label className="flex gap-2 items-center text-sm pt-5"><input type="checkbox" checked={'isAdult' in item && !!item.isAdult} onChange={(e) => change(index, 'isAdult', e.target.checked)} />成人内容源</label></div>}
            {kind === 'liveSources' && <Field label="节目单 EPG 地址（可选）"><input className="input w-full" type="url" value={'epg' in item ? item.epg || '' : ''} onChange={(e) => change(index, 'epg', e.target.value)} /></Field>}
            <div className="flex items-center flex-wrap gap-2 pt-1">
              <button className="btn-ghost min-h-11" disabled={!item.url || testing} onClick={() => void (kind === 'subscriptions' ? onSync(item.url, item.name) : test(item))}><Icon name={kind === 'subscriptions' ? 'refresh' : 'bolt'} className="w-4 h-4" />{kind === 'subscriptions' ? '同步订阅' : '检测源'}</button>
              <button className="btn-ghost min-h-11" disabled={index === 0} aria-label={`上移${item.name || title}`} onClick={() => { const reordered = [...list]; [reordered[index - 1], reordered[index]] = [reordered[index], reordered[index - 1]]; onChange({ ...config, [kind]: reordered }); }}>上移</button>
              <button className="btn-ghost min-h-11" onClick={() => void copyToClipboard(item.url).then((ok) => report(ok ? '地址已复制' : '复制失败，请手动复制地址'))}>复制地址</button>
              {kind === 'liveSources' && <button className="btn-ghost min-h-11" disabled={!item.url} onClick={() => void exportM3u(index)}>导出 M3U</button>}
              <button className="btn-ghost min-h-11 text-danger sm:ml-auto" onClick={() => { if (window.confirm(`删除「${item.name || '未命名条目'}」？保存后生效。`)) onChange({ ...config, [kind]: list.filter((_, i) => i !== index) }); }}><Icon name="trash" className="w-4 h-4" />删除</button>
            </div>
          </div>
        </details>
        {kind === 'subscriptions' && <SubscriptionSnapshot config={config} index={index} onChange={onChange} />}
        {results[item.url] && <p className="px-5 py-3 border-t border-line text-xs text-muted break-words" role="status">{results[item.url]}</p>}
      </article>)}
    </div>
    {!!subscribedVisible.length && kind !== 'subscriptions' && <section className="card overflow-hidden">
      <div className="px-5 py-4 border-b border-line"><h2 className="font-medium text-sm">订阅中的{title}</h2><p className="text-xs text-muted mt-1.5">已读取项目源快照。更改启停后保存；名称与地址随所属订阅同步更新。</p></div>
      {subscribedVisible.map(({ item, subscription, subscriptionIndex }) => <article key={item.url} className="px-5 py-4 border-b border-line last:border-0">
        <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h3 className="text-sm font-medium break-words">{item.name}</h3><p className="text-xs text-muted mt-1">来自 {subscription.name}{!subscription.enabled && ' · 订阅已停用'}</p><p className="text-xs text-faint break-all mt-1.5">{item.url}</p></div><Switch label={`启用${item.name}`} checked={subscription.enabled && item.enabled !== false} onChange={(enabled) => onChange(setSourceEnabled(config, kind, item.url, enabled, subscriptionIndex))} /></div>
        <div className="flex items-center flex-wrap gap-3 mt-3"><button className="btn-ghost btn-sm min-h-9" disabled={testing} onClick={() => void test(item)}>检测源</button>{results[item.url] && <p className="text-xs text-muted" role="status">{results[item.url]}</p>}</div>
      </article>)}
    </section>}
    {kind !== 'subscriptions' && <p className="text-xs text-muted leading-5">检测验证接口可达性或列表解析，不代表视频已通过实际播放验证。订阅中的源在「配置订阅」里统一管理。</p>}
  </section>;
}

function SubscriptionSnapshot({ config, index, onChange }: { config: SiteConfig; index: number; onChange: (value: SiteConfig) => void }) {
  const subscription = config.subscriptions[index];
  if (!subscription.sources?.length && !subscription.liveSources?.length) return null;
  function toggle(kind: 'sources' | 'liveSources', row: number, enabled: boolean) {
    onChange({ ...config, subscriptions: config.subscriptions.map((s, i) => i === index ? {
      ...s, [kind]: s[kind]?.map((item, j) => j === row ? { ...item, enabled } : item),
    } : s) });
  }
  return <details className="border-t border-line"><summary className="px-5 py-3 text-xs text-muted cursor-pointer hover:bg-hover">管理订阅中的源</summary><div className="border-t border-line px-5 py-2">
    {(['sources', 'liveSources'] as const).map((kind) => <div key={kind}>
      {!!subscription[kind]?.length && <p className="text-xs text-faint py-3">{kind === 'sources' ? '点播源' : '直播源'} · {subscription[kind]?.length} 个</p>}
      {subscription[kind]?.map((source, row) => <div key={source.key} className="flex gap-4 items-center justify-between py-3 border-b border-line last:border-0"><div className="min-w-0"><p className="text-sm truncate">{source.name}</p><p className="text-xs text-muted truncate mt-1">{source.url}</p></div><Switch label={`启用订阅源${source.name}`} checked={source.enabled !== false} onChange={(v) => toggle(kind, row, v)} /></div>)}
    </div>)}
    <p className="text-xs text-muted py-3 leading-5">修改后需保存。重新同步保留相同地址的启停选择；订阅整体关闭时，其下全部源停用。</p>
  </div></details>;
}

export function AdminCatalog({ config, onChange, onSync, report, request }: {
  config: SiteConfig; onChange: (value: SiteConfig) => void; request: RequestFn;
  onSync: (url: string, name?: string) => Promise<boolean>; report: (message: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('全部');
  const [catalog, setCatalog] = useState<SourceCatalog | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request<SourceCatalog>('/api/admin/catalog').then((value) => { if (active) setCatalog(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : '目录读取失败'); });
    return () => { active = false; };
  }, [request]);
  if (error) return <p className="text-sm text-danger" role="alert">{error}</p>;
  if (!catalog) return <p className="text-sm text-muted" role="status">正在读取资源目录…</p>;
  if (!catalog.sourceUrl) return <p className="text-sm text-muted">尚未配置资源目录。可直接添加订阅，或由部署者导入私有目录。</p>;
  const groups = Object.entries(catalog.groups);
  const visible = groups.flatMap(([category, items]) => items.map((item) => ({ ...item, category }))).filter((item) =>
    (group === '全部' || item.category === group) && `${item.name} ${item.url} ${item.description}`.toLowerCase().includes(query.toLowerCase().trim()));
  return <section className="space-y-5">
    <p className="text-sm text-muted leading-6">目录统一去重点播和直播源，服务器每四天北京时间凌晨 5 点自动刷新。需要 Spider 插件的条目会跳过。</p>
    <button className="btn-primary min-h-11" onClick={() => void onSync(catalog.sourceUrl, '资源目录自动更新')}>导入自动更新目录</button>
    <div className="flex flex-wrap gap-2"><input className="input flex-1 min-w-[160px]" aria-label="搜索资源目录" placeholder="搜索名称、说明或配置地址…" value={query} onChange={(e) => setQuery(e.target.value)} /><select className="input" aria-label="资源目录分类" value={group} onChange={(e) => setGroup(e.target.value)}>{['全部', ...groups.map(([name]) => name)].map((name) => <option key={name}>{name}</option>)}</select></div>
    <p className="text-xs text-muted">显示 {visible.length} 条 · 来源 <a className="text-accent" href={catalog.sourceUrl} target="_blank" rel="noreferrer">目录来源 ↗</a> · 更新于 {catalog.fetchedAt.slice(0, 10)}</p>
    <div className="grid xl:grid-cols-2 gap-4">{visible.map((item) => {
      const existing = config.subscriptions.find((s) => s.url === item.url);
      return <article className="card p-5 flex flex-col" key={`${item.category}:${item.name}:${item.url}`}>
        <div className="flex gap-3 justify-between"><h2 className="font-medium text-sm">{item.name}</h2><span className="text-[11px] text-muted bg-chip px-2 py-1 rounded-md shrink-0">{item.category}</span></div>
        <p className="text-xs text-muted leading-6 mt-2 mb-3">{item.description}</p><p className="text-xs text-faint break-all mb-5">{item.url}</p>
        <div className="flex flex-wrap gap-2 mt-auto"><button className="btn-primary btn-sm min-h-10" onClick={() => void onSync(item.url, item.name)}>{existing ? '重新同步' : '检查并导入'}</button><button className="btn-ghost btn-sm min-h-10" disabled={!!existing} onClick={() => { onChange({ ...config, subscriptions: [...config.subscriptions, { name: item.name, url: item.url, enabled: true }] }); report('已添加订阅草稿，需同步获取源列表。'); }}>{existing ? '已订阅' : '仅添加订阅'}</button><button className="btn-ghost btn-sm min-h-10" aria-label={`复制${item.name}地址`} onClick={() => void copyToClipboard(item.url).then((ok) => report(ok ? '地址已复制' : '复制失败，请手动复制'))}>复制</button></div>
      </article>;
    })}</div>
    {!visible.length && <p className="text-sm text-muted py-10 text-center">没有匹配的配置来源。</p>}
  </section>;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-2"><span className="block text-sm font-medium">{label}</span>{children}</label>;
}
