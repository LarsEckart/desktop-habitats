# Handoff: click-to-feed pellets, and two species to add after it

Written 2026-09-17. You have no context on the conversation that produced this, so it
tries to tell you everything you need.

## The project

`/Users/chaselean/Desktop/aquarium-shader` is a freshwater aquascape rendered in WebGL2
and GLSL through Three.js: a planted riverbed with driftwood, stones, moss, a sand
channel, rivergrass beds and a shoal of 24 bloodfin tetras (*Aphyocharax anisitsi*).
Read `README.md` first. The code is written to an unusually high standard — tuning
constants live in named blocks with comments explaining the physical reason for each
group, comments cite real ichthyology by DOI, and there is no per-frame allocation.
Match that voice or the work will not fit.

`npm run check` syntax-checks every module; `npm test` runs a headless two-minute
behaviour simulation in `tests/fish-behavior.mjs` through a `three-loader` shim.

## What we were doing

Adding a feature the user asked for in these words:

> clicking down produces some tiny fish pellets, and the fish are quickly attracted and
> eat the pellets ... ensure that the movement of the fish is realistic, and that the
> feeding follows realistic fish behavior

The work is happening in a **git worktree at `/Users/chaselean/Desktop/aquarium-feeding`
on branch `feature/feeding`**. Do the work there, not in the main checkout. Nothing is
committed: `git status` in that worktree shows modified `src/fish.js`, modified
`src/water.js` and new `src/food.js`. The user has not asked for commits, so leave the
work uncommitted unless they say otherwise.

The user paused the work partway through the implementation to resume later. Nothing is
broken — it stopped at a clean boundary, and both `npm run check` and `npm test` pass in
the worktree as it stands.

## Read these before writing any code

Three documents were produced specifically to make this implementation possible. They
live in the worktree under `review/`, which is gitignored, so they are on disk but will
never be committed. They represent most of the thinking done so far and reading them is
much cheaper than rediscovering their contents.

- **`review/feeding-spec.md`** (1237 lines) — a cited behavioural specification of how
  small shoaling characins actually feed: pellet physics, the three sensory channels,
  recruitment, approach kinematics, the strike, competition, satiation, and a §9 listing
  the failure modes that would make the feature read as fake. All 46 DOIs in it were
  verified against Crossref. **This is the standard the behaviour is judged against.**
- **`review/integration-recon.md`** (698 lines) — a map of exactly where the feature
  plugs into the existing code, with `file:line` references throughout: the fish state
  machine, every branch that would silently misbehave with a new mode string, the
  rendering analysis, the test harness, and the house code conventions with quoted
  examples.
- **`review/tools/README.md`** — a capture harness built for verifying this feature.

## The capture harness — use it, it already works

`review/tools/feed-capture.mjs` launches the scene in headless Chromium with a virtual
clock, dispatches a **real** pointer event at a chosen canvas point, and captures frames
through CDP; `review/tools/sheet.mjs` assembles them into labelled contact sheets. No
production hook is needed. The three documented commands give an 8-second wide view, a
zoomed 1.5-second close view of a strike, and a 30-second arc back to normal behaviour.

This was verified working against the current scene, with samples in `review/samples/`.
The close view resolves individual tetras at 520×271 per cell — body bend, caudal fin,
red fin bases, eyes — which is enough to judge a strike. **Look at the sheets yourself
and judge them against spec §9.** The feature cannot be verified by tests alone; the
whole question is whether it looks like animals.

Things learned the hard way about measuring this project, which the harness already
encodes and you should not rediscover:

- The in-app browser pane reports `document.hidden = true` unless displayed, so
  `requestAnimationFrame` never runs there. Use Playwright from
  `~/.agents/node_modules/playwright`.
- Frame sequences need **headless** Chromium with `--use-angle=metal --enable-gpu
  --ignore-gpu-blocklist` and `Page.captureScreenshot` over a CDP session. Playwright's
  own `page.screenshot()` takes over a second per frame.
- There is no ffmpeg and no PIL on this machine. Contact sheets are composed in a blank
  Playwright page from data URIs.
- The virtual clock (an `addInitScript` replacing `requestAnimationFrame` and
  `performance.now`, stepped a fixed 16.667 ms per captured frame) is what turns a slow
  capture into a smooth 60 fps sequence. **If feeding logic ever calls `Date.now()`
  instead of `performance.now()`, it will break this.** Use the simulation's own
  `elapsed`, as the rest of the code does.
- Serve on a private port such as 8090; the user often has their own server on 8080.

## What is done

**`src/food.js` — new, and essentially complete as a module.** It owns pellet state,
physics and rendering, with no DOM dependency. Exports `createFood(scene, { thickets })`
returning `{ drop, update, pellets, take, nudge, floating, settled, stats, dispose }`.

- Rendering is an `InstancedMesh` of low-poly icosahedra with a `MeshStandardMaterial`
  wrapped by `waterLitShader`, following the existing `gravel`/`grit` pattern in
  `environment.js`. `receiveShadow = true`, `castShadow = false` (a 1 mm pellet would
  smear a blob several times its size onto the sand through the 4096 shadow map),
  `frustumCulled = false`, removal by swap-with-last and `mesh.count`.
