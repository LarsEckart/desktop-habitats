# Handoff: aquascape and atmosphere

This is an interactive freshwater aquarium built with WebGL2, vendored Three.js 0.180, and custom GLSL. The latest request was to make the composition, the wood, stones and plants and their density, arrangement and amount, genuinely pleasing to the eye at the standard of a professionally arranged riverbed aquascape, without being too clean. The composition revision is complete and packaged in `freshwater-aquarium.zip`.

## Run and check

- Main checkout: `/Users/chaselean/Desktop/aquarium-shader`.
- Serve with `npm start`, or `PORT=8090 npm start`. Servers were already running on 8080 and 8090 from this checkout during this revision. Do not stop a server someone else started.
- `npm run check` checks syntax; `npm test` runs the swimming and pointer-response regression checks.
- The in-app browser was verified running during wrap-up. Earlier sessions sometimes stalled while its pane was hidden; Claude used headless GPU Chromium for the saved captures. `review/composition-round-1/` holds the reference images, before, pass and after captures and `report.md`. Earlier reviews remain under `review/`, which is gitignored.
- `freshwater-aquarium.zip` contains the current runtime, assets, checks, documentation, and composition references and final captures. Earlier review history remains in the local checkout.

## The composition

The layout is a concave riverbed. A pale sand channel runs in from the front glass a little left of centre and curves back toward the foot of the wood, narrowing as it goes. The trunk rises from behind a main stone on the right, crosses the open water to the upper left, and a forward limb leaves the moss clump toward the glass. A secondary stone about two thirds the size of the main one answers it across the channel on the left, with a low companion behind each and small stones trailing along the banks. Tall rivergrass walls both sides, tallest at the ends of the tank and stepping down toward the channel; a short shade-grown stand carries the planting under the dark pocket of open water at the back of the middle. Anubias holds the left corner and creeps over the left stones, Echinodorus the right corner beyond the main stone, and bronze crypts line the banks. Sediment gathers at the stone bases and along the banks and thins in the channel. A few dead leaves lie on the sand.

Most changes are layout data. The revision also adjusts stone grain, moss shading, stem-plant lighting and dieback, and the shadow-camera coverage:

- `src/math.js`: `channel(x, z)` is the channel mask, 1 on the centreline; `groundHeight` dips along it. Sediment, sand algae, and the sand's lighting all read it.
- `src/environment.js`: `ROCKS` with per-stone `lean`, `rockCenterY` (the one owner of how deep a stone sits, also used by the epiphytes), `BRANCHES` with `obstacle` and `landmarks` flags, `MOSS_COLONIES`, the shelter and sediment densities, and rejection-sampled pebbles and grit. Stone texture repeat scales with stone size.
- `src/plants.js`: `BEDS` and `grassHeight` place rosettes in clumps with a height gradient; `THICKETS` are the fish's grass volumes and must follow the beds; `fallenLeaf` makes the dead leaves. `tests/fish-behavior.mjs` imports the same `THICKETS` so its fixture cannot drift from the scene.
- `src/broadleaf.js`: `plantForeground` holds the Anubias, epiphyte, Echinodorus and crypt tables. Epiphytes reference `ROCKS` by index; crypts skip spots inside a stone footprint, Echinodorus does not, so keep them clear of the main stone by hand.
- `src/stemplants.js`: `BANDS`; the centre band is the shaded group, with two lower midground mounds. Per-band canopy height keeps short plants leafy.

If you move a stone, move its moss colony, fern tuft and any epiphyte with it. If you move the trunk's first point, the sand shelter follows automatically.

## Verification

`npm run check` and `npm test` pass. At 1920×1001 with the frame limiter off in headed Chromium on the M5 Pro, the scene runs at 133 fps average, 125 fps at the 95th-percentile frame time, GPU 13.7 ms; the previous revision measured 155–160 fps, so the denser beds cost about 15%. The final captures in `review/composition-round-1/after/` were inspected at native resolution; see `report.md` there for the critique and subsequent fixes. The independent review scored the earlier pass 23/40 (FAIL); Claude addressed its main findings afterwards, but that revision has not received another independent score. The report records this distinction.

## Other scene systems

- `src/fish.js` owns behaviour, locomotion and deformation; `src/fish-anatomy.js` the geometry and skin. Both unchanged this round. Fish avoid the stones, the trunk and the forward limb, and visit stone and wood landmarks derived from the layout.
- `src/water.js` defines the one current field shared by the fish simulation and the plant and debris shaders.
- `src/main.js` owns the camera, lighting, postprocessing, input and controls. The camera was not moved.
- Earlier open issues in water volume, moss silhouette, sand sparkle, driftwood relief and foliage detail were outside this task. The dark backboard behind the open centre is still a flat plane; adding depth remains a possible future visual task. The bright patch at its lower right was fixed by extending the shadow-camera frustum.

Keep future changes scoped. Verify visual claims in the running scene; numeric behaviour tests alone cannot establish photographic realism.

## Wrap-up verification

On 2026-09-17, `npm run check`, `npm test`, and `git diff --check` passed. The live full view rendered without browser console warnings or errors. The behaviour test still covers two simulated minutes with all 24 fish exploring width, depth and height. The test now imports the scene’s grass volumes instead of duplicating them.

## Atmosphere pass

The final atmosphere pass triples suspended debris from 260 to 780 flecks while keeping 120 plant bubbles. The flecks have a finer size distribution and softer opacity. `scene.fog` in `src/main.js` provides a faint green-blue tint that strengthens with viewing depth. `surfaceLightGLSL` in `src/water.js` adds broad, spatially varying illumination with periods of roughly 43 and 86 seconds and a combined amplitude bounded by 3.6%. It uses the same paused clock as the current and fish. The existing render passes and composition remain in place.

Atmosphere captures and verification are in `review/atmosphere-round-1/`.

The atmosphere passed one independent review (36/40, scoped to this pass). Pause captures were byte-identical three seconds apart and resume worked. Syntax, fish-behaviour and diff checks passed; browser warning/error logs were empty.
