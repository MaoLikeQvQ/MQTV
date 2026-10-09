'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, firstAvailableDetail } from '@/lib/client-api';
// 播放器（artplayer + hls.js）按需加载：拆出独立 chunk，不占首屏 First Load JS
const PlayerShell = dynamic(() => import('@/components/player-shell').then((m) => m.PlayerShell), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  ),
});
import { EmptyState, LoadingState, Spinner } from '@/components/states';
import { enqueueDownload } from '@/components/download-manager';
import { Icon } from '@/components/icon';
import { useCinemaAppearance } from '@/components/cinema-appearance';
import { HomeReveal } from '@/components/home-motion';
import { useAuth } from '@/components/auth';
import { resolveSource, useAppStore, isSourceDisabled, isInDisabledSubscription } from '@/lib/store';
import {
  clearProgress,
  progressKeyOf,
  saveProgress,
  updateHistoryProgress,
  upsertHistory,
  db,
} from '@/lib/db';
import { buildWatchUrl, cn, formatVideoDescription } from '@/lib/utils';
import { SPIDER_EPISODE_PREFIX } from '@/lib/spider-source';
import { mergePlaybackLines, playbackLinesKey } from '@/lib/playback-lines';
import type { SearchResultItem, SourceConfig } from '@/lib/types';

/**
 * 播放页（唯一入口，替代旧版 watch.html → player.html 跳转链）。
 * 状态全部由 URL 驱动：/watch?source=xx&id=..&index=..&title=..
 * 集数列表由服务端详情接口获取；进度与历史走 IndexedDB。
 */
export default function WatchPage() {
  return (
    <Suspense>
      <WatchContent />
    </Suspense>
  );
}

function WatchContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const store = useAppStore();
  const { verified, site } = useAuth();
  const { appearance, toggleAppearance } = useCinemaAppearance();

  const sourceKey = searchParams.get('source') || '';
  const vodId = searchParams.get('id') || '';
  const directUrl = searchParams.get('url') || '';
  const titleParam = searchParams.get('title') || '';
  const indexParam = parseInt(searchParams.get('index') || '0', 10) || 0;

  const [reversed, setReversed] = useState(false);
  const year = searchParams.get('year') || '';
  const autoSelect = searchParams.get('auto') === '1';

  const source = resolveSource(store, sourceKey, {
    url: searchParams.get('sourceUrl') || undefined,
    detail: searchParams.get('detail') || undefined,
    type: searchParams.get('sourceType') === 'drpy' ? 'drpy' : searchParams.get('sourceType') === 't4' ? 't4' : undefined,
  });

  // 详情查询：无 id（纯直连链接分享）时跳过
  const detailQuery = useQuery({
    queryKey: ['detail', sourceKey, vodId, source?.url],
    queryFn: ({ signal }) => api.detail(vodId, source!, signal),
    enabled: Boolean(source && vodId && verified && !autoSelect),
    staleTime: 5 * 60_000,
  });

  const episodes = useMemo(() => detailQuery.data?.episodes ?? [], [detailQuery.data]);
  const videoTitle = titleParam || detailQuery.data?.videoInfo?.title || '未知视频';

  const lineSources = useMemo(() => {
    const seen = new Set<string>();
    return store.selectedKeys.map((key) => resolveSource({ customAPIs: store.customAPIs, envSources: store.envSources }, key)).filter((candidate): candidate is SourceConfig => {
      if (!candidate || seen.has(candidate.key) || isSourceDisabled({ sourceHealth: store.sourceHealth }, candidate.key) || isInDisabledSubscription({ subscriptions: store.subscriptions }, candidate.key)) return false;
      seen.add(candidate.key);
      return true;
    });
  }, [store.customAPIs, store.envSources, store.selectedKeys, store.sourceHealth, store.subscriptions]);
  const linesKey = playbackLinesKey(videoTitle, year, store.selectedKeys, store.yellowFilter);
  const initialLine: SearchResultItem[] = source && vodId ? [{
    sourceKey, vodId, sourceName: source.name, sourceUrl: source.url, sourceType: source.type, name: videoTitle, year: year || undefined,
  }] : [];
  const linesQuery = useQuery({
    queryKey: linesKey,
    queryFn: async ({ signal }) => {
      const previous = queryClient.getQueryData<SearchResultItem[]>(linesKey) ?? initialLine;
      if (lineSources.length === 0) return previous;
      const { list } = await api.search(videoTitle, lineSources, store.yellowFilter, { signal });
      return mergePlaybackLines(previous, list, videoTitle, year);
    },
    enabled: Boolean(verified && source && vodId && videoTitle !== '未知视频'),
    // 首页带入的线路立即可见；进入播放页补查其他线路，手动切换不重新创建查询。
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const lines = linesQuery.data ?? initialLine;
  const autoQuery = useQuery({
    queryKey: ['playback-auto', videoTitle, year, lines.map((line) => [line.sourceKey, line.vodId])],
    queryFn: ({ signal }) => firstAvailableDetail(lines.flatMap((item) => {
      const candidate = resolveSource({ customAPIs: store.customAPIs, envSources: store.envSources }, item.sourceKey, { url: item.sourceUrl, name: item.sourceName, type: item.sourceType });
      return candidate ? [{ item, source: candidate }] : [];
    }), signal),
    enabled: Boolean(verified && source && vodId && autoSelect && lines.length),
    retry: false,
  });
  useEffect(() => {
    if (!autoSelect || !autoQuery.data) return;
    const { item, detail } = autoQuery.data;
    const candidate = resolveSource({ customAPIs: store.customAPIs, envSources: store.envSources }, item.sourceKey, { url: item.sourceUrl, name: item.sourceName, type: item.sourceType });
    if (!candidate) return;
    // 胜出详情写入播放页缓存，更新 URL 后立即播放，避免重复请求。
    queryClient.setQueryData(['detail', item.sourceKey, item.vodId, candidate.url], detail);
    const sp = new URLSearchParams(searchParams.toString());
    sp.set('source', item.sourceKey);
    sp.set('id', item.vodId);
    sp.set('sourceUrl', candidate.url);
    if (candidate.type) sp.set('sourceType', candidate.type);
    else sp.delete('sourceType');
    if (candidate.detail) sp.set('detail', candidate.detail);
    else sp.delete('detail');
    sp.delete('auto');
    router.replace(`/watch?${sp.toString()}`, { scroll: false });
  }, [autoSelect, autoQuery.data, queryClient, router, searchParams, store.customAPIs, store.envSources]);
  const detailLoading = autoSelect ? autoQuery.isFetching || !autoQuery.isError : detailQuery.isLoading;
  const detailError = autoSelect ? autoQuery.isError : detailQuery.isError;

  function selectLine(item: SearchResultItem) {
    const candidate = resolveSource({ customAPIs: store.customAPIs, envSources: store.envSources }, item.sourceKey, { url: item.sourceUrl, name: item.sourceName, type: item.sourceType });
    if (!candidate) return;
    const target = new URL(buildWatchUrl({
      sourceKey: item.sourceKey, vodId: item.vodId, index: currentIndex,
      title: videoTitle, sourceUrl: candidate.url, sourceType: candidate.type, detail: candidate.detail,
    }), window.location.origin);
    if (year) target.searchParams.set('year', year);
    router.replace(`${target.pathname}${target.search}`, { scroll: false });
  }

  // 当前播放地址：优先取剧集列表中的当前集，其次直连 URL 参数
  const episodeReference = useMemo(() => {
    if (episodes.length > 0) {
      const idx = Math.min(Math.max(indexParam, 0), episodes.length - 1);
      return episodes[idx] || directUrl;
    }
    return directUrl;
  }, [episodes, indexParam, directUrl]);

  const needsResolution = episodeReference.startsWith(SPIDER_EPISODE_PREFIX);
  const playQuery = useQuery({
    queryKey: ['spider-play', source?.url, source?.type, episodeReference],
    queryFn: ({ signal }) => api.play(episodeReference, source!, signal),
    enabled: Boolean(verified && source && needsResolution),
    staleTime: 30_000, retry: false,
  });
  const currentUrl = needsResolution ? playQuery.data?.url || '' : episodeReference;

  const currentIndex = useMemo(() => {
    if (episodes.length > 0) return Math.min(Math.max(indexParam, 0), episodes.length - 1);
    return indexParam;
  }, [episodes, indexParam]);

  const goEpisode = useCallback(
    (index: number) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set('index', String(index));
      sp.set('url', episodes[index] || directUrl);
      sp.delete('position');
      router.replace(`/watch?${sp.toString()}`, { scroll: false });
    },
    [router, searchParams, episodes, directUrl]
  );

  // 进度恢复优先级：URL position 参数 > IndexedDB 记录
  const getRestorePosition = useCallback(async () => {
    const urlPos = parseInt(searchParams.get('position') || '0', 10) || 0;
    if (urlPos > 0) return urlPos;
    if (!vodId) return 0;
    const entry = await db.progress.get(progressKeyOf(sourceKey, vodId, currentIndex));
    return entry?.position ?? 0;
  }, [searchParams, sourceKey, vodId, currentIndex]);

  // 写入观看历史（进入页面即记录，进度后续增量更新）
  useEffect(() => {
    if (!verified || !sourceKey || !currentUrl) return;
    const timer = setTimeout(() => {
      upsertHistory({
        sourceKey,
        sourceUrl: source?.url, sourceType: source?.type,
        vodId: vodId || currentUrl,
        title: videoTitle,
        pic: detailQuery.data?.videoInfo?.cover,
        episodeIndex: currentIndex,
        totalEpisodes: episodes.length,
        playbackPosition: 0,
        duration: 0,
        timestamp: Date.now(),
      }).catch(() => {});
    }, 2000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, sourceKey, vodId, currentIndex, videoTitle, currentUrl]);

  // 播放中与暂停时的进度落盘逻辑一致，共用同一回调
  const handleProgress = useCallback(
    (position: number, duration: number) => {
      if (vodId) {
        saveProgress(sourceKey, vodId, currentIndex, position, duration).catch(() => {});
        updateHistoryProgress(sourceKey, vodId || currentUrl, position, duration).catch(() => {});
      }
    },
    [sourceKey, vodId, currentIndex, currentUrl]
  );

  // 自动连播的 800ms 延迟切集要在卸载时取消，避免离开页面后跳转
  const autoNextTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (autoNextTimer.current) clearTimeout(autoNextTimer.current);
  }, []);

  const handleEnded = useCallback(() => {
    if (vodId) clearProgress(sourceKey, vodId, currentIndex).catch(() => {});
    if (store.autoplayNext && currentIndex < episodes.length - 1) {
      autoNextTimer.current = setTimeout(() => goEpisode(currentIndex + 1), 800);
    }
  }, [store.autoplayNext, currentIndex, episodes.length, goEpisode, sourceKey, vodId]);

  // Alt+←/→ 集数切换快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft' && currentIndex > 0) {
        e.preventDefault();
        goEpisode(currentIndex - 1);
      } else if (e.key === 'ArrowRight' && currentIndex < episodes.length - 1) {
        e.preventDefault();
        goEpisode(currentIndex + 1);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [currentIndex, episodes.length, goEpisode]);

  const orderedEpisodes = reversed ? [...episodes].map((_, i) => episodes.length - 1 - i) : episodes.map((_, i) => i);

  if (!verified) {
    return (
      <div className="cinema-home cinema-watch flex items-center justify-center" data-appearance={appearance}>
        <p className="text-faint text-sm">正在加载网站配置…</p>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="cinema-home cinema-watch flex items-center justify-center px-4" data-appearance={appearance}>
        <div className="text-center max-w-md">
          <h1 className="text-content font-medium mb-2">点播源不存在</h1>
          <p className="text-sm text-muted mb-4">
            该视频来自点播源「{sourceKey}」，但它可能已被删除或停用。请联系管理员在后台检查数据源。
          </p>
          <Link href="/" className="btn-primary">返回首页</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="cinema-home cinema-watch" data-appearance={appearance}>
      <header className="watch-topbar">
        <div className="watch-topbar-inner">
          <BackButton />
          <Link href="/" className="cinema-brand watch-brand" aria-label={`${site.name} 首页`}>
            <span className="cinema-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg></span>
            <span>{site.name}</span>
          </Link>
          <div className="watch-top-context"><span>正在观看</span><strong>{videoTitle}</strong></div>
          <div className="watch-top-tools">
            <button className="watch-theme-button" onClick={toggleAppearance} aria-label={`切换为${appearance === 'dark' ? '浅色' : '深色'}主题`} title="切换主题">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4" /><circle cx="12" cy="12" r="4" /></svg>
            </button>
            <button
              className="watch-download"
              disabled={!currentUrl}
              onClick={() => {
                if (!currentUrl) return;
                enqueueDownload({
                  url: currentUrl,
                  // 多集才带集数后缀；单集影片（含电影）文件名就是纯标题
                  title: `${videoTitle}${episodes.length > 1 ? ` 第${currentIndex + 1}集` : ''}`,
                  format: 'MP4',
                });
                // 「已加入下载队列」由 DownloadManager 在真正入队后提示：
                // 这里先提示的话，用户随后取消保存位置会出现「已加入→已取消」的矛盾
              }}
            >
              <Icon name="download" className="w-4 h-4" /><span>下载本集</span>
            </button>
          </div>
        </div>
      </header>

      <main className="watch-main">
        <HomeReveal className="watch-layout" identity={videoTitle}>
          <div className="watch-stage" data-reveal>
            <div className="watch-player">
              {currentUrl ? (
                <PlayerShell
                  url={currentUrl}
                  title={videoTitle}
                  adFilter={store.adFilter}
                  autoplayNext={store.autoplayNext}
                  episodeKey={`${sourceKey}:${vodId}:${currentIndex}`}
                  nextUrl={!needsResolution && currentIndex + 1 < episodes.length ? episodes[currentIndex + 1] : undefined}
                  nextEpisodeKey={currentIndex + 1 < episodes.length ? `${sourceKey}:${vodId}:${currentIndex + 1}` : undefined}
                  getRestorePosition={getRestorePosition}
                  onTimeUpdate={handleProgress}
                  onPause={handleProgress}
                  onEnded={handleEnded}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  {detailLoading || (needsResolution && playQuery.isPending) ? (
                    <Spinner size="lg" />
                  ) : (
                    <p className="text-faint text-sm">
                      {playQuery.error?.message || (detailError ? '视频加载失败，请选择其他线路' : '无可用播放地址')}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 操作栏 */}
            <div className="watch-playback-bar">
              <span className="watch-current"><i />{episodes.length > 1 ? `正在播放第 ${currentIndex + 1} 集` : currentUrl ? '正片播放' : '正在准备播放'}</span>
              <button
                className="btn-ghost btn-sm"
                disabled={currentIndex <= 0}
                onClick={() => goEpisode(currentIndex - 1)}
              >
                <span aria-hidden="true">←</span> 上一集
              </button>
              <button
                className="btn-ghost btn-sm"
                disabled={episodes.length === 0 || currentIndex >= episodes.length - 1}
                onClick={() => goEpisode(currentIndex + 1)}
              >
                下一集 <span aria-hidden="true">→</span>
              </button>
            </div>
            <section className="watch-film-info" aria-label="影片信息">
              <p className="cinema-eyebrow">{site.name} · 正在观看</p>
              <h1>{videoTitle}</h1>
              <div className="watch-film-meta">
                {(detailQuery.data?.videoInfo?.year || year) && <span>{detailQuery.data?.videoInfo?.year || year}</span>}
                {detailQuery.data?.videoInfo?.typeName && <span>{detailQuery.data.videoInfo.typeName}</span>}
                {detailQuery.data?.videoInfo?.area && <span>{detailQuery.data.videoInfo.area}</span>}
                {episodes.length > 0 && <span>{episodes.length === 1 ? '正片' : `共 ${episodes.length} 集`}</span>}
              </div>
              {detailQuery.data?.videoInfo?.desc && <p className="watch-synopsis">{formatVideoDescription(detailQuery.data.videoInfo.desc)}</p>}
            </section>
          </div>

          {/* 线路与剧集侧栏 */}
          <aside className="watch-side" data-reveal>
            <section aria-label="播放线路" className="watch-lines-section">
              <div className="watch-section-title"><h2>播放线路</h2><span>{lines.length} 条线路</span></div>
              <p className="watch-line-hint">{autoSelect ? '为你选择可用线路' : `当前：${source.name}`}</p>
              <div className="watch-lines">
                {lines.map((line) => {
                  const active = line.sourceKey === sourceKey && line.vodId === vodId && !autoSelect;
                  return <button
                    key={JSON.stringify([line.sourceKey, line.vodId])}
                    className="watch-line"
                    aria-pressed={active}
                    onClick={() => selectLine(line)}
                    title={line.sourceName}
                  ><span className="watch-line-dot" aria-hidden="true" /><span className="truncate">{line.sourceName}</span>{active && <Icon name="check" className="w-3.5 h-3.5 shrink-0" />}</button>;
                })}
              </div>
              {autoSelect && <p role="status" className="text-xs text-faint mt-2">{autoQuery.isError ? '自动选线失败，请选择线路或重试' : '正在选择可用线路…'}</p>}
              {autoSelect && autoQuery.isError && <button className="btn-ghost btn-sm mt-1" onClick={() => { void autoQuery.refetch(); }}>重新选线</button>}
              {linesQuery.isFetching && <p role="status" className="text-xs text-faint mt-2">正在查找其他线路…</p>}
              {linesQuery.isError && <button className="btn-ghost btn-sm mt-2" onClick={() => { void linesQuery.refetch(); }}>重新查找线路</button>}
            </section>
            <div className="watch-section-title watch-episode-heading">
              <h2>
                选集{episodes.length > 0 && ` · ${episodes.length}`}
              </h2>
              {/* 排列开关紧贴它所作用的列表：放在这里才看得出它管的是这一栏的顺序 */}
              {episodes.length > 1 && (
                <button
                  className="btn-ghost btn-sm shrink-0"
                  onClick={() => setReversed((v) => !v)}
                  aria-label={reversed ? '切换为正序排列' : '切换为倒序排列'}
                  title="调整剧集列表的排列顺序"
                >
                  <Icon
                    name="arrowDown"
                    className={cn('w-3.5 h-3.5 transition-transform', reversed && 'rotate-180')}
                  />
                  {reversed ? '正序排列' : '倒序排列'}
                </button>
              )}
            </div>
            {episodes.length === 0 ? (
              detailLoading ? (
                <LoadingState />
              ) : (
                <EmptyState variant="plain" title={detailError ? '获取剧集失败' : '暂无剧集信息'} />
              )
            ) : (
              <div className="watch-episodes">
                {orderedEpisodes.map((realIndex) => (
                  <EpisodeButton
                    key={realIndex}
                    index={realIndex}
                    active={realIndex === currentIndex}
                    onClick={() => goEpisode(realIndex)}
                  />
                ))}
              </div>
            )}
            <details className="watch-shortcuts"><summary>播放快捷键 <Icon name="chevronDown" className="w-3.5 h-3.5" /></summary><p>空格：播放 / 暂停<br />← / →：快退 / 快进 5 秒<br />F：全屏 · Alt + ← / →：切换集数</p></details>
          </aside>
        </HomeReveal>
      </main>
      <footer className="watch-footer"><Link href="/">返回首页</Link><span>{site.name} · 发现你的下一部好片</span></footer>
    </div>
  );
}

/** 集数按钮：激活时自动滚动进可视区（长剧列表） */
function EpisodeButton({ index, active, onClick }: { index: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <button
      ref={ref}
      className="watch-episode"
      aria-pressed={active}
      onClick={onClick}
    >
      {index + 1}
    </button>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <button
      className="p-2 -ml-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push('/');
      }}
      aria-label="返回"
    >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
    </button>
  );
}
