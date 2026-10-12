import { describe, expect, it } from 'vitest';
import { liveChannelKey } from './live-channel-match';

describe('同频道备用线路匹配', () => {
  it('合并空格、分隔符和画质后缀', () => {
    expect(liveChannelKey('CCTV-2 高清')).toBe(liveChannelKey('cctv2HD'));
  });
  it('保留不同频道及加号，不做模糊匹配', () => {
    expect(liveChannelKey('CCTV2')).not.toBe(liveChannelKey('CCTV20'));
    expect(liveChannelKey('CCTV5+')).not.toBe(liveChannelKey('CCTV5'));
    expect(liveChannelKey('湖南卫视')).not.toBe(liveChannelKey('湖南电视剧'));
  });
});