- The physics models the thing that actually sets the pace of a feeding event: a dry 1 mm
  pellet **floats** on surface tension for seconds before it wets and lets go, with a
  standard deviation as large as its mean, and that spread is what gives the shoal time
  to gather. Once wetted it falls at terminal velocity immediately rather than
  accelerating. Settled pellets do not creep in the tank's own current — only a fish can
  move them, via `nudge`.
- `drop(point, count)` staggers entry by tens of milliseconds per pellet, which
  desynchronises every downstream timer for free, and chooses depth itself because a
  pointer can only give two dimensions.
- `take(pellet)` shrinks the pellet over about an eighth of a second rather than popping
  it, so the frame it vanishes is the frame the jaws shut.

**`src/water.js` — a small refactor, done for a real reason.** `thicketAt` and the
shelter model (now `shelteredVelocity`) were lifted out of `fish.js` into `water.js`, so
fish and sinking food feel the *same* current. Without this, food would drift off at a
different angle from the fish chasing it. `src/fish.js` was updated to import them.

**Everything verified so far:** `npm run check` passes, `npm test` passes with the
existing assertions untouched, and the capture harness produces good sheets.

## What is still open

This is the bulk of the remaining work.

1. **The feeding behaviour in `src/fish.js`.** Nothing consumes `food.js` yet. This is
   the hard part and the part the user cares about — see spec §2 through §8 and recon §3.
2. **Wiring in `src/main.js`.** A `pointerdown` handler, the raycast, and `food.update`
   in the frame loop. `main.js` is currently unmodified.
3. **Test assertions** in `tests/fish-behavior.mjs`: pellets consumed, arrivals spread
   rather than simultaneous, some strikes missing, shoal order collapsing and recovering,
   no fish stuck in the feeding mode, nothing going NaN.
4. **Visual verification and tuning** through the harness, against spec §9.

## Decisions already made — do not relitigate these

- **Instanced spheres, not points.** Recon §4 has the full comparison: real PBR lighting,
  fog, depth-write (so pellets read correctly against the sand and pick up the post
  pass), tumble, and `mesh.count` for removal, at about 960 triangles. Already built.
- **6 to 10 pellets per click**, pool capped at 48. This puts 2–4 fish on each pellet
  with a 24-fish shoal, which is the regime where competition actually happens.
- **`src/food.js` is injected into `createFishSchool`** alongside the existing
  `obstacles` / `landmarks` / `thickets`, so the headless test can feed the fish with no
  pointer event. This is why `drop` takes a point rather than an event.
- **The strike should be built from `startFlick` + `twitchProfile`**, which already means
  "the body bends into a C toward the new heading, then the tail sweeps back and drives
  the fish forward" — that *is* a strike. The peck impulse at `fish.js:800-803` is the
  precedent. Do not build a parallel system.
- **The species question is settled.** The spec warns that neon and cardinal tetras are
  litter-pickers rather than drift feeders and the model would need shifting for them.
  That caveat does not apply here: bloodfins are exactly the greedy, opportunistic
  mid-water and surface-feeding silver characin the drift-feeder model was written for.

## Traps that will bite you

These were found by reading the code carefully and are the reason the recon exists.

- **`SWIM.thrustLimit[f.mode]` at `fish.js:917` returns `undefined` for a new mode
  string, and `undefined > 0` is `false`.** A feeding fish would never start a tail beat
  and would drift toward the pellet like a balloon, with no error and no NaN to show for
  it. Recon §3 catalogues ten more silent mode branches, including `decide()` having no
  arm for a new mode (so the mode never ends) and `states[f.mode]++` writing NaN into the
  test's telemetry forever.
- **`fish.js:373-393` declares one shared set of scratch vectors for the entire school**,
  live across function boundaries — `water` is filled in `update()` and read inside
  `twitch()`, `urge` is written by the main loop then mutated by `threat()`. Borrowing an
  existing one for feeding will corrupt an unrelated behaviour in a way no existing
  assertion names. Add new named vectors to that block.
- **The pointer plane is at z = +2.6**, just inside the front glass — `THREE.Plane` with
  normal (0,0,1) and constant −2.6 is the plane z = +2.6. A horizontal surface-plane
  raycast is unusable: rays below mid-frame miss it entirely and rays just above the
  horizon hit at z = −11 and z = −145. Use the front plane for x, force y to the surface,
  and choose z yourself with jitter so pellets are not glued to the glass. Recon §1.
- **The macOS wallpaper forwards cursor position only, never clicks** —
  `wallpaper/Wallpaper.swift:144` sets `ignoresMouseEvents = true` and the injected script
  dispatches only `pointermove` and `pointerleave`. Feeding is a preview-only feature.
  Nothing breaks there *provided* the pellet update runs unconditionally in the frame loop
  and no new per-frame work is gated on `pointer` being non-null. Do not add click
  forwarding to the wallpaper; it is out of scope and the design deliberately leaves
  clicks to the Finder.

