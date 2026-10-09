import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';

const privateFiles = new Set([
  'src/lib/source-presets.json',
  'src/lib/tvbox-catalog.json',
  'docs/source-sync-report.json',
]);
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const blocked = files.filter(file =>
  privateFiles.has(file)
  || /^(data|\.runtime|output|\.playwright-cli)\//.test(file)
  || (basename(file).startsWith('.env') && file !== '.env.example'),
);
if (blocked.length) {
  console.error('Private files must not be tracked in a release (paths only):');
  for (const file of blocked) console.error(file);
  process.exitCode = 1;
} else {
  console.log('No known private configuration, source snapshots or runtime artifacts tracked');
}
