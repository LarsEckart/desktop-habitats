# Fish state and saving: how it works

What a tank remembers between restarts, where it keeps it, and the best-effort rules
behind it.

## The saved record

A save keeps only each fish's durable identity and growth/breeding state — nothing about
swimming. Per fish:

- **id** — an opaque, unique string (`fmuavn2jp-1-go6zqu`). Never an array index, because
  later issues remove fish and an index would change meaning while a saved fish still
  claimed it. Nothing parses the id.
- **species** — a short stable key (`bloodfin-tetra`), never a display name or index, so
  renaming a label can never re-home somebody's fish.
- **age** — seconds of *running simulation time* since birth. It advances only while the
  tank actually draws, rounded to the millisecond on the way onto disk so float drift never
  accumulates. A baby's growth is derived from this age; levels of maturity are mostly
  there to say when a baby is big enough to breed.
- **breedIn** — the adult's remaining breeding cooldown in running seconds (0 = ready). A
  *remainder*, not a wall-clock timestamp, so a restart continues it instead of re-firing
  the same birth.
- **adult** — `true` for a fish born full-grown (every fish from a v1 save, or a fresh
  tank), `false` for a baby born to grow. It is what keeps a migrated tank adult-sized
  even when its saved running age is tiny, and makes a baby visibly distinct from day one.

The whole tank also carries `breedIn`, the tank-level birth cooldown (one birth per
cooldown, never more than the population cap of 24), and one optional **turtle** record:
an opaque `id`, `hunger` (0–1), `feedIn` / `retryIn`, the running-second remainders of the
turtle's after-meal and after-miss cooldowns, and `breathIn`, the remainder until its next
trip to the surface (issue 04). Like a fish's `breedIn` they
are remainders, not timestamps, so a restart continues them. Turtle position, pose,
movement phase, and the hunt phase are live state and are rebuilt on load: a lunge that
was in the air at save time neither lands nor repeats. A caught fish is removed from the
`fish` array in the same call that removes it from the live shoal, so it can never be
saved twice or resurrected.

Everything else — fish position and pose, the pellet being chased — is rebuilt fresh on load. The
school in `fish.js` adopts a saved population and `snapshotPopulation()` hands the durable
record back plus the tank cooldown. `tank-state.js` owns the format; `tank-storage.js`
owns where the bytes go; `breeding.js` owns the growth and birth rules (constants and the
pure `breedMany` step).

## Validation safeguards

Each save carries `version` (now `3`). A reader refuses a version **higher** than it knows
and starts a fresh tank rather than guess. It also refuses malformed records: a non-object,
a population that is not an array, missing fields, duplicate or blank ids, an unknown
species, an invalid age, a non-numeric cooldown, or a non-boolean adult flag. Bounds guard
the extremes: the practical ceiling for a restored/rendered tank is `CAPACITY` — the
larger of `LEGACY_V1_COUNT` (24, the always-exact v1 size) and `POPULATION_CAP` (the live
birth ceiling) — with `MAX_SAVED_FISH` (128) as a redundant belt-and-braces guard, and
`MAX_AGE_SECONDS` (~10 years) caps age so a corrupt `1e308` can never overflow to
Infinity. Parsing and validation are coercion-free and never throw — a hostile object id,
for example, is refused by type check rather than `String`-coerced. Extra fields on a
record are accepted and discarded, so a newer version degrades gracefully.

Why two ceilings? The live birth machinery (`breedMany`) only ever grows a tank toward
`POPULATION_CAP`. But restore/render must be able to hold the legacy v1 population too, so
if a future tuning ever lowers `POPULATION_CAP` below the always-24 v1 count, an existing
migrated 24-fish save is still accepted by the reader (`CAPACITY` spans it) and still fits
the render buffers (`fish.js` sizes them to the same `CAPACITY`). A migrated tank that
sits above a lowered live cap simply has no room to breed and holds steady — never a
silver loss.

## Version history and migration

