import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import { GET as detail } from '../detail/route';
import { POST as search } from '../search/route';
import { fetchUpstream } from '@/lib/fetch-utils';
import type { SearchResponse, VideoDetail } from '@/lib/types';

vi.mock('@/lib/api-guard', () => ({ guardRequest: vi.fn(async () => null) }));
vi.mock('@/lib/fetch-utils', () => ({ fetchUpstream: vi.fn(), getCache: vi.fn(), setCache: vi.fn() }));
vi.mock('@/lib/ssrf', () => ({ checkUpstreamAllowed: vi.fn(async (url: string) => ({ ok: !url.includes('127.0.0.1'), reason: '内网禁止' })) }));
const source = { key: 'test-t4', name: 'T4', url: 'https://t4.example.com/api?channel=1', type: 't4' };
const post = (body: unknown) => POST(new Request('http://localhost/api/play', { method: 'POST', body: JSON.stringify(body) }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe('Spider 搜索→详情→懒播放接口', () => {
  it('完整T4链保留query、协议与线路token，前端只接收验证后的HLS', async () => {
    vi.mocked(fetchUpstream).mockResolvedValueOnce(new Response(JSON.stringify({ pagecount: 1, list: [{ vod_id: 'path/item?key=value', vod_name: '测试片' }] })));
    const searched = await (await search(new Request('http://localhost/api/search', { method: 'POST', body: JSON.stringify({ wd: '测试片', sources: [source] }) }))).json() as SearchResponse;
    expect(searched.list[0]).toMatchObject({ sourceType: 't4', sourceUrl: source.url });
    const query = new URLSearchParams({ id: searched.list[0].vodId, source: JSON.stringify(source) });
    vi.mocked(fetchUpstream).mockResolvedValue(new Response(JSON.stringify({ list: [{ vod_name: '测试片', vod_play_from: '原画', vod_play_url: '正片$opaque-token' }] })));
    const video = await (await detail(new Request(`http://localhost/api/detail?${query}`))).json() as VideoDetail;
    expect(video.episodes).toHaveLength(1);
    expect(video.videoInfo).toMatchObject({ sourceType: 't4' });
    vi.mocked(fetchUpstream).mockResolvedValueOnce(new Response(JSON.stringify({ list: [{ vod_name: '测试片', vod_play_from: '原画', vod_play_url: '正片$opaque-token' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ parse: 0, url: 'https://media.example.com/main.m3u8' })))
      .mockResolvedValueOnce(new Response('#EXTM3U\n#EXT-X-ENDLIST'));
    const played = await post({ source, episode: video.episodes[0] });
    expect(played.status).toBe(200);
    expect(await played.json()).toEqual({ url: 'https://media.example.com/main.m3u8' });
    const playerCall = vi.mocked(fetchUpstream).mock.calls.find(([url]) => new URL(url).searchParams.has('play'))!;
    expect(new URL(playerCall[0]).searchParams.get('channel')).toBe('1');
    expect(new URL(playerCall[0]).searchParams.get('play')).toBe('opaque-token');
    expect(new URL(playerCall[0]).searchParams.get('flag')).toBe('原画');
  });

  it('非Spider请求及内网接口在调用上游前拒绝', async () => {
    expect((await post({ source: { ...source, type: undefined }, episode: 'spider:x' })).status).toBe(400);
    expect((await post({ source: { ...source, url: 'http://127.0.0.1/a' }, episode: 'spider:x' })).status).toBe(400);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });

  it('部署未启用的托管源拒绝，客户端不能把私有URL伪装成drpy', async () => {
    vi.stubEnv('DRPY_ENABLED', '0');
    expect((await post({ source: { ...source, type: 'drpy', url: 'https://drpy.libretv.invalid/api/cctv-public' }, episode: 'spider:x' })).status).toBe(400);
    vi.stubEnv('DRPY_ENABLED', '1');
    expect((await post({ source: { ...source, type: 'drpy', url: 'http://127.0.0.1:5757/api/cctv-public' }, episode: 'spider:x' })).status).toBe(400);
    expect(fetchUpstream).not.toHaveBeenCalled();
  });
});
