import assert from 'node:assert/strict';
import { renderSettings, framebufferSize } from '../src/render-policy.js';
import { createFrameLoop } from '../src/frame-loop.js';

const { measurementOptions, measurementSettings } = await import('../src/measurement-options.js');
const experiment = (s) => measurementOptions(new URLSearchParams(s));
assert.deepEqual(experiment('particles=0&resolution=1&fps=30'), {});
assert.deepEqual(experiment('diagnostics=1&particles=0&ao=0&plants=0&resolution=1&shadowHz=0&fps=30'),
  { particles: false, ao: false, plants: false, resolution: 1, shadowHz: 0, fps: 30 });
assert.deepEqual(experiment('diagnostics=1&resolution=NaN&shadowHz=&fps=999&particles=oops'), {});
const original = renderSettings();
assert.deepEqual(measurementSettings(original, {}), original);
const trial = measurementSettings(original, { resolution: 1, shadowHz: 0, ao: false });
assert.equal(trial.resolution, 1);
assert.equal(trial.shadowHz, 0);
assert.equal(trial.aoSamples, 0);
assert.equal(trial.samples, 4);
assert.equal(original.aoSamples, 8);

const reference = renderSettings({ profile: 'reference', wallpaper: true, pixelRatio: 2 });
const balanced = renderSettings({ wallpaper: true, pixelRatio: 2 });
const battery = renderSettings({ wallpaper: true, pixelRatio: 2, onBattery: true });
assert.equal(reference.resolution, 2);
assert.equal(balanced.resolution, 1.25);
assert.equal(battery.resolution, 1.15);
assert.equal(balanced.samples, 4, 'Preserve quarter-coverage foliage translucency');
assert.equal(balanced.shadowSize, 2048);
assert.equal(balanced.shadowHz, 30);
assert.equal(battery.shadowHz, 15);
assert.equal(renderSettings({ profile: 'typo' }).name, 'balanced');
assert.equal(renderSettings({ profile: 'reference', pixelRatio: 3 }).resolution, 1.5);
assert.equal(renderSettings({ profile: 'reference', wallpaper: true, pixelRatio: NaN }).resolution, 1.5);
assert.equal(framebufferSize(0, 900, 1.25), null);
assert.deepEqual(framebufferSize(1280, 720, 1.25), {width:1600,height:900,scale:1.25});
assert.deepEqual(framebufferSize(10000, 5000, 2, 8192), {width:8192,height:4096,scale:0.8192});

