# Verification workbench

The four features have implementations. That is not the same as accepting every behavior.
This workbench gives us repeatable conditions, real-render evidence, and a short review
for the parts a test cannot judge.

The [acceptance map](verification-checklist.json) covers all 36 checks in the four issue
docs. It is a work list, not a record of passing tests. Evidence belongs to a particular
source revision, run, and environment. Leave checks open until the evidence supports them.

## The daily loop

Use Node 22+ and an installed Chrome/Chromium. No npm install is needed.

```sh
# Unit/integration tests and Swift typechecks, with saved logs and provenance.
npm run verify:checks

# The short first review: real hunt hit and miss, state checks, screenshots and video.
npm run verify:hunts

# All named scenarios, with optional automated-check evidence attached.
npm run verify -- --checks verification-artifacts/checks/verification-checks.json

# Timing is a separate run, without video or screenshots during measurement.
npm run verify:performance
```

The browser commands start a temporary local server and dedicated Chrome profile. They
never use your everyday browser profile. They stop their own processes when finished.
Set `CHROME_BIN` if Chrome is not in its usual location. `--headful` displays the dedicated
browser; the npm shortcuts use it so visual evidence does not depend on headless rendering.

Each capture run writes `report.json`, `review.html`, screenshots and WebM clips under
`verification-artifacts/<run-id>/`. Open `review.html`, or serve the repo with `npm start`
and open that file's localhost URL. Keep a run's files together: the report links to the
clips and images. Generated evidence is not committed.

Useful runner options:

```sh
node tools/verification/run.mjs --help
node tools/verification/run.mjs --start --headful \
  --scenario hunt-hit,hunt-miss --seed 42 --duration 6000 --out verification-artifacts/my-review
```

`--no-video` can help diagnose recording support, but does not count as visual evidence.
A smoke run is not acceptance of all four features. Failure to load, assertion failures,
and page errors must remain visible rather than becoming a green report.

## Detect a test browser left running

```sh
npm run verify:doctor
npm run verify:doctor -- --watch
npm run verify:doctor -- --json
```

This read-only check looks for this repo's old `/tmp/habitats-chrome` profile and the
new runner's `/tmp/desktop-habitats-verification-*` profiles. It flags browser age over
20 minutes, a missing runner parent, software-rendering flags, and aggregate CPU over
200% (roughly two fully used cores). These are warnings, not proof of a leak: a deliberate
long run can be healthy. Other Chrome profiles and normal browsers are ignored.

Watch mode polls every ten seconds; Ctrl+C stops it. It never kills anything. Confirm the
shown PID and profile before stopping a process. A browser detached from its runner can
keep animating indefinitely, especially with SwiftShader doing GPU work on the CPU.
The new runner must also clean up after normal completion, failure, Ctrl+C and termination.

## Explore a scenario yourself

Start `npm start`, then open:

```text
http://127.0.0.1:8080/scenes/riverscape/index.html?diagnostics=1&verify=1&scenario=hunt-hit&seed=42&run=manual
```

Both `diagnostics=1` and `verify=1` are required. Normal preview and wallpaper pages do
not load the workbench. Controls offer scenario selection, play, pause, one simulation
step, reset, save, and reload.

- **Reset** discards only this verification fixture's saved progress and starts it again.
- **Reload** saves this fixture and restores its lasting state, not the interrupted pose.
- **Step** advances a bounded number of fixed simulation ticks while playback stays paused.
- **Play** uses the ordinary frame loop. It does not speed up a strike for the recording.

Verification saves use their own namespace, including scenario, seed, and run ID. They
must never read, overwrite, or clear normal browser saves or a wallpaper host's tank.
A scenario prepares conditions; the real school and turtle code still resolve behavior.
Deliberate stimuli, such as moving prey to cause a miss, appear in the event log and
metadata. Such clips prove behavior under prepared conditions, not natural event frequency.

### Named scenarios

| Scenario | Purpose |
| --- | --- |
| `fresh` | New population and a single turtle |
| `legacy-save` | Older save migration without losing fish |
| `growth` | Baby growth state and size compared with adults |
| `full-tank` | Population cap, crowding, and a timing workload |
| `turtle-rest` | Shape and idle head motion |
| `turtle-walk` | Movement, gait, and ground contact |
| `turtle-breathe` | Rise, surface breath, and glide |
| `hunt-hit` | Tracking, strike, exactly one catch, hunger and cooldown |
| `hunt-miss` | Miss, retry delay, and scatter |
| `prey-loss` | Safe resolution when the selected prey disappears |
| `minimum-population` | No hunt below the protected floor |

The public development API is `habitatVerification`: `list`, `state`, `pause`, `play`,
`step`, `reset`, `save`, `reload`, and `export`. `state()` contains the durable snapshot,
checks, events, and scenario metadata. `habitatStats()` and `habitatSnapshot()` remain
available for host diagnostics. These are local development tools, not a remote control API.

