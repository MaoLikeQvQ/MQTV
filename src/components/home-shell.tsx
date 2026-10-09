'use client';

import Link from 'next/link';
import { useRef, useState, type ReactNode } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { Icon, type IconName } from './icon';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { useAuth } from './auth';
import { useCinemaAppearance } from './cinema-appearance';

gsap.registerPlugin(useGSAP);

export type HomeChannel = 'recommended' | 'tv' | 'movie' | 'variety' | 'anime';
const channels: { id: HomeChannel; label: string; icon: IconName }[] = [
  { id: 'recommended', label: '为你推荐', icon: 'home' },
  { id: 'tv', label: '电视剧', icon: 'link' },
  { id: 'movie', label: '电影', icon: 'filter' },
  { id: 'variety', label: '综艺', icon: 'bolt' },
  { id: 'anime', label: '动漫', icon: 'plus' },
];

export function HomeShell({ channel, onChannel, searching, search, children }: {
  channel: HomeChannel; onChannel: (channel: HomeChannel) => void; searching: boolean;
  search: ReactNode; children: ReactNode;
}) {
  const { site } = useAuth();
  const [historyOpen, setHistoryOpen] = useState(false);
  const { appearance, toggleAppearance } = useCinemaAppearance();
  const root = useRef<HTMLDivElement>(null);
  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.fromTo('.cinema-nav > button, .cinema-nav > a', { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.28, stagger: 0.02, ease: 'power2.out', clearProps: 'opacity,transform' });
      gsap.fromTo('.cinema-top-search', { opacity: 0, y: -5 }, { opacity: 1, y: 0, duration: 0.24, ease: 'power2.out', clearProps: 'opacity,transform' });
    }, root);
    return () => media.revert();
  }, { scope: root });
  return <div ref={root} className="cinema-home" data-appearance={appearance}>
    <a href="#home-content" className="cinema-skip">跳到内容</a>
    <aside className="cinema-sidebar">
      <Link href="/" className="cinema-brand" aria-label={`${site.name} 首页`}>
        <span className="cinema-brand-mark" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z" /></svg></span>
        <span>{site.name}</span>
      </Link>
      <p className="cinema-nav-caption">发现好故事</p>
      <nav aria-label="首页频道" className="cinema-nav">
        {channels.map((item) => <button key={item.id} aria-current={!searching && channel === item.id ? 'page' : undefined} onClick={() => onChannel(item.id)}>
          <Icon name={item.icon} className="w-[19px] h-[19px]" /><span>{item.label}</span>
        </button>)}
        <Link href="/live"><Icon name="bolt" className="w-[19px] h-[19px]" /><span>直播</span><i className="cinema-live-dot" /></Link>
      </nav>
      <div className="cinema-sidebar-bottom">
        <button onClick={() => setHistoryOpen(true)}><Icon name="clock" className="w-[18px] h-[18px]" />观看历史</button>
        <Link href="/about"><Icon name="alert" className="w-[18px] h-[18px]" />关于本站</Link>
        <span className="cinema-sidebar-note">每一个好故事，都值得被发现。</span>
      </div>
    </aside>
    <div className="cinema-workspace">
      <header className="cinema-topbar">
        <Link href="/" className="cinema-mobile-brand">{site.name}</Link>
        <div className="cinema-top-search">{search}</div>
        <div className="cinema-tools">
          <button onClick={() => setHistoryOpen(true)} aria-label="观看历史" title="观看历史"><Icon name="clock" /><span>历史</span></button>
          <button onClick={requestShowDownloadManager} aria-label="下载管理" title="下载管理"><Icon name="download" /><span>下载</span></button>
          <button onClick={toggleAppearance} aria-label={`切换为${appearance === 'dark' ? '浅色' : '深色'}主题`} title="切换首页主题"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17m10-10 1.4-1.4" /><circle cx="12" cy="12" r="4" /></svg><span>主题</span></button>
        </div>
      </header>
      <main id="home-content" className="cinema-main" tabIndex={-1}>{children}</main>
      <footer className="cinema-footer"><span>{site.name} · 发现你的下一部好片</span><Link href="/about">关于与使用说明</Link><a href="https://github.com/LibreSpark/LibreTV" target="_blank" rel="noreferrer">LibreTV · AGPL-3.0</a></footer>
    </div>
    <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
  </div>;
}
