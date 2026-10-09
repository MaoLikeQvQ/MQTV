import { expect, it } from 'vitest';
import { mergePlaybackLines, playbackLinesKey } from './playback-lines';
import type { SearchResultItem } from './types';

function line(key: string, year?: string, name = '龙猫'): SearchResultItem {
  return { sourceKey: key, sourceName: key, vodId: key, name, year };
}

it('后续查到的线路只追加，同线路去重，不打乱首页带入的顺序', () => {
  expect(mergePlaybackLines([line('fast', '1988')], [line('slow', '1988'), line('fast', '1988')], '龙猫', '1988').map((item) => item.sourceKey))
    .toEqual(['fast', 'slow']);
});

it('不把外传和明确不同年份的翻拍作为同一影片的线路', () => {
  expect(mergePlaybackLines([], [line('original', '1988'), line('remake', '2025'), line('other', '1988', '龙猫外传'), line('unknown')], '龙猫', '1988').map((item) => item.sourceKey))
    .toEqual(['original', 'unknown']);
});

it('分享链接缺少年份时以最先出现的明确年份为准', () => {
  expect(mergePlaybackLines([line('unknown')], [line('first', '1988'), line('second', '2025')], '龙猫', '').map((item) => item.sourceKey))
    .toEqual(['unknown', 'first']);
});

it('不同影片年份及后台源选择使用独立缓存', () => {
  expect(playbackLinesKey('龙猫', '1988', ['a'], true)).not.toEqual(playbackLinesKey('龙猫', '2025', ['a'], true));
  expect(playbackLinesKey('龙猫', '1988', ['a'], true)).not.toEqual(playbackLinesKey('龙猫', '1988', ['b'], true));
});
