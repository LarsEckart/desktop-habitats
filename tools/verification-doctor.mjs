#!/usr/bin/env node
// Read-only health check for this repo's test browsers. It never kills processes,
// opens Chrome, or inspects ordinary browser profiles.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const MINUTES = 20;
const CPU_LIMIT = 200;

export function elapsedSeconds(text) {
  const [daysPart, clockPart] = text.includes('-') ? text.split('-') : ['0', text];
  const fields = clockPart.split(':').map(Number);
  if (fields.length < 2 || fields.length > 3 || fields.some(value => !Number.isFinite(value))) return 0;
  const [hours, minutes, seconds] = fields.length === 3 ? fields : [0, ...fields];
  return Number(daysPart) * 86400 + hours * 3600 + minutes * 60 + seconds;
}

export function parseProcesses(text) {
  return text.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.+)$/);
    if (!match) return [];
    return [{ pid: Number(match[1]), ppid: Number(match[2]), cpu: Number(match[3]),
      ageSeconds: elapsedSeconds(match[4]), elapsed: match[4], command: match[5] }];
  });
}

function testProfile(command) {
  // Include the old repo-specific profile that was left running, and the new runner's
  // temporary profiles. A shared debugging port alone is NOT proof that we own a browser.
  if (!/Chrome|Chromium/.test(command)) return null;
  return command.match(/--user-data-dir=(\/tmp\/(?:habitats-chrome|desktop-habitats-verification-[^\s]+))(?=\s|$)/)?.[1] ?? null;
}

export function inspectBrowsers(processes, { maxAgeMinutes = MINUTES, cpuLimit = CPU_LIMIT } = {}) {
  const profiles = new Map();
  for (const process of processes) {
    const profile = testProfile(process.command);
    if (!profile) continue;
    const members = profiles.get(profile) ?? [];
    members.push(process);
    profiles.set(profile, members);
  }
  const byPID = new Map(processes.map(process => [process.pid, process]));
  return [...profiles].map(([profile, members]) => {
    const browser = members.find(process => !/--type=/.test(process.command));
    const cpu = members.reduce((sum, process) => sum + process.cpu, 0);
    const ageSeconds = Math.max(...members.map(process => process.ageSeconds));
    const softwareRendering = members.some(process => /swiftshader|--disable-gpu(?:\s|$)/i.test(process.command));
    const detached = !browser || browser.ppid === 1 || !byPID.has(browser.ppid);
    const reasons = [];
    if (softwareRendering) reasons.push('Software-rendering flags detected (can use many CPU cores).');
    if (cpu >= cpuLimit) reasons.push(`High CPU: ${cpu.toFixed(1)}% across this test browser's processes.`);
    if (ageSeconds >= maxAgeMinutes * 60) reasons.push(`Older than ${maxAgeMinutes} minutes; check whether its test finished.`);
    if (detached) reasons.push('No live test-runner parent detected; may have been left behind.');
    return { profile, browserPID: browser?.pid ?? null, parentPID: browser?.ppid ?? null,
      pids: members.map(process => process.pid), cpu: Number(cpu.toFixed(1)), ageSeconds,
      softwareRendering, detached, status: reasons.length ? 'warning' : 'ok', reasons };
  });
}

export function formatFindings(browsers) {
  if (!browsers.length) return 'OK: no aquarium test Chrome processes found.';
  return browsers.map(browser => {
    const age = `${Math.floor(browser.ageSeconds / 3600)}h ${Math.floor(browser.ageSeconds % 3600 / 60)}m`;
    const lines = [`${browser.status === 'warning' ? 'WARNING' : 'OK'}: PID ${browser.browserPID ?? '(browser exited)'} · ${browser.cpu.toFixed(1)}% CPU · ${age}`, `  ${browser.profile}`];
    for (const reason of browser.reasons) lines.push(`  - ${reason}`);
    lines.push(`  Process IDs: ${browser.pids.join(', ')}`);
    if (browser.status === 'warning') lines.push('  Read-only warning: confirm ownership before stopping anything.');
    return lines.join('\n');
  }).join('\n\n');
}

export async function main(argv) {
  const watch = argv.includes('--watch'), json = argv.includes('--json');
  if (argv.some(arg => !['--watch', '--json', '--help', '-h'].includes(arg))) throw new Error('Unknown option; use --help.');
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: npm run verify:doctor -- [--watch] [--json]\nRead-only checks for old aquarium test browsers, high CPU and software rendering.\n--watch polls every 10 seconds; Ctrl+C stops the monitor. No automatic process killing.\nExit code: 0 = no warnings, 1 = warnings, 2 = monitor error.');
    return;
  }
  let stopped = false;
  const stop = () => { stopped = true; };
  if (watch) { process.on('SIGINT', stop); process.on('SIGTERM', stop); }
  let previous = '';
  try {
    do {
      const { stdout } = await exec('ps', ['-axo', 'pid=,ppid=,pcpu=,etime=,command='], { maxBuffer: 8 * 1024 * 1024, timeout: 5000 });
      const browsers = inspectBrowsers(parseProcesses(stdout));
      const text = json ? JSON.stringify({ checkedAt: new Date().toISOString(), browsers }) : formatFindings(browsers);
      // In watch mode print changes rather than flooding the terminal when nothing runs.
      if (!watch || text !== previous) console.log(watch && !json ? `[${new Date().toLocaleTimeString()}]\n${text}` : text);
      previous = text;
      if (!watch) { process.exitCode = browsers.some(browser => browser.status === 'warning') ? 1 : 0; break; }
      for (let i = 0; i < 20 && !stopped; i++) await new Promise(resolve => setTimeout(resolve, 500));
    } while (!stopped);
  } finally {
    if (watch) { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch(error => { console.error(`Doctor failed: ${error.message}`); process.exitCode = 2; });
}
