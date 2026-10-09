import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const script = resolve(import.meta.dirname, 'deploy.sh');
const releaseCheck = resolve(import.meta.dirname, 'check-release-files.mjs');
const appImage = `ghcr.io/maolikeqvq/mqtv@sha256:${'a'.repeat(64)}`;
const drpyImage = `ghcr.io/maolikeqvq/mqtv-drpy@sha256:${'b'.repeat(64)}`;
const previous = `LIBRETV_IMAGE=ghcr.io/maolikeqvq/mqtv@sha256:${'c'.repeat(64)}\nDRPY_IMAGE=ghcr.io/maolikeqvq/mqtv-drpy@sha256:${'d'.repeat(64)}\n`;
const dockerMock = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.MOCK_LOG, JSON.stringify(args) + '\\n');
if (args.includes('version')) process.exit(0);
if (args.includes('config')) {
  if (process.env.FAIL_CONFIG) process.exit(1);
  console.log('DRPY_ENABLED=' + process.env.MOCK_DRPY);
  console.log('ADMIN_KEY=do-not-print-this');
  process.exit(0);
}
if (args.includes('pull')) process.exit(process.env.FAIL_PULL ? 1 : 0);
if (args.includes('up')) {
  if (process.env.LIBRETV_IMAGE || process.env.DRPY_IMAGE) process.exit(7);
  const rollback = args.includes('.env.release');
  process.exit((rollback ? process.env.FAIL_ROLLBACK : process.env.FAIL_UP) ? 1 : 0);
}
process.exit(1);
`;

function fixture(t, { hasPrevious = true, ...flags } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'mqtv-deploy-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'docker'), dockerMock, { mode: 0o755 });
  writeFileSync(join(bin, 'flock'), '#!/bin/sh\nexit "${FAIL_LOCK:-0}"\n', { mode: 0o755 });
  const env = 'DRPY_ENABLED=1\nADMIN_KEY=private-setting\nINERT=$(touch should-not-exist)\n';
  writeFileSync(join(directory, '.env'), env);
  writeFileSync(join(directory, 'docker-compose.yml'), 'services: {}\n');
  if (hasPrevious) writeFileSync(join(directory, '.env.release'), previous);
  const log = join(directory, 'docker.log');
  function run(app = appImage) {
    const result = spawnSync('bash', [script, directory, app, drpyImage], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, MOCK_LOG: log, MOCK_DRPY: '1', ...flags },
    });
    assert.equal(readFileSync(join(directory, '.env'), 'utf8'), env);
    assert.ok(!readdirSync(directory).includes('should-not-exist'));
    assert.ok(!result.stdout.includes('private-setting'));
    assert.ok(!result.stdout.includes('do-not-print-this'));
    const calls = readdirSync(directory).includes('docker.log')
      ? readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
    return { ...result, calls };
  }
  return { directory, run };
}

test('healthy update records both digests, uses drpy and waits without building', t => {
  const { directory, run } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(join(directory, '.env.release'), 'utf8'), `LIBRETV_IMAGE=${appImage}\nDRPY_IMAGE=${drpyImage}\n`);
  const up = result.calls.find(args => args.includes('up'));
  assert.ok(up.includes('--profile') && up.includes('drpy'));
  assert.ok(up.includes('--no-build') && up.includes('--wait'));
  assert.ok(result.calls.findIndex(args => args.includes('pull')) < result.calls.findIndex(args => args.includes('up')));
  assert.ok(!readdirSync(directory).some(name => name.startsWith('.env.release.pending')));
});

test('unhealthy update restores previous images and returns failure', t => {
  const { directory, run } = fixture(t, { FAIL_UP: '1' });
  const result = run();
  assert.notEqual(result.status, 0);
  const updates = result.calls.filter(args => args.includes('up'));
  assert.equal(updates.length, 2);
  assert.ok(updates[1].includes('.env.release'));
  assert.equal(readFileSync(join(directory, '.env.release'), 'utf8'), previous);
  assert.match(result.stderr, /Previous release restored/);
});

test('pull failure does not restart containers or replace the previous release', t => {
  const { directory, run } = fixture(t, { FAIL_PULL: '1' });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.ok(!result.calls.some(args => args.includes('up')));
  assert.equal(readFileSync(join(directory, '.env.release'), 'utf8'), previous);
});

test('first deployment failure reports that rollback is unavailable', t => {
  const { directory, run } = fixture(t, { hasPrevious: false, FAIL_UP: '1' });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no recorded previous release/);
  assert.equal(result.calls.filter(args => args.includes('up')).length, 1);
  assert.ok(!readdirSync(directory).includes('.env.release'));
});

test('rollback failure stays visible', t => {
  const { run } = fixture(t, { FAIL_UP: '1', FAIL_ROLLBACK: '1' });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Rollback also failed/);
});

test('disabled drpy does not force its profile', t => {
  const { run } = fixture(t, { MOCK_DRPY: '0' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.ok(!result.calls.find(args => args.includes('up')).includes('--profile'));
});

test('configuration failure removes pending file and never starts containers', t => {
  const { directory, run } = fixture(t, { FAIL_CONFIG: '1' });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.ok(!result.calls.some(args => args.includes('up')));
  assert.ok(!readdirSync(directory).some(name => name.startsWith('.env.release.pending')));
});

test('failed deployment lock prevents Docker calls', t => {
  const { run } = fixture(t, { FAIL_LOCK: '1' });
  const result = run();
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
});

test('rejects mutable tags and shell text before Docker operations', t => {
  const { run } = fixture(t);
  const result = run('ghcr.io/maolikeqvq/mqtv:latest; touch should-not-exist');
  assert.notEqual(result.status, 0);
  assert.deepEqual(result.calls, []);
});

test('inherited image variables cannot override release files', t => {
  const { run } = fixture(t, { LIBRETV_IMAGE: 'wrong-app:latest', DRPY_IMAGE: 'wrong-drpy:latest' });
  const result = run();
  assert.equal(result.status, 0, result.stderr);
});

function checkTrackedFiles(t, files) {
  const directory = mkdtempSync(join(tmpdir(), 'mqtv-release-files-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  execFileSync('git', ['init', '--quiet', directory], { env });
  for (const file of files) {
    const path = join(directory, file);
    mkdirSync(resolve(path, '..'), { recursive: true });
    writeFileSync(path, 'private-body-must-not-appear\n');
  }
  execFileSync('git', ['add', '--all'], { cwd: directory, env });
  return spawnSync(process.execPath, [releaseCheck], { cwd: directory, env, encoding: 'utf8' });
}

test('release guard accepts example env and generic test fixtures', t => {
  const result = checkTrackedFiles(t, ['.env.example', 'src/lib/testing/source-fixtures.ts', 'docker-compose.yml']);
  assert.equal(result.status, 0, result.stderr);
});

test('release guard rejects tracked private snapshots, envs and artifacts without reading contents', t => {
  const files = ['src/lib/source-presets.json', 'src/lib/tvbox-catalog.json', 'docs/source-sync-report.json', '.env', '.env.production', 'data/site-config.json', '.playwright-cli/session.yml', 'output/capture.png'];
  const result = checkTrackedFiles(t, files);
  assert.notEqual(result.status, 0);
  for (const file of files) assert.ok(result.stderr.includes(file));
  assert.ok(!result.stderr.includes('private-body-must-not-appear'));
});
