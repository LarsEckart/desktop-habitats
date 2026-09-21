// Opt-in browser measurements, not part of npm test. Requires Node 22+ and a
// dedicated Chrome instance with --remote-debugging-port=9222. See docs/performance.md.
import { writeFile } from 'node:fs/promises';

const paced = process.argv.includes('--paced');
const base = process.env.HABITAT_URL || 'http://127.0.0.1:8080';
const debug = process.env.CHROME_DEBUG_URL || 'http://127.0.0.1:9222';
const rounds = Number(process.env.ROUNDS || 3);
if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) throw new Error('ROUNDS must be 1–10');
const { webSocketDebuggerUrl } = await (await fetch(`${debug}/json/version`)).json();
const socket = new WebSocket(webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
let serial = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  const callback = pending.get(message.id);
  if (!callback) return;
  pending.delete(message.id);
  clearTimeout(callback.timer);
  if (message.error) callback.reject(new Error(message.error.message));
  else callback.resolve(message.result);
});
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out: ${method}`));
    }, 180000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let targetId;
try {
  ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }));
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const page = (method, params) => send(method, params, sessionId);
  const evaluate = async expression => {
    const result = await page('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  await send('Target.activateTarget', { targetId });
  await page('Emulation.setDeviceMetricsOverride', {
    width: 1728, height: 972, deviceScaleFactor: 2, mobile: false,
  });
  await page('Performance.enable');
  const measure = async () => {
    const { metrics } = await page('Performance.getMetrics');
    const { processInfo } = await send('SystemInfo.getProcessInfo');
    return {
      task: metrics.find(m => m.name === 'TaskDuration').value,
      gpuCpu: processInfo.filter(p => p.type === 'GPU').reduce((sum, p) => sum + p.cpuTime, 0),
      stats: await evaluate('habitatStats()'), time: performance.now(),
    };
  };
  const variants = paced ? [
    ['60-fps', ''], ['30-fps', '&fps=30'], ['30-fps-resolution-1', '&fps=30&resolution=1'],
  ] : [
    ['baseline', ''], ['particles-off', '&particles=0'], ['ao-off', '&ao=0'],
    ['shadows-10', '&shadowHz=10'], ['shadows-static', '&shadowHz=0'],
    ['resolution-1', '&resolution=1'], ['plants-off', '&plants=0'], ['30-fps', '&fps=30'],
  ];
  const results = [];
  for (let round = 1; round <= rounds; round++) {
    // Reverse alternate rounds to reduce bias from warming and trial order.
    const order = round % 2 === 0 ? [...variants].reverse() : variants;
    for (const [name, query] of order) {
      // Keep the measured baseline at its original 1.25× even if defaults change.
      const resolution = query.includes('resolution=') ? '' : '&resolution=1.25';
      const url = `${base}/scenes/riverscape/index.html?diagnostics=1&still=1${query}${resolution}`;
      await page('Page.navigate', { url });
      let ready = false;
      for (let attempt = 0; attempt < 180; attempt++) {
        await sleep(500);
        if (await evaluate('typeof habitatBenchmark === "function"')) { ready = true; break; }
      }
      if (!ready) throw new Error(`Scene did not load: ${url}`);
      let result;
      if (paced) {
        await evaluate('document.dispatchEvent(new KeyboardEvent("keydown", {code:"Space"}))');
        await sleep(3000);
        const before = await measure();
        await sleep(10000);
        const after = await measure();
        const seconds = (after.time - before.time) / 1000;
        result = {
          seconds, fps: (after.stats.renderedFrames - before.stats.renderedFrames) / seconds,
          rendererMainThreadPercent: 100 * (after.task - before.task) / seconds,
          chromeGpuProcessCpuPercent: 100 * (after.gpuCpu - before.gpuCpu) / seconds,
          before: before.stats, after: after.stats,
        };
        if (after.stats.loop.hidden || !after.stats.loop.running || result.fps < 1)
          throw new Error('Paced trial stopped; keep the benchmark tab visible');
      } else {
        result = await evaluate(`habitatBenchmark({frames:180,warmup:60,simulationFps:${name === '30-fps' ? 30 : 60}})`);
      }
      results.push({ round, name, url, ...result });
      await writeFile(paced ? 'habitat-paced-results.json' : 'habitat-perf-results.json', JSON.stringify(results, null, 2));
      console.log({ round, name, meanMs: result.meanMs, fps: result.fps,
        mainThreadPercent: result.rendererMainThreadPercent, gpuProcessCpuPercent: result.chromeGpuProcessCpuPercent });
    }
  }
} finally {
  if (targetId) await send('Target.closeTarget', { targetId });
  socket.close();
}
