'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ThemeToggle } from './theme';
import { Icon, type IconName } from './icon';
import { ToggleRow } from './settings-shared';
import { VisitorStats } from './visitor-stats';
import { AdminSourceEditor, AdminCatalog } from './admin-source-editor';
import { AdminDataPanel } from './admin-data-panel';
import { useAppStore } from '@/lib/store';
import type { VisitorStats as VisitorStatsData } from '@/lib/visitor-types';
import type { SiteConfig, SiteSettings } from '@/lib/site-config-types';
import type { SourceListPayload } from '@/lib/types';
import { describeParseStats } from '@/lib/tvbox-parser';

type Tab = 'site' | 'content' | 'sources' | 'liveSources' | 'subscriptions' | 'catalog' | 'data' | 'visitors';
const tabs: { id: Tab; name: string; icon: IconName; hint: string }[] = [
  { id: 'site', name: '网站设置', icon: 'home', hint: '网站名称、简介与首页公告' },
  { id: 'content', name: '内容与播放', icon: 'filter', hint: '统一管理首页、播放和封面加载方式' },
  { id: 'sources', name: '点播源', icon: 'link', hint: '维护参与全站搜索的内容来源' },
  { id: 'liveSources', name: '直播源', icon: 'bolt', hint: '管理 M3U 直播列表与节目单' },
  { id: 'subscriptions', name: '配置订阅', icon: 'refresh', hint: '同步配置来源，统一下发数据源' },
  { id: 'catalog', name: '资源目录', icon: 'search', hint: '查找配置来源并添加到后台订阅' },
  { id: 'data', name: '数据管理', icon: 'download', hint: '配置备份、旧设置迁移与当前设备数据' },
  { id: 'visitors', name: '访问统计', icon: 'clock', hint: '查看新增访客、活跃和回访趋势' },
];

