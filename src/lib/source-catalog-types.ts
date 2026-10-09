/** 目录内容只从服务器私有数据目录读取；客户端仅使用此类型。 */
export interface SourceCatalog {
  sourceUrl: string;
  fetchedAt: string;
  groups: Record<string, { name: string; url: string; description: string }[]>;
}
