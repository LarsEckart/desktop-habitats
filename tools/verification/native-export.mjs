#!/usr/bin/env node
// Inspect a real, fresh dev-host export without launching or stopping any app.
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const usage = 'Usage: node tools/verification/native-export.mjs <wallpaper/dev.sh export JSON path>';
export function inspectNativeExport(value, { requestId = null } = {}) {
  const checks = [];
  const add = (id, ok, detail) => checks.push({ id, status: ok ? 'passed' : 'failed', detail });
  add('fresh-token', value?.fresh === true && typeof value?.requestId === 'string' && (!requestId || requestId === value.requestId), `request ${value?.requestId || 'missing'}`);
  add('dev-process', value?.process?.bundleIdentifier === 'com.chaselean.desktop-habitats.dev', 'must be an isolated dev host');
  add('display-count', Array.isArray(value?.views) && value.views.length === value?.environment?.screenCount && value.views.length > 0, `${value?.views?.length ?? 0} views / ${value?.environment?.screenCount ?? 0} screens`);
  for (const [i, view] of (value?.views ?? []).entries()) {
    add(`display-${i + 1}-ready`, view.fresh === true && view.js?.ready === true && view.js?.snapshotReady === true && view.js?.statsReady === true && view.errors?.length === 0,
      `ready=${view.js?.ready}, errors=${view.errors?.length ?? 'missing'}`);
    add(`display-${i + 1}-separate-save`, view.native?.persistence === 'native' && typeof view.native?.tankId === 'string',
      `persistence=${view.native?.persistence}, tank=${view.native?.tankId ?? 'missing'}`);
    // A fresh response can still be paused or fully covered. Do not present it as a
    // paced native workload unless the host and the scene are both running.
    checks.push({ id: `display-${i + 1}-paced`, status: view.native?.rate > 0 && view.js?.stats?.loop?.running === true ? 'passed' : 'not-exercised',
      detail: `host rate=${view.native?.rate}, scene running=${view.js?.stats?.loop?.running}` });
  }
  checks.push({ id: 'physical-multidisplay', status: (value?.views?.length ?? 0) > 1 ? 'needs-judgment' : 'not-exercised',
    detail: 'A real two-display quit/replug test needs distinct before/after exports and a physical display change.' });
  return { requestId: value?.requestId, checkedAt: new Date().toISOString(), checks,
    status: checks.some(check => check.status === 'failed') ? 'failed' : 'needs-judgment' };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  if (process.argv.length !== 3) { console.error(usage); process.exitCode = 2; }
  else {
    try {
      const file = resolve(process.argv[2]); await access(file);
      const result = inspectNativeExport(JSON.parse(await readFile(file, 'utf8')));
      for (const check of result.checks) console.log(`${check.status}: ${check.id} — ${check.detail}`);
      process.exitCode = result.status === 'failed' ? 1 : 0;
    } catch (error) { console.error(`Native export check failed: ${error.message}`); process.exitCode = 2; }
  }
}