// Virtual time, a real refresh cadence, and separate timer/rAF queues. A stopped
// scene must have no callbacks at all, not just an early return inside a live rAF.
function harness(fps = 30, refreshHz = 60, paused = false) {
  let now = 0, serial = 0, callbacks = 0;
  const tasks = new Map(), frames = [];
  const period = 1000 / refreshHz;
  const add = (fn, due) => { const id=++serial; tasks.set(id,{fn,due}); return id; };
  const loop = createFrameLoop((dt,t) => frames.push({dt,t}), {
    fps, paused, clock:()=>now,
    requestFrame: (fn) => add(fn, (Math.floor((now + 1e-6) / period) + 1) * period),
    cancelFrame: (id)=>tasks.delete(id),
    delay: (fn,ms)=>add(fn,now+ms), cancelDelay:(id)=>tasks.delete(id),
  });
  function advance(ms) {
    const end = now + ms;
    for (;;) {
      let next = null;
      for (const entry of tasks) if (!next || entry[1].due < next[1].due) next = entry;
      if (!next || next[1].due > end + 1e-6) break;
      tasks.delete(next[0]); now=next[1].due; callbacks++; next[1].fn(now);
      assert(callbacks < 100000, 'Unexpected busy loop');
    }
    now=end;
  }
  return {loop,frames,tasks,advance,get callbacks(){return callbacks;}};
}
for (const refresh of [60,120]) for (const fps of [20,30,60]) {
  const h=harness(fps,refresh);h.advance(10000);
  assert(Math.abs(h.frames.length - fps * 10) <= 1, `${fps} fps at ${refresh} Hz: ${h.frames.length}`);
  const simulated = h.frames.reduce((sum,f)=>sum+f.dt,0);
  assert(Math.abs(simulated - (10 - 1/refresh)) < 0.06, `Clock drift: ${simulated}`);
  h.loop.dispose();assert.equal(h.tasks.size,0);
}
const h=harness(30);
h.advance(1000);h.loop.setPaused(true);
const before=h.frames.length, callbacks=h.callbacks;
h.advance(60000);assert.equal(h.frames.length,before);assert.equal(h.callbacks,callbacks);assert.equal(h.tasks.size,0);
h.loop.invalidate();h.advance(100);assert.equal(h.frames.length,before+1);assert.equal(h.frames.at(-1).dt,0);assert.equal(h.tasks.size,0);
h.loop.setPaused(false);h.advance(100);assert(h.frames.length>before+1);assert(h.frames.every(f=>f.dt<=0.1));
h.loop.setRate(0);assert.equal(h.tasks.size,0);h.advance(10000);assert.equal(h.tasks.size,0);
h.loop.setRate(30);h.advance(100);h.loop.setHidden(true);const hiddenFrames=h.frames.length;
h.loop.invalidate();h.advance(10000);assert.equal(h.frames.length,hiddenFrames);assert.equal(h.tasks.size,0);
h.loop.setHidden(false);h.advance(100);assert(h.frames.length>hiddenFrames);assert.equal(h.frames[hiddenFrames].dt,0);
h.loop.setRate(NaN);assert.equal(h.tasks.size,0);
h.loop.setRate(30);h.advance(100);h.loop.dispose();h.loop.invalidate();assert.equal(h.tasks.size,0);
const still=harness(0);still.advance(100);assert.equal(still.frames.length,1);assert.equal(still.tasks.size,0);
const reduced=harness(60,60,true);reduced.advance(1000);assert.equal(reduced.frames.length,1);assert.equal(reduced.tasks.size,0);

// ---- Finding 4: a real stall is a scheduler gap, not a long frame. A blocked main thread,
// a throttled tab or a sleeping display can leave seconds since the last draw; the loop must
// deliver dt = 0 for that gap rather than clamp it to 0.1 s (which would burst simulated age
// and fish forward). Normal 20/30/60 fps intervals — at most 0.05 s — are untouched, as the
// pacing assertions above already pin down. Drive the loop's parked callback by hand so the
// wall clock can be leapt by exactly 5 s between two consecutive frames.
function stallDriver() {
  const state = { now: 0, callback: null };
  const frames = [];
  const loop = createFrameLoop((dt, t) => frames.push({ dt, t }), {
    fps: 30, clock: () => state.now,
    requestFrame: (fn) => { state.callback = fn; return 1; },
    cancelFrame: () => { state.callback = null; },
    // Run the timer-body immediately: it clears the loop's timer and hands control back to
    // requestFrame, so the parked slot always holds the real frame closure. This keeps every
    // fire() a single frame regardless of which scheduling branch the loop chose.
    delay: (fn) => { fn(); return 1; },
    cancelDelay: () => { state.callback = null; },
  });
  return {
    loop, frames,
    fire(t) { state.now = t; state.callback(t); },
  };
}
const stall = stallDriver();
const periodMS = 1000 / 30; // a 30 fps frame, in milliseconds
let at = 50; // the loop's clock (and now) is in milliseconds
for (let i = 0; i < 30; i++) { stall.fire(at); at += periodMS; }
const typical = stall.frames[stall.frames.length - 1].dt;
assert.ok(typical > 0 && typical <= 0.05,
  `a normal 30 fps interval is preserved (dt=${typical})`);
// Leap 5 real seconds (5000 ms) to the next parked frame: the gap is discarded entirely.
stall.fire(at + 5000);
const stalled = stall.frames[stall.frames.length - 1];
assert.equal(stalled.dt, 0, "a 5 s stall yields dt = 0, never a clamped 0.1 s");
at += 5000 + periodMS;
stall.fire(at);
assert.ok(stall.frames[stall.frames.length - 1].dt > 0, "30 fps resumes normally after a stall");
stall.loop.dispose();
console.log('PASS: render budgets, zero-size/large targets, 20/30/60 fps pacing at 60/120 Hz, stop/resume, reduced motion, hidden invalidation, zero idle callbacks and stalled-frame discard');
