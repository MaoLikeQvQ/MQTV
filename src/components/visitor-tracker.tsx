'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { reportVisit } from '@/lib/visitor-client';

export function VisitorTracker() {
  const pathname = usePathname();
  useEffect(() => {
    const report = () => { if (document.visibilityState === 'visible') void reportVisit(); };
    report();
    document.addEventListener('visibilitychange', report);
    // 长时间停留在播放页也跨日检查；当日成功后只比较日期，不再请求。
    const interval = window.setInterval(report, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', report);
      window.clearInterval(interval);
    };
  }, [pathname]);
  return null;
}