export function AdminConsole() {
  // 管理密钥仅保存在当前页面内存中，所有管理请求独立验证。
  const [key, setKey] = useState('');
  const [inputKey, setInputKey] = useState('');
  const [config, setConfig] = useState<SiteConfig | null>(null);
  const [saved, setSaved] = useState('');
  const [tab, setTab] = useState<Tab>('site');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [visitorStats, setVisitorStats] = useState<VisitorStatsData | null>(null);
  const [statsBusy, setStatsBusy] = useState(false);
  const dirty = !!config && JSON.stringify(config) !== saved;
  const currentTab = tabs.find((item) => item.id === tab)!;
  const sourceCount = (kind: 'sources' | 'liveSources') => config
    ? new Set([...config[kind], ...config.subscriptions.flatMap((s) => s[kind] ?? [])].map((s) => s.url)).size
    : 0;

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const request = useCallback(async <T,>(url: string, secret: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      ...init, cache: 'no-store', credentials: 'omit', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
    });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) { setKey(''); setConfig(null); setInputKey(''); }
      throw new Error(data.error || `请求失败（${response.status}）`);
    }
    return data as T;
  }, []);
  const adminRequest = useCallback(<T,>(url: string, init?: RequestInit) => request<T>(url, key, init), [request, key]);

  async function login() {
    if (busy || !inputKey.trim()) return;
    setBusy(true); setError('');
    try {
      const data = await request<SiteConfig>('/api/admin/config', inputKey.trim());
      await useAppStore.persist.rehydrate();
      setKey(inputKey.trim()); setInputKey(''); setConfig(data); setSaved(JSON.stringify(data));
      setMessage(''); setTab('site'); setVisitorStats(null);
    } catch (e) { setError(e instanceof Error ? e.message : '无法连接管理后台'); }
    finally { setBusy(false); }
  }

  async function loadVisitors() {
    if (statsBusy) return;
    setStatsBusy(true); setError('');
    try { setVisitorStats(await adminRequest<VisitorStatsData>('/api/admin/visitors')); }
    catch (e) { setError(e instanceof Error ? e.message : '统计加载失败'); }
    finally { setStatsBusy(false); }
  }

  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const data = await adminRequest<SiteConfig>('/api/admin/config', { method: 'PUT', body: JSON.stringify(config) });
      setConfig(data); setSaved(JSON.stringify(data)); setMessage('配置已保存，访客刷新页面后生效。');
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败'); }
    finally { setBusy(false); }
  }

  async function reload() {
    if (dirty && !window.confirm('重新加载会丢弃尚未保存的修改，是否继续？')) return;
    setBusy(true); setError('');
    try {
      const data = await adminRequest<SiteConfig>('/api/admin/config');
      setConfig(data); setSaved(JSON.stringify(data)); setMessage('已加载服务器配置');
    } catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
    finally { setBusy(false); }
  }

  async function syncSubscription(url: string, name?: string) {
    setBusy(true); setError(''); setMessage('');
    try {
      const payload = await adminRequest<SourceListPayload>(`/api/admin/source-list?url=${encodeURIComponent(url)}`);
      if (!payload.sources.length && !payload.liveSources.length) {
        const skipped = payload.stats ? describeParseStats(payload.stats) : '';
        throw new Error(`未解析到可用数据源，原订阅快照已保留${skipped ? `；${skipped}` : ''}`);
      }
      setConfig((current) => {
        if (!current) return current;
        const old = current.subscriptions.find((s) => s.url === url);
        const snapshot = {
          name: old?.name || name || payload.name || '配置订阅', url, enabled: old?.enabled ?? true,
          sources: payload.sources.map((s) => ({ ...s, key: 'key' in s && typeof s.key === 'string' && s.key.startsWith('catalog_') ? s.key : old?.sources?.find((v) => v.url === s.url)?.key || `sub_${crypto.randomUUID()}`, enabled: old?.sources?.find((v) => v.url === s.url)?.enabled ?? true })),
          liveSources: payload.liveSources.map((s) => ({ ...s, key: 'key' in s && typeof s.key === 'string' && s.key.startsWith('catalog_') ? s.key : old?.liveSources?.find((v) => v.url === s.url)?.key || `sub_${crypto.randomUUID()}`, enabled: old?.liveSources?.find((v) => v.url === s.url)?.enabled ?? true })),
          syncedAt: Date.now(),
        };
        return { ...current, subscriptions: old ? current.subscriptions.map((s) => s.url === url ? snapshot : s) : [...current.subscriptions, snapshot] };
      });
      const skipped = payload.stats ? describeParseStats(payload.stats) : '';
      setMessage(`已同步到草稿：${payload.sources.length} 个点播源、${payload.liveSources.length} 个直播源${skipped ? `；${skipped}` : ''}。保存后全站生效。`);
      return true;
    } catch (e) { setError(e instanceof Error ? e.message : '同步失败'); return false; }
    finally { setBusy(false); }
  }

  function updateSite<K extends keyof SiteSettings>(field: K, value: SiteSettings[K]) {
    if (config) setConfig({ ...config, site: { ...config.site, [field]: value } });
  }
  function logout() {
    if (dirty && !window.confirm('有未保存的修改，仍要退出？')) return;
    setKey(''); setInputKey(''); setConfig(null); setVisitorStats(null); setMessage(''); setError('');
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-card">
        <div className="mx-auto max-w-[1440px] px-5 sm:px-8 h-16 flex items-center justify-between gap-3">
          <Link href="/admin" className="flex items-center gap-3"><span className="grid place-items-center h-8 w-8 rounded-lg bg-accent text-white text-xs font-bold">L</span><span className="font-semibold tracking-tight">LibreTV <span className="hidden sm:inline text-muted font-normal ml-2 text-sm">管理后台</span></span></Link>
          <div className="flex items-center gap-3"><Link className="text-sm text-muted hover:text-accent min-h-11 flex items-center" href="/" target="_blank">查看网站 ↗</Link><ThemeToggle />{key && <button className="btn-ghost btn-sm min-h-11" disabled={busy} onClick={logout}>退出</button>}</div>
        </div>
      </header>
      {!key || !config ? (
        <main className="max-w-[440px] mx-auto px-5 pt-20 sm:pt-28 pb-16">
          <div className="card p-7 sm:p-9">
            <span className="inline-flex items-center gap-2 text-xs text-accent mb-7"><Icon name="gear" className="w-4 h-4" />网站管理</span>
            <h1 className="text-2xl font-semibold tracking-tight">欢迎回来</h1>
            <p className="text-muted text-sm mt-3 mb-7 leading-6">使用管理员密钥登录，集中管理网站内容、数据源与访问统计。</p>
            <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void login(); }}>
              <Field label="管理员密钥"><input className="input w-full min-h-11" type="password" autoComplete="off" autoFocus required value={inputKey} onChange={(e) => setInputKey(e.target.value)} placeholder="输入管理密钥" /></Field>
              {error && <p role="alert" className="text-danger text-sm">{error}</p>}
              <button className="btn-primary w-full min-h-11" disabled={busy || !inputKey.trim()}>{busy ? '正在验证…' : '进入后台'}</button>
            </form>
            <p className="text-xs text-faint mt-6 leading-5">密钥仅用于本次会话，刷新页面后需重新登录。</p>
          </div>
          <p className="text-center text-xs text-muted mt-6">前台已开放访问，管理操作独立验证。</p>
        </main>
      ) : (
        <div className="max-w-[1440px] mx-auto lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
          <aside className="lg:min-h-[calc(100vh-64px)] border-b lg:border-b-0 lg:border-r border-line bg-card px-3 lg:px-5 py-4 lg:py-8">
            <p className="hidden lg:block text-[11px] tracking-widest text-faint mb-4 px-3">管理工作台</p>
            <nav aria-label="管理模块" className="flex lg:flex-col gap-1 overflow-x-auto">
              {tabs.map((item) => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => { setTab(item.id); if (item.id === 'visitors') void loadVisitors(); }} className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm whitespace-nowrap transition-colors ${tab === item.id ? 'bg-accent/10 text-accent font-medium' : 'text-muted hover:bg-hover hover:text-content'}`}><Icon name={item.icon} className="w-[18px] h-[18px]" />{item.name}{(item.id === 'sources' || item.id === 'liveSources' || item.id === 'subscriptions') && <span className="ml-auto text-xs tabular-nums opacity-70">{item.id === 'subscriptions' ? config.subscriptions.length : sourceCount(item.id)}</span>}</button>)}
            </nav>
            <div className="hidden lg:block border-t border-line mt-8 pt-5 px-3"><p className="text-xs text-muted">前台公开访问</p><p className="text-[11px] text-faint leading-5 mt-2">所有设置统一保存到服务器，<br />访客刷新后获取最新配置。</p></div>
          </aside>
          <main className="min-w-0 px-5 sm:px-8 xl:px-12 py-7 sm:py-10">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-7">
              <div><h1 className="text-2xl font-semibold tracking-tight">{currentTab.name}</h1><p className="text-muted text-sm mt-2">{currentTab.hint}</p></div>
              <div className="flex gap-2 items-center"><button className="btn-ghost min-h-11" disabled={busy} onClick={() => void reload()} aria-label="重新加载配置"><Icon name="refresh" className="w-4 h-4" /><span className="hidden sm:inline">重新加载</span></button><button className="btn-primary min-h-11" disabled={busy || !dirty} onClick={() => void save()}>{busy ? '正在处理…' : '保存配置'}</button></div>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted mb-6"><span className={`w-1.5 h-1.5 rounded-full ${dirty ? 'bg-warning' : 'bg-success'}`} />{dirty ? '有尚未保存的修改' : '配置已同步'}<span className="text-faint ml-2">修订 {config.revision}</span></div>
            {error && <p role="alert" className="border border-danger/30 bg-danger/5 rounded-lg p-3 text-danger text-sm mb-5">{error}</p>}
            {message && <p role="status" className="border border-accent/20 bg-accent/5 rounded-lg p-3 text-sm mb-5 leading-6">{message}</p>}
            <fieldset disabled={busy} className="min-w-0 space-y-5">
              <legend className="sr-only">{currentTab.name}</legend>
              {tab === 'site' && <>
                <Panel title="基本信息" hint="显示在网站首页与浏览器标题中。">
                  <Field label="网站名称"><input className="input w-full max-w-lg" maxLength={80} value={config.site.name} onChange={(e) => updateSite('name', e.target.value)} /></Field>
                  <Field label="网站简介"><textarea className="input w-full" rows={2} maxLength={500} value={config.site.description} onChange={(e) => updateSite('description', e.target.value)} /></Field>
                </Panel>
                <Panel title="首页公告" hint="留空时隐藏公告。支持换行，适合发布维护或内容说明。"><Field label="公告内容"><textarea className="input w-full" rows={4} maxLength={2000} placeholder="请输入要展示的公告…" value={config.site.announcement} onChange={(e) => updateSite('announcement', e.target.value)} /></Field></Panel>
                <div className="flex items-start gap-3 rounded-xl border border-line px-5 py-4 text-sm"><Icon name="check" className="w-5 h-5 text-success shrink-0" /><div><p className="font-medium">前台免密码访问已开启</p><p className="text-muted text-xs mt-1 leading-5">访客直接搜索和观看；后台操作始终需要管理员密钥。</p></div></div>
              </>}
              {tab === 'content' && <>
                <Panel title="首页与内容" hint="统一应用到所有访客，替代原前台设置面板。">
                  <ToggleRow label="成人内容过滤" description="搜索时过滤成人内容与成人数据源。" checked={config.site.yellowFilter} onChange={(v) => updateSite('yellowFilter', v)} />
                  <ToggleRow label="首页推荐" description="在首页展示推荐内容。" checked={config.site.doubanEnabled} onChange={(v) => updateSite('doubanEnabled', v)} />
                  <Field label="推荐来源"><select className="input w-full sm:max-w-xs" value={config.site.recommendSource} onChange={(e) => updateSite('recommendSource', e.target.value as SiteSettings['recommendSource'])}><option value="hot-list">影视热榜</option><option value="douban">豆瓣</option><option value="bangumi">Bangumi 动画</option></select></Field>
                </Panel>
                <Panel title="播放偏好">
                  <ToggleRow label="广告切片过滤" description="播放 HLS 视频时尝试跳过已识别的广告片段。" checked={config.site.adFilter} onChange={(v) => updateSite('adFilter', v)} />
                  <ToggleRow label="自动连播" description="当前一集播放结束后，自动播放下一集。" checked={config.site.autoplayNext} onChange={(v) => updateSite('autoplayNext', v)} />
                  <ToggleRow label="视频缓存" description="在访客浏览器中缓存视频片段，减少重复加载。" checked={config.site.cacheEnabled} onChange={(v) => updateSite('cacheEnabled', v)} />
                </Panel>
                <Panel title="封面图加载" hint="直连速度快；代理适合原站图片有访问限制的情况。">
                  <Field label="加载方式"><select className="input w-full sm:max-w-xs" value={config.site.imageMode} onChange={(e) => updateSite('imageMode', e.target.value as SiteSettings['imageMode'])}><option value="direct">原站直连</option><option value="proxy">本站代理</option><option value="custom">自定义代理</option></select></Field>
                  {config.site.imageMode === 'custom' && <Field label="代理地址模板"><input className="input w-full" maxLength={2048} placeholder="https://image.example.com/?url={url}" value={config.site.customImageProxy} onChange={(e) => updateSite('customImageProxy', e.target.value)} /><p className="text-xs text-muted">使用 {'{url}'} 作为原图地址占位符。</p></Field>}
                </Panel>
              </>}
              {(tab === 'sources' || tab === 'liveSources' || tab === 'subscriptions') && <AdminSourceEditor kind={tab} config={config} onChange={setConfig} request={adminRequest} onSync={syncSubscription} report={setMessage} />}
              {tab === 'catalog' && <AdminCatalog request={adminRequest} config={config} onChange={setConfig} onSync={syncSubscription} report={setMessage} />}
              {tab === 'data' && <AdminDataPanel config={config} onChange={setConfig} request={adminRequest} report={setMessage} />}
              {tab === 'visitors' && <VisitorStats stats={visitorStats} busy={statsBusy} refresh={() => void loadVisitors()} />}
            </fieldset>
          </main>
        </div>
      )}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block space-y-2"><span className="block text-sm font-medium">{label}</span>{children}</label>;
}
function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section className="card"><div className="border-b border-line px-5 sm:px-6 py-4"><h2 className="font-semibold text-sm">{title}</h2>{hint && <p className="text-xs text-muted mt-1.5 leading-5">{hint}</p>}</div><div className="p-5 sm:p-6 space-y-6">{children}</div></section>;
}