## Review with Lars

Each card includes actual renderer evidence and its assertions. View clips at normal
speed and desktop scale first. Use a close-up only as a second view: a clear close-up
cannot prove that the animal reads well behind desktop icons.

For each card, choose **Looks right**, **Needs work**, or **Can't tell**, and add a note.
Feedback stays local in that browser; export it as JSON to hand it back with the evidence.
A browser that blocks local storage can still show evidence; export feedback before closing.
Visual approval does not overwrite failed automated checks.

Ask Lars about shape, motion, clarity, clipping, crowding, and pacing. Do not ask him to
count fish IDs or judge a cooldown from a clip when we can assert it directly.

A short prepared clip cannot establish that births and hunts feel rare over an hour.
Use the production-timing multi-seed tests for bounds, and a separate long observation
for that pacing judgment. Label accelerated demonstrations as accelerated.

## The real Mac host

The development app uses the same host code but a separate bundle identity, preferences,
and Application Support directory. It does not replace the installed aquarium, register a
login item, change the desktop picture, or stop the production process.

```sh
sh wallpaper/dev.sh build
sh wallpaper/dev.sh run
sh wallpaper/dev.sh export
sh wallpaper/dev.sh stop
```

The default is windowed, so it is easy to inspect without covering the desktop. Use the
script's explicit desktop mode for real desktop-level lifecycle checks; record that mode
in the evidence. Diagnostic exports must come from the current dev process and request,
not a stale JSON file. See `sh wallpaper/dev.sh help` for scenario and capture options.

Read an export without launching the app:

```sh
node tools/verification/native-export.mjs "/path/to/dev/exports/<request-id>.json"
```

This checker calls a stopped or covered scene **not exercised** for pacing, even if its
WebKit view loaded and an image was captured. One display cannot pass a two-display test.

**Live-run note:** the first dev build crashed twice at startup because its UserDefaults
suite name matched its app bundle ID. A static test now guards the corrected separate
suite name. A subsequent windowed dev run produced a fresh, error-free export and a real
WKWebView PNG, but reported host rate 0 and no running simulation while other windows
covered the desktop. The windowed dev exposure policy was then changed to use its own
window visibility. That fix has passed compile checks, **not a new live run**. Do not mark
native paced rendering, restart, or display recovery passed from this export.

### Native checklist

Keep the app in its normal dev-host mode (no verification fixture) for saved-tank and
host lifecycle tests. Fixture storage intentionally bypasses host tank writes and cannot
prove the native save bridge.

1. **Quit/relaunch:** export state, quit cleanly, relaunch and export again. Compare display
   identity, tank ID, fish IDs, turtle ID, age, and cooldowns. Allow only actual running time.
2. **Two displays:** give each dev tank distinct records; check both mappings and snapshots.
   Quit/relaunch, then unplug/replug one display. Its tank must return without changing the
   other. One screen or mocked IDs cannot pass this check.
3. **Pause and coverage:** observe the real host stop, export twice across a wall-clock wait,
   and verify simulation time, age, hunger and breeding clocks stay still. Resume and check
   that only new running time advances. Windowed-mode behavior is not proof of desktop coverage.
4. **Sleep/wake, screen lock, and Low Power Mode:** exercise each actual system event. Check
   the stop/resume state, saved clocks and lack of catch-up. If we cannot trigger an event
   safely on this machine, record it as **not exercised** and ask Lars to run that step.
5. **Update:** rebuild only the dev bundle; its external tank store should survive. Never
   corrupt the production tank to test invalid-data recovery.
6. **Visuals and performance:** inspect real WKWebView rendering, not Chrome rendering the
   wallpaper HTML. Capture visuals separately from timing. Export viewport, resolution,
   host mode, display count, power state, and errors with results.

Do not automate screen lock, sleep, display changes, or power settings without telling the
person using the Mac. Those actions interrupt their work.

## Reading evidence honestly

| State | Meaning |
| --- | --- |
| Passed | The named check ran and its evidence supports that claim |
| Failed | A check ran and did not meet its expectation |
| Needs judgment | The evidence needs a person's visual or pacing review |
| Not exercised | No suitable run exists yet, or required hardware was unavailable |

A scenario can have passing state assertions and still need visual review. Mesh counts are
not frame-time measurements. An uncaptured paced browser run is not a battery-life test or
a native WKWebView benchmark. Timing needs a recorded workload, target rate and environment;
added cost also needs a comparable baseline.

Two original acceptance lines describe intermediate development stages: issue 01's old
starting count was replaced by issue 02's smaller tank; issue 03's “does not hunt yet” was
replaced by issue 04's hunting. The acceptance map records those replacements rather than
pretending the finished product must satisfy contradictory rules.