## The behaviour, in one page

The full argument is in the spec. The beats that matter most:

- **Arrival is a staircase, not an event.** Three channels with different ranges and
  latencies: lateral line catches the splash at ~4.5 u in 130–250 ms and gives direction
  but no target; vision gives a specific pellet at 3.0 u forward in ~200 ms; olfaction
  advects downstream at the current's speed and arrives 8–25 s later with no direction at
  all, so a downstream fish noses *upstream* long after. Recruitment then chains through
  the shoal like the existing alarm contagion but slower and graded, and a recruited fish
  aims at *the feeding fish*, not at a pellet it cannot see. Arrivals spread over 5–15 s.
  All 24 fish converging on one frame is the single worst failure mode.
- **The approach is two-phase**, and this is the thing most likely to be got wrong.
  Zebrafish chase *evasive* prey at 3.8 body lengths per second, but carp and tilapia
  approach *stationary* food at about 1 BL/s. A pellet is stationary. So: fast transit,
  a hard pectoral brake, then a slow deliberate stalk — because coming in fast means the
  fish's own bow wave blows its dinner away. The careful behaviour earns its own reward
  mechanically rather than by script.
- **Suction has almost no reach** — about one gape width, 0.08 u. The fish must nearly
  touch the pellet, and that constraint is what produces the sharp forward stab that
  reads as eating. Strike launch distance 0.18 u; 40–60 ms physically, rendered over
  90–120 ms to be visible at all.
- **The shoal visibly dissolves** into scramble competition and re-forms over 20–40 s.
  That ordered → disordered → ordered arc is the strongest single read of "these are
  animals."
- **Nothing snaps back.** Two decay timescales — about 25 s of intense interest and a
  200 s residual tail of sand-picking — with uneaten pellets on the substrate still
  getting picked at. Some pellets should never be eaten at all.
- **Do not load-balance who eats.** Real scramble competition is unequal; some fish
  should consistently miss out, and one fish taking three in a row is correct.

An honest note carried over from the spec: a real strike is 42 ms, which is 2.5 frames,
so rendering it over 90–120 ms is a declared concession, as is compressing a 15–30 minute
appetite envelope into 60–85 s. Spec §12 lists what nobody has actually measured, so
those numbers get tuned by eye and should not be commented as though they were cited.

## Species we plan to add next

The user asked what other species would suit the tank. The recommendation given, and the
two they chose to implement:

**Agreed for implementation:**

1. **Amano shrimp (*Caridina multidentata*).** Not a fish, and the strongest addition for
   this particular scene: `environment.js` already models moss, algal film and biofilm
   coverage per vertex across rock, wood and sand, so Amanos would be driven by geometry
   that already exists rather than needing a new field. Their motion is usefully alien —
   perched on wood picking with alternating chelipeds at 5–6 Hz, backing off, jerky bursts
   between perches. At feeding time they do the best thing in the tank: pin a pellet under
   the body and hold it while tetras try to rob them. That interaction is a direct reason
   to build them *after* the feeding feature rather than before.
2. **Apistogramma cacatuoides**, a pair, holding territory under the driftwood. The focal
   animal the scene currently lacks: territorial, holds a patch of sand near the stones,
   digs a pit, hovers on its pectorals instead of cruising, and flares at anything
   crossing the line. A completely different locomotion model from the shoal, and it gives
   the hardscape a meaning it does not have yet.

**Also recommended, not currently planned:** *Corydoras paleatus* (a group of 8) as a
sand-sifting bottom layer that would catch pellets the shoal misses, and *Otocinclus* as
leaf grazers driven by the same algae coverage field as the shrimp.

**Advised against:** anything long-finned and slow — pearl gourami, betta, fancy guppies.
Bloodfins are boisterous nippers and a real aquarist would call that mix a mistake. If a
slow vertical note is wanted, pencilfish (*Nannostomus*) hanging nose-up near the surface
are the safe version.

## Obvious next steps

1. Read `review/feeding-spec.md` and `review/integration-recon.md` in the worktree.
2. Add the feeding mode to `src/fish.js`, defending against the trap list above.
3. Wire `pointerdown` and `food.update` into `src/main.js`.
4. Extend `tests/fish-behavior.mjs`; keep every existing assertion passing. If an existing
   assertion now fails, that is a real regression in the undisturbed behaviour — fix it
   rather than loosening the assertion, and say so explicitly if you believe otherwise.
5. Capture the three contact sheets, look at them, and tune against spec §9 until they
   show what it describes.
6. Report honestly on what is not yet convincing. An accurate account of remaining
   weaknesses is worth more to this user than a claim that it is finished.

## One loose end, already filed separately

Three files disagree about the world scale: `src/water.js:14` says a scene unit is about
six centimetres, `src/stemplants.js:19` says 4.5 cm, and the morphometrics in
`src/fish-anatomy.js:11` imply about 6.2 cm. This is pre-existing, unrelated to feeding,
and has been filed as its own task. **Do not fix it as part of this feature and do not
change either comment.** Anchor feeding numbers to body lengths, as the spec does.
