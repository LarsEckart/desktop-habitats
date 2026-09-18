# Riverscape: balanced optimization

## Outcome and limits

This build targets **at least 2× rendering performance and approximately half the aquarium's incremental power consumption**, without lowering the normal 60 fps plugged-in / 30 fps battery frame-rate limits. The battery target is **not a measured result**. A software-rendered Chromium check can validate rendering and provide a limited speed comparison, but cannot establish Mac GPU performance, native WebKit behavior, or battery life. The Swift host was syntax-parsed on Linux, not compiled or run against macOS frameworks.

The existing 24 fish, feeding behavior, water model, camera, foreground planting, rock/wood/sand textures, HDR environment, tone mapping, fog and 4× multisampling are retained. The intentional visible changes are a more open rear grass bed and slightly lower sampling detail. Animation is not halved to manufacture the performance gain.

The captured results and test status are in [VALIDATION.md](VALIDATION.md).

## What changed

| Area | Uploaded version | Balanced version | Visual tradeoff |
|---|---|---|---|
| Rear ribbon leaves, full scene | 1,564 | 1,094 (30.05% fewer) | More space between leaves; clump roots and retained leaf shapes stay in place |
| Rear blade tessellation | 30 × 6 segments | 20 × 2 segments | Slightly coarser cross-section on narrow, distant leaves |
| All plant triangles | 977,586 | 502,066 (48.64% fewer) | Foreground geometry is unchanged |
| Preview resolution scale | 1.5× CSS size | 1.25× CSS size | Slightly less oversampling |
| Retina wallpaper resolution scale | 2× CSS size | 1.25× AC / 1.15× battery | Slightly softer fine detail; 4× MSAA remains |
| Shadow map | 4096 × 4096, every frame | 2048 × 2048, at most 30 Hz AC / 15 Hz battery | Less fine shadow detail and lower shadow-motion sampling |
| Screen-space depth occlusion | 12 depth taps | 8, with normalized strength and screen-space radius | Small shading differences near intersections |
| Paused browser preview | Draws the same picture repeatedly | One frame, then no render callbacks | None |
| Stopped wallpaper | Continues rAF callbacks that return early | Cancels rAF and render timer | None |
| Native pointer polling | 60 Hz, including while stopped | At most 30 Hz; none while all tanks are stopped | Cursor response sampled at most every ~33 ms |
| Native window polling / messaging | Queries per display; resends rate each second | Shares one window list; messages only on changes; no polling while deliberately paused/asleep | None |

Rear grass triangle count is 563,040 → 87,520 (**84.46% fewer**). The larger all-plant total above includes unchanged broadleaf and stem plants. Geometry counts are from the full browser scene, after environment generation. The isolated Node plant test deliberately starts a fresh random stream without the environment and therefore has slightly different absolute counts.

Thinning consumes the same procedural random values even for omitted leaves. It does not shuffle later foliage, rock placement, or fish. Tests compare every foreground vertex attribute byte-for-byte and verify the shared generator's next value. No density or geometry changes occur when plugging/unplugging, so there is no vegetation popping.

The foliage depth shader also now receives the shared water clock. It previously declared the uniform without binding it, leaving leaf shadows at time zero. The optimized shadows follow the moving leaves at the bounded cadence. The reference profile retains the old depth-clock behavior for comparison. One repeated power expression in the strand shader is factored algebraically; the current model itself is unchanged.

## Budget arithmetic—not a battery measurement

For the captured 1280 × 720 CSS viewport with device pixel ratio 2:

- Original color/depth target: 2560 × 1440 = 3,686,400 pixels.
- Balanced AC target: 1600 × 900 = 1,440,000 pixels (**60.94% fewer**).
- Balanced battery target: 1472 × 828 = 1,218,816 pixels (**66.94% fewer**).

The shadow map has **75% fewer texels**. At 60 displayed frames/second on AC, a 30 Hz shadow limit halves shadow redraw frequency. On battery the existing 30 fps cap is retained, with 15 Hz shadows. At lower achieved frame rates, the actual redraw fraction depends on elapsed simulation time; these are maximum frequencies, not a promise that every other real frame is always skipped.

The preview starts from only 1.5× rather than a Retina wallpaper's 2×, so its pixel reduction is smaller: **30.56% on AC**. A universal 2× speedup cannot be inferred from the Retina pixel arithmetic. Likewise, fewer triangles or texels are work reductions, not measured watt reductions. The `low-power` context preference is a browser hint, not a guaranteed GPU choice.

## Reproduce a visual comparison

Run `npm start` and use the scene paths directly (the root page redirects to the preview):

```text
/scenes/riverscape/wallpaper.html?quality=reference&still=1
/scenes/riverscape/wallpaper.html?still=1
```

