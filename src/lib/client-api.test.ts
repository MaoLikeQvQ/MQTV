import { afterEach, expect, it, vi } from 'vitest';
import { api, firstAvailableDetail } from './client-api';
import type { SearchResultItem, VideoDetail } from './types';

const candidates = ['slow', 'empty', 'fast'].map((key) => ({
  item: { sourceKey: key, sourceName: key, vodId: key, name: '龙猫' } as SearchResultItem,
  source: { key, name: key, url: `https://${key}.example.com/api` },
}));

afterEach(() => vi.restoreAllMocks());

it('并发获取详情，跳过空剧集，选择最先成功的来源并取消慢请求', async () => {
  const signals: AbortSignal[] = [];
  vi.spyOn(api, 'detail').mockImplementation(async (id, _source, signal) => {
    signals.push(signal!);
    if (id === 'slow') {
      return new Promise<VideoDetail>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(new DOMException('取消', 'AbortError')), { once: true });
      });
    }
    return { episodes: id === 'empty' ? [] : ['https://video.example.com/play.m3u8'], videoInfo: { sourceKey: id, sourceName: id } };
  });
  const result = await firstAvailableDetail(candidates, new AbortController().signal);
  expect(api.detail).toHaveBeenCalledTimes(3);
  expect(result.item.sourceKey).toBe('fast');
  expect(result.detail.episodes).toHaveLength(1);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

it('关闭详情时取消全部请求，返回取消状态而非自动选择结果', async () => {
  const signals: AbortSignal[] = [];
  vi.spyOn(api, 'detail').mockImplementation(async (_id, _source, signal) => {
    signals.push(signal!);
    return new Promise<VideoDetail>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(new DOMException('取消', 'AbortError')), { once: true });
    });
  });
  const controller = new AbortController();
  const pending = firstAvailableDetail(candidates, controller.signal);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(signals.every((signal) => signal.aborted)).toBe(true);
});

it('全部来源失败或剧集为空时显示可理解的错误', async () => {
  vi.spyOn(api, 'detail').mockRejectedValue(new Error('HTTP 502'));
  await expect(firstAvailableDetail(candidates, new AbortController().signal)).rejects.toThrow('暂时无法获取可用剧集');
});
