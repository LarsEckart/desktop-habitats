# Handoff: aquarium realism revision

This file is for an agent with no context on the previous session. It describes the state of the interactive WebGL freshwater aquarium in this repository after the second revision round, what was verified, what is still open, and how to continue.

## What we were doing and why

The project is a realistic, interactive 3D freshwater aquarium preview (WebGL2, Three.js 0.180 vendored in `vendor/`, custom GLSL). The original brief is `review/original-request.md`; the reference photo is `assets/reference.png`. The first delivery worked but was judged far from photographic (see `review/round-1/report.md`, 19/40).

The user asked for a revision with six goals:

1. Ambient particles: small bubbles and drifting debris that catch the light.
2. Moss and algae on the log, rocks and sand, in patches with varying degrees of growth.
3. Rivergrass that sways softly in flowing water instead of standing rigid, and lets light through because the leaves are thin.
4. Fish that bend like real fish, twitch while holding station, and also swim freely, into the vegetation, investigating rocks, wood and grass.
5. Performance headroom, including halving the rivergrass thicket.
6. Later guidance: emphasize lighting and natural principles (plant growth and anatomy, fish curiosity and boid behaviour, stiffness, how foliage responds to force, light scattering) rather than visual hacks, and rebuild the weakest elements (the foreground plant clumps, the fish design) with parallel Opus agents.

## Where things are

- Main checkout: `/Users/chaselean/Desktop/aquarium-shader`, branch `main`. All work in this round is committed on `main`.
- Agent worktrees (may still exist; safe to delete with `git worktree remove --force <path>` and `git branch -D agent/<name>`):
  - `/tmp/aquarium-wt-fish` on branch `agent/fish`: fish anatomy and skin (`src/fish-anatomy.js`).
  - `/tmp/aquarium-wt-plants` on branch `agent/plants`: foreground broad-leaf plants (`src/broadleaf.js`).
  - `/tmp/aquarium-wt-stems` on branch `agent/stems`: background stem plants (`src/stemplants.js`).
  The worktrees were seeded by copying the main tree's working files at the time, not by committing, so their branches have no commits of their own. Only the module each agent owned was taken back into `main`.
