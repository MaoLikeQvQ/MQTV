import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const env = { ...process.env, DRPY_ENABLED: '1', DRPY_HOST: '127.0.0.1',
  DRPY_API_KEY: process.env.DRPY_API_KEY || randomBytes(32).toString('hex'),
  DRPY_BASE_URL: `http://127.0.0.1:${process.env.DRPY_PORT || '5757'}` };
const engine = spawn(process.env.DRPY_NODE_BIN || process.execPath,
  [fileURLToPath(new URL('../services/drpy/server.mjs', import.meta.url))], { env, stdio: 'inherit' });
let web;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  engine.kill('SIGTERM');
  web?.kill('SIGTERM');
}
engine.on('error', (error) => { console.error(error.message); stop(1); });
engine.on('exit', (code) => { if (!stopping) stop(code || 1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
try {
  let ready = false;
  for (let i = 0; i < 40 && !stopping; i++) {
    try {
      const response = await fetch(`${env.DRPY_BASE_URL}/health`, {
        headers: { 'x-api-key': env.DRPY_API_KEY }, signal: AbortSignal.timeout(1000),
      });
      const health = response.ok ? await response.json() : null;
      if (health?.engine === 'drpyS') { ready = true; break; }
    } catch { /* 引擎初始化期间连接尚未建立。 */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('drpy 引擎未就绪，主站未启动');
  web = spawn(process.execPath, [fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)),
    process.argv[2] === 'dev' ? 'dev' : 'start', '-p', process.env.PORT || '8080'], { env, stdio: 'inherit' });
  web.on('error', (error) => { console.error(error.message); stop(1); });
  web.on('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)));
} catch (error) { console.error(error.message); stop(1); }
