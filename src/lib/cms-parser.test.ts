import { describe, expect, it } from 'vitest';
import {
  extractEpisodesFromPlayUrl,
  extractM3u8FromText,
  filterAdultResults,
  filterRelevantResults,
  isAdultContent,
  isRelevant,
  normalizeTitle,
  sortSearchResults,
  parseDetail,
  parseDetailPageHtml,
  parseSearchList,
} from './cms-parser';

const source = { key: 'test', name: '测试源', url: 'https://api.example.com/provide/vod' };

describe('parseSearchList', () => {
  it('解析标准搜索响应并补齐源信息', () => {
    const data = {
      list: [
        { vod_id: 123, vod_name: '流浪地球', vod_pic: 'https://img/a.jpg', type_name: '科幻', vod_year: '2019', vod_remarks: 'HD' },
        { vod_id: 'abc-1', vod_name: '探<script>' },
      ],
    };
    const items = parseSearchList(data, source);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      sourceKey: 'test', sourceName: '测试源', vodId: '123', name: '流浪地球',
      typeName: '科幻', year: '2019', remarks: 'HD', sourceUrl: source.url,
    });
    expect(items[1].vodId).toBe('abc-1');
  });

  it('对缺失字段健壮', () => {
    const items = parseSearchList({ list: [{}] }, source);
    expect(items[0].vodId).toBe('');
    expect(items[0].name).toBe('');
  });

  it('拒绝无效响应；list 缺失或 null 视为空结果', () => {
    expect(() => parseSearchList(null, source)).toThrow();
    expect(() => parseSearchList({ list: 'nope' }, source)).toThrow();
    // 部分源站无结果时返回 list: null（或缺失），按空结果兼容
    expect(parseSearchList({ list: null }, source)).toEqual([]);
    expect(parseSearchList({}, source)).toEqual([]);
  });
});

describe('extractEpisodesFromPlayUrl', () => {
  it('解析 源$$$源 与 集$URL#集$URL 结构', () => {
    const play = '第01集$https://cdn/a1.m3u8#第02集$https://cdn/a2.m3u8$$$备用$https://x/b.m3u8';
    expect(extractEpisodesFromPlayUrl(play)).toEqual([
      'https://cdn/a1.m3u8',
      'https://cdn/a2.m3u8',
    ]);
  });

  it('过滤无 URL 或非 http 的集', () => {
    const play = '第01集$#第02集$ftp://x#第03集$https://cdn/a3.m3u8';
    expect(extractEpisodesFromPlayUrl(play)).toEqual(['https://cdn/a3.m3u8']);
  });

  it('第一条线路为中转页时优先取 m3u8 线路（量子/非凡类源）', () => {
    const play =
      'HD中字$https://vip.lzcdn2.com/share/abc$$$HD中字$https://vip.lzcdn2.com/20220329/1012_e9be6a92/index.m3u8';
    expect(extractEpisodesFromPlayUrl(play)).toEqual([
      'https://vip.lzcdn2.com/20220329/1012_e9be6a92/index.m3u8',
    ]);
  });

  it('第一条线路为空时取后续有效线路', () => {
    const play = '第1集$$$第1集$https://cdn/b.m3u8';
    expect(extractEpisodesFromPlayUrl(play)).toEqual(['https://cdn/b.m3u8']);
  });

  it('两条线路均无 m3u8 时回退第一条', () => {
    const play = '第1集$https://cdn/a.mp4$$$第1集$https://cdn2/a.mp4';
    expect(extractEpisodesFromPlayUrl(play)).toEqual(['https://cdn/a.mp4']);
  });

  it('空输入返回空数组', () => {
    expect(extractEpisodesFromPlayUrl('')).toEqual([]);
  });
});

describe('extractM3u8FromText', () => {
  it('从简介中提取 m3u8 链接', () => {
    const text = '正片$https://cdn.com/x/index.m3u8 更多';
    expect(extractM3u8FromText(text)).toEqual(['https://cdn.com/x/index.m3u8']);
  });
});

describe('parseDetail', () => {
  it('解析详情并提取分集', () => {
    const data = {
      list: [{
        vod_id: 1, vod_name: '三体', vod_content: '科幻剧',
        vod_play_url: '第1集$https://cdn/1.m3u8#第2集$https://cdn/2.m3u8',
      }],
    };
    const detail = parseDetail(data, source);
    expect(detail.episodes).toHaveLength(2);
    expect(detail.videoInfo.title).toBe('三体');
    expect(detail.videoInfo.sourceName).toBe('测试源');
  });

  it('play_url 为空时从简介兜底', () => {
    const data = { list: [{ vod_name: 'X', vod_content: '$https://cdn/fall.m3u8' }] };
    const detail = parseDetail(data, source);
    expect(detail.episodes).toEqual(['https://cdn/fall.m3u8']);
  });

  it('空列表抛错', () => {
    expect(() => parseDetail({ list: [] }, source)).toThrow();
  });
});

