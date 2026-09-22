import { execFile } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';
import { deserializeReport, readChecklist, renderReportHtml, serializeReport } from './report.mjs';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_SCENARIOS = ['fresh', 'legacy-save', 'growth', 'full-tank', 'turtle-rest', 'turtle-walk', 'turtle-breathe', 'hunt-hit', 'hunt-miss', 'prey-loss', 'minimum-population'];
const PERFORMANCE_SCENARIOS = ['fresh', 'full-tank', 'turtle-rest', 'hunt-hit'];
const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;

export function makeSafeRunId(value = `verify-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}`) {
  const id = String(value).replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  if (!id) throw new Error('Run id must contain at least one safe character.');
  return id;
}

export function parseArgs(argv) {
  const options = {
    base: process.env.HABITAT_URL || 'http://127.0.0.1:8080',
    debug: process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9222',
    out: null,
    seed: 42,
    run: null,
    duration: 2000,
    warmup: 1500,
    measure: 5000,
    width: 1280,
    height: 720,
    dpr: 1,
    start: false,
    headless: false,
    performance: false,
    smoke: false,
    noVideo: false,
    checks: null,
    scenarios: null,
  };
  const value = (i, flag) => {
    if (argv[i + 1] == null || argv[i + 1].startsWith('--')) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--start') options.start = true;
    else if (arg === '--headful') options.headless = false;
    else if (arg === '--headless') options.headless = true;
    else if (arg === '--performance') options.performance = true;
    else if (arg === '--smoke') options.smoke = true;
    else if (arg === '--no-video') options.noVideo = true;
    else if (arg === '--checks') options.checks = value(i++, arg);
    else if (arg === '--base') options.base = value(i++, arg);
    else if (arg === '--debug') options.debug = value(i++, arg);
    else if (arg === '--out') options.out = value(i++, arg);
    else if (arg === '--run') options.run = makeSafeRunId(value(i++, arg));
    else if (arg === '--seed') options.seed = Number(value(i++, arg));
    else if (arg === '--duration') options.duration = Number(value(i++, arg));
    else if (arg === '--warmup') options.warmup = Number(value(i++, arg));
    else if (arg === '--measure') options.measure = Number(value(i++, arg));
    else if (arg === '--width') options.width = Number(value(i++, arg));
    else if (arg === '--height') options.height = Number(value(i++, arg));
    else if (arg === '--dpr') options.dpr = Number(value(i++, arg));
    else if (arg === '--scenario' || arg === '--scenarios') options.scenarios = value(i++, arg).split(',').map(s => s.trim()).filter(Boolean);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!Number.isSafeInteger(options.seed) || options.seed < 0) throw new Error('--seed must be a non-negative integer');
  for (const [name, max] of [['duration', 60000], ['warmup', 60000], ['measure', 60000]]) {
    if (!Number.isFinite(options[name]) || options[name] < 0 || options[name] > max) throw new Error(`--${name} is out of range`);
  }
  for (const [name, min, max] of [['width', 320, 4096], ['height', 240, 4096], ['dpr', 0.5, 3]]) {
    if (!Number.isFinite(options[name]) || options[name] < min || options[name] > max) throw new Error(`--${name} is out of range`);
  }
  options.run ||= makeSafeRunId();
  options.scenarios ||= options.performance ? PERFORMANCE_SCENARIOS : DEFAULT_SCENARIOS;
  if (options.smoke) options.scenarios = options.scenarios.slice(0, 1);
  if (!options.scenarios.length) throw new Error('At least one scenario is required');
  if (options.scenarios.some(scenario => !SAFE_ID.test(scenario))) throw new Error('Scenario ids must contain only letters, numbers, dot, underscore and dash.');
  return options;
}

export function scenarioUrl(base, { scenario, seed = 42, run }) {
  const url = new URL('/scenes/riverscape/index.html', base);
  url.search = new URLSearchParams({ diagnostics: '1', verify: '1', scenario, seed: String(seed), run: makeSafeRunId(run) }).toString();
  return url.href;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function equalJson(a, b) {
  return stableJson(a) === stableJson(b);
}

// Fish ages round to milliseconds in the save format. Larger changes (especially
// hunger, which is only 0..1) must not hide behind a one-second blanket tolerance.
export function durableSnapshotEqual(a, b, tolerance = 0.001) {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= tolerance;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => durableSnapshotEqual(item, b[index], tolerance));
  if (a && typeof a === 'object' && b && typeof b === 'object') {
    const ak = Object.keys(a).sort(); const bk = Object.keys(b).sort();
    return equalJson(ak, bk) && ak.every(key => durableSnapshotEqual(a[key], b[key], tolerance));
  }
  return false;
}

