import { Icon } from './icon';

/** 与首页保持相同尺寸，不用假进度延长等待。 */
export function HomeLoading() {
  return <div className="cinema-home cinema-loading" data-appearance="dark" role="status" aria-label="正在加载首页" aria-busy="true">
    <aside className="cinema-sidebar" aria-hidden="true"><div className="cinema-brand"><span className="cinema-brand-mark"><Icon name="home" /></span><span className="cinema-skeleton" style={{ width: 76, height: 24 }} /></div><p className="cinema-nav-caption">发现好故事</p><div className="cinema-nav">{['为你推荐', '电视剧', '电影', '综艺', '动漫', '直播'].map((label) => <div className="cinema-loading-nav" key={label}><span className="cinema-skeleton" />{label}</div>)}</div></aside>
    <div className="cinema-workspace" aria-hidden="true"><div className="cinema-topbar"><div className="cinema-skeleton cinema-search-skeleton" /></div><div className="cinema-main"><div className="cinema-loading-announcement"><span className="cinema-skeleton" /></div><div className="cinema-loading-title"><p>正在为你准备好故事…</p><span className="cinema-skeleton" /></div><div className="cinema-loading-filters">{Array.from({ length: 6 }, (_, i) => <span className="cinema-skeleton" key={i} />)}</div><DiscoverySkeleton /></div></div>
    <span className="sr-only">正在加载首页，请稍候。</span>
  </div>;
}

export function DiscoverySkeleton() {
  return <div className="cinema-discovery-skeleton" aria-hidden="true"><div className="cinema-feature-grid">{Array.from({ length: 4 }, (_, i) => <div key={i}><div className="cinema-skeleton cinema-feature-image" /><div className="cinema-skeleton cinema-skeleton-title" /><div className="cinema-skeleton cinema-skeleton-caption" /></div>)}</div><div className="cinema-skeleton cinema-skeleton-heading" /><div className="cinema-editorial-grid">{Array.from({ length: 3 }, (_, i) => <div key={i} className="cinema-skeleton cinema-editorial-skeleton" />)}</div></div>;
}
