#!/usr/bin/env node
// Save the full automated checks as evidence. A failed command stays failed; this
// runner still executes the other command so the report does not hide its result.
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) {
  console.error('Usage: node tools/verification-checks.mjs [--out <directory>]');
  process.exit(2);
}
const out = path.resolve(args[1] ?? path.join(root, 'verification-results', 'checks'));
await mkdir(out, { recursive: true });
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const startedAt = new Date().toISOString();
const report = {
  version: 1,
  kind: 'automated-checks',
  commit: git('rev-parse', 'HEAD'),
  dirty: Boolean(git('status', '--porcelain')),
  startedAt,
  environment: { platform: process.platform, arch: process.arch, node: process.version },
  commands: [],
};
for (const [id, commandArgs] of [['test', ['test']], ['check', ['run', 'check']]]) {
  const start = Date.now();
  let text = '';
  const result = await new Promise(resolve => {
    const child = spawn('npm', commandArgs, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const append = data => { text += data; process.stdout.write(data); };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.once('error', error => resolve({ exitCode: null, error: error.message }));
    child.once('close', (code, signal) => resolve({ exitCode: code, signal }));
  });
  const log = `${id}.log`;
  await writeFile(path.join(out, log), text);
  report.commands.push({
    id, command: `npm ${commandArgs.join(' ')}`,
    status: result.exitCode === 0 ? 'passed' : 'failed',
    ...result, durationMs: Date.now() - start, log,
  });
  await writeFile(path.join(out, 'verification-checks.json'), JSON.stringify(report, null, 2) + '\n');
}
report.finishedAt = new Date().toISOString();
report.status = report.commands.every(command => command.status === 'passed') ? 'passed' : 'failed';
await writeFile(path.join(out, 'verification-checks.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nAutomated evidence: ${path.join(out, 'verification-checks.json')}`);
process.exitCode = report.status === 'passed' ? 0 : 1;
