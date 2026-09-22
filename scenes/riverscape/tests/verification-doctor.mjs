import assert from 'node:assert/strict';
import { elapsedSeconds, parseProcesses, inspectBrowsers, formatFindings } from '../../../tools/verification-doctor.mjs';
assert.equal(elapsedSeconds('23:33:23'), 84803);
assert.equal(elapsedSeconds('01-10:45:20'), 125120);
assert.equal(elapsedSeconds('00:45'), 45);
assert.equal(elapsedSeconds('bad'), 0);
const list = parseProcesses(`
1 0 0.1 22-00:00:00 /sbin/launchd
900 1 2.0 23:33:23 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --remote-debugging-port=9222 --user-data-dir=/tmp/habitats-chrome about:blank
901 900 690.3 23:33:22 /Applications/Google Chrome.app/Contents/Helpers/Google Chrome Helper (GPU) --type=gpu-process --use-angle=swiftshader --user-data-dir=/tmp/habitats-chrome
902 1 500.0 01-00:00:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --remote-debugging-port=9333 --user-data-dir=/Users/lars/normal-profile
903 1 500.0 01-00:00:00 /Applications/Firefox.app/Contents/MacOS/firefox
904 1 500.0 01-00:00:00 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/habitats-chrome-other
`);
const old = inspectBrowsers(list);
assert.equal(old.length, 1, 'ignore normal profiles and similarly named unrelated profiles');
assert.equal(old[0].cpu, 692.3, 'sum browser and helper CPU, not unrelated processes');
assert.equal(old[0].browserPID, 900);
assert.equal(old[0].detached, true);
assert.equal(old[0].softwareRendering, true);
assert.equal(old[0].reasons.length, 4);
assert.match(formatFindings(old), /confirm ownership/);
const live = parseProcesses(`
10 1 0.0 00:05 node tools/verification/run.mjs
11 10 2.0 00:04 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/desktop-habitats-verification-abcdef
12 11 25.0 00:03 /Applications/Google Chrome.app/Contents/Helpers/Google Chrome Helper --type=gpu-process --user-data-dir=/tmp/desktop-habitats-verification-abcdef
`);
assert.equal(inspectBrowsers(live)[0].status, 'ok');
assert.equal(inspectBrowsers(live.filter(process => process.pid !== 11))[0].detached, true);
assert.equal(inspectBrowsers(live, { cpuLimit: 20 })[0].status, 'warning');
assert.match(formatFindings([]), /^OK:/);
console.log('PASS: verification doctor finds old/software-rendered/high-CPU test browsers and ignores normal profiles');
