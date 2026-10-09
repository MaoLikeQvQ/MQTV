import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkSourceAllowed, detailSpider, resolveSpiderEpisode, searchSpider } from './spider-bridge';
import { DRPY_SOURCE_URL, drpyModule } from './spider-source';
import { fetchUpstream } from './fetch-utils';
import { checkUpstreamAllowed } from './ssrf';
import type { SourceConfig } from './types';

const cache = vi.hoisted(() => new Map());
vi.mock('./fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: (key: string) => cache.get(key), setCache: (key: string, value: unknown) => cache.set(key, value) }));
vi.mock('./ssrf', () => ({ checkUpstreamAllowed: vi.fn(async () => ({ ok: true })) }));
const source: SourceConfig = { key: 'drpy', name: '央视 drpy', url: DRPY_SOURCE_URL, type: 'drpy' };
const original = 'https://tv.cctv.com/a.shtml?参数=中文';
const id = `spider_${Buffer.from(original).toString('base64url')}`;
const response = (body: unknown) => new Response(JSON.stringify(body));
const detail = () => response({ list: [{ vod_name: '新闻联播', vod_play_from: '公开$$$备用', vod_play_url: '正片$pid-token#下集$next-token$$$正片$backup' }] });
const hls = 'https://media.example.com/main.m3u8?sign=abc';

beforeEach(() => {
  vi.clearAllMocks(); cache.clear();
  vi.stubEnv('DRPY_ENABLED', '1'); vi.stubEnv('DRPY_API_KEY', 'server-secret');
  vi.stubEnv('DRPY_BASE_URL', 'http://127.0.0.1:5757'); vi.stubEnv('DRPY_MODULES', 'cctv-public');
  vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllEnvs());

describe('Node Spider HTTP bridge', () => {
  it('只允许部署者启用的本地模块；不放宽普通源的SSRF', async () => {
    expect(await checkSourceAllowed(source)).toEqual({ ok: true });
    expect(checkUpstreamAllowed).not.toHaveBeenCalled();
    for (const url of ['http://127.0.0.1:5757/api/cctv-public', `${DRPY_SOURCE_URL}?path=x`, 'https://drpy.libretv.invalid/api/not-enabled', 'https://drpy.libretv.invalid/api/../secret']) {
      expect((await checkSourceAllowed({ ...source, url })).ok).toBe(false);
    }
    vi.stubEnv('DRPY_ENABLED', '0'); expect((await checkSourceAllowed(source)).ok).toBe(false);
    vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: false, reason: '内网' });
    expect(await checkSourceAllowed({ url: 'http://127.0.0.1/x', type: 't4' })).toEqual({ ok: false, reason: '内网' });
    expect(drpyModule('https://drpy.libretv.invalid/api/cctv-public')).toBe('cctv-public');
  });

  it('搜索仅将服务密钥放在header，编码非数字ID并保持分享协议', async () => {
    vi.mocked(fetchUpstream).mockResolvedValue(response({ pagecount: 3, list: [{ vod_id: original, vod_name: '新闻联播' }] }));
    const result = await searchSpider(source, '新闻联播', 2);
    expect(result).toMatchObject({ pagecount: 3, list: [{ vodId: id, sourceType: 'drpy', sourceUrl: DRPY_SOURCE_URL }] });
    const [url, options] = vi.mocked(fetchUpstream).mock.calls[0];
    expect(url).toBe('http://127.0.0.1:5757/api/cctv-public?wd=%E6%96%B0%E9%97%BB%E8%81%94%E6%92%AD&pg=2');
    expect(options).toMatchObject({ safeRedirects: false, redirect: 'error', headers: { 'x-api-key': 'server-secret' } });
    expect(JSON.stringify(result)).not.toContain('server-secret');
    expect(JSON.stringify(result)).not.toContain('127.0.0.1');
  });

  it('T4保留原有查询参数且始终走公开上游保护', async () => {
    vi.mocked(fetchUpstream).mockResolvedValue(response({ list: [] }));
    await searchSpider({ ...source, type: 't4', url: 'https://t4.example.com/api?id=bMTV' }, '测试', 1);
    const [url, options] = vi.mocked(fetchUpstream).mock.calls[0];
    expect(new URL(url).searchParams.get('id')).toBe('bMTV');
    expect(options?.safeRedirects).toBeUndefined();
    expect(options?.headers).not.toHaveProperty('x-api-key');
    expect(checkUpstreamAllowed).toHaveBeenCalledWith('https://t4.example.com/api?id=bMTV');
  });

  it('详情保留不透明token，播放时仅解析选中集，不一次解析整季', async () => {
    vi.mocked(fetchUpstream).mockResolvedValueOnce(detail());
    const result = await detailSpider(source, id);
    expect(result.episodes).toHaveLength(2);
    expect(result.episodes[0]).toMatch(/^spider:/);
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
    expect(new URL(vi.mocked(fetchUpstream).mock.calls[0][0]).searchParams.get('ids')).toBe(original);
    vi.mocked(fetchUpstream).mockResolvedValueOnce(response({ parse: 0, url: hls }))
      .mockResolvedValueOnce(new Response('#EXTM3U\n#EXT-X-VERSION:3', { headers: { 'content-type': 'application/vnd.apple.mpegurl' } }));
    expect(await resolveSpiderEpisode(source, result.episodes[1])).toBe(hls);
    const playUrl = new URL(vi.mocked(fetchUpstream).mock.calls[1][0]);
    expect(playUrl.searchParams.get('play')).toBe('next-token');
    expect(playUrl.searchParams.get('flag')).toBe('公开');
    expect(checkUpstreamAllowed).toHaveBeenCalledWith(hls);
  });

  it('不接受客户端自造play token或越界集数', async () => {
    await expect(detailSpider(source, '123')).rejects.toThrow('视频标识');
    vi.mocked(fetchUpstream).mockResolvedValueOnce(detail());
    const bad = `spider:${Buffer.from(JSON.stringify({ id, index: 99, token: 'http://127.0.0.1/secret' })).toString('base64url')}`;
    await expect(resolveSpiderEpisode(source, bad)).rejects.toThrow('剧集不存在');
    expect(fetchUpstream).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ parse: 1, url: hls }, '网页解析'],
    [{ parse: 0, url: hls, header: { Referer: 'https://example.com' } }, '请求头'],
    [{ parse: 0 }, '未返回播放地址'],
  ])('未完成解析或需专用header时明确失败 %j', async (play, error) => {
    vi.mocked(fetchUpstream).mockResolvedValueOnce(detail()).mockResolvedValueOnce(response(play));
    const result = await detailSpider(source, id);
    await expect(resolveSpiderEpisode(source, result.episodes[0])).rejects.toThrow(error);
    expect(fetchUpstream).toHaveBeenCalledTimes(2);
  });

  it('拒绝伪装为parse=0的网页和内网媒体', async () => {
    vi.mocked(fetchUpstream).mockResolvedValueOnce(detail()).mockResolvedValueOnce(response({ parse: 0, url: hls }))
      .mockResolvedValueOnce(new Response('<html>player</html>', { headers: { 'content-type': 'text/html' } }));
    const result = await detailSpider(source, id);
    await expect(resolveSpiderEpisode(source, result.episodes[0])).rejects.toThrow('网页');
    vi.mocked(fetchUpstream).mockResolvedValueOnce(response({ parse: 0, url: 'http://127.0.0.1/movie.m3u8' }));
    vi.mocked(checkUpstreamAllowed).mockResolvedValue({ ok: false, reason: '内网禁止' });
    await expect(resolveSpiderEpisode(source, result.episodes[0])).rejects.toThrow('内网禁止');
  });

  it('本地服务错误不向客户端泄露主机或密钥', async () => {
    vi.mocked(fetchUpstream).mockRejectedValue(new Error('connect failed http://127.0.0.1:5757?key=server-secret'));
    await expect(searchSpider(source, '新闻', 1)).rejects.toThrow('请检查服务运行状态');
  });
});
