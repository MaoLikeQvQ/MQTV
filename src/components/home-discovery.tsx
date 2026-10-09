'use client';

import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/client-api';
import { useAppStore } from '@/lib/store';
import type { DoubanItem } from '@/lib/types';
import type { HomeChannel } from './home-shell';
import { SmartImage } from './smart-image';
import { Icon } from './icon';
import { HomeReveal } from './home-motion';
import { DiscoverySkeleton } from './home-loading';

const hotLists = [
  { id: 'douban_movie_weekly', label: '电影周榜' }, { id: 'douban_tv_chinese', label: '国产剧' },
  { id: 'douban_tv_global', label: '海外剧' }, { id: 'douban_show_chinese', label: '国内综艺' },
  { id: 'douban_show_global', label: '海外综艺' }, { id: 'baidu_teleplay', label: '热播剧' },
];
const movieTags = ['热门', '最新', '经典', '豆瓣高分', '华语', '欧美', '韩国', '日本'];
const tvTags = ['热门', '国产剧', '美剧', '英剧', '韩剧', '日剧', '综艺', '日本动画'];
const channelNames = { recommended: '为你推荐', tv: '电视剧', movie: '电影', variety: '综艺', anime: '动漫' };

export function HomeDiscovery({ channel, onPick }: { channel: HomeChannel; onPick: (title: string) => void }) {
  const source = useAppStore((s) => s.recommendSource);
  const enabled = useAppStore((s) => s.doubanEnabled);
  const [filter, setFilter] = useState('');
  const previousChannel = useRef(channel);
  const switched = previousChannel.current !== channel;
  useEffect(() => { previousChannel.current = channel; setFilter(''); }, [channel]);
  const useBangumi = source === 'bangumi' && (channel === 'recommended' || channel === 'anime');
  const useHot = source === 'hot-list' && channel !== 'anime';
  const type = channel === 'tv' || channel === 'variety' || channel === 'anime' ? 'tv' : 'movie';
  const defaultHot = channel === 'tv' ? 'douban_tv_chinese' : channel === 'variety' ? 'douban_show_chinese' : 'douban_movie_weekly';
  const defaultTag = channel === 'anime' ? '日本动画' : channel === 'variety' ? '综艺' : '热门';
  const current = (!switched && filter) || (useBangumi ? 'all' : useHot ? defaultHot : defaultTag);
  const channelHotLists = hotLists.filter((item) => channel === 'recommended' || (channel === 'movie' ? item.id.includes('movie') : channel === 'tv' ? item.id.includes('tv_') || item.id === 'baidu_teleplay' : item.id.includes('show_')));
  const tags = channel === 'anime' ? ['日本动画'] : channel === 'variety' ? ['综艺'] : type === 'movie' ? movieTags : tvTags;
  const filters = useBangumi ? [{ id: 'all', label: '全部放送' }, ...['周一','周二','周三','周四','周五','周六','周日'].map((label, i) => ({ id: String(i + 1), label }))]
    : useHot ? channelHotLists : tags.map((label) => ({ id: label, label }));
  const query = useQuery({
    queryKey: ['home-discovery', useBangumi ? 'bangumi' : useHot ? 'hot-list' : 'douban', type, current],
    queryFn: async ({ signal }) => {
      if (useBangumi) {
        const result = await api.bangumiCalendar(signal);
        return { items: result.days.filter((d) => current === 'all' || d.weekday === Number(current)).flatMap((d) => d.items) };
      }
      return useHot ? api.hotList(current, signal) : api.douban(type, current, 0, 30, signal);
    },
    enabled, placeholderData: keepPreviousData, staleTime: 120_000,
  });
  const items = query.data?.items ?? [];
  const featured = items.slice(0, 4);
  const editorial = items.slice(4, 7);
  const remaining = items.slice(7);
  const label = filters.find((f) => f.id === current)?.label || channelNames[channel];
  return <section className="cinema-discovery" aria-label={channelNames[channel]} aria-busy={query.isFetching}>
    <div className="cinema-section-heading"><div><p className="cinema-eyebrow">发现 · {channelNames[channel]}</p><h1>{channel === 'recommended' ? '好故事，现在开始。' : `${channelNames[channel]}，总有一部打动你。`}</h1></div><span className="cinema-heading-note">{query.isFetching ? '正在更新内容…' : '选一部，开启下一段故事'}</span></div>
    {enabled && <div className="cinema-filters" aria-label="推荐分类">{filters.map((item) => <button key={item.id} aria-pressed={item.id === current} onClick={() => setFilter(item.id)}>{item.label}</button>)}</div>}
    {!enabled ? <div className="cinema-empty"><h2>从一个片名开始</h2><p>首页推荐已关闭。输入电影、剧集或动漫名称，寻找你想看的故事。</p></div>
      : query.isError ? <div className="cinema-empty" role="alert"><h2>推荐暂时没能加载</h2><p>你仍然可以搜索片名，或重试获取这份榜单。</p><button className="btn-primary" onClick={() => void query.refetch()}>重新加载</button></div>
      : !query.data ? <div role="status" aria-label="正在加载推荐"><DiscoverySkeleton /></div>
      : !items.length ? <div className="cinema-empty"><h2>这个分类暂时没有内容</h2><p>试试其他分类，或直接搜索片名。</p></div>
      : <HomeReveal identity={JSON.stringify(items.map(({ id, title }) => [id, title]))}>
        <div className="cinema-feature-grid">{featured.map((item, i) => <button className="cinema-feature-card" key={item.id} data-reveal onClick={() => onPick(item.title)} aria-label={`搜索 ${item.title}`}>
          <div className="cinema-feature-image"><Poster item={item} /><span className="cinema-label">{label}</span>{item.rating && <span className="cinema-score">{item.rating}</span>}<span className="cinema-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l12-7z" /></svg></span></div>
          <h2>{item.title}</h2><p>{i === 0 ? '本期榜单 · 值得一看' : item.rating ? `评分 ${item.rating} · 搜索观看` : '发现更多精彩故事'}</p>
        </button>)}</div>
        {!!editorial.length && <section className="cinema-editorial"><div className="cinema-row-title"><h2>值得一看</h2><span>好作品，慢慢发现</span></div><div className="cinema-editorial-grid">{editorial.map((item) => <button key={item.id} className="cinema-editorial-card" data-reveal onClick={() => onPick(item.title)} aria-label={`搜索 ${item.title}`}><div className="cinema-editorial-image"><Poster item={item} /><span className="cinema-editorial-shade" /><span className="cinema-editorial-caption"><span className="cinema-eyebrow">{label}</span><strong>{item.title}</strong><span>{item.rating ? `评分 ${item.rating}` : '为你发现'}<i>搜索观看 ↗</i></span></span></div></button>)}</div></section>}
        {!!remaining.length && <section className="cinema-more"><div className="cinema-row-title"><h2>更多好片</h2><span>{remaining.length} 部作品等你发现</span></div><div className="cinema-poster-grid">{remaining.map((item) => <button key={item.id} className="cinema-poster-card" onClick={() => onPick(item.title)} aria-label={`搜索 ${item.title}`}><div className="cinema-poster-image"><Poster item={item} />{item.rating && <span className="cinema-score">{item.rating}</span>}</div><h3>{item.title}</h3></button>)}</div></section>}
      </HomeReveal>}
  </section>;
}

function Poster({ item }: { item: DoubanItem }) {
  const mode = useAppStore((s) => s.imageProxyMode);
  const proxy = useAppStore((s) => s.customImageProxy);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [item.cover]);
  return <><div className="cinema-poster-placeholder"><Icon name="filter" className="w-9 h-9" /><span>{item.title}</span></div>{item.cover && !failed && <SmartImage url={item.cover} mode={mode} customProxy={proxy} alt={item.title} className="cinema-cover" fadeIn onExhausted={() => setFailed(true)} />}</>;
}
