import assert from 'node:assert/strict';
import { inspectNativeExport } from '../../../tools/verification/native-export.mjs';
const base = {
  fresh: true, requestId: 'unique-request', process: { bundleIdentifier: 'com.chaselean.desktop-habitats.dev' },
  environment: { screenCount: 1 }, views: [{
    fresh: true, errors: [], native: { rate: 0, persistence: 'native', tankId: 'dev-tank' },
    js: { ready: true, snapshotReady: true, statsReady: true, stats: { loop: { running: false } } },
  }],
};
const result = inspectNativeExport(base, { requestId: 'unique-request' });
assert.notEqual(result.status, 'failed');
assert.equal(result.checks.find(check => check.id === 'display-1-paced').status, 'not-exercised', 'a loaded but stopped native scene has no timing evidence');
assert.equal(result.checks.find(check => check.id === 'physical-multidisplay').status, 'not-exercised');
assert.equal(inspectNativeExport(base, { requestId: 'stale' }).status, 'failed');
assert.equal(inspectNativeExport({ ...base, process: { bundleIdentifier: 'com.chaselean.desktop-habitats' } }).status, 'failed', 'reject production exports');
assert.equal(inspectNativeExport({ ...base, views: [{ ...base.views[0], native: { ...base.views[0].native, rate: 30 }, js: { ...base.views[0].js, stats: { loop: { running: true } } } }] }).checks.find(check => check.id === 'display-1-paced').status, 'passed');
console.log('PASS: native export check refuses stale or production data and does not claim timing for stopped views');