export function isJsonSafe(value) {
  try { return equalJson(JSON.parse(JSON.stringify(value)), value); } catch { return false; }
}

export function assertion(id, label, ok, detail = '') {
  return { id, label, status: ok === true ? 'passed' : ok === false ? 'failed' : 'not-exercised', ...(detail ? { detail: String(detail) } : {}) };
}

export function overallStatus(assertions) {
  if (assertions.some(a => a.status === 'failed')) return 'failed';
  if (assertions.some(a => a.status === 'not-exercised')) return 'needs-judgment';
  return 'passed';
}

export function makeScenarioAssertions({ initial, paused, stepped, still, played, beforeReload, afterReload, recording, normalStorageBefore, normalStorageAfter, screenshotsReady, contextErrors = [], apiReady = false, listed = false, timeout = false }) {
  const startTime = Number(initial?.simulationTime);
  const steppedTime = Number(stepped?.simulationTime);
  const stillTime = Number(still?.simulationTime);
  const playedTime = Number(played?.simulationTime);
  const assertions = [
    assertion('api-ready', 'Verification API is ready', apiReady),
    assertion('scenario-listed', 'Scenario appears in public list()', listed),
    assertion('state-json', 'state() is JSON-safe', initial != null && isJsonSafe(initial)),
    assertion('pause', 'pause() reports paused', paused?.paused === true),
    assertion('step', 'step(3) advances exactly three fixed ticks', Number.isFinite(startTime) && Number.isFinite(steppedTime) && Math.abs((steppedTime - startTime) - 3 / 60) < 0.00001),
    assertion('pause-freeze', 'simulation stays still while paused', Number.isFinite(steppedTime) && Number.isFinite(stillTime) && Math.abs(stillTime - steppedTime) < 0.00001),
    assertion('play', 'play() advances simulation at normal speed', Number.isFinite(stillTime) && Number.isFinite(playedTime) && playedTime > stillTime),
    assertion('reload-retains', 'reload retains the durable snapshot', beforeReload != null && afterReload != null && durableSnapshotEqual(beforeReload.snapshot, afterReload.snapshot)),
    { id: 'recording', label: 'real canvas recording is available', status: recording?.supported === true && Boolean(recording.path) ? 'passed' : 'not-exercised', ...(recording?.reason ? { detail: String(recording.reason) } : {}) },
    { id: 'normal-storage-isolation', label: 'normal tank storage key is unchanged', status: normalStorageBefore?.error || normalStorageAfter?.error ? 'not-exercised' : normalStorageBefore && normalStorageAfter && normalStorageBefore.value === normalStorageAfter.value ? 'passed' : 'failed', detail: normalStorageBefore?.error || normalStorageAfter?.error || 'desktop-habitats/tank:v1 matched before and after controls' },
    { id: 'rendered-before-screenshot', label: 'screenshots follow a real rendered frame', status: screenshotsReady == null ? 'not-exercised' : screenshotsReady.fresh && screenshotsReady.final ? 'passed' : 'failed', detail: screenshotsReady == null ? 'render proof was not collected' : `fresh=${screenshotsReady.fresh}, final=${screenshotsReady.final}` },
    assertion('context-clean', 'no page exception or console error occurred', contextErrors.length === 0, contextErrors.join('; ')),
    assertion('not-timeout', 'scenario run completed within its time budget', !timeout),
  ];
  return assertions;
}

function help() {
  return `Riverscape verification runner\n\nUsage: node tools/verification/run.mjs [options]\n\n  --start             launch a temporary server and isolated Chrome\n  --performance       paced measurements only (fresh, full-tank, turtle-rest, hunt-hit)\n  --smoke             run the first selected scenario only\n  --scenario a,b      select scenario ids\n  --no-video          skip MediaRecorder clips\n  --checks FILE       include parent repo check provenance and copy logs\n  --base URL --debug URL --out DIR --run ID --seed N\n  --duration MS       clip length (default 2000; hunts at least 5000, breath trips 40000; max 60000)\n  --warmup MS --measure MS  paced performance timings\n  --headful           show the dedicated Chrome window (default; never uses your profile)\n  --headless           use headless Chrome only when a display is unavailable\n`;
}

