export async function register() {
  // 仅持续运行的生产 Node 服务启用；开发、测试、构建和 Edge 不启动定时任务。
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production'
    && process.env.NEXT_PHASE !== 'phase-production-build' && process.env.CATALOG_AUTO_SYNC !== '0') {
    const { startCatalogScheduler } = await import('./lib/source-catalog-sync');
    startCatalogScheduler();
  }
}
