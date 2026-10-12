/** 只合并频道名相同、画质标记不同的线路，保留 CCTV5+ 等频道身份。 */
export function liveChannelKey(name: string): string {
  return name.normalize('NFKC').toUpperCase().replace(/[\s_-]/g, '')
    .replace(/(?:超高清|高清|标清|蓝光|HD|SD|4K|8K)+$/g, '');
}