The reference profile restores the original density, framebuffer, shadow and occlusion budgets, but shares the new scheduler and static-transform optimization. For a whole-app energy A/B comparison, use the uploaded original app instead of the reference profile.

Use the same viewport and display scale for both. `still=1` starts at simulation time zero, keeping the fish and current phase aligned. The wallpaper page intentionally starts with a zero frame rate until a host calls `habitatRate(...)`; one initial picture is still rendered. The regular `index.html` preview animates normally and retains Space/F and click-to-feed.

The screenshots in `docs/images/riverscape-before.png` and `riverscape-after.png` were captured on the target Mac from `main` and from the optimized build respectively, both at 1512 × 982 CSS pixels and device pixel ratio 2. See [VALIDATION.md](VALIDATION.md) for the measurements taken alongside them.

## Run an on-device rendering benchmark

Open only one test tab at a time. Use the same Mac, browser version, viewport, display scale, power source and thermal state. Do not compare one build on an integrated GPU with another on a discrete GPU without recording that difference.

Load the reference scene:

```text
/scenes/riverscape/wallpaper.html?quality=reference&still=1&diagnostics=1
```

Run in that page's JavaScript console:

```js
const reference = await habitatBenchmark({frames: 180, warmup: 60, simulationFps: 60});
JSON.stringify(reference, null, 2);
```

Save the JSON, close the reference tab, then load:

```text
/scenes/riverscape/wallpaper.html?still=1&diagnostics=1
```

Run the same call. For the battery comparison, call `habitatPower(true)` before benchmarking **both** profiles and use `simulationFps: 30`. This keeps the simulated animation and shadow cadence comparable. Repeat in reverse order. Compare `reference.meanMs / balanced.meanMs`; a value of 2 or more meets the rendering-service-time goal for that configuration. Review median, p95 and individual samples as well.

The benchmark includes scene rendering, simulation, shadows, MSAA resolve and post-processing. A synchronous one-pixel readback waits for submitted GPU work to complete; timing only the JavaScript `render()` calls would not be a reliable measure of GPU completion. Readback adds overhead and removes normal CPU/GPU overlap, so **these measurements are not normal displayed FPS**. Warm-up samples are excluded. Hidden tabs, lost contexts and readback errors abort rather than reporting misleading timings. No diagnostic readbacks or sample arrays run in normal use.

`habitatStats()` is also available without diagnostics. It reports actual target dimensions, geometry counts, shadow draws, rendered frames and loop state. Draw counts span both the scene and post passes, rather than resetting between them. When paused/stopped, `renderedFrames` should stop increasing and `loop.pending` should be false after the initial or resize frame.

## Verify native behavior and energy on the Mac

Reinstall from this folder with `sh wallpaper/install.sh`. Check first launch, Feed, Pause/Resume, unplug/replug, sleep/wake, lock/unlock, Low Power Mode, covering/uncovering the desktop, and every connected display. These native integration checks still require macOS.

For energy, compare the original installed app and this build under the same screen brightness, display count, visible desktop area, power source and workload. Allow warm-up and thermal settling; measure several minutes per run and repeat in reverse order. Include a paused/still-wallpaper baseline. Record both the app and its WebKit/GPU subprocesses, not only the small Swift host process.

Activity Monitor's Energy Impact is a **relative measure**, not watts. It is useful for checking the direction of a change but must not be reported as a measured 50% battery-drain reduction. To validate the energy target, use comparable power/energy measurements on the Mac and subtract the still-wallpaper baseline: `(optimized power - idle power) / (original power - idle power) ≈ 0.5`. For a literal total-system battery-drain claim, compare total discharge under otherwise matched conditions instead; a 50% reduction in the aquarium's added power need not halve the machine's total consumption.

## Checks

```sh
npm run check
npm test
```

The tests cover existing fish behavior and feeding; render budgets; frame caps at 60/120 Hz; stop/resume, hidden pages, reduced motion and zero scheduled idle callbacks; zero-size/oversized framebuffers; finite geometry and valid indices; ~30% rear-only thinning; unchanged foreground attributes and random state. The shader and visual smoke checks are described in the accompanying validation results.

## Implementation references

The implementation was also checked against the project's bundled Three.js r180 source.

- Three.js renderer controls, shadow map settings and multi-pass statistics: https://threejs.org/docs/pages/WebGLRenderer.html
- Three.js render-target settings: https://threejs.org/docs/pages/RenderTarget.html
- Apple's Mac timer-efficiency guidance: https://developer.apple.com/library/archive/documentation/Performance/Conceptual/power_efficiency_guidelines_osx/Timers.html
- Apple's definition of Activity Monitor energy metrics: https://support.apple.com/guide/activity-monitor/view-energy-consumption-actmntr43697/mac