- Scratch measurement scripts (not part of the repo, may be gone): `/tmp/aquarium-bench/bench.mjs` (runs the app's own 15 s measurement in headed Chromium and prints fps and GPU ms), `shots.mjs` (captures the four inspection views), `sequence.mjs` (timed frame bursts with optional crop), `ui-check.mjs` (exercises pause, panel, views, pointer). They import Playwright from `~/.agents/node_modules/playwright`. Before/after captures from the session are under `/tmp/aquarium-bench/` (`before/`, `step1/` ... `step7/`) and may be gone.
- `review/` is gitignored. It holds the original request, the round-1 critic report and captures, and the first revision's verification notes. The packaged deliverable `freshwater-aquarium.zip` in the repo root is tracked in git and was regenerated at the end of this round from the working tree (source, vendor, assets, review notes).

## How to run and measure

- Serve: `npm start` (Node 24; `PORT=8081 npm start` to pick a port). The user often runs their own `python3 -m http.server 8080` from this folder; it was unresponsive during the session, so use another port.
- Checks: `npm run check` (syntax of every `src/*.js`) and `npm test` (120 simulated seconds of fish behaviour: bounds, spacing, all five states, landmark visits, pointer disturbance and recovery).
- Measuring: the in-app browser pane of Claude Desktop reports `document.hidden = true` unless displayed, so the scene's frame loop never runs there and the 15 s measurement never completes. Headed Playwright Chromium works, but only with `--disable-frame-rate-limit --disable-gpu-vsync`; without those flags every page is paced at exactly 30 fps. Read frame-rate throughput as the real number; the GPU-time line from timer queries overlaps frames and reads high when vsync is off.

## Architecture after this round

- `src/water.js`: one water model for the whole tank. `currentGLSL` is the current field (mean flow along `FLOW_DIRECTION` with a slow travelling gust and finer eddies). `surfaceLightGLSL` is the overhead light after refraction through a rippled surface (focusing from the divergence of refracted rays, with depth absorption stronger in red). `waterLitShader(shader, { perLight })` wraps any Three.js lit material so every direct light passes through this model, by redefining `RE_Direct` after `lights_physical_pars_fragment`; it is idempotent.
- `src/math.js`: `GeometryBatch.vertex(p, uv, color, anchor, strand, thin)` with `strand = { direction, tangent, distance, compliance }` and `thin` for translucency.
- `src/foliage.js`: the strand model in the vertex stage (drag bend growing with the square of distance from the root and saturating, plus a root-to-tip travelling wave; the slope rotates the shading normal), the submerged leaf material (low specular because leaf and water have similar refractive index; per-light thin-leaf transmission with a green-weighted spectrum; alpha-to-coverage held to exact quarters so the driver never dithers), and the `blade`, `stem`, `stemStrand` generators.
- `src/plants.js`: layout only. Rivergrass rosettes (age model: older leaves longer, paler, leaning downstream, browning tips), ferns, and `THICKETS` (the two grass beds as volumes fish may enter). Calls `plantForeground` from `src/broadleaf.js` and `plantStems` from `src/stemplants.js`.
- `src/environment.js`: sand, rocks, driftwood, gravel and grit as before, plus moss: `mossCoverage` gives per-vertex growth from light exposure (upward faces), shelter (rock pits, bark splits, sand near hardscape or under the back planting) and colony centres (`MOSS_COLONIES`, where an aquascaper would tie moss on); the surface materials carry a moss layer (young olive film to dark velvety turf, roughness 1, grazing-angle sheen, fine noise fringe); `plantFronds` scatters about 3,500 instanced fronds by weighted sampling where turf is dense. Particles: shadow-lit debris riding the current and bubbles rising from the plant beds and the substrate, drawn as points with the key light's shadow map sampled in the vertex shader. Returns `obstacles` and `landmarks` (rock tops, points along the trunk).
- `src/fish-anatomy.js`: geometry, part ids and skin shader. Forward axis +X, snout near x = 0.35, tail near x = -0.45, length about 0.8 before instance scaling.
- `src/fish.js`: `bendSpine` integrates a planar spine curve whose curvature is a turning term (yaw rate over speed, clamped, lagged) plus a propulsive wave growing toward the tail; cross-sections stay rigid and normals rotate with the frame. Behaviour: hover with twitches, wander within the open water with group departures, dart, brake, and `inspect`: curiosity builds while hovering and sends up to `MAX_EXPLORERS` fish to a landmark or a point inside a grass bed, where they hold off it, face it, and peck. `BOUNDS` is the whole water column above the sand (`groundHeight` + clearance); `OPEN` is where the school prefers to hold.
- `src/main.js`: camera, lights (hemisphere 0.3, key 4.5 with a 4096 shadow map, fill 0.44, back 0.8 so back-lit leaves read as translucent), PMREM environment, post pass (depth occlusion, vignette), controls, measurement with GPU timer queries.

## What is done and verified

- Baseline before this round: about 158 fps unthrottled at 1920x1001 on the M5 Pro (6.3 ms per frame). Shadows cost about 1.4 ms, 4x MSAA about 1.9 ms, the foliage about 2.4 ms; halving the grass returned about 1.2 ms.
- After the main-tree work (before the agents' modules): 175 to 179 fps at the same resolution; `npm test` and `npm run check` pass; the controls, pause, inspection panel, views, resolution switch and pointer disturbance were exercised with a Playwright script and produced no console errors.
- Visual checks were made from Playwright captures of the four inspection views and timed sequences (grass sway between frames, fish bending through turns, moss distribution). The in-app browser pane could not be used for live checks.
- Three Opus agents rebuilt one module each in worktrees, and only those modules were merged:
  - `src/fish-anatomy.js`: bloodfin tetra (*Aphyocharax anisitsi*) from published morphometrics; 21-station body spline, eye at 39% of head length seated in the body surface, mouth cleft and lip, opercular step, ray-fan fins with correct fin formulae plus an adipose fin (part id 12), guanine flank band with capped metalness and iridescence, 34x11 scale rows expressed mostly in roughness and normal, fins as hyaline membranes with branching rays. 9,444 vertices per fish. `applySkin` now applies `waterLitShader` itself with a fin-transmission term, so fish.js must not apply it again (it is idempotent anyway). Materials carry `defines.FISH_OPAQUE` and `defines.FISH_MEMBRANE`; do not replace `material.defines`.
  - `src/broadleaf.js`: Anubias barteri (rhizome colonies on sand and epiphytes gripping rocks), Echinodorus (bottom right), Cryptocoryne wendtii (midground and front skirt). One `bladeSurface` sweeps a lamina along a midrib with cupping, keel, undulation, bullate pucker, twist and furl; age drives size, colour, browning, algae spots, holes and torn margins; blades roll to catch the most light; petiole-to-blade motion blends continuously. About 121k vertices. Uses `ROCKS` exported from environment.js.
  - `src/stemplants.js`: Limnophila sessiliflora (feathery whorls, the tall side stands, turning over at the surface) and Hygrophila polysperma (opposite pairs, the shadier centre). Stem axes are growth histories (phototropic lean, downstream deflection, frozen sway), internodes walked by arc length, light as a function of absolute height, die-back low in the stand, basal branching. About 133k vertices. Called last in `createPlants` so the other species' random draws stay identical.
- An independent visual critic reviewed the main-tree state before the agents' modules were merged (report saved as `review/round-2/report.md`, gitignored): 19/40, FAIL. Its three findings were a black void behind the planting, moss reading as flat decals with confetti dots, and fish bending too subtle to see with darts too rare. In response, before the merge: a dark backboard plane at z = -7.2 that receives the planting's shadows, denser teal fog, particle size and albedo spread, olive moss film with more value variation and frond size spread, body-wave curvature raised to 0.5 + 1.7 x effort with full turning curvature, twitch-dart probability raised to 0.3, hover durations lengthened and group-departure contagion reduced. The critic has not seen the merged scene.
- Final merged state: `npm run check` and `npm test` pass; the UI script (pause, panel, views, resolution, pointer sweep) runs with no console errors; two clean measurements gave 161.4 and 158.2 fps at 1920x1001 (about 6.2 ms per frame), the same throughput as the original scene with all the new content. Foliage is about 407k vertices (was 831k). Final captures of the four views are in `review/round-2/final/` and the pre-revision captures in `review/round-2/before/`.

## Key decisions and things that did not work

- Alpha-to-coverage with a per-pixel hash dither produced visible grain, and intermediate alpha values produced a regular driver-dither grid on the broad leaves. Fix: quantize coverage to exact quarters (ribbons 0.75, their edges 0.5, everything else opaque) and drop the shadow-pass dither entirely.
- The first moss pass painted bright green patches on sand and rocks and cost about 1 ms of GPU time. Fixes: per-surface bias (sand sparser, browner film), branch out of the moss code when coverage is near zero, two noise evaluations instead of five, darker and smaller fronds concentrated where turf is dense (weight = (coverage - 0.3)^2.2).
- Water absorption was first too strong (the sand turned green); the coefficients were roughly halved.
- The 30 fps "cap" seen in the previous verification and at the start of this round was the measurement harness (Chromium's frame pacing in a Playwright window), not the scene.
- Leaf specular: submerged tissue reflects almost nothing (refractive index close to water), so clearcoat was removed and `specularIntensity` set to 0.07. This removed the plastic look more than any geometry change.
- Fish turning curvature sign: a right turn bends the tail to the left (-z); `aSwim.z` receives `-bend`.
- Kept the previous pointer interaction, telemetry, and the inspection panel; the behaviour readout gained an "investigating" count and the measurement gained GPU time.

## Open items and next steps

- Get a fresh critic round on the merged scene. The last independent verdict (19/40) predates the agents' modules and the backboard; nothing after it has been independently judged.
- Fish motion still needs a real check of tail-beat visibility at 100 ms intervals in the 2x view; the amplitudes were raised blind after the critic's finding. If the wave is still invisible while cruising, raise `0.5 + effort * 1.7` in `fish.js` or lower the head pivot stiffness. Also confirm the fin-membrane ripple applies to part 12.
- Behaviour balance: the panel often shows about half the school relocating. Real tetras hover more. Candidates: longer hover durations, smaller `wander` offsets, lower contagion.
- Water volume: the backboard and fog are a first answer to the critic's "no water volume" finding. A physically better answer is exponential (not squared) extinction plus a little in-scatter toward the lamp colour in the post pass, using the depth texture that is already bound.
- Moss: the critic wants growth with its own silhouette and contact darkening. Ideas: darken the surface under fronds (bake an occlusion term into the `moss` attribute), vary frond leaflet shapes, let the wood clump creep along the trunk rather than sit as one sphere.
- Sand: no grain sparkle at 4x, soft contacts at pebble bases. Driftwood: little surface relief. Both untouched this round.
- foliage.js requests from the plant agents not yet done: a `distance` offset on `stem`/`stemStrand` so side shoots can bend on their own while starting from the parent's displacement; a larger `veinHeight` (0.00025 to about 0.0009) so light breaks across bullate blades (check it does not roughen the grass).
- The thin-blade dashed-highlight artifact the critic saw at 2x (`dash_native.png` in its captures) was not investigated; it is probably the vein pattern aliasing on blades a few pixels wide and may need the same `fwidth` gating as the midrib.
- `freshwater-aquarium.zip` (about 150 MB) is tracked in git; consider moving packaged builds out of the repository.
- The agent worktrees under `/tmp` can be removed once their scratch pages are no longer wanted.

## Conventions

- Plain, short comments that explain a principle or a gotcha, not what the code does. New code should look native to the existing modules.
- Every visual claim should come from a capture of the running scene; every performance claim from the app's own 15 s measurement in an unthrottled browser.
- The user's harness notes live in `~/.agents/` (crafts for code and writing); read `crafts/code.md` and `crafts/writing.md` before larger changes.
