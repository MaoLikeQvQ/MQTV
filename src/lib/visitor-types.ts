export interface VisitorDayStats {
  date: string;
  newVisitors: number;
  activeVisitors: number;
  returningVisitors: number;
}

export interface VisitorStats {
  timezone: 'Asia/Shanghai';
  totalVisitors: number;
  today: VisitorDayStats;
  days: VisitorDayStats[];
}

export const VISITOR_KEY_STORAGE = 'libretv-visitor-ukey';
export const VISITOR_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** 前后端使用同一日界线；客户端日期只用于减少请求，计数以服务端时间为准。 */
export function visitorDay(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
