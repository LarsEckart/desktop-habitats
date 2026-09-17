# Handoff: aquarium realism revision

This file is for an agent with no context on the previous sessions. It describes the state of the interactive WebGL freshwater aquarium in this repository after the third revision round, what was verified, what is still open, and how to continue.

## What we were doing and why

The project is a realistic, interactive 3D freshwater aquarium preview (WebGL2, Three.js 0.180 vendored in `vendor/`, custom GLSL). The original brief is `review/original-request.md`; the reference photo is `assets/reference.png`. Round 1 delivered a working scene judged far from photographic (`review/round-1/report.md`, 19/40). Round 2 added the water model, living grass, moss, particles and bending fish, and rebuilt the fish anatomy and the plants with parallel agents.

Round 3 (this session) had four goals from the user:

1. Slow the current by half.
2. Make the fish behave like real fish: schooling, free roaming through the whole tank including behind the rivergrass, responding to each other, and being pushed a little by the current.
3. Replace the pointer response. The fish used to swing away from the pointer "like a compass needle"; real fish do not.
4. Light the fish as small, slightly translucent animals, with some parts more opaque than others.

Everything was to be grounded in physical or biological models rather than visual hacks. The fish behaviour, the current and the pointer model were done in the main tree; the fish lighting was done by an Opus agent in a worktree and merged (only `src/fish-anatomy.js`).

## Where things are

