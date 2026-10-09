'use client';

import type { VisitorStats as Stats } from '@/lib/visitor-types';

export function VisitorStats({ stats, busy, refresh }: { stats: Stats | null; busy: boolean; refresh: () => void }) {
  const maximum = Math.max(1, ...(stats?.days.map((day) => day.newVisitors) || []));
  return (
    <section className="space-y-5">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">访问统计</h2><button className="btn-ghost min-h-11" disabled={busy} onClick={refresh}>{busy ? '正在加载…' : '刷新统计'}</button></div>
      <p className="text-sm text-muted leading-relaxed">按浏览器标识去重，统计日界线为北京时间。清除站点数据、无痕访问或更换浏览器会产生新标识，新增访客不等同于新增注册用户。</p>
      {!stats ? <p role="status" className="text-muted py-8">{busy ? '正在读取访问统计…' : '统计尚未加载，请点击刷新。'}</p> : <>
        <dl className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          {[
            ['累计访客', stats.totalVisitors], ['今日新增', stats.today.newVisitors],
            ['今日活跃', stats.today.activeVisitors], ['今日回访', stats.today.returningVisitors],
          ].map(([label, value]) => <div key={label} className="card p-4"><dt className="text-xs text-muted">{label}</dt><dd className="text-3xl font-semibold mt-3 tabular-nums">{Number(value).toLocaleString('zh-CN')}</dd></div>)}
        </dl>
        <div className="card p-5">
          <h3 className="text-sm font-semibold mb-5">近 30 天新增访客</h3>
          <div className="flex items-end gap-1 h-28" role="img" aria-label={`近 30 天新增访客 ${stats.days.reduce((sum, day) => sum + day.newVisitors, 0)} 个，逐日明细见下表`}>
            {stats.days.map((day) => <div key={day.date} className="flex-1 h-full flex items-end" title={`${day.date}：新增 ${day.newVisitors}`}><div className={`w-full rounded-t-sm ${day.newVisitors ? 'bg-accent' : 'bg-line'}`} style={{ height: day.newVisitors ? `${Math.max(4, day.newVisitors / maximum * 100)}%` : '2px' }} /></div>)}
          </div>
          <div className="flex justify-between text-xs text-muted mt-3"><span>{stats.days[0]?.date}</span><span>{stats.today.date}</span></div>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm text-left whitespace-nowrap">
            <caption className="text-left p-4 text-muted">每日明细 · 同一浏览器一天计一次活跃；首次出现当天计入新增</caption>
            <thead className="border-y border-line bg-surface"><tr>{['日期', '新增访客', '活跃访客', '回访访客'].map((label) => <th key={label} scope="col" className="px-4 py-3 font-medium">{label}</th>)}</tr></thead>
            <tbody>{[...stats.days].reverse().map((day) => <tr key={day.date} className="border-b border-line last:border-0"><th scope="row" className="px-4 py-3 font-normal">{day.date}</th><td className="px-4 py-3 tabular-nums">{day.newVisitors}</td><td className="px-4 py-3 tabular-nums">{day.activeVisitors}</td><td className="px-4 py-3 tabular-nums">{day.returningVisitors}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="text-xs text-muted">只统计前台页面，后台访问不计入。累计访客从启用本模块并开始保存数据后计算。</p>
      </>}
    </section>
  );
}
