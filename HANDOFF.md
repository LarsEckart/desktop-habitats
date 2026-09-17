# Handoff: aquarium swimming revision

This is an interactive freshwater aquarium built with WebGL2, vendored Three.js 0.180, and custom GLSL. The latest request was to fix rigid, rapid tail oscillation and fish that stayed in roughly the same place. The changes below are in the working tree; they have not been committed.

## Run and check

- Main checkout: `/Users/chaselean/Desktop/aquarium-shader`.
- Serve with `npm start`, or `PORT=8090 npm start`. A server was already running on 8090 during this revision. Do not stop a server someone else started.
- `npm run check` checks syntax; `npm test` runs the swimming and pointer-response regression checks.
- The Codex in-app browser runs the animation correctly. Inspect → View → Open water gives a useful close view. Reload after source edits.
- `review/` is gitignored. `review/swimming-round-1/` contains the latest independent motion review and fresh captures. Earlier scene reviews and the original brief remain under `review/`.
- `freshwater-aquarium.zip` is still the old packaged deliverable. It predates the current, behaviour, fish-lighting and swimming revisions. It has not been regenerated.

## What the investigation found

Two primary studies provided the motion reference:

- [Calovi et al., 2018](https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1005933): freely swimming rummy-nose tetras alternate brief accelerations and mostly passive glides. Changes of heading often accompany a propulsive kick; attraction and alignment both contribute to neighbour interactions.
- [Li et al., 2021](https://pmc.ncbi.nlm.nih.gov/articles/PMC7809443/): small tetras adjust the ratio of bursting to coasting, with a relatively consistent stroke during active swimming. They straighten during the coast.

These are references for the movement pattern, not measurements of this scene's bloodfin tetra. The animation is tuned for a calm aquarium, not a species-calibrated hydrodynamic simulation.

The previous model kept fish hovering for long periods (mean autonomous departure interval 40 seconds), mostly selected local trips, and paid drag with continuous tail thrust. Its shader always imposed a tail wave, even without propulsive demand. A large head-counterrotation dominated the integrated rear-body bend, producing a rigid seesaw. Pectoral motion multiplied a wrapped tail phase by a non-integer, causing a discontinuity at every wrap.

## Current swimming model

`src/fish.js` owns the behaviour, locomotion and deformation:

- `GAIT` schedules one- or two-stroke bouts, followed by a coast. A smooth envelope controls both tail thrust and the travelling body wave. Ordinary active strokes run at about 2.6–3.8 Hz, varying by individual; rest and coasting have no baseline tail oscillation. C-start escapes remain faster.
- `SWIM` integrates thrust and drag relative to the shared water current. Reduced axial drag preserves momentum between strokes; greater lateral drag limits sideways sliding through a turn. Pectoral trim is independent of tail effort.
- The shader integrates the spine's tangent to preserve body length. Wave amplitude grows through the trunk and peduncle; the head counter-moves only slightly. Tail membranes flex behind the peduncle. A separate fin phase keeps pectoral sculling smooth through tail rests and phase wraps. Body, fins and depth/shadow passes use the same deformation.
- `TURN` smooths angular velocity before applying heading changes. The body bends with path curvature, and banking is subtle. Routine departures use this steering instead of a sudden prescribed flick.
- `HOVER` makes station keeping a short pause, with an average autonomous departure interval of 4.5 seconds. Three quarters of the initial fish are already setting off. Open-water destinations span wider bounds and reject nearby targets. Most ordinary arrivals continue toward another destination without stopping.
- The full tank remains accessible, including above, inside and behind the grass. Slow investigation visits and brief rests still occur.
- Neighbour avoidance predicts closest approach over the next 1.1 seconds. Fish turn away before a close crossing, which matters with more fish travelling. Small avoidance flicks are slower than escape C-starts.
- The existing pointer model remains: a slowly approaching pointer is given room; a fast looming pointer can trigger a C-start. Alarm spreads locally and habituates. Escape thrust was adjusted for the lower axial drag.

States remain `hover`, `travel`, `settle`, `inspect`, and `escape`; a glide is part of travelling, not a separate mode. `school.fish` exposes the simulation state to the Node tests. Rendering attributes are on the named instanced meshes in the scene.

## Verification

`npm run check` and `npm test` pass. In the deterministic two-minute test:

- 23 of 24 individuals explored broadly across width, depth and height.
- 44% of travelling frames were moving with a quiet tail.
- Calm tail beats peaked at 3.81 Hz.
- The minimum sampled neighbour distance was 0.590 scene units.
- Fish visited the hardscape and travelled behind the grass; 73% of resting fish faced upstream.
- A slow pointer approach gave fish room without startling them. A lunge startled 3 fish directly and 13 including local contagion, peaking at 4.92 units/s.

The new regression checks fail against the previous committed fish implementation on tank coverage. They also guard against continuous tail motion during coasting and rapid calm tail beats.

Additional two-minute simulations at 20, 30, 60 and 144 updates/s had no nonfinite states or frames pinned to a horizontal tank boundary. Mean distance per fish was 74–77 scene units, quiet-tail coasting was 41–44% of travel, and minimum neighbour distances remained above 0.55. Scratch metrics scripts are under `/tmp/aquarium-bench/`; they are not part of the deliverable.

Fresh full-tank and close-view browser sequences were inspected for travelling body bends, quiet glides and actual displacement. One independent motion review passed at 36/40, with no confirmed issues requiring correction. Its scope was ordinary swimming and roaming; pointer escapes and every rare transition were not visually reviewed. See `review/swimming-round-1/report.md` for the captures and limitations. No new comparable unthrottled GPU benchmark was taken.

## Other scene systems

- `src/water.js` still defines one current field, shared by the CPU fish simulation and the plant/debris shaders. The preceding revision halved its speed. Flow is attenuated near the sand and in grass beds.
- `src/fish-anatomy.js` still owns bloodfin tetra geometry and tissue-aware lighting, including coloured transmission through the body wall, opaque skull/body cavity, guanine reflection, and translucent fin membranes.
- `src/main.js` owns the camera, lighting, postprocessing, input and controls. Environment and planting modules provide obstacles, landmarks and thickets.
- Earlier open issues in water volume, moss silhouette, sand sparkle, driftwood relief and foliage detail were outside this swimming task.

Keep future changes scoped. Verify visual claims in the running scene; numeric behaviour tests alone cannot establish photographic realism.
