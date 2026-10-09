import { describe, expect, it, vi } from 'vitest';
import { getVisitorKey } from './visitor-client';
import { VISITOR_KEY_STORAGE } from './visitor-types';

const KEY = '12345678-1234-4123-8123-123456789abc';

function storage() {
  const entries = new Map<string, string>();
  return {
    entries,
    getItem: (name: string) => entries.get(name) ?? null,
    setItem: (name: string, value: string) => { entries.set(name, value); },
  };
}

describe('浏览器持久访客标识', () => {
  it('首次生成后复用；修改偏好不会更换标识，清除标识后才生成新标识', () => {
    const local = storage();
    const uuid = vi.fn(() => KEY);
    expect(getVisitorKey(local, uuid)).toBe(KEY);
    local.setItem('libretv-settings', '{}');
    expect(getVisitorKey(local, uuid)).toBe(KEY);
    expect(uuid).toHaveBeenCalledTimes(1);
    local.entries.delete(VISITOR_KEY_STORAGE);
    const other = '22345678-1234-4123-8123-123456789abc';
    expect(getVisitorKey(local, () => other)).toBe(other);
  });

  it('损坏标识被替换，已有大写 UUID 保持同一身份', () => {
    const local = storage();
    local.setItem(VISITOR_KEY_STORAGE, 'broken');
    expect(getVisitorKey(local, () => KEY)).toBe(KEY);
    local.setItem(VISITOR_KEY_STORAGE, KEY.toUpperCase());
    const uuid = vi.fn();
    expect(getVisitorKey(local, uuid)).toBe(KEY);
    expect(uuid).not.toHaveBeenCalled();
  });

  it('读取或写入持久存储失败时跳过，不返回临时标识', () => {
    const uuid = vi.fn(() => KEY);
    expect(getVisitorKey({ getItem: () => { throw new Error('blocked'); }, setItem: vi.fn() }, uuid)).toBeNull();
    expect(uuid).not.toHaveBeenCalled();
    expect(getVisitorKey({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, uuid)).toBeNull();
  });
});
