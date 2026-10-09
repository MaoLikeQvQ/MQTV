import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const revision = '295f2b7047e14122d542a7736cb931e81abcf85c';
const artifacts = [
  ['drpy-node-bundle/libs/localDsCore.bundled.js', 'libs/localDsCore.bundled.js', '52131f413d263f151a184abf5b2b618ac598e8206736888b58cc736de6f5e7e2', 14198789],
  ['drpy-node-bundle/libs/node-sqlite3-wasm.wasm', 'libs/node-sqlite3-wasm.wasm', '4603de9d79f4fa3ed837f0d3658ddd2f20f27159e47ef120cb36c3dc4d1ca18d', 1251966],
];
const target = path.join(root, '.runtime/drpy');
const download = promisify(execFile);
await mkdir(path.join(target, 'libs'), { recursive: true });
for (const [upstream, local, expected, size] of artifacts) {
  const file = path.join(target, local);
  try {
    if (createHash('sha256').update(await readFile(file)).digest('hex') === expected) {
      console.info(`[drpy] verified ${local}`);
      continue;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = `${file}.tmp`;
  const partSize = 512 * 1024;
  const parts = Array.from({ length: Math.ceil(size / partSize) }, (_, i) => `${temporary}.${i}`);
  const buffers = new Array(parts.length);
  console.info(`[drpy] downloading ${local}`);
  try {
    // 原站完整大文件连接在本机多次超时，分段缩短连接时间；最终仍验证完整摘要。
    for (let index = 0; index < parts.length; index += 4) {
      const batch = await Promise.allSettled(parts.slice(index, index + 4).map(async (part, offset) => {
        const i = index + offset;
        const start = i * partSize;
        const end = Math.min(size - 1, start + partSize - 1);
        await download('curl', ['--fail', '--location', '--http1.1', '--proto', '=https', '--proto-redir', '=https',
          '--retry', '2', '--retry-all-errors', '--retry-delay', '1', '--silent', '--show-error',
          '--connect-timeout', '15', '--max-time', '60', '--range', `${start}-${end}`, '--output', part,
          `https://raw.githubusercontent.com/Hululu007/drpy-node/${revision}/${upstream}`]);
        const content = await readFile(part);
        if (content.length !== end - start + 1) throw new Error(`drpy download range mismatch: ${local}`);
        buffers[i] = content;
      }));
      const failed = batch.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
      console.info(`[drpy] ${local}: ${Math.min(index + 4, parts.length)}/${parts.length} parts`);
    }
    const content = Buffer.concat(buffers);
    if (createHash('sha256').update(content).digest('hex') !== expected) throw new Error(`drpy checksum mismatch: ${local}`);
    await writeFile(temporary, content);
    await rename(temporary, file);
  }
  finally { await Promise.all([temporary, ...parts].map((part) => rm(part, { force: true }))); }
  console.info(`[drpy] installed ${local}`);
}
await writeFile(path.join(target, 'package.json'), '{"type":"module"}\n');
console.info(`[drpy] pinned upstream ${revision}; run npm run drpy:start`);
