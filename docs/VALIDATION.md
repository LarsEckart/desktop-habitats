# Riverscape optimization: validation record

## Bottom line

The balanced build removes **30.05% of rear ribbon leaves** and **48.64% of all plant triangles**, while retaining the foreground geometry, scene composition, 24 fish, HDR lighting and 4× MSAA. The matched software-rendering smoke comparison recorded **2.40× lower mean render service time**. This is encouraging evidence for the performance target, **not a measured Mac speedup or a guarantee across devices**.

**Approximately half the battery drain has not been measured.** Neither total-system battery drain nor the aquarium's incremental power can be derived directly from triangle, pixel or timing reductions. Native macOS compilation, runtime integration, real GPU performance and energy measurements remain to be checked on the target Mac. No FPS cap was lowered: normal wallpaper caps remain 60 fps on AC and 30 fps on battery.

## Measured on the target Mac (2026-09-18)

Apple M5 Pro, built-in 3024 × 1964 display at 120 Hz, headed Chromium through Playwright with the Metal ANGLE backend. `main` was served from a separate worktree; the branch served its balanced and reference profiles. The reference profile matched `main` within noise, so it is a fair stand-in for the original.

Render service time from `habitatBenchmark({frames: 180, warmup: 60})`, synchronous readback, device pixel ratio 2:

| CSS viewport | Original (reference) mean | Balanced mean | Ratio |
|---|---:|---:|---:|
| 1512 × 982 | 16.46 ms | 8.36 ms | 1.97× |
| 2560 × 1440 | 26.17 ms | 12.23 ms | 2.14× |

Uncapped throughput with the frame-rate limiter off: `main` rendered 72 fps at 1512 × 982 and 40 fps at 2560 × 1440; the reference profile rendered 41 fps at 2560 × 1440. With vsync on, the balanced build delivered exactly 60, 30 and 20 rendered frames per second for the matching host rates.

CPU time of the whole browser process tree per wall-clock second: stopped, `main` 0.065 s and balanced 0.009 s. Running at 60 fps, both builds use the same CPU per frame (about 0.13 s renderer, 0.14 s GPU process at a viewport where neither is GPU-bound); at full resolution `main` reads lower only because its threads block on a saturated GPU. Battery drain was not measured; halving GPU time while CPU time stays constant means the aquarium's added power drops substantially but not by half.

One correction was made after measurement: the substep loop split a frame of 16.7 ms plus timer jitter into a full step and a sliver, running the fish update twice on about half of all frames. Steps are now equal and rounded to the nearest 60 Hz count (301 steps for 301 frames).

## Actual before/after captures

[Original scene](images/riverscape-before.png) · [Balanced scene](images/riverscape-after.png)

Both are browser screenshots on the Mac above at 1512 × 982 CSS pixels and device pixel ratio 2: `main` from its own worktree, the balanced build with `?still=1`. Fish positions differ because `main` starts animating at once.

## Rendering comparison

Environment: Linux; Chromium 144; ANGLE Vulkan SwiftShader software renderer. One scene/browser was run at a time. The same 1280 × 720 viewport and DPR 2 were used. The wallpaper's uploaded settings allocate 2560 × 1440 pixels; balanced AC allocates 1600 × 900 pixels. Both retain 4× MSAA and the same HDR target format.

Each run recorded one initial frame followed by three timed frames. The initial frame was excluded from the following results. Simulation advanced by 1/60 second per timed frame. A synchronous one-pixel readback after rendering waited for submitted GPU work; every sample had a valid pixel, no lost context and WebGL error code 0. These times include rendering work and readback overhead; they are **not presented FPS**.

| Measurement | Uploaded | Balanced |
|---|---:|---:|
| Timed frame 1 | 34,335.5 ms | 15,352.0 ms |
| Timed frame 2 | 33,485.9 ms | 13,674.1 ms |
| Timed frame 3 | 32,962.6 ms | 13,022.7 ms |
| Mean | 33,594.7 ms | 14,016.3 ms |
| Median | 33,485.9 ms | 13,674.1 ms |

