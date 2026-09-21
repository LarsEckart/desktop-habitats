# Riverscape performance checks

## Findings

Measured on an Apple M4, macOS 26.6.2, in Chrome using ANGLE/Metal. These are
**browser measurements, not WKWebView or battery-life measurements**. The runs below
used the old defaults. After reviewing these results and matching image crops, Lars
approved 30 fps for the visible wallpaper and 1× resolution on both power sources.
The 1× trial was installed, but Lars reported moving white specks on the grass.
This may be leaf-detail shimmer; the cause has not been isolated. With his approval,
resolution returns to 1.25× plugged in and 1.15× on battery, while the visible
wallpaper keeps its 30 fps cap. 4× MSAA, particles, plants and fish behavior stay intact.
The original trial's log confirmed a requested 30 fps rate, then 0 fps while covered,
and a native frame rendered at 1920 × 1080. That verified setup, not motion quality,
sustained native frame pacing or power savings.

The strongest candidates are a 30 fps cap and lower resolution. Plants are a large
rendering cost, but hiding them is only a diagnostic test, not a proposed feature cut.
The white floating particles are a small cost, not the main problem.

### Cost per frame

Three trials per setting, each with 60 warm-up frames and 180 measured frames.
Alternate rounds reverse trial order. Each trial reloads the same seeded scene.
The viewport is 1728 × 972 CSS pixels; the preview canvas is 1728 × 901, giving a
2160 × 1126 framebuffer at the balanced 1.25 scale. MSAA stays at 4× throughout.

| One change from balanced | Mean frame service time | Reduction |
| --- | ---: | ---: |
| None | 16.74 ms | — |
| No particles | 16.22 ms | 3.1% |
| No depth shading (AO) | 16.47 ms | 1.6% |
| Shadows at 10 Hz, instead of 30 | 16.17 ms | 3.4% |
| Frozen shadows after initial draw | 15.90 ms | 5.0% |
| Resolution 1×, instead of 1.25× | 13.96 ms | 16.6% |
| Hide plants and their shadows | 11.51 ms | 31.3% |

An earlier three-round run found roughly 0.5% for particles, no clear AO saving,
15% for resolution, and 32% for plants. Small differences are sensitive to noise
and run order; do not treat the small percentages as precise savings.

Raw retained trials: [frame-cost.json](performance/frame-cost.json).

The benchmark synchronizes with a one-pixel GPU readback. It measures combined
CPU/GPU frame service time plus synchronization overhead. It does not isolate
GPU time, presentation rate, watts, or battery drain. Feature savings need not add
up. Hiding plants removes their geometry, material work and shadows together; it
does not tell us which leaf-shader detail is expensive.

The 30 fps simulation trial averages 17.67 ms **per frame**, not half the baseline.
It performs two simulation steps and refreshes shadows every frame, compared with
one step and shadows every other frame at 60 fps. It also advances twice as much
simulation time over the same frame count. The saving comes from drawing fewer
frames per second; use the paced test below to check that.

### Normal paced rendering

Three ten-second samples per setting, after three seconds of settling, with a
fresh scene each time. No synchronous GPU readback during these samples.

| Setting | Observed fps | Renderer main-thread busy time | Chrome GPU-process CPU |
| --- | ---: | ---: | ---: |
| Default | ~60 | 10.65% | 20.22% |
| 30 fps | ~30 | 7.77% | 13.07% |
| 30 fps + 1× resolution | ~30 | 7.75% | 13.29% |

30 fps cut main-thread busy time by about **27%** and GPU-process CPU time by
about **35%**. The GPU-process column is CPU time spent by Chrome's GPU process,
**not GPU hardware use**. It covers the whole dedicated Chrome instance. Lower
resolution helped frame service time but did not clearly lower these CPU measures.

Raw trials: [paced.json](performance/paced.json). A further one-round check with
the checked-in runner showed the same broad result. Pausing also produced zero
new frames over three seconds, with `running: false` and `pending: false`.

The installed wallpaper's host, WebContent and GPU processes each showed 0.0% CPU
in a spot check while covered, consistent with its logged 0 fps state. That is not
a sustained native test. A native before/after run and power measurements remain
needed before claiming battery savings.

## Measurement switches

All switches require `diagnostics=1`; without it they have no effect.

| Query | Experiment |
| --- | --- |
| `particles=0` | Skip floating flecks and bubbles |
| `ao=0` | Remove depth-shading samples; keep the final color pass |
| `plants=0` | Hide the plant mesh and its shadows; keep fish shelter behavior |
| `shadowHz=0`, `5`, `10`, `15`, `30` | Shadow refresh rate; zero freezes after the initial draw or invalidation |
| `resolution=0.75`, `1`, `1.15`, `1.25` | Internal rendering scale |
| `fps=20`, `30`, `60` | Preview frame cap; the native host still owns its rate |

Invalid values fall back to normal settings. Reload between trials. `habitatStats()`
includes the active experiments. To inspect a fixed frame without particles:

```text
http://127.0.0.1:8080/scenes/riverscape/index.html?diagnostics=1&still=1&particles=0
```

For the existing manual benchmark, call:

```js
await habitatBenchmark({ frames: 180, warmup: 60, simulationFps: 60 });
```

`simulationFps` controls this benchmark's time step; the `fps` URL option controls
the normal loop, not the unpaced benchmark.

## Repeat the comparisons

Start the local server with `npm start`. Use Node 22+ and a dedicated Chrome
profile with remote debugging enabled on port 9222. Close other animated tabs in
that instance and keep the benchmark tab visible. The runner opens its own tab
and closes it when done; it does not install or change the wallpaper.

```sh
node scenes/riverscape/tests/benchmark.mjs
node scenes/riverscape/tests/benchmark.mjs --paced
```

Results go to `habitat-perf-results.json` and `habitat-paced-results.json` in the
current working directory. Use `HABITAT_URL` for a different local server,
`CHROME_DEBUG_URL` for a different debug port, and `ROUNDS=1` for a smoke test.
The runner uses Node's built-in WebSocket support and needs no npm packages.
It explicitly pins the 1.25× baseline so these comparisons remain repeatable
if defaults change.

## Follow-up

Check whether restoring resolution removes the reported shimmer. A still-image
comparison cannot establish motion quality. If it persists, isolate leaf highlights,
thin edges and shadows before making more quality changes.

Further work, not implemented here:

1. Profile simpler plant materials and geometry rather than removing the planting.
2. Separate fish simulation from display-matrix writes so intermediate simulation
   steps do not prepare poses that never get drawn.

Do not start by removing particles or AO: their measured savings are small here.
Do not remove 4× MSAA without redesigning the leaves' quarter-sample transparency.