v3 adds the optional turtle identity. A valid v1 or v2 save has no turtle; the live scene
creates one and writes it in the startup save. A valid v3 turtle id is restored as-is.
A malformed turtle field is dropped without dropping the fish, since the turtle identity
can be replaced. The turtle clocks (`hunger`, `feedIn`, `retryIn`, `breathIn`) are optional on top of
the id, so an earlier v3 save without them still reads (the live turtle applies its default
hunger); when present each must be a finite non-negative number or the turtle record is
dropped the same way. The version stays 3 because an older reader ignores the extra
fields and cannot misread them. Other extra turtle fields are ignored.

v2 allowed variable restored counts (births) and the growth/breeding fields. A v1 save —
which always carried the old fixed
population of exactly 24 fish with only id/species/age — is migrated in `validate()`:

- every fish's saved **id**, **species**, **age** and the **count** are preserved exactly;
- the breeding fields are filled with the safe defaults (`breedIn: 0` per fish, tank
  `breedIn: 0`);
- every migrated fish is marked **adult**, so an existing tank keeps its fish adult-sized
  and breeding-ready rather than shrinking them into fry because their pre-growth running
  age happened to be small.

Because 24 is exactly the capacity floor, a migrated tank renders at the full 24 and its
birth machinery stays idle (births cap at `POPULATION_CAP`, so an update never surprises
an existing aquarium with babies). If a future tuning ever lowers `POPULATION_CAP` below
24, the renderer still keeps room for all 24 (`CAPACITY`) and the tank simply holds steady.

Tuning for the v2 growth/breeding model (all constants in `breeding.js`, easy to retune):

- `FRESH_COUNT` **8** — a brand-new tank starts with 8 adult fish, fewer than the old 24;
  existing saves keep whatever they had.
- `POPULATION_CAP` **24** — the *birth* ceiling: how many fish the breeding machinery may
grow a tank to, and how crowded it may ever be. Restore/render uses `CAPACITY = max(24,
POPULATION_CAP)`, described above.
- `MATURITY_AGE` / `GROWTH_SECONDS` **5400 s** (90 min of running time) — a baby grows
  from 40% of adult size to full size, and becomes breeding-eligible.
- `PER_FISH_BREED_COOLDOWN` **5400 s** — an adult rests before breeding again.
- `TANK_BREED_COOLDOWN` **600 s** (10 min) — at most one birth per 10 minutes of running
  time, whichever adult is ready, which is what makes births feel like occasional
  discoveries rather than a spawning burst, and guarantees the cap is never exceeded.

Growth, ages and cooldowns advance **only while the simulation runs** (`dt > 0`); there is
deliberately **no offline or catch-up** for time spent paused, hidden, asleep, or with
rendering stopped. Babies are born where their parent is, swim with size-aware spacing,
and their feeding reach and obstacle clearance scale to their small body.

## Where a tank lives on each host

| Host | Storage | Notes |
| --- | --- | --- |
| Browser preview | `localStorage["desktop-habitats/tank:v1"]` (key kept from v1 so a v1 save is found and migrated) | per browser *origin* |
| Mac wallpaper | `~/Library/Application Support/Desktop Habitats/tanks/<id>.json`, plus `displays.json` mapping displays to tank ids | outside the app bundle |

The Mac app bundle is rebuilt **from scratch** on every install, so the population lives
outside it, in Application Support, which install and uninstall never touch — so a
reinstall or update does not reset the fish. That is a host-based guarantee, not a claim
that every hardware case is "fully covered".

**Browser behavior.** Storage is keyed per *origin*, not per page or tab. Two same-origin
tabs, a reopened preview, or another page on the same origin share one key, so they share a
tank and the **last writer wins** — exactly one tank per origin, not one per window.

**Wallpaper mapping.** One window per screen, one tank per window. On startup the Swift
host resolves a stable tank id per screen from `displays.json`. The key is the display's
persistent physical UUID (`CGDisplayCreateUUIDFromDisplayID`), not the transient
`NSScreenNumber`, so a reconnected panel returns to its own fish. A screen whose display
number cannot be read gets its own unique `NSScreen`-object key (picked once for the
process lifetime) rather than a shared fallback, so unidentifiable screens never map onto
one another. Caveat: that fallback key is stable only for the `NSScreen` object's lifetime,
so such a screen starts fresh each run; full physical matching still needs the number.

