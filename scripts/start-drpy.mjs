import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const child = spawn(process.env.DRPY_NODE_BIN || process.execPath,
  [fileURLToPath(new URL('../services/drpy/server.mjs', import.meta.url))], { stdio: 'inherit', env: process.env });
child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