class Cdp {
  constructor(debugUrl) { this.debugUrl = debugUrl; this.socket = null; this.serial = 0; this.pending = new Map(); this.events = []; this.navigationCount = 0; this.sessionId = null; this.targetId = null; }
  async connect() {
    const version = await (await fetch(`${this.debugUrl}/json/version`)).json();
    this.browserVersion = version;
    this.socket = new WebSocket(version.webSocketDebuggerUrl);
    this.socket.addEventListener('message', ({ data }) => {
      const message = JSON.parse(data);
      if (message.method) {
        this.events.push(message);
        if (message.method === 'Page.frameNavigated' && !message.params?.frame?.parentId) this.navigationCount++;
      }
      const callback = this.pending.get(message.id);
      if (!callback) return;
      this.pending.delete(message.id); clearTimeout(callback.timer);
      if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result);
    });
    await new Promise((resolve, reject) => { this.socket.addEventListener('open', resolve, { once: true }); this.socket.addEventListener('error', reject, { once: true }); });
    ({ targetId: this.targetId } = await this.send('Target.createTarget', { url: 'about:blank' }));
    ({ sessionId: this.sessionId } = await this.send('Target.attachToTarget', { targetId: this.targetId, flatten: true }));
    await this.page('Runtime.enable'); await this.page('Page.enable'); await this.page('Log.enable'); await this.page('Performance.enable');
    return this;
  }
  send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.serial; const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 180000);
      this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }
  page(method, params = {}) { return this.send(method, params, this.sessionId); }
  clearEvents() { this.events.length = 0; }
  contextErrors() {
    return this.events.filter(e => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded' && ['error', 'assert'].includes(e.params?.entry?.level) || e.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(e.params?.type)).map(e => {
      const p = e.params || {}; return p.exceptionDetails?.text || p.entry?.text || p.args?.map(a => a.value ?? a.description).join(' ') || 'page error';
    });
  }
  async evaluate(expression) {
    const result = await this.page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed');
    return result.result?.value;
  }
  async call(fn, args) { return this.evaluate(`(${fn})(${JSON.stringify(args)})`); }
  async navigate(url, { width, height, dpr }) {
    await this.page('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dpr, mobile: false });
    await this.page('Page.navigate', { url });
    await this.waitFor(async () => {
      try { return await this.evaluate('document.readyState === "complete"'); } catch { return false; }
    }, 15000, 'page load');
  }
  async waitFor(predicate, timeout = 10000, label = 'condition', interval = 100) {
    const end = Date.now() + timeout; let lastError;
    while (Date.now() < end) {
      try { if (await predicate()) return true; } catch (error) { lastError = error; }
      await sleep(interval);
    }
    throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
  }
  async close() {
    try { if (this.targetId) await this.send('Target.closeTarget', { targetId: this.targetId }); } catch {}
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.socket?.close();
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function waitForHttp(url, timeout = 15000) {
  const end = Date.now() + timeout; let error;
  while (Date.now() < end) { try { const response = await fetch(url); if (response.ok) return response; error = new Error(`HTTP ${response.status}`); } catch (e) { error = e; } await sleep(200); }
  throw new Error(`Timed out waiting for ${url}: ${error?.message || 'unavailable'}`);
}
async function waitForJson(url, timeout = 15000) {
  const response = await waitForHttp(url, timeout); return response.json();
}
async function commandExists(command) {
  try { await execFileAsync('which', [command]); return command; } catch { return null; }
}
async function chromeBinary() {
  const candidates = [process.env.CHROME_BIN, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', 'google-chrome', 'chromium', 'chromium-browser'].filter(Boolean);
  for (const candidate of candidates) { if (candidate.includes('/')) { try { await execFileAsync(candidate, ['--version']); return candidate; } catch {} } else { const found = await commandExists(candidate); if (found) return candidate; } }
  throw new Error('No Chrome/Chromium found. Set CHROME_BIN or omit --start and provide CHROME_DEBUG_URL.');
}
async function terminateProcessGroup(child) {
  if (!child || child.exitCode !== null) return;
  const pid = child.pid;
  try { if (pid) process.kill(-pid, 'SIGTERM'); else child.kill('SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch {} }
  await sleep(300);
  if (child.exitCode === null) {
    try { if (pid) process.kill(-pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch {} }
  }
}
async function startHarness(options) {
  if (!options.start) return { cleanup: async () => {} };
  const port = await freePort(); const debugPort = await freePort();
  const profile = await mkdtemp('/tmp/desktop-habitats-verification-');
  let server = null; let chrome = null;
  const base = `http://127.0.0.1:${port}`; const debug = `http://127.0.0.1:${debugPort}`;
  const cleanupChildren = async () => { for (const child of [chrome, server]) await terminateProcessGroup(child); await rm(profile, { recursive: true, force: true }); };
  try {
    const binary = await chromeBinary();
    server = spawn(process.execPath, [join(ROOT, 'serve.mjs')], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    chrome = spawn(binary, [
      `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-sync', '--disable-extensions', '--hide-scrollbars', ...(options.headless ? ['--headless=new'] : []), 'about:blank',
    ], { cwd: ROOT, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    await waitForJson(`${debug}/json/version`); await waitForHttp(`${base}/scenes/riverscape/index.html`);
    options.base = base; options.debug = debug;
    return { cleanup: cleanupChildren };
  } catch (error) {
    await cleanupChildren();
    throw error;
  }
}

async function waitForRenderedFrame(cdp, timeout = 15000) {
  let last = null;
  await cdp.waitFor(async () => {
    try {
      last = await cdp.evaluate('globalThis.habitatVerification.state()');
      const frames = Number(last?.stats?.renderedFrames);
      const framebuffer = last?.stats?.framebuffer;
      return frames > 0 && Array.isArray(framebuffer) && framebuffer[0] > 0 && framebuffer[1] > 0;
    } catch { return false; }
  }, timeout, 'first rendered frame');
  return last;
}
async function waitForVerification(cdp, timeout = 20000) {
  await cdp.waitFor(async () => {
    try { return await cdp.evaluate('typeof globalThis.habitatVerification === "object" && typeof globalThis.habitatVerification.state === "function"'); } catch { return false; }
  }, timeout, 'habitatVerification');
  return waitForRenderedFrame(cdp, timeout);
}
async function callVerification(cdp, method, arg) { return cdp.evaluate(`globalThis.habitatVerification.${method}(${arg === undefined ? '' : JSON.stringify(arg)})`); }
async function reloadThroughApi(cdp) {
  const before = cdp.navigationCount;
  try { await callVerification(cdp, 'reload'); } catch { /* Page.navigate can interrupt the evaluation promise. */ }
  await cdp.waitFor(() => cdp.navigationCount > before, 15000, 'reload navigation');
  await waitForVerification(cdp);
}
async function resetThroughApi(cdp) {
  const before = cdp.navigationCount;
  try { await callVerification(cdp, 'reset'); } catch {}
  await cdp.waitFor(() => cdp.navigationCount > before, 15000, 'reset navigation');
  await waitForVerification(cdp);
}
async function captureScreenshot(cdp, path, renderState) {
  // The loading veil fades after the first frame. A successful screenshot taken during
  // that fade would make the real scene look incorrectly dark.
  await cdp.waitFor(() => cdp.evaluate('!document.querySelector("#loading") || document.querySelector("#loading").hidden'), 5000, 'loading veil to clear');
  const { data } = await cdp.page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path, Buffer.from(data, 'base64')); return { path: `screenshots/${path.split('/').at(-1)}`, format: 'png', renderedFrames: Number(renderState?.stats?.renderedFrames) || 0, framebuffer: renderState?.stats?.framebuffer || null };
}
async function captureVideo(cdp, durationMs) {
  return cdp.call(async ({ durationMs }) => {
    const canvas = document.querySelector('#scene');
    if (!canvas) return { supported: false, reason: 'The scene canvas is missing.' };
    if (typeof canvas.captureStream !== 'function') return { supported: false, reason: 'Canvas captureStream() is unsupported.' };
    if (typeof MediaRecorder !== 'function') return { supported: false, reason: 'MediaRecorder is unsupported.' };
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
    const mimeType = types.find(type => MediaRecorder.isTypeSupported(type));
    if (!mimeType) return { supported: false, reason: 'No supported WebM MediaRecorder format.' };
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType });
    const chunks = [];
    const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = event => reject(new Error(event.error?.message || 'MediaRecorder error')); });
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    try {
      const before = globalThis.habitatVerification?.state?.() || null;
      const wallStart = performance.now();
      recorder.start(250);
      if (globalThis.habitatVerification?.play) await globalThis.habitatVerification.play();
      await new Promise(resolve => setTimeout(resolve, durationMs));
      if (globalThis.habitatVerification?.pause) await globalThis.habitatVerification.pause();
      const wallSeconds = (performance.now() - wallStart) / 1000;
      const after = globalThis.habitatVerification?.state?.() || null;
      recorder.stop(); await stopped;
      const blob = new Blob(chunks, { type: mimeType });
      const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const simulationSeconds = Number(after?.simulationTime) - Number(before?.simulationTime);
      return { supported: true, mimeType, base64: btoa(binary), bytes: bytes.length, durationMs, wallSeconds, simulationSeconds, simulationToWallRatio: Number.isFinite(simulationSeconds) && wallSeconds > 0 ? simulationSeconds / wallSeconds : null, normalSpeed: Number.isFinite(simulationSeconds) && wallSeconds > 0 && Math.abs(simulationSeconds / wallSeconds - 1) <= 0.1, method: 'canvas.captureStream + MediaRecorder' };
    } finally { stream.getTracks().forEach(track => track.stop()); }
  }, { durationMs });
}
async function waitForScenarioChecks(cdp, maxMs) {
  const end = Date.now() + maxMs; let last = null;
  while (Date.now() < end) {
    last = await callVerification(cdp, 'state');
    const checks = Array.isArray(last?.checks) ? last.checks : [];
    if (checks.length && checks.every(check => check.status !== 'not-exercised')) return { state: last, timeout: false };
    await sleep(250);
  }
  return { state: last || await callVerification(cdp, 'state'), timeout: true };
}

async function gitInfo() {
  try {
    const { stdout: sha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: ROOT });
    const { stdout: dirty } = await execFileAsync('git', ['status', '--porcelain'], { cwd: ROOT });
    return { sha: sha.trim(), dirty: Boolean(dirty.trim()) };
  } catch (error) { return { sha: 'unknown', dirty: false, error: error.message }; }
}
async function browserInfo(cdp, options) {
  const device = await cdp.call(() => ({ userAgent: navigator.userAgent, devicePixelRatio: window.devicePixelRatio, innerWidth, innerHeight, hidden: document.hidden, stats: globalThis.habitatStats?.() }), {});
  let gpu = null;
  try { gpu = (await cdp.send('SystemInfo.getInfo')).gpu; } catch { /* Older browsers may not expose this; never invent a hardware label. */ }
  return { chrome: cdp.browserVersion?.Browser || 'unknown', userAgent: device.userAgent, viewport: { width: options.width, height: options.height, deviceScaleFactor: options.dpr }, resolution: { scale: device.stats?.resolution ?? null, framebuffer: device.stats?.framebuffer ?? null }, gpu, page: { innerWidth: device.innerWidth, innerHeight: device.innerHeight, devicePixelRatio: device.devicePixelRatio, hidden: device.hidden }, platform: process.platform, node: process.version };
}

async function checkInterruptedHunt(cdp) {
  await resetThroughApi(cdp);
  let before = await callVerification(cdp, 'state');
  // Step the real engine into a lunge, then reload while it is paused mid-strike.
  for (let i = 0; i < 80 && before.stats?.turtle?.phase !== 'strike'; i++) {
    before = await callVerification(cdp, 'step', 3);
  }
  await reloadThroughApi(cdp);
  const after = await callVerification(cdp, 'state');
  return { before, after, check: assertion('mid-strike-reload', 'Reload mid-strike grants no catch',
    before.stats?.turtle?.phase === 'strike' && after.stats?.turtle?.phase === 'idle' &&
    durableSnapshotEqual(before.snapshot, after.snapshot),
    `phase ${before.stats?.turtle?.phase} → ${after.stats?.turtle?.phase}`) };
}

async function runScenario(cdp, options, scenario, meta, output) {
  const url = scenarioUrl(options.base, { scenario, seed: options.seed, run: options.run });
  cdp.clearEvents();
  const screenshots = []; const lifecycleChecks = []; let interruptedHunt = null; let resolvedReload = null; let recording = null; let timeout = false; let initial = null; let paused = null; let stepped = null; let still = null; let played = null; let beforeReload = null; let afterReload = null; let normalStorageBefore = null; let normalStorageAfter = null; let screenshotsReady = { fresh: false, final: false }; let apiReady = false; let listed = false; let failure = null;
  try {
    await cdp.navigate(url, options); initial = await waitForVerification(cdp); apiReady = true;
    try { normalStorageBefore = await cdp.call(() => ({ value: globalThis.localStorage?.getItem('desktop-habitats/tank:v1') ?? null }), {}); } catch (error) { normalStorageBefore = { error: error.message }; }
    const listedScenarios = await callVerification(cdp, 'list'); listed = Array.isArray(listedScenarios) && listedScenarios.some(item => item?.id === scenario);
    paused = await callVerification(cdp, 'pause'); stepped = await callVerification(cdp, 'step', 3); await sleep(250); still = await callVerification(cdp, 'state');
    await callVerification(cdp, 'play');
    try { await cdp.waitFor(async () => Number((await callVerification(cdp, 'state'))?.simulationTime) > Number(still?.simulationTime) + 1 / 120, 2000, 'play simulation'); } catch { /* The assertion below records a real stalled play instead of hiding it. */ }
    played = await callVerification(cdp, 'pause');
    await callVerification(cdp, 'save'); beforeReload = await callVerification(cdp, 'state'); await reloadThroughApi(cdp); afterReload = await callVerification(cdp, 'state');
    if (scenario === 'hunt-hit' || scenario === 'hunt-miss') {
      interruptedHunt = await checkInterruptedHunt(cdp);
      lifecycleChecks.push(interruptedHunt.check);
    }
    await resetThroughApi(cdp); await cdp.page('Page.bringToFront');
    const shotDir = join(output, 'screenshots'); const videoDir = join(output, 'videos'); await mkdir(shotDir, { recursive: true }); await mkdir(videoDir, { recursive: true });
    const freshRender = await waitForRenderedFrame(cdp); screenshotsReady.fresh = true;
    screenshots.push({ label: 'fresh-fixture', ...(await captureScreenshot(cdp, join(shotDir, `${scenario}-fresh.png`), freshRender)) });
    if (!options.noVideo) {
      const clipDuration = scenario.startsWith('hunt-') ? Math.max(options.duration, 5000) : scenario === 'turtle-breathe' ? Math.max(options.duration, 40000) : options.duration;
      console.log(`  Recording ${clipDuration / 1000}s at normal speed…`);
      const video = await captureVideo(cdp, Math.min(clipDuration, 60000));
      if (video.supported && video.base64) {
        const filename = `${scenario}.webm`; await writeFile(join(videoDir, filename), Buffer.from(video.base64, 'base64')); recording = { supported: true, path: `videos/${filename}`, mimeType: video.mimeType, bytes: video.bytes, durationMs: video.durationMs, wallSeconds: video.wallSeconds, simulationSeconds: video.simulationSeconds, simulationToWallRatio: video.simulationToWallRatio, normalSpeed: video.normalSpeed, method: video.method };
      } else recording = { supported: false, reason: video.reason || 'Recording returned no data.' };
    } else recording = { supported: false, reason: 'Skipped by --no-video.' };
    await callVerification(cdp, 'play');
    const completed = await waitForScenarioChecks(cdp, scenario.startsWith('hunt-') ? 15000 : Math.max(1000, options.duration)); timeout = completed.timeout; const finalState = await callVerification(cdp, 'pause');
    const finalRender = await waitForRenderedFrame(cdp); screenshotsReady.final = true;
    screenshots.push({ label: 'after-run', ...(await captureScreenshot(cdp, join(shotDir, `${scenario}-final.png`), finalRender)) });
    const checks = (finalState?.checks || []).map(check => ({ id: `scene-check-${check.id}`, label: check.label || check.id, status: ['passed', 'failed', 'not-exercised'].includes(check.status) ? check.status : 'not-exercised', detail: check.detail }));
    if (scenario === 'hunt-hit' || scenario === 'hunt-miss') {
      const before = await callVerification(cdp, 'state');
      await reloadThroughApi(cdp);
      const after = await callVerification(cdp, 'state');
      resolvedReload = { before, after };
      lifecycleChecks.push(assertion('resolved-hunt-reload', 'Reload retains the result, hunger and cooldown',
        durableSnapshotEqual(before.snapshot, after.snapshot) && after.stats?.turtle?.snaps === 0,
        `fish ${before.snapshot.fish.length} → ${after.snapshot.fish.length}; no catch replayed`));
    }
    const contextErrors = cdp.contextErrors();
    try { normalStorageAfter = await cdp.call(() => ({ value: globalThis.localStorage?.getItem('desktop-habitats/tank:v1') ?? null }), {}); } catch (error) { normalStorageAfter = { error: error.message }; }
    const assertions = makeScenarioAssertions({ initial, paused, stepped, still, played, beforeReload, afterReload, recording, normalStorageBefore, normalStorageAfter, screenshotsReady, contextErrors, apiReady, listed, timeout });
    const allAssertions = [...assertions, ...checks, ...lifecycleChecks];
    return { id: scenario, title: meta?.title || scenario, description: meta?.description || 'Scenario metadata was not supplied by the scene.', url, status: overallStatus(allAssertions), assertions: allAssertions, captures: { screenshots, recording }, metadata: finalState?.metadata || initial?.metadata || {}, states: { initial, paused, stepped, still, played, beforeReload, afterReload, final: finalState, interruptedHunt, resolvedReload, normalStorageBefore, normalStorageAfter }, events: finalState?.events || [], errors: contextErrors };
  } catch (error) {
    failure = error;
    const contextErrors = cdp.contextErrors();
    const assertions = makeScenarioAssertions({ initial, paused, stepped, still, played, beforeReload, afterReload, recording, normalStorageBefore, normalStorageAfter, screenshotsReady, contextErrors: [...contextErrors, error.message], apiReady, listed, timeout: true });
    return { id: scenario, title: meta?.title || scenario, description: meta?.description || 'Scenario metadata was not supplied by the scene.', url, status: 'failed', assertions, captures: { screenshots, recording: recording || { supported: false, reason: error.message } }, states: { initial, afterReload }, events: [], errors: [...contextErrors, error.message], error: failure.message };
  }
}

async function performanceSample(cdp) {
  const metrics = await cdp.page('Performance.getMetrics');
  const processInfo = await cdp.send('SystemInfo.getProcessInfo');
  const metric = name => metrics.metrics.find(item => item.name === name)?.value ?? null;
  const canvas = await cdp.call(() => {
    const element = document.querySelector('#scene'); const gl = element?.getContext('webgl2') || element?.getContext('webgl');
    let renderer = null; if (gl) { const ext = gl.getExtension('WEBGL_debug_renderer_info'); renderer = gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER); }
    return { renderer, hidden: document.hidden };
  }, {});
  return { time: performanceNow(), metrics: { taskDuration: metric('TaskDuration'), scriptDuration: metric('ScriptDuration') }, gpuProcessCpu: processInfo.processInfo.filter(item => item.type === 'GPU').reduce((sum, item) => sum + item.cpuTime, 0), canvas };
}
function performanceNow() { return Date.now(); }
async function runPerformance(cdp, options, output) {
  const rows = [];
  for (const scenario of options.scenarios) {
    const url = scenarioUrl(options.base, { scenario, seed: options.seed, run: options.run }); cdp.clearEvents(); await cdp.navigate(url, options); await waitForVerification(cdp);
    await resetThroughApi(cdp); await callVerification(cdp, 'play'); await sleep(options.warmup);
    const before = { ...(await performanceSample(cdp)), state: await callVerification(cdp, 'state'), stats: await cdp.call(() => typeof globalThis.habitatStats === 'function' ? globalThis.habitatStats() : null, {}) };
    await sleep(options.measure);
    const after = { ...(await performanceSample(cdp)), state: await callVerification(cdp, 'state'), stats: await cdp.call(() => typeof globalThis.habitatStats === 'function' ? globalThis.habitatStats() : null, {}) };
    await callVerification(cdp, 'pause');
    const seconds = (after.time - before.time) / 1000;
    const frames = Number(after.stats?.renderedFrames) - Number(before.stats?.renderedFrames);
    const simulationSeconds = Number(after.state?.simulationTime) - Number(before.state?.simulationTime);
    const fps = Number.isFinite(frames) && frames >= 0 && seconds > 0 ? frames / seconds : null;
    const targetFps = Number(after.stats?.targetFps ?? after.stats?.fpsTarget ?? 60);
    const errors = cdp.contextErrors();
    const hiddenOrPaused = after.canvas.hidden || after.state?.paused !== false || after.stats?.loop?.running === false;
    const status = errors.length || hiddenOrPaused || frames <= 0 || !Number.isFinite(fps) || !Number.isFinite(simulationSeconds) || simulationSeconds <= 0 ? 'failed' : 'passed';
    rows.push({ scenario, url, seconds, frames, fps, targetFps, simulationSeconds, simulationToWallRatio: Number.isFinite(simulationSeconds) && seconds > 0 ? simulationSeconds / seconds : null, renderer: after.canvas.renderer, gpuProcessCpuSeconds: after.gpuProcessCpu - before.gpuProcessCpu, mainThreadTaskSeconds: after.metrics.taskDuration - before.metrics.taskDuration, before, after, errors, status, note: 'Paced normal-clock measurement; no screenshot or video capture ran during timing.', failureReasons: [...(errors.length ? ['page errors'] : []), ...(hiddenOrPaused ? ['renderer hidden or paused'] : []), ...(frames <= 0 ? ['no rendered frames'] : []), ...(simulationSeconds <= 0 ? ['simulation clock did not advance'] : [])] });
    await writeFile(join(output, 'performance.json'), JSON.stringify(rows, null, 2));
  }
  return rows;
}

export async function run(options) {
  const harness = await startHarness(options); const output = resolve(options.out || join(ROOT, 'verification-artifacts', options.run)); await mkdir(output, { recursive: true });
  let cdp; let cleaned = false; let signalCleanup = null;
  const cleanup = async () => { if (cleaned) return; cleaned = true; await cdp?.close(); await harness.cleanup(); };
  const onSignal = (signal) => { process.exitCode = signal === 'SIGINT' ? 130 : 143; signalCleanup ||= cleanup(); };
  process.once('SIGINT', onSignal); process.once('SIGTERM', onSignal);
  try {
    cdp = await new Cdp(options.debug).connect();
    if (options.performance) {
      const performance = await runPerformance(cdp, options, output);
      const envelope = { schemaVersion: 1, generatedAt: new Date().toISOString(), commit: await gitInfo(), run: { id: options.run, mode: 'performance', seed: options.seed, baseUrl: options.base }, environment: await browserInfo(cdp, options), scenarios: performance };
      await writeFile(join(output, 'performance.json'), JSON.stringify(envelope, null, 2));
      return { output, performance: envelope };
    }
    await cdp.send('Target.activateTarget', { targetId: cdp.targetId });
    await cdp.navigate(scenarioUrl(options.base, { scenario: options.scenarios[0], seed: options.seed, run: options.run }), options).catch(() => {});
    let list = []; try { await waitForVerification(cdp); list = await callVerification(cdp, 'list'); } catch {}
    const byId = new Map((Array.isArray(list) ? list : []).map(item => [item.id, item]));
    const scenarios = []; for (const scenario of options.scenarios) { console.log(`Verify ${scenario}…`); const result = await runScenario(cdp, options, scenario, byId.get(scenario), output); scenarios.push(result); console.log(`${result.status}: ${scenario}`); }
    const checklist = await readChecklist(join(ROOT, 'docs/verification-checklist.json'));
    const report = deserializeReport({ schemaVersion: 1, generatedAt: new Date().toISOString(), commit: await gitInfo(), run: { id: options.run, mode: 'capture', seed: options.seed, baseUrl: options.base, startedWithDedicatedChrome: options.start }, environment: await browserInfo(cdp, options), coverage: checklist, scenarios });
    if (options.checks) {
      const checksPath = resolve(options.checks); const checks = JSON.parse(await readFile(checksPath, 'utf8'));
      report.verificationChecks = { source: checksPath, status: checks.status || 'unknown', commit: checks.commit, kind: checks.kind, commands: checks.commands || [] };
      for (const filename of ['test.log', 'check.log']) { try { await copyFile(join(dirname(checksPath), filename), join(output, filename)); } catch {} }
    }
    await writeFile(join(output, 'report.json'), serializeReport(report)); await writeFile(join(output, 'review.html'), renderReportHtml(report));
    return { output, report };
  } finally {
    process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal);
    await (signalCleanup || cleanup());
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    const options = parseArgs(process.argv.slice(2)); if (options.help) { console.log(help()); process.exit(0); }
    const result = await run(options);
    console.log(`Evidence written to ${result.output}`);
    if (result.report) {
      console.log(`Review: ${join(result.output, 'review.html')}`);
      if (result.report.scenarios.some(scenario => scenario.status === 'failed')) process.exitCode = 1;
    } else {
      console.log(`Performance: ${join(result.output, 'performance.json')}`);
      if (result.performance.scenarios.some(scenario => scenario.status === 'failed')) process.exitCode = 1;
    }
  } catch (error) { console.error(`Verification failed: ${error.stack || error.message}`); process.exitCode = 1; }
}

export { Cdp, captureVideo, captureScreenshot, runPerformance, DEFAULT_SCENARIOS, PERFORMANCE_SCENARIOS };