- Main checkout: `/Users/chaselean/Desktop/aquarium-shader`, branch `main`. All work is committed on `main`.
- The lighting agent's branch `agent/fish-light` (commit 9f5bb96, worktree `/tmp/aquarium-wt-light`) was merged by taking its `src/fish-anatomy.js`; the worktree and branch were removed afterwards.
- Scratch tooling (not part of the repo, may be gone): `/tmp/aquarium-bench/` holds `capture.mjs` (stills of a view), `frames.mjs` (timed frame sequences at about 9 to 30 frames a second, with optional pointer scripts `slow`, `lunge`, `both`), `sheet.mjs` (contact sheets, optional `CROP=x,y,w,h`), `bench.mjs` (runs the app's 15 s measurement), `stats.mjs`, `trips.mjs` and `close.mjs` (behaviour statistics from the simulation alone). Captures from this round are under `/tmp/aquarium-bench/seq/` and `/tmp/aquarium-bench/merged/`. The lighting agent's rig (eight fish at fixed yaws under the real lights, before/after comparisons) is under `/tmp/aquarium-light-bench/`.
- `review/` is gitignored and holds the original request and the earlier critic reports. `freshwater-aquarium.zip` in the repo root is the packaged deliverable from round 2; it was not regenerated this round, so it predates all of this work.

## How to run and measure

- Serve: `npm start` (Node 24; `PORT=8090 npm start` to pick a port). The user often runs their own server on 8080; use another port.
- Checks: `npm run check` (syntax of every `src/*.js`) and `npm test` (120 simulated seconds of fish behaviour, then a slow pointer approach and a pointer lunge; see `tests/fish-behavior.mjs`).
- Capturing: the in-app browser pane of Claude Desktop never runs the frame loop, and Playwright screenshots of a headed window take over a second each. What works: headless Chromium with the GPU on (`--use-angle=metal --enable-gpu --ignore-gpu-blocklist`) and `Page.captureScreenshot` over a CDP session, which gives 9 to 30 frames a second depending on the view. The DevTools screencast is too slow on this page. There is no ffmpeg or PIL on the machine; contact sheets are composed in a blank Playwright page from data URIs.
- Measuring: use headed Chromium with `--disable-frame-rate-limit --disable-gpu-vsync`, set `#resolution` to 1 for the comparable 1920x1001 figure, then click `#measure`. Read frame throughput as the real number; the GPU-time line overlaps frames and reads high with vsync off.

## Architecture after this round

- `src/water.js`: one water model for the whole tank. The current is now defined once, in `CURRENT` (mean strength and three travelling waves), and both the GLSL (`currentStrength`, plus `currentTravel`, its time integral, which the debris rides) and the CPU function `currentVelocity(p, t, out)` are generated from it. `CURRENT_SPEED` converts strength to scene units per second; the open-water mean is about 0.26 units/s (a scene unit is about 62 mm, so about 1.6 cm/s). `surfaceLightGLSL` and `waterLitShader` are unchanged.
- `src/foliage.js`: the strand wave frequencies were halved with the current. `src/environment.js`: the debris uses `currentTravel` instead of its own copy of the current's coefficients.
- `src/fish.js`, rewritten around a physical locomotion model:
  - Swimming is thrust against drag (viscous plus pressure terms, mass one), integrated on the velocity relative to the water; the water velocity from `currentVelocity`, reduced near the sand and inside the grass beds, is added to move the fish. The tail thrusts along the heading; pectoral sculling gives a small thrust in any direction. Tail-beat frequency and amplitude follow propulsive thrust, not speed, so a coasting or carried fish does not thrash.
  - Sensing: neighbours within about three body lengths except in a blind cone behind, plus a lateral-line range at which anything is felt. Boids: separation, alignment with neighbours that are moving, cohesion only when left behind.
  - Modes: `hover` (station keeping with a slowly drifting station, Poisson twitches, excursions every forty seconds or so per fish), `travel` (to a destination: mostly a hop of a few body lengths in the open water, sometimes into or behind a grass bed, sometimes anywhere), `settle` (coasting to a stop with fins spread), `inspect` (as before: hold off a landmark or a grass spot and peck), `escape`.
  - One flick primitive serves twitches and C-starts: stage one bends the body into a C toward the new heading while the head swings, stage two is the propulsive stroke, and a C-start adds a burst then coasts. Rheotaxis is emergent: a hovering fish can only hold station by swimming into the flow, so it turns upstream; twitches are biased upstream when the fish has swung off it.
  - Threat model: the pointer (position and velocity from `main.js`) is read by its looming rate, closing speed over distance. Above a threshold, and in view, it fires a C-start away from the pointer with a chance per second rising with the looming rate. Below it, the fish's station is moved away so it gives room calmly. Each startle raises the fish's threshold for a while (habituation, 25 s decay). A startled fish startles neighbours within about two units after a 40 to 130 ms latency, in roughly the same direction (escape contagion). Recruits of a departing neighbour do not recruit further, which bounds group departures.
  - Telemetry: `states` (hover, travel, settle, inspect, escape), `twitching`, `pointerResponses` (direct startles), `escapes` (all C-starts).
- `src/fish-anatomy.js` (lighting agent): light transport through the body wall. The path length is the section width at the fragment (`vSkinPoint.z`, the rest position), attenuated per channel (blood and myoglobin pass red), masked by the silvered body cavity, the skull and the vertebral column with a faint myomere chevron, with the gill chamber as the one warm window through the head. A per-light term (Lambert at the entry face, a Barré-Brisebois lobe on a wrap floor) and a view-independent ambient term carry it. The guanine reflector thins toward the tail and blocks part of the transmission. Fin membranes use the same transport; ray bones read as dark striations when backlit.
- `src/main.js`: the pointer object is `{ position, velocity }`, velocity smoothed over events and decayed once events stop. The behaviour readout lists the new states and both startle counts.

## What is done and verified

- `npm run check` and `npm test` pass. The test reports about 92% of hovering fish within 60 degrees of upstream after a minute, 2% or more of fish-frames behind the grass, a minimum sampled spacing near half a unit, a slow approach that gives room without a C-start, and a lunge that startles a few fish directly and more through contagion, peaking above 4 units/s.
- Simulation statistics over four minutes (`/tmp/aquarium-bench/stats.mjs`, with the test's landmark set): hover 60%, travel 32%, inspect 6%, settle 2%; 17% of fish-frames behind the grass; cruising ground speed about 0.56 units/s; hover tail-beat effort mean 0.26; about 14 twitches per fish per minute; every trip arrives.
- Visual checks from captures: the shoal holds into the current facing left with a spread of headings; fish pass behind grass blades; a pointer lunge produced a flash expansion of the central group within a third of a second and a settled shoal within three seconds; a slow pointer approach moved the nearby fish off without darting; hovering fish show small alternating tail flexes between frames 70 ms apart. The lighting agent's rig comparisons are at `/tmp/aquarium-light-bench/cmp-*.png`.
- Performance: 154.7 fps average at 1920x1001 (the previous round measured 158 to 161; the difference is within the run-to-run spread). The fish update is 24 fish with an O(n^2) neighbour loop and is not measurable.

## Key decisions and things that did not work

- "Slow the current by half" was read physically: the flow speed halved, so the strand drag and the wave frequencies halved with it, and the debris now moves at the water's own speed (half its old pace).
- Boid alignment with hovering neighbours dragged travellers down to half speed; alignment now counts only neighbours that are moving.
- A recruitment cascade (recruits recruiting) put the school in travel 60% of the time; recruits no longer recruit, and destinations are local hops so trips are short.
- Fish converging on nearby goals came within a third of a unit; any non-escaping fish that is crowded now flicks away (rate limited), which is also what real fish do.
- After a C-start, the coasting fish used to pivot slowly toward upstream with a full C-bend, the "compass needle" look in another guise. Coasting fish hold their line; reorientation happens later, from hover, and the body curvature of a slow pivot is read against a floor speed so it stays modest.
- Braking thrust no longer counts as tail effort (a braking fish spreads its fins; it does not beat its tail).
- Pointer avoidance as a steering force fought the station trim and did nothing; moving the station itself works.

## Open items and next steps

- A fresh independent critic round on the merged scene; nothing after the round-2 verdict has been independently judged.
- Rheotaxis is strong (about 90% of hovering fish within 60 degrees of upstream). If the school reads too uniform, lower `TURN.hoverRate` further or widen `HOVER.turn`.
- Real tank fish approach a still hand at the glass expecting food. A low-rate "approach a still pointer" behaviour would fit the inspect machinery (an interest at the pointer) and was left out to keep the threat model clean.
- The lighting agent noted that `vSkinPoint` is pre-instance-scale, so a large fish transmits as if it were scale 1.0 (about 8% short in path length); not visible at scene scale.
- Water volume, moss silhouette, sand sparkle, driftwood relief, the foliage `distance` offset and `veinHeight` requests, and the dashed-highlight artifact from round 2 remain untouched.
- `freshwater-aquarium.zip` (about 150 MB) is tracked in git and is now stale; regenerate it from the working tree if a packaged build is wanted, or move packaged builds out of the repository.

## Conventions

- Plain, short comments that explain a principle or a gotcha, not what the code does. New code should look native to the existing modules.
- Every visual claim should come from a capture of the running scene; every performance claim from the app's own 15 s measurement in an unthrottled browser.
- The user's harness notes live in `~/.agents/` (crafts for code and writing); read `crafts/code.md` and `crafts/writing.md` before larger changes.
