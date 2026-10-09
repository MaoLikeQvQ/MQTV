import type { SourceType } from './types';
import { DEFAULT_SITE, type SiteConfig } from './site-config-types';
import { MAX_LIVE_SOURCES, MAX_VOD_SOURCES } from './source-list';

export class ConfigError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const MAX_CONFIG_BYTES = 256 * 1024;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ConfigError('配置必须是对象');
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) {
    throw new ConfigError(`${label}不能为空且不能超过 ${max} 个字符`);
  }
  return value.trim();
}

function sourceType(value: unknown): { type?: SourceType } {
  if (value === undefined) return {};
  if (value !== 't4' && value !== 'drpy') throw new ConfigError('点播源类型无效');
  return { type: value };
}

function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new ConfigError('开关必须为布尔值');
  return value;
}

function url(value: unknown, label: string): string {
  const result = text(value, label, 2048);
  try {
    const parsed = new URL(result);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
  } catch { throw new ConfigError(`${label}必须是无用户名和密码的 http/https 地址`); }
  return result;
}

function rows(value: unknown, max: number): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > max) throw new ConfigError(`列表最多允许 ${max} 条`);
  return value.map(object);
}

function timestamp(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new ConfigError('订阅同步时间无效');
  return Number(value);
}

/** 按白名单重建配置，密钥等未知字段不会落盘或通过状态接口下发。 */
export function parseSiteConfig(value: unknown): SiteConfig {
  const raw = object(value);
  if (raw.version !== 1 || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0) {
    throw new ConfigError('配置版本或修订号无效');
  }
  const site = object(raw.site);
  flag(site.authDisabled);
  if (!['douban', 'bangumi', 'hot-list'].includes(String(site.recommendSource))) throw new ConfigError('首页推荐来源无效');
  if (!['direct', 'proxy', 'custom'].includes(String(site.imageMode))) throw new ConfigError('封面加载方式无效');
  const sources = rows(raw.sources, MAX_VOD_SOURCES).map((s) => ({
    key: text(s.key, '源标识', 128), name: text(s.name, '源名称', 128), url: url(s.url, '源地址'),
    enabled: flag(s.enabled), ...sourceType(s.type),
    ...(s.detail ? { detail: url(s.detail, '详情地址') } : {}),
    ...(s.isAdult !== undefined ? { isAdult: flag(s.isAdult) } : {}),
  }));
  const liveSources = rows(raw.liveSources, MAX_LIVE_SOURCES).map((s) => ({
    key: text(s.key, '源标识', 128), name: text(s.name, '源名称', 128), url: url(s.url, '直播地址'),
    enabled: flag(s.enabled), ...(s.epg ? { epg: url(s.epg, '节目单地址') } : {}),
  }));
  const customImageProxy = text(site.customImageProxy ?? '', '封面代理模板', 2048, false);
  if (site.imageMode === 'custom') {
    if (!customImageProxy.includes('{url}')) throw new ConfigError('自定义封面代理模板必须包含 {url}');
    url(customImageProxy.replaceAll('{url}', 'https%3A%2F%2Fexample.com%2Fimage.jpg'), '封面代理模板');
  }
  const subscriptions = rows(raw.subscriptions, 100).map((s) => ({
    name: text(s.name, '订阅名称', 128), url: url(s.url, '订阅地址'), enabled: flag(s.enabled),
    ...(s.sources !== undefined ? { sources: rows(s.sources, MAX_VOD_SOURCES).map((v) => ({
      key: text(v.key, '源标识', 128), name: text(v.name, '源名称', 128), url: url(v.url, '源地址'),
      enabled: v.enabled === undefined ? true : flag(v.enabled), ...sourceType(v.type),
      ...(v.detail ? { detail: url(v.detail, '详情地址') } : {}),
      ...(v.isAdult !== undefined ? { isAdult: flag(v.isAdult) } : {}),
    })) } : {}),
    ...(s.liveSources !== undefined ? { liveSources: rows(s.liveSources, MAX_LIVE_SOURCES).map((v) => ({
      key: text(v.key, '源标识', 128), name: text(v.name, '源名称', 128), url: url(v.url, '直播地址'),
      enabled: v.enabled === undefined ? true : flag(v.enabled),
      ...(v.epg ? { epg: url(v.epg, '节目单地址') } : {}),
    })) } : {}),
    ...(s.syncedAt !== undefined ? { syncedAt: timestamp(s.syncedAt) } : {}),
  }));
  for (const list of [sources, liveSources]) {
    if (new Set(list.map((s) => s.key)).size !== list.length) throw new ConfigError('同类源标识不能重复');
    if (new Set(list.map((s) => s.url)).size !== list.length) throw new ConfigError('同类源地址不能重复');
  }
  if (new Set(subscriptions.map((s) => s.url)).size !== subscriptions.length) throw new ConfigError('订阅地址不能重复');
  return {
    version: 1, revision: Number(raw.revision),
    site: {
      name: text(site.name, '网站名称', 80), description: text(site.description, '网站简介', 500, false),
      announcement: text(site.announcement, '公告', 2000, false), authDisabled: true,
      recommendSource: site.recommendSource as SiteConfig['site']['recommendSource'],
      imageMode: site.imageMode as SiteConfig['site']['imageMode'], customImageProxy,
      yellowFilter: flag(site.yellowFilter === undefined ? DEFAULT_SITE.yellowFilter : site.yellowFilter),
      adFilter: flag(site.adFilter === undefined ? DEFAULT_SITE.adFilter : site.adFilter),
      doubanEnabled: flag(site.doubanEnabled === undefined ? DEFAULT_SITE.doubanEnabled : site.doubanEnabled),
      autoplayNext: flag(site.autoplayNext === undefined ? DEFAULT_SITE.autoplayNext : site.autoplayNext),
      cacheEnabled: flag(site.cacheEnabled === undefined ? DEFAULT_SITE.cacheEnabled : site.cacheEnabled),
    }, sources, liveSources, subscriptions,
  };
}

