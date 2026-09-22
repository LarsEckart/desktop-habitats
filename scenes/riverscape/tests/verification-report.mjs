import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { deserializeReport, feedbackStorageKey, parseFeedback, readChecklist, renderReportHtml, serializeFeedback, serializeReport, withFeedback } from '../../../tools/verification/report.mjs';
import { equalJson, durableSnapshotEqual, makeSafeRunId, makeScenarioAssertions, overallStatus, parseArgs, scenarioUrl } from '../../../tools/verification/run.mjs';

const report = {
  schemaVersion: 1,
  generatedAt: '2025-01-01T00:00:00.000Z',
  commit: { sha: 'abc123', dirty: true },
  run: { id: 'unit-run', mode: 'capture', seed: 42 },
  environment: { viewport: { width: 320, height: 240 } },
  coverage: [{ id: '01-01', claim: 'A claim', method: 'browser', status: 'not-exercised' }],
  scenarios: [{ id: 'fresh', title: 'Fresh', description: 'A fixture', status: 'passed', assertions: [], captures: { screenshots: [], recording: { supported: false, reason: 'test' } } }],
};

// Report serialization keeps the schema explicit and survives a disk round trip.
const text = serializeReport(report);
assert.deepEqual(deserializeReport(text), report);
assert.throws(() => deserializeReport(JSON.stringify({ ...report, schemaVersion: 99 })), /Unsupported report schema/);
assert.throws(() => deserializeReport(JSON.stringify({ schemaVersion: 1 })), /scenarios/);

// Embedded report data cannot terminate the JSON script element.
const hostile = { ...report, scenarios: [{ ...report.scenarios[0], description: '</script><script>alert(1)</script>', metadata: { class: 'prepared-condition', naturalBehavior: false, pacing: 'Review at normal speed.', fixtureOverrides: { restMin: 0.12 }, controlledStimuli: ['placed-prey'], note: 'Prepared only.' }, captures: { screenshots: [{ path: 'screenshots/fresh.png' }], recording: { path: 'videos/fresh.webm', simulationToWallRatio: 0.98 } } }] };
const html = renderReportHtml(hostile);
assert.match(html, /Riverscape review/);
assert.ok(!html.includes('</script><script>alert(1)</script>'), 'report data is escaped before embedding');
assert.match(html, /Acceptance coverage/);
assert.match(html, /Looks right/);
const checklist = await readChecklist(fileURLToPath(new URL('../../../docs/verification-checklist.json', import.meta.url)));
assert.equal(checklist.length, 36, 'the report loads all acceptance checks from docs/verification-checklist.json');
assert.equal(checklist.find(row => row.id === '04-12')?.method, 'judgment');
assert.match(html, /normal-speed recording/);
assert.match(html, /Open full-size screenshot/);
assert.match(html, /Open clip/);
assert.match(html, /sim\/wall/);
assert.match(html, /controlled stimuli/i);
assert.match(html, /persistence-warning/);
assert.match(html, /<details class="coverage">/);

// Feedback accepts only the three review decisions and plain notes.
const feedback = { fresh: { verdict: 'looks-right', note: 'The water and fish look right.' }, bad: { verdict: 'not-a-verdict', note: 'discard' }, malformed: null };
assert.deepEqual(parseFeedback(feedback), { fresh: feedback.fresh });
assert.match(feedbackStorageKey('hello/run with spaces'), /^habitats-verification-feedback:v1:hello-run-with-spaces$/);
const feedbackText = serializeFeedback(feedback);
assert.deepEqual(parseFeedback(feedbackText), { fresh: feedback.fresh });
assert.deepEqual(withFeedback(report, feedback).feedback, { fresh: feedback.fresh });

// Runner helpers are pure and safe to use in headless tests.
assert.equal(makeSafeRunId('  run with spaces  '), 'run-with-spaces');
assert.throws(() => makeSafeRunId('---'), /safe character/);
const url = scenarioUrl('http://127.0.0.1:8080', { scenario: 'hunt-hit', seed: 42, run: 'unit-run' });
assert.equal(new URL(url).searchParams.get('verify'), '1');
assert.equal(new URL(url).searchParams.get('scenario'), 'hunt-hit');
assert.equal(new URL(url).searchParams.get('seed'), '42');
assert.equal(new URL(url).searchParams.get('run'), 'unit-run');
assert.equal(equalJson({ b: 2, a: 1 }, { a: 1, b: 2 }), true);

const successful = makeScenarioAssertions({
  apiReady: true, listed: true,
  initial: { simulationTime: 0, snapshot: { fish: [{ id: 'a' }] } },
  paused: { paused: true }, stepped: { simulationTime: 0.05 }, still: { simulationTime: 0.05 }, played: { simulationTime: 0.1 },
  beforeReload: { snapshot: { fish: [{ id: 'a' }] } }, afterReload: { snapshot: { fish: [{ id: 'a' }] } },
  recording: { supported: true, path: 'videos/fresh.webm' },
  normalStorageBefore: { value: 'normal-save' }, normalStorageAfter: { value: 'normal-save' },
  screenshotsReady: { fresh: true, final: true },
});
assert.equal(overallStatus(successful), 'passed');
assert.equal(successful.find(a => a.id === 'recording').status, 'passed');
assert.equal(successful.find(a => a.id === 'normal-storage-isolation').status, 'passed');
assert.equal(successful.find(a => a.id === 'rendered-before-screenshot').status, 'passed');
assert.equal(durableSnapshotEqual({ fish: [{ id: 'a', age: 1.0004 }] }, { fish: [{ id: 'a', age: 1 }] }), true);
assert.equal(durableSnapshotEqual({ fish: [{ id: 'a', age: 1 }] }, { fish: [{ id: 'a', age: 1.5 }] }), false);
assert.equal(durableSnapshotEqual({ turtle: { hunger: 0.15 } }, { turtle: { hunger: 1 } }), false, 'a hunger reset must fail reload verification');
const unsupported = makeScenarioAssertions({ apiReady: true, listed: true, initial: { simulationTime: 0, snapshot: {} }, paused: { paused: true }, stepped: { simulationTime: 0.05 }, still: { simulationTime: 0.05 }, played: { simulationTime: 0.1 }, beforeReload: { snapshot: {} }, afterReload: { snapshot: {} }, recording: { supported: false, reason: 'unsupported' }, normalStorageBefore: { value: null }, normalStorageAfter: { value: null }, screenshotsReady: { fresh: true, final: true } });
assert.equal(unsupported.find(a => a.id === 'recording').status, 'not-exercised');
assert.equal(overallStatus(unsupported), 'needs-judgment');
const failed = makeScenarioAssertions({ contextErrors: ['boom'], timeout: true });
assert.equal(overallStatus(failed), 'failed');

const parsed = parseArgs(['--smoke', '--run', 'test-run', '--scenario', 'fresh,hunt-hit', '--no-video']);
assert.deepEqual(parsed.scenarios, ['fresh']);
assert.equal(parsed.noVideo, true);
assert.equal(parsed.run, 'test-run');

console.log('PASS: verification report serialization, safe feedback, HTML embedding, runner URLs and assertion statuses');
