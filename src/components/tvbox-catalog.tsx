'use client';

import { SectionTitle } from './settings-shared';

/** 私有目录仅由管理接口读取，不写入访客页面或浏览器静态包。 */
export function TvboxCatalog() {
  return (
    <section>
      <SectionTitle title="资源目录" />
      <p className="text-sm text-muted leading-relaxed">资源目录由管理员在后台维护。当前应用不附带数据源或订阅地址。</p>
    </section>
  );
}
