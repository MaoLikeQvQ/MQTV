import { VISITOR_KEY_PATTERN, VISITOR_KEY_STORAGE, visitorDay } from './visitor-types';

/** 独立于偏好设置与导入导出；存储失败不创建一次性标识，以免虚增新访客。 */
export function getVisitorKey(storage: Pick<Storage, 'getItem' | 'setItem'>, randomUUID: () => string): string | null {
  try {
    const saved = storage.getItem(VISITOR_KEY_STORAGE);
    if (saved && VISITOR_KEY_PATTERN.test(saved)) return saved.toLowerCase();
    const key = randomUUID();
    storage.setItem(VISITOR_KEY_STORAGE, key);
    return key;
  } catch { return null; }
}

let lastReported = '';
let inFlight: Promise<void> | undefined;

export function reportVisit(): Promise<void> {
  if (inFlight) return inFlight;
  const task = (async () => {
    const identify = () => getVisitorKey(window.localStorage, () => crypto.randomUUID());
    // Web Locks 避免支持该 API 的浏览器中，多个首开标签页各自生成不同标识。
    const key = navigator.locks ? await navigator.locks.request('libretv-visitor-identity', identify) : identify();
    if (!key || lastReported === `${key}:${visitorDay()}`) return;
    const response = await fetch('/api/visit', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ukey: key }), credentials: 'omit', cache: 'no-store',
    });
    if (!response.ok) throw new Error(`访问统计上报失败（${response.status}）`);
    const result = await response.json() as { day: string };
    lastReported = `${key}:${result.day}`;
  })().catch(() => {
    // 统计不可用不影响观看；仅输出原因类别，不输出访客标识。
    console.warn('[LibreTV] 访问统计上报未完成，将在下次页面访问时重试');
  });
  inFlight = task;
  void task.finally(() => { inFlight = undefined; });
  return task;
}
