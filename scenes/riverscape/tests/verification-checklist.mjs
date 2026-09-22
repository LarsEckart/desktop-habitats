// Every source acceptance check must have a stable row in the review work list.
// This validates coverage and links, not whether the aquarium meets the claim.
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const checklist = JSON.parse(await readFile(new URL('docs/verification-checklist.json', root), 'utf8'));
const issues = [
  'issue-01-fish-state-and-saving.md',
  'issue-02-babies-and-growth.md',
  'issue-03-snapping-turtle.md',
  'issue-04-turtle-hunting-and-balance.md',
];
const methods = new Set(['automated', 'browser', 'native', 'judgment']);
const ids = new Set();
for (const [index, issue] of issues.entries()) {
  const source = await readFile(new URL(`docs/${issue}`, root), 'utf8');
  const count = [...source.matchAll(/^- \[[ x]\] /gm)].length;
  const rows = checklist.checks.filter(row => row.issue === issue);
  assert.equal(rows.length, count, `${issue}: one row per source acceptance check`);
  for (let i = 0; i < count; i++) {
    assert.equal(rows[i].id, `${String(index + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
  }
}
for (const row of checklist.checks) {
  assert.ok(!ids.has(row.id), `unique check: ${row.id}`);
  ids.add(row.id);
  assert.ok(issues.includes(row.issue));
  assert.ok(row.claim.trim());
  assert.ok(methods.has(row.method));
  assert.ok(checklist.statuses.includes(row.status));
  assert.ok(Array.isArray(row.scenarioIds));
  assert.ok(Array.isArray(row.tests));
  // Static coverage must never pretend to be the result of a particular run.
  assert.ok(['not-exercised', 'needs-judgment'].includes(row.status));
  for (const file of row.tests) await access(new URL(file, root));
}
for (const row of checklist.checks) {
  if (row.supersededBy) assert.ok(ids.has(row.supersededBy), `staged replacement: ${row.id}`);
}
console.log(`PASS: ${ids.size} acceptance rows cover all four issue docs; source/test links and review states are valid`);