The page hands saves to the Swift host through a WebKit message (`tankSave`); the host
writes the file. The wallpaper's WebKit data store is deliberately non-persistent — the
file is the only durable state.

## When saves happen (best effort, not a guarantee)

- **Startup.** A snapshot is written once the school is built, so a session that ends
  before the first periodic save still retains ids, species and age.
- **Periodic.** Every 60 s of monotonic time (`performance.now()`, never a date clock)
  while the page is visible and running (`SAVE_INTERVAL_MS` in `main.js`). A long
  closed/stalled stretch never piles up flush-work: a stopped frame loop has nothing
  periodically new to save.
- **On lifecycle, unconditionally.** When the tank stops being drawn — `visibilitychange`
  hidden, `pagehide`, `webglcontextlost`, resized to zero, manual pause, or the host
  stopping it (`habitatRate(0)`) — the page writes with `saveNow()`. This is deliberately
  separate from the periodic save, which refuses while hidden.
- **On native teardown** (wallpaper only). Before close, screen rebuild or quit the Swift
  host stops the page and pulls its latest snapshot in one evaluate —
  `habitatRate(0)` then `habitatSnapshot()` — and writes it before it closes. The write is
  bounded by a **0.5 s flush timeout** (`Finish` one-shot gate) so a hung view can never
  block a rebuild or quit; whichever of the callback or the timeout fires first wins, and a
  late callback after the timeout cannot save a stale snapshot over a newer tank. This is a
  best-effort final write, not a persistence guarantee for the whole population.

The 60 s cadence and the lifecycle saves are **best effort, not a guaranteed loss bound**:
a save can fail (quota, host unreachable, disk error) and is retried at the next save
point. A failure never stops the scene — a missing or corrupt save starts a fresh tank.

**Graceful quit ≠ surviving a kill.** The teardown flush works when the app quits through
its lifecycle state machine. It does **not** survive a hard `kill` (e.g. SIGKILL): the
process is torn down abruptly, and any async flush still in flight is lost (on top of the
0.5 s timeout). Only saves already written to disk survive such a kill.

**Stall discard.** The frame loop drops any scheduler gap over **100 ms** as `dt = 0`
(`frame-loop.js`). This keeps a throttled tab, a sleeping display or a blocked main thread
from bursting simulated age forward; the ordinary 20/30/60 fps intervals are preserved. It
also means age (and thus what a save can capture) never leaps ahead during a stall.

Failure handling: JS-side hits do log a `console.warn` and keep going; the native disk
write (`try?`) is **silent** — a best-effort write that returns without a warning when it
fails.

## Tests and what is only manual

Automated, in CI-style `npm test`:

- `tests/tank-state.mjs` — format round trips; strict coercion-free validation; the
  v1→v2 migration (ids/ages/count preserved, breeding defaults, adult flag); the
  `CAPACITY` (restore/render) and `MAX_SAVED_FISH` caps — including the fail-safe that a
  migrated 24-fish tank serializes and stays steady even under a simulated lowered birth
  cap; the fresh smaller population; `roundAge` never returning Infinity; unsafe `parse`
  returning null.
- `tests/breeding.mjs` — the pure growth curve; mature-only breeding (a baby must grow
  before it can breed); per-fish and tank cooldowns on a controlled clock with `dt === 0`
  changing nothing; cooldown *remainders* surviving a reload without a duplicate birth;
  and a hard-population-cap simulation where many ready adults still never exceed 24.
- `tests/tank-save.mjs` — a saved population (any count up to the cap) restores stable
  ids/species/ages and breeding state; age advances only while `dt > 0`; a live snapshot
  round-trips through both adapters (browser `localStorage` and a fake WebKit host bridge)
  with read/write failures resolving to a fresh tank or a refused save rather than
  crashing, each host id isolated; a fresh tank starts at the smaller population; a v1
  file migrates through the live school into a v2 save; a birth grows the live tank and
  the baby survives a save/restore.
