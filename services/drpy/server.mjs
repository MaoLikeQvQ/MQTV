import http from 'node:http';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { mkdir, copyFile, readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.join(project, '.runtime/drpy');
const major = Number(process.versions.node.split('.')[0]);
if (major < 18 || major >= 24) throw new Error('drpy 引擎要求 Node 18–23，建议 Node 22；可设置 DRPY_NODE_BIN');
if (!process.env.DRPY_API_KEY) throw new Error('请配置 DRPY_API_KEY，主站和引擎使用相同密钥');
const key = Buffer.from(process.env.DRPY_API_KEY);
const modules = new Set((process.env.DRPY_MODULES || 'cctv-public').split(',').map((s) => s.trim()).filter(Boolean));
if ([...modules].some((s) => !/^[\w-]+$/.test(s))) throw new Error('DRPY_MODULES 模块名称无效');
const ruleFiles = await readdir(path.join(project, 'services/drpy/rules'));
if ([...modules].some((name) => !ruleFiles.includes(`${name}.js`))) throw new Error('DRPY_MODULES 中有未安装的本地规则');
await mkdir(path.join(root, 'spider/js'), { recursive: true });
await mkdir(path.join(root, 'json'), { recursive: true });
for (const name of ruleFiles) {
  if (name.endsWith('.js') && modules.has(name.slice(0, -3))) {
    await copyFile(path.join(project, 'services/drpy/rules', name), path.join(root, 'spider/js', name));
  }
}
process.env.ROOT = root;
process.env.NODE_ENV = 'production';
const nativeFetch = globalThis.fetch;
globalThis.fetch = (url, options = {}) => nativeFetch(url, {
  ...options,
  signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
});
// 上游 bundled core 提供 getEngine，不加载原项目的插件中心、WebSocket 或 Python daemon。
try { await import(pathToFileURL(path.join(root, 'libs/localDsCore.bundled.js')).href); }
catch (error) {
  if (error.code === 'ERR_MODULE_NOT_FOUND') throw new Error('drpy 引擎尚未安装，请执行 npm run drpy:install');
  throw error;
}
if (typeof globalThis.getEngine !== 'function') throw new Error('drpy 引擎初始化失败');

function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
const server = http.createServer(async (req, res) => {
  const supplied = Buffer.from(String(req.headers['x-api-key'] || ''));
  if (supplied.length !== key.length || !timingSafeEqual(supplied, key)) return json(res, 401, { error: '引擎鉴权失败' });
  if (req.method !== 'GET') return json(res, 405, { error: '仅支持 GET' });
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return json(res, 200, { ok: true, engine: 'drpyS', modules: [...modules] });
  const name = /^\/api\/([\w-]+)$/.exec(url.pathname)?.[1];
  if (!name || !modules.has(name)) return json(res, 404, { error: '模块未注册' });
  const query = Object.fromEntries(url.searchParams);
  if (req.url.length > 16384 || Object.keys(query).some((k) => !['wd', 'pg', 'ac', 'ids', 'play', 'flag'].includes(k))) {
    return json(res, 400, { error: '不支持的引擎参数' });
  }
  if (query.play) {
    if (query.play.length > 4096 || !query.flag || query.flag.length > 256) return json(res, 400, { error: '播放参数无效' });
  } else if (query.ids) {
    if (query.ac !== 'detail' || query.ids.length > 4096 || query.ids.includes(',')) return json(res, 400, { error: '详情参数无效' });
  } else if (!query.wd || query.wd.length > 100 || !/^[1-9]\d?$/.test(query.pg || '1')) {
    return json(res, 400, { error: '搜索参数无效' });
  }
  // localDsCore 的 detail 要求 ids 数组；固定 do=ds，外部不能选择其他引擎或执行动作。
  if (query.ids) query.ids = [query.ids];
  let timer;
  try {
    const result = await Promise.race([
      globalThis.getEngine(name, { ...query, do: 'ds' }, {}),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('引擎请求超时')), 10000); }),
    ]);
    if (!result || typeof result !== 'object') throw new Error('引擎未返回有效结果');
    json(res, 200, result);
  } catch (error) {
    // vm 中抛出的 Error 不属于宿主的 Error 构造器。
    const message = error?.message || String(error);
    console.error(`[drpy] ${name}: ${message}`);
    json(res, 502, { error: message });
  }
  finally { clearTimeout(timer); }
});
const port = Number(process.env.DRPY_PORT || 5757);
const host = process.env.DRPY_HOST || '127.0.0.1';
server.listen(port, host, () => console.info(`[LibreTV drpy] ${host}:${port}; modules=${[...modules].join(',')}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
});