describe('parseDetailPageHtml', () => {
  it('从 HTML 中提取去重后的 m3u8', () => {
    const html = `<h1>庆余年</h1>
      <div class="sketch">简介<b>内容</b></div>
      <script>player_aa={"url":"$https://cdn/ep1.m3u8"}</script>
      <script>player_bb={"url":"$https://cdn/ep2.m3u8"}</script>
      <script>player_cc={"url":"$https://cdn/ep1.m3u8"}</script>`;
    const detail = parseDetailPageHtml(html, source);
    expect(detail.episodes).toEqual(['https://cdn/ep1.m3u8', 'https://cdn/ep2.m3u8']);
    expect(detail.videoInfo.title).toBe('庆余年');
    expect(detail.videoInfo.desc).toBe('简介 内容');
  });

  it('非凡影视特征路径兜底', () => {
    const html = '$https://vip.ffzy.com/20231101/12345_abcdef/index.m3u8';
    const detail = parseDetailPageHtml(html, source);
    expect(detail.episodes).toContain('https://vip.ffzy.com/20231101/12345_abcdef/index.m3u8');
  });
});

describe('成人内容过滤', () => {
  it('识别敏感分类', () => {
    expect(isAdultContent('伦理片')).toBe(true);
    expect(isAdultContent('福利片')).toBe(true);
    expect(isAdultContent('科幻片')).toBe(false);
    expect(isAdultContent(undefined)).toBe(false);
  });

  it('filterAdultResults 按开关过滤', () => {
    const items = [{ typeName: '伦理片' }, { typeName: '剧情片' }];
    expect(filterAdultResults(items, true)).toEqual([{ typeName: '剧情片' }]);
    expect(filterAdultResults(items, false)).toHaveLength(2);
  });
});

describe('normalizeTitle', () => {
  it('去标点、空白并转小写', () => {
    expect(normalizeTitle('摔跤吧！爸爸')).toBe('摔跤吧爸爸');
    expect(normalizeTitle('摔跤吧!爸爸 【影视解说】')).toBe('摔跤吧爸爸影视解说');
    expect(normalizeTitle('Hello, World!')).toBe('helloworld');
  });
});

describe('isRelevant', () => {
  it('命中完整关键词（忽略标点差异）', () => {
    expect(isRelevant('摔跤吧！爸爸', '摔跤吧！爸爸')).toBe(true);
    expect(isRelevant('摔跤吧!爸爸【影视解说】', '摔跤吧！爸爸')).toBe(true);
    expect(isRelevant('摔跤吧 爸爸', '摔跤吧！爸爸')).toBe(true);
  });

  it('标题不含关键词时不相关（模糊分词场景）', () => {
    expect(isRelevant('爸爸去哪儿第三季', '摔跤吧！爸爸')).toBe(false);
    expect(isRelevant('爸爸当家 第五季', '摔跤吧！爸爸')).toBe(false);
  });

  it('子串命中视为相关', () => {
    expect(isRelevant('爸爸去哪儿第三季', '爸爸去哪儿')).toBe(true);
  });

  it('多词查询放宽为每个词都命中', () => {
    expect(isRelevant('钢铁侠', '钢铁侠 2008')).toBe(false);
    expect(isRelevant('钢铁侠 Iron Man 2008', '钢铁侠 2008')).toBe(true);
  });

  it('空关键词或空标题不参与过滤', () => {
    expect(isRelevant('任意标题', '')).toBe(true);
    expect(isRelevant('', '任意')).toBe(false);
  });
});

describe('filterRelevantResults', () => {
  const wd = '摔跤吧！爸爸';
  const items = [
    { name: '摔跤吧！爸爸' },
    { name: '爸爸去哪儿第三季' },
    { name: '摔跤吧!爸爸【影视解说】' },
  ];

  it('丢弃与关键词无关的结果', () => {
    const out = filterRelevantResults(items, wd);
    expect(out).toHaveLength(2);
    expect(out.map((i) => i.name)).toEqual(['摔跤吧！爸爸', '摔跤吧!爸爸【影视解说】']);
  });

  it('全部不相关时返回空列表', () => {
    const junk = [{ name: '爸爸当家' }, { name: '爸爸别走' }];
    expect(filterRelevantResults(junk, wd)).toEqual([]);
  });
});

describe('搜索结果相关度排序', () => {
  it('晚到的龙猫正片排在无关结果和解说前，并保留同名不同年份的顺序', () => {
    const items = [
      { name: '小赛罗拓荒者' }, { name: '有点神的日常' },
      { name: '龙猫[电影解说]' }, { name: '龙猫', year: '1988' },
      { name: '龙猫', year: '2018' },
    ];
    const original = [...items];
    expect(sortSearchResults(items, '龙猫')).toEqual([
      items[3], items[4], items[2], items[0], items[1],
    ]);
    expect(items).toEqual(original);
    expect(sortSearchResults(items.slice(0, 2), '龙猫')).toEqual(items.slice(0, 2));
  });

  it('忽略大小写和标点差异，完整匹配优先于多词匹配，空标题最后', () => {
    const items = [
      { name: '' }, { name: '其他' }, { name: 'Man of Iron' },
      { name: 'Iron Man 2' }, { name: 'IRON—MAN' },
    ];
    expect(sortSearchResults(items, 'Iron Man')).toEqual([
      items[4], items[3], items[2], items[1], items[0],
    ]);
    expect(sortSearchResults(items, '   ')).toEqual(items);
    expect(sortSearchResults(items, '！')).toEqual(items);
  });
});