- `tests/fish-behavior.mjs` — (plus the issue-02 section) a capped tank mixing adults and
  fry stays inside the tank, finite, feeding and avoid-collision, and the renderer draws
  exactly as many instances as fish exist.
- `tests/render-policy.mjs` — the stall rule: a 5 s scheduler gap delivers `dt = 0` while
  normal pacing is preserved.
- `tests/turtle.mjs` — v3 turtle identity round trips without changing fish; old fish-only
  records gain one id; the complete turtle pose freezes at `dt = 0`; hunger and cooldown
  remainders round-trip, a save taken mid-lunge reloads at rest without a catch, bad clocks
  drop only the turtle, and a caught fish leaves the live and saved lists together.
- `wallpaper/tests/main.swift` (via `wallpaper/tests/run.sh`) — the AppKit-free lifecycle
  helpers: the one-shot `Finish` gate (flush timeout cannot be followed by a stale save)
  and the `LifecycleCoordinator` rebuild/terminate state machine. Gated to macOS by
  `uname`; off Mac it prints SKIP and succeeds while all JS runs.
- `npm run check` — every `src` file parses; the Swift typecheck (`wallpaper/tests/check.sh`)
  runs on macOS and is likewise gated off Mac.

Actually exercised in a real browser (this issue's check):

- A fresh preview starts at **8** fish. A seeded v2 tank with 8 adults and 16 fish at
  different growth ages draws **24** fish in both preview and `wallpaper.html` in
  headless Chrome. Screenshots show clearly smaller fry and no obvious crowding in
  this starting layout. This is a browser check, not native WebKit or a long swim trial.
- The existing `habitatBenchmark` readback check ran 12 frames after 3 warmup frames:
  preview at 1600×834 averaged 48 draw calls and 1363 ms service time; wallpaper HTML
  at 1600×891 averaged 58 draw calls and 1528 ms. Chrome used **SwiftShader software
  rendering**, so these slow timings do not establish a hardware frame budget or FPS.
  Real GPU/native wallpaper performance remains unchecked. Birth timing, migration,
  actual fry bites, and pair spacing are covered by deterministic tests, not inferred
  from these screenshots.

Only manual (Mac wallpaper integration, **not** yet run):

- Visual crowding/frame-cost review of a full 24-fish tank on real hardware in both
  preview (all display modes) and the native wallpaper, including a tank that has grown
  from 8 to 24 through actual births over hours of running time.
- The tuned timing feel: births at ~10 min spacing, fry visible for ~90 min of running
  time, first birth in a fresh tank after 10 running minutes.

- Reconnecting a display to its own tank after a replug/rebuild; two displays keeping
  separate tanks.
- Rate-0, close/rebuild and quit flushing latest age through the real Swift bridge;
  resized-to-zero, context-lost and hung-view save paths on hardware.

The storage *format* logic is fully unit-tested headless; the host glue (WebKit message
bridge, display UUIDs, atomic Application Support writes) can only be exercised by the real
app.

## Files

- `src/breeding.js` — growth and breeding rules: tuning constants, `growthOf`/`sizeScale`,
  and the pure `breedMany` simulation step.
- `src/tank-state.js` — format: create, validate, parse, serialize; v1→v2 migration rules.
- `src/tank-storage.js` — host adapters: browser localStorage, host bridge.
- `src/fish.js` — adopts a population; tracks age; `snapshotPopulation()`.
- `src/main.js` — loads a population; initial/periodic/lifecycle saves; `habitatSnapshot`.
- `src/frame-loop.js` — the 100 ms stall rule that never turns a gap into simulated age.
- `src/turtle-simulation.js` — pure turtle placement, movement, footprint, pose, and hunt.
- `src/turtle.js` — the merged Three.js turtle view; saves id, hunger, and cooldowns.
- `wallpaper/Wallpaper.swift` — `TankStore` (Application Support, display→tank mapping),
  state injection, `tankSave`, stop+snapshot teardown.
- `wallpaper/Lifecycle.swift` — AppKit-free `Finish` gate and rebuild/terminate machine.
- `wallpaper/tests/check.sh` / `run.sh` — macOS-gated typecheck and lifecycle tests.
