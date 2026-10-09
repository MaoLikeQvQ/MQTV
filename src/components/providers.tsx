'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Suspense, useEffect, useState, type ReactNode } from 'react';
import { ToastProvider } from './toast';
import { AuthProvider } from './auth';
import { VisitorTracker } from './visitor-tracker';
import { usePathname } from 'next/navigation';
import { ThemeProvider } from './theme';
import { GlobalDownloadManager } from './download-manager';
import { useAppStore, hydrateLiveProbeResults } from '@/lib/store';
import { api, STATUS_QUERY_KEY } from '@/lib/client-api';
import { applyEnvPresets } from '@/lib/subscription-sync';
import { HomeLoading } from './home-loading';
import { NavigationProgress } from './navigation-progress';

export function Providers({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // 管理页不启动访客查询、订阅同步和登录弹窗；验证密钥前不请求管理数据。
  if (pathname === '/admin' || pathname?.startsWith('/admin/')) {
    return <ThemeProvider><ToastProvider>{children}</ToastProvider></ThemeProvider>;
  }
  return <PublicProviders>{children}</PublicProviders>;
}

function PublicProviders({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const pathname = usePathname();
  const [configError, setConfigError] = useState('');
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 },
        },
      })
  );

  // store 配置了 skipHydration：等挂载后再读 localStorage，
  // 保证 hydration 阶段客户端与服务端渲染结果一致。
  useEffect(() => {
    // 先等持久化状态恢复，再拉服务端下发数据：
    // 避免 setEnvSources/setLiveEnvSources 的勾选合并发生在 rehydrate 之前被覆盖
    let cancelled = false;
    Promise.resolve(useAppStore.persist.rehydrate())
      .then(() => {
        // 测活缓存从 IndexedDB 恢复（并顺带搬迁旧 localStorage 快照里的存量），
        // 与下方 /api/status 拉取互不依赖，失败静默
        void hydrateLiveProbeResults();
        // 获取后台保存的网站设置和已启用的源快照。
        // 与 AuthProvider 共用同一 query key，/api/status 全站只发一次
        return queryClient.fetchQuery({ queryKey: STATUS_QUERY_KEY, queryFn: () => api.status() });
      })
      .then((d) => {
        // 后台配置覆盖运行时偏好；订阅由管理员同步，浏览器只接收源快照。
        if (d) return applyEnvPresets(d);
      })
      .then(() => { if (!cancelled) setReady(true); })
      .catch((error) => {
        if (!cancelled) setConfigError(error instanceof Error ? error.message : '网站配置加载失败');
      });
    return () => { cancelled = true; };
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <VisitorTracker />
          <Suspense fallback={null}><NavigationProgress /></Suspense>
          {/* 全站常驻：下载事件监听（enqueueDownload）依赖它存在——
              挂在 Header 里会让 /watch 等不渲染 Header 的页面派发的事件凭空丢失 */}
          <GlobalDownloadManager />
          <AuthProvider>{ready ? children : pathname === '/' && !configError ? <HomeLoading /> : (
            <div className="min-h-screen flex items-center justify-center px-6" role="status">
              {configError ? (
                <div className="max-w-sm text-center space-y-3">
                  <p className="text-content font-medium">网站配置暂时无法加载</p>
                  <p className="text-sm text-muted">{configError}</p>
                  <button className="btn-primary" onClick={() => window.location.reload()}>重新加载</button>
                </div>
              ) : <p className="text-sm text-muted">正在加载网站…</p>}
            </div>
          )}</AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
