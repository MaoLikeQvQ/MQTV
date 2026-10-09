/** 固定公开接口作为内置 Spider 的身份；沿用 URL 合同，导出与分享无需额外字段。 */
export const CCTV_SOURCE_URL = 'https://search.cctv.com/ifsearch.php';

export function isCctvSource(url: string): boolean {
  return url === CCTV_SOURCE_URL;
}
