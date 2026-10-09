import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchCctv, detailCctv } from './cctv-spider';
import { CCTV_SOURCE_URL, isCctvSource } from './cctv-source';
import { fetchUpstream } from './fetch-utils';
import { checkUpstreamAllowed } from './ssrf';

vi.mock('./fetch-utils', () => ({ fetchUpstream: vi.fn() }));
vi.mock('./ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));
const source = { key: 'cctv', name: '央视公开点播', url: CCTV_SOURCE_URL };
const page = 'https://tv.cctv.com/2026/10/08/VIDEpfUCDISjzUpXoBM7KblB261008.shtml';
const id = Buffer.from(page).toString('base64url');
const guid = 'acd2338e07d149c8a69dfdbc287fb653';
const hls = 'https://hls.cntv.lxdns.com/video/main.m3u8?maxbr=2048';

beforeEach(() => { vi.clearAllMocks(); vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: true }); });

describe('央视公开点播适配', () => {
  it('仅固定接口启用适配，搜索保留源身份、分页及分享所需的ID', async () => {
    expect(isCctvSource(CCTV_SOURCE_URL)).toBe(true);
    expect(isCctvSource(`${CCTV_SOURCE_URL}?other=1`)).toBe(false);
    vi.mocked(fetchUpstream).mockResolvedValue(new Response(JSON.stringify({ totalpage: 4, list: [
      { all_title: '《新闻联播》', urllink: page, imglink: 'https://img.cctvpic.com/cover.jpg', uploadtime: '2026-10-08' },
      { title: '不可信跳转', urllink: 'https://example.com/video.shtml' },
    ] })));
    const signal = new AbortController().signal;
    const result = await searchCctv(source, '新闻联播', 2, signal);
    expect(result).toMatchObject({ pagecount: 4, list: [{ vodId: id, name: '《新闻联播》', sourceKey: 'cctv', sourceUrl: CCTV_SOURCE_URL, year: '2026' }] });
    expect(result.list).toHaveLength(1);
    const [url, options] = vi.mocked(fetchUpstream).mock.calls[0];
    expect(new URL(url).searchParams.get('qtext')).toBe('新闻联播');
    expect(new URL(url).searchParams.get('page')).toBe('2');
    expect(options?.signal).toBe(signal);
  });

  it('详情从官方页提取guid，向播放器返回纯HLS地址', async () => {
    vi.mocked(fetchUpstream).mockResolvedValueOnce(new Response(`var guid = "${guid}";`))
      .mockResolvedValueOnce(new Response(JSON.stringify({ title: '新闻联播', image: 'https://img.cctvpic.com/a.jpg', hls_url: hls })));
    expect(await detailCctv(source, id)).toEqual({ episodes: [hls], videoInfo: {
      title: '新闻联播', cover: 'https://img.cctvpic.com/a.jpg', sourceKey: 'cctv', sourceName: source.name, sourceUrl: CCTV_SOURCE_URL,
    } });
    expect(fetchUpstream).toHaveBeenNthCalledWith(2, `https://vdn.apps.cntv.cn/api/getHttpVideoInfo.do?pid=${guid}`, expect.anything());
    expect(checkUpstreamAllowed).toHaveBeenCalledWith(hls);
  });

  it('拒绝伪造ID、凭证、查询参数、非官方主机和非视频页，不请求上游', async () => {
    for (const url of ['https://localhost/private', 'https://tv.cctv.com@evil.example/2026/10/08/VIDEabc.shtml',
      `${page}?url=http://127.0.0.1`, page.replace('https://', 'https://user:password@'),
      page.replace('https:', 'http:'), 'https://tv.cctv.com/anything.shtml']) {
      await expect(detailCctv(source, Buffer.from(url).toString('base64url'))).rejects.toThrow();
    }
    await expect(detailCctv(source, 'a'.repeat(513))).rejects.toThrow('视频ID');
    await expect(detailCctv(source, `${id}=`)).rejects.toThrow('视频ID');
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('没有播放标识或公开地址时明确失败', async () => {
    vi.mocked(fetchUpstream).mockResolvedValueOnce(new Response('<html>missing guid</html>'));
    await expect(detailCctv(source, id)).rejects.toThrow('未提供播放标识');
    vi.mocked(fetchUpstream).mockResolvedValueOnce(new Response(`guid="${guid}"`))
      .mockResolvedValueOnce(new Response('{}'));
    await expect(detailCctv(source, id)).rejects.toThrow('未提供公开 HLS');
  });

  it('拒绝受限内容和不安全播放地址', async () => {
    vi.mocked(fetchUpstream).mockResolvedValueOnce(new Response(`guid="${guid}"`))
      .mockResolvedValueOnce(new Response(JSON.stringify({ is_protected: 1, hls_url: hls })));
    await expect(detailCctv(source, id)).rejects.toThrow('公开播放权限');
    vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: false, reason: '内网地址' });
    vi.mocked(fetchUpstream).mockResolvedValueOnce(new Response(`guid="${guid}"`))
      .mockResolvedValueOnce(new Response(JSON.stringify({ hls_url: 'http://127.0.0.1/movie.m3u8' })));
    await expect(detailCctv(source, id)).rejects.toThrow('内网地址');
  });
});
