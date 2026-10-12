import { describe, expect, it } from 'vitest';
import { cmsListUrl } from './cms-parser';
import { probeSearchCapability } from './source-capability';

describe('点播列表与搜索能力', () => {
  it('覆盖旧操作和筛选参数，同时保留源的鉴权参数', () => {
    const url = new URL(cmsListUrl('https://cms.example/api/?ac=list&wd=旧词&pg=9&ids=1&t=2&token=abc', '相反的你和我', 2));
    expect([...url.searchParams.entries()]).toEqual([['ac', 'videolist'], ['wd', '相反的你和我'], ['pg', '2'], ['token', 'abc']]);
    expect(new URL(cmsListUrl(url.href)).searchParams.has('wd')).toBe(false);
  });
  it('任何关键词都返回列表的接口没有搜索能力', async () => {
    expect(await probeSearchCapability(async () => [{ name: '金牌调解' }], '金牌调解')).toEqual({ search: 'unsupported', count: 0 });
  });
  it('已知标题命中且不存在的词返回空，才确认搜索能力', async () => {
    expect(await probeSearchCapability(async (wd) => wd === '测试剧' ? [{ name: '测试剧' }] : [], '测试剧')).toEqual({ search: 'supported', count: 1 });
  });
  it('正反查询都空时保留未确认状态', async () => {
    expect(await probeSearchCapability(async () => [], '测试剧')).toEqual({ search: 'unknown', count: 0 });
  });
});