Mean ratio: `33594.7 / 14016.3 = 2.397×`. This corresponds to **58.3% less timed render service time** in this limited run, not the same percentage of reduced watts.

Important limitations: only three timed frames per build, one initial/warm-up frame, no confidence interval, no reverse-order repeat, and software rather than hardware rendering. The software times are extremely slow and are not representative of a real Mac. Balanced refreshed shadows on one of these three timed frames; over a longer 60 Hz simulation the intended fraction is approximately one-half. The limited cadence mix and possible warm-up effects make this a smoke comparison, not a rigorous acceptance benchmark. Use the longer, warm-up-excluded A/B procedure in [OPTIMIZATION.md](OPTIMIZATION.md) before claiming the 2× goal is met on a particular Mac.

Raw captures: [uploaded metrics](validation/baseline-metrics.json), [balanced metrics](validation/balanced-metrics.json).

## Deterministic work reductions

| Resource / work budget | Uploaded | Balanced | Reduction |
|---|---:|---:|---:|
| Rear leaves in full scene | 1,564 | 1,094 | 30.05% |
| Rear triangles | 563,040 | 87,520 | 84.46% |
| All plant triangles | 977,586 | 502,066 | 48.64% |
| AC target pixels, DPR 2 wallpaper | 3,686,400 | 1,440,000 | 60.94% |
| Battery target pixels, same viewport | 3,686,400 | 1,218,816 | 66.94% |
| Shadow-map texels | 16,777,216 | 4,194,304 | 75.00% |
| Depth-occlusion samples per output pixel | 12 | 8 | 33.33% |

These are counts or configured budgets, not energy measurements. The preview starts from a lower original 1.5× render scale; its AC pixel reduction is 30.56%, so the Retina wallpaper ratio should not be generalized to the preview.

## Automated source checks

`npm run check` and `npm test` pass. The tests cover existing feeding and fish behavior; 20/30/60 fps scheduling at 60/120 Hz display refresh; pause/resume; hidden pages; stopped scenes with no scheduled callbacks; one-off redraw; reduced motion; invalid frame rates; framebuffer limits; finite plant geometry and valid indices; rear-only thinning; unchanged foreground attributes and downstream random state.

The isolated plant test starts a fresh random stream before environment generation, so its counts are 1,536 → 1,075 rear leaves and 552,960 → 86,000 rear triangles rather than the full-scene counts above. Every foreground vertex attribute and the following shared random value match exactly between density profiles.

`swiftc -frontend -parse wallpaper/Wallpaper.swift` passes on Linux. This is a syntax check only: it does not typecheck Cocoa/WebKit/IOKit APIs, build the macOS app, or prove native timer/window behavior. `git diff --check` passes. Command output is saved in [checks.txt](validation/checks.txt).

## Real-browser lifecycle checks

A separate Chromium/SwiftShader test passed at smaller viewports with no JavaScript or shader console errors:

- Initial host rate zero draws the first picture, then leaves no rendering callback pending; positive host rates resume simulation, and zero stops it again.
- Battery/AC changes switch the framebuffer scales to 1.15×/1.25× and shadow limits to 15/30 Hz; a resize while stopped redraws once at the new dimensions.
- Visibility handling suppresses rendering even with a positive requested frame rate; Space cancels the browser loop.
- The opt-in benchmark completes with valid GPU readbacks and restores the previous paused state.

The visibility test injects `document.hidden` and dispatches a visibility event; it does not establish native WebKit occlusion behavior. The two-frame diagnostic smoke run only checks the helper itself and is not part of the comparative performance result. Full output: [lifecycle-results.json](validation/lifecycle-results.json).

## Mac acceptance still required

Build with `sh wallpaper/install.sh`. Verify first launch, Feed, Pause/Resume, unplug/replug, sleep/wake, lock/unlock, Low Power Mode, cover/uncover and multiple monitors. Then run the documented longer rendering comparison and matched power tests. The original supplied archive remains the baseline for a whole-app energy comparison. In particular, do not report Activity Monitor's relative Energy Impact as watts or as proof of half the total battery drain.
