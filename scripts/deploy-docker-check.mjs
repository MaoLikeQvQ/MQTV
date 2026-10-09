import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const dockerMock = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
if (args[0] === 'info') process.exit(process.env.FAIL_DAEMON ? 1 : 0);
if (args.includes('version')) process.exit(0);
if (args.includes('--help')) { console.log('--wait-timeout'); process.exit(0); }
if (args.includes('config')) {
  if (process.env.FAIL_CONFIG) process.exit(1);
  if (args.includes('--environment')) {
    const content = fs.readFileSync(args[args.indexOf('--env-file')+1], 'utf8');
    for (const line of content.split('\\n')) if (/^(ADMIN_KEY|DRPY_API_KEY|DRPY_ENABLED|HOST_PORT)=/.test(line)) console.log(line);
  }
  process.exit(0);
}
if (args.includes('up')) process.exit(process.env.FAIL_UP ? 1 : 0);
if (args.includes('ps')) process.exit(0);
if (args.includes('port')) {
  const content = fs.readFileSync(args[args.indexOf('--env-file')+1], 'utf8');
  const port = process.env.HOST_PORT || /^HOST_PORT=(.*)$/m.exec(content)?.[1] || '18080';
  console.log('0.0.0.0:' + port); process.exit(0);
}
process.exit(1);
`;

function fixture(t, { existing, ...flags } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'mqtv-one-click-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  copyFileSync(new URL('./deploy-docker.sh', import.meta.url), join(root, 'scripts/deploy-docker.sh'));
  copyFileSync(new URL('../.env.example', import.meta.url), join(root, '.env.example'));
  writeFileSync(join(root, 'docker-compose.yml'), 'services: {}\n');
  writeFileSync(join(root, 'docker-compose.build.yml'), 'services: {}\n');
  writeFileSync(join(root, 'bin/docker'), dockerMock, { mode: 0o755 });
  if (existing !== undefined) writeFileSync(join(root, '.env'), existing);
  const log = join(root, 'calls.log');
  const run = (...args) => {
    const env = { ...process.env, ...flags, PATH: `${join(root, 'bin')}:${process.env.PATH}`, MOCK_LOG: log };
    delete env.HOST_PORT;
    const result = spawnSync('bash', [join(root, 'scripts/deploy-docker.sh'), ...args], { env, encoding: 'utf8' });
    const calls = readdirSync(root).includes('calls.log')
      ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    return { ...result, calls };
  };
  return { root, run, content: () => readFileSync(join(root, '.env'), 'utf8') };
}

test('first deployment creates distinct private keys, maps 18080 and waits for drpy', t => {
  const { root, run, content } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const settings = content();
  const keys = ['ADMIN_KEY', 'DRPY_API_KEY', 'PROXY_SECRET'].map(name => new RegExp(`^${name}=([a-f0-9]{64})$`, 'm').exec(settings)?.[1]);
  assert.ok(keys.every(Boolean));
  assert.equal(new Set(keys).size, 3);
  for (const key of keys) assert.ok(!`${result.stdout}${result.stderr}`.includes(key));
  assert.equal(statSync(join(root, '.env')).mode & 0o777, 0o600);
  assert.match(settings, /^HOST_PORT=18080$/m);
  assert.match(settings, /^DRPY_ENABLED=1$/m);
  assert.match(settings, /^COMPOSE_PROFILES=drpy$/m);
  const up = result.calls.find(args => args.includes('up') && !args.includes('--help'));
  for (const arg of ['--build', '--wait', '--wait-timeout', '--profile', 'drpy']) assert.ok(up.includes(arg));
  assert.ok(up.some(arg => arg.endsWith('docker-compose.build.yml')));
  assert.match(result.stdout, /服务器IP:18080\/admin/);
  assert.ok(!result.calls.some(args => args.includes('down')));
  assert.ok(!readdirSync(root).some(name => name.startsWith('.env.tmp.')));
});

test('changing only host port preserves keys, volume selection and inert env text', t => {
  const existing = 'ADMIN_KEY=keep-admin\nDRPY_API_KEY=keep-drpy\nDRPY_ENABLED=1\nHOST_PORT=18080\nMQTV_DATA_VOLUME=existing-volume\nINERT=$(touch must-not-exist)\n';
  const { root, run, content } = fixture(t, { existing });
  const result = run('19080');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(content(), existing.replace('HOST_PORT=18080', 'HOST_PORT=19080'));
  assert.ok(!readdirSync(root).includes('must-not-exist'));
  assert.ok(!result.stdout.includes('keep-admin') && !result.stdout.includes('keep-drpy'));
  assert.match(result.stdout, /服务器IP:19080/);
  const second = run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(content(), existing.replace('HOST_PORT=18080', 'HOST_PORT=19080'));
});

test('disabled engine does not force a profile or require an engine key', t => {
  const existing = 'ADMIN_KEY=keep-admin\nDRPY_API_KEY=\nDRPY_ENABLED=0\nHOST_PORT=18080\n';
  const { run, content } = fixture(t, { existing });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(content(), existing);
  assert.ok(!result.calls.find(args => args.includes('up') && !args.includes('--help')).includes('--profile'));
});

test('invalid ports cause no Docker operations or environment writes', t => {
  const { root, run } = fixture(t);
  for (const value of ['0', '65536', '-1', '8080;touch bad', 'abc']) {
    const result = run(value);
    assert.equal(result.status, 2);
    assert.deepEqual(result.calls, []);
  }
  assert.ok(!readdirSync(root).includes('.env'));
});

test('unavailable daemon leaves deployment environment untouched', t => {
  const { root, run } = fixture(t, { FAIL_DAEMON: '1' });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.ok(!readdirSync(root).includes('.env'));
  assert.ok(!result.calls.some(args => args.includes('config') || args.includes('--build')));
});

test('empty required key fails before starting containers', t => {
  for (const existing of ['ADMIN_KEY=\nDRPY_ENABLED=0\n', 'ADMIN_KEY=keep\nDRPY_ENABLED=1\nDRPY_API_KEY=\n']) {
    const { run, content } = fixture(t, { existing });
    const result = run();
    assert.notEqual(result.status, 0);
    assert.equal(content(), existing);
    assert.ok(!result.calls.some(args => args.includes('--build')));
  }
});

test('failed build or health check retains env, reports failure and never deletes volumes', t => {
  const existing = 'ADMIN_KEY=keep\nDRPY_ENABLED=0\nHOST_PORT=18080\n';
  const { run, content } = fixture(t, { existing, FAIL_UP: '1' });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.equal(content(), existing);
  assert.match(result.stderr, /部署未成功就绪/);
  assert.ok(!result.stdout.includes('前台：http'));
  assert.ok(!result.calls.some(args => args.includes('down') || args.includes('rm')));
});
