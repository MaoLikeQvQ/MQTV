import { expect, it } from 'vitest';
import { aggregateResults } from './video-card';
import type { SearchResultItem } from '@/lib/types';

it('流式加入同名影片的新来源时保持卡片标识，同时保留不同年份的翻拍', () => {
  const first: SearchResultItem = { name: '测试影片', year: '2025', sourceKey: 'first', sourceName: '第一来源', sourceUrl: 'https://example.com/one', vodId: '1', pic: '', remarks: '' };
  const before = aggregateResults([first]);
  const after = aggregateResults([first, { ...first, sourceKey: 'second', vodId: '2' }]);
  expect(after[0].key).toBe(before[0].key);
  expect(after[0].items).toHaveLength(2);
  const remakes = aggregateResults([first, { ...first, year: '2026', vodId: '3' }]);
  expect(remakes).toHaveLength(2);
  expect(remakes[0].key).not.toBe(remakes[1].key);
});

function item(name: string, id: string, year?: string): SearchResultItem {
  return { name, year, sourceKey: id, sourceName: id, sourceUrl: 'https://example.com/api', vodId: id, pic: '', remarks: '' };
}

it('后到的同名翻拍只追加在末尾，不插到已显示的其他影片前面', () => {
  const first = [item('龙猫', 'a', '1988'), item('龙猫外传', 'b', '2020')];
  const before = aggregateResults(first);
  const after = aggregateResults([...first, item('龙猫', 'c', '2025'), item('龙猫', 'd', '1988')]);
  expect(after.slice(0, 2).map((g) => g.key)).toEqual(before.map((g) => g.key));
  expect(after.map((g) => [g.name, g.year])).toEqual([['龙猫', '1988'], ['龙猫外传', '2020'], ['龙猫', '2025']]);
  expect(after[0].items.map((i) => i.sourceKey)).toEqual(['a', 'd']);
});

it('晚到的年份补全与重复条目不会创建重复卡片或改变已有标识', () => {
  const first = item('龙猫', 'a');
  const before = aggregateResults([first]);
  const after = aggregateResults([first, item('龙猫外传', 'b'), item('龙猫', 'c', '1988'), first]);
  expect(after).toHaveLength(2);
  expect(after[0].key).toBe(before[0].key);
  expect(after[0].year).toBe('1988');
  expect(after[0].items.map((i) => i.sourceKey)).toEqual(['a', 'c']);
});
