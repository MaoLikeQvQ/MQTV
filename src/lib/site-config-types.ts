import type { LiveSourceConfig, SourceConfig } from './types';

export interface SiteSettings {
  name: string;
  description: string;
  announcement: string;
  authDisabled: boolean;
  recommendSource: 'douban' | 'bangumi' | 'hot-list';
  imageMode: 'direct' | 'proxy' | 'custom';
  customImageProxy: string;
  yellowFilter: boolean;
  adFilter: boolean;
  doubanEnabled: boolean;
  autoplayNext: boolean;
  cacheEnabled: boolean;
}

export interface ManagedSubscription {
  name: string;
  url: string;
  enabled: boolean;
  sources?: (SourceConfig & { enabled?: boolean })[];
  liveSources?: (LiveSourceConfig & { enabled?: boolean })[];
  syncedAt?: number;
}

export interface SiteConfig {
  version: 1;
  revision: number;
  site: SiteSettings;
  sources: (SourceConfig & { enabled: boolean })[];
  liveSources: (LiveSourceConfig & { enabled: boolean })[];
  subscriptions: ManagedSubscription[];
}

export const DEFAULT_SITE: SiteSettings = {
  name: 'MQTV',
  description: '免费在线视频搜索与观看平台',
  announcement: '',
  authDisabled: true,
  recommendSource: 'hot-list',
  imageMode: 'direct',
  customImageProxy: '',
  yellowFilter: true,
  adFilter: true,
  doubanEnabled: true,
  autoplayNext: true,
  cacheEnabled: true,
};
