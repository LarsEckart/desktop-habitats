# Fish state and saving: how it works

What a tank remembers between restarts, where it keeps it, and the best-effort rules
behind it.

## The saved record

A save keeps only each fish's durable identity — nothing about swimming. Per fish:

- **id** — an opaque, unique string (`fmuavn2jp-1-go6zqu`). Never an array index, because
  later issues remove fish and an index would change meaning while a saved fish still
  claimed it. Nothing parses the id.
- **species** — a short stable key (`bloodfin-tetra`), never a display name or index, so
  renaming a label can never re-home somebody's fish.
- **age** — seconds of *running simulation time* since birth. It advances only while the
  tank actually draws, rounded to the millisecond on the way onto disk so float drift never
  accumulates.

Everything else — position, pose, the pellet being chased — is rebuilt fresh on load. The
school in `fish.js` adopts a saved population and `snapshotPopulation()` hands the durable
record back. `tank-state.js` owns the format; `tank-storage.js` owns where the bytes go.

## Validation safeguards

Each save carries `version` (now `1`). A reader refuses a version **higher** than it knows
and starts a fresh tank rather than guess. It also refuses malformed records: a non-object,
a population that is not an array, missing fields, duplicate or blank ids, an unknown
species, or an invalid age. Bounds guard the extremes: `MAX_SAVED_FISH` (128) caps the
population, and `MAX_AGE_SECONDS` (~10 years) caps age so a corrupt `1e308` can never
overflow to Infinity. Parsing and validation are coercion-free and never throw — a hostile
object id, for example, is refused by type check rather than `String`-coerced. Extra fields
on a record are accepted and discarded, so a newer version degrades gracefully.

## Version migration (next feature)

v1 requires **exactly `DEFAULT_COUNT` (24) fish**. Variable restored counts — births — are
deliberately out of scope for v1 and deferred to a version migration. The next feature that
allows more (or fewer) restored fish **must** bump `SAVE_VERSION` to `2` **and** keep the
reader able to accept v1: it must still parse v1 records and preserve each fish's saved
**id** and **age**. Bump `SAVE_VERSION` in `tank-state.js` whenever the *meaning* of a
saved record changes (not just the count check).

## Where a tank lives on each host

| Host | Storage | Notes |
| --- | --- | --- |
| Browser preview | `localStorage["desktop-habitats/tank:v1"]` | per browser *origin* |
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
  exact-24 v1 count rule and the `MAX_SAVED_FISH` cap; `roundAge` never returning Infinity;
  unsafe `parse` returning null.
- `tests/tank-save.mjs` — a saved population restores stable ids/species/ages; age
  advances only while `dt > 0`; a live snapshot round-trips through both adapters (browser
  `localStorage` and a fake WebKit host bridge) with read/write failures resolving to a
  fresh tank or a refused save rather than crashing, each host id isolated.
- `tests/render-policy.mjs` — the stall rule: a 5 s scheduler gap delivers `dt = 0` while
  normal pacing is preserved.
- `wallpaper/tests/main.swift` (via `wallpaper/tests/run.sh`) — the AppKit-free lifecycle
  helpers: the one-shot `Finish` gate (flush timeout cannot be followed by a stale save)
  and the `LifecycleCoordinator` rebuild/terminate state machine. Gated to macOS by
  `uname`; off Mac it prints SKIP and succeeds while all JS runs.
- `npm run check` — every `src` file parses; the Swift typecheck (`wallpaper/tests/check.sh`)
  runs on macOS and is likewise gated off Mac.

Actually exercised (real browser, parent's check):

- Rate-0 (`habitatRate(0)`) flushes a full snapshot; a stopped tank advances no age with no
  pending callbacks; a reload `?still=1` restored **exact 24 records**.

Only manual (Mac wallpaper integration, **not** yet run):

- Reconnecting a display to its own tank after a replug/rebuild; two displays keeping
  separate tanks.
- Rate-0, close/rebuild and quit flushing latest age through the real Swift bridge;
  resized-to-zero, context-lost and hung-view save paths on hardware.

The storage *format* logic is fully unit-tested headless; the host glue (WebKit message
bridge, display UUIDs, atomic Application Support writes) can only be exercised by the real
app.

## Files

- `src/tank-state.js` — format: create, validate, parse, serialize; v1/version rules.
- `src/tank-storage.js` — host adapters: browser localStorage, host bridge.
- `src/fish.js` — adopts a population; tracks age; `snapshotPopulation()`.
- `src/main.js` — loads a population; initial/periodic/lifecycle saves; `habitatSnapshot`.
- `src/frame-loop.js` — the 100 ms stall rule that never turns a gap into simulated age.
- `wallpaper/Wallpaper.swift` — `TankStore` (Application Support, display→tank mapping),
  state injection, `tankSave`, stop+snapshot teardown.
- `wallpaper/Lifecycle.swift` — AppKit-free `Finish` gate and rebuild/terminate machine.
- `wallpaper/tests/check.sh` / `run.sh` — macOS-gated typecheck and lifecycle tests.
