import { appendFile, mkdir, readFile, truncate } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { visitorDay, type VisitorDayStats, type VisitorStats } from './visitor-types';

interface VisitEvent { hash: string; day: string }
interface VisitIndex {
  visitors: Map<string, string>;
  days: Map<string, { newVisitors: number; activeVisitors: number }>;
}

function eventPath(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'visitor-events.jsonl');
}

function apply(index: VisitIndex, event: VisitEvent): void {
  const lastDay = index.visitors.get(event.hash);
  if (lastDay === event.day) return;
  const day = index.days.get(event.day) || { newVisitors: 0, activeVisitors: 0 };
  if (!lastDay) day.newVisitors++;
  day.activeVisitors++;
  index.days.set(event.day, day);
  index.visitors.set(event.hash, event.day);
}

/** 只读取完整事件行；写入端初始化时移除崩溃留下的不完整尾行。 */
async function readIndex(file: string, repairTail = false): Promise<VisitIndex> {
  const index: VisitIndex = { visitors: new Map(), days: new Map() };
  let text: string;
  try { text = await readFile(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return index;
    throw error;
  }
  const end = text.lastIndexOf('\n') + 1;
  if (repairTail && end < text.length) await truncate(file, Buffer.byteLength(text.slice(0, end)));
  for (const line of text.slice(0, end).split('\n')) {
    if (!line) continue;
    const event = JSON.parse(line) as VisitEvent;
    if (!/^[0-9a-f]{64}$/.test(event.hash) || !/^\d{4}-\d{2}-\d{2}$/.test(event.day)) {
      throw new Error('访问统计文件包含无效记录');
    }
    apply(index, event);
  }
  return index;
}

let queue: Promise<unknown> = Promise.resolve();
let cached: { file: string; index: VisitIndex } | undefined;

/** 单实例内串行判重；同一 ukey 当天仅写一条，成功落盘后才更新内存。 */
export function recordVisit(ukey: string, now = new Date()): Promise<void> {
  const file = eventPath();
  const event: VisitEvent = {
    hash: createHash('sha256').update(ukey.toLowerCase()).digest('hex'), day: visitorDay(now),
  };
  const task = queue.then(async () => {
    if (cached?.file !== file) cached = { file, index: await readIndex(file, true) };
    if (cached.index.visitors.get(event.hash) === event.day) return;
    await mkdir(path.dirname(file), { recursive: true });
    try {
      await appendFile(file, `${JSON.stringify(event)}\n`, { encoding: 'utf8', mode: 0o600 });
    } catch (error) {
      // 下一次请求重新检查尾行，避免失败的部分写入与重试事件拼成坏 JSON。
      cached = undefined;
      throw error;
    }
    apply(cached.index, event);
  });
  queue = task.catch(() => {});
  return task;
}

/** 统计从持久文件重建，管理路由不会依赖另一路由进程中的内存缓存。 */
export async function readVisitorStats(now = new Date()): Promise<VisitorStats> {
  const index = await readIndex(eventPath());
  const today = visitorDay(now);
  const daily = (date: string): VisitorDayStats => {
    const counts = index.days.get(date) || { newVisitors: 0, activeVisitors: 0 };
    return { date, ...counts, returningVisitors: counts.activeVisitors - counts.newVisitors };
  };
  const days: VisitorDayStats[] = [];
  for (let offset = 29; offset >= 0; offset--) {
    const date = new Date(`${today}T12:00:00+08:00`);
    date.setUTCDate(date.getUTCDate() - offset);
    days.push(daily(visitorDay(date)));
  }
  return { timezone: 'Asia/Shanghai', totalVisitors: index.visitors.size, today: daily(today), days };
}
