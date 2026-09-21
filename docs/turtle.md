# Snapping turtle (issue 03) — implementation notes

The turtle is a bottom animal only. It does not hunt, chase fish, grow, or breed.

## Shape and draw cost

The body is smaller than the first draft and starts in the open sandy foreground. Its
silhouette uses traits that should survive desktop scale:

- a low, rough shell with three rows of raised scutes;
- a long tapered tail with a jagged top ridge;
- broad feet with three pale claws each;
- an angular head with a separate lower jaw, brow plates, gold eyes, and black pupils;
- separate neck and head pivots.

Small parts use vertex colours in merged geometry. The turtle adds exactly three meshes:
one merged body, one neck, and one merged head. All three cast shadows, for at most three
beauty draws and three shadow draws when shadows refresh. `tests/turtle.mjs` enforces this
budget. This is a code-level budget, not a measured frame-time claim.

## Pure movement model

`src/turtle-simulation.js` has no Three.js or browser import. It accepts plain obstacles,
a random source, bounds, and an injected ground-height sampler. It returns a full pose:
body place and heading, neck yaw, head yaw, head pitch, and the world-space footprint.
`src/turtle.js` only builds the Three.js view and applies that pose.

The turtle rests for 70–220 seconds of running simulation time, then makes a 0.32–0.72
unit shuffle at 0.28 tank units per second. It plans a short local arc from its current
heading and checks the swept body poses before starting. This avoids choosing a valid but
unreachable distant pose that needs a broad turn in the narrow foreground strip. If forward
arcs do not fit, it can take a short backward step without turning its whole body around.
That modest reverse is a deliberate simple bottom-turtle behavior, not full pathfinding.
Route search runs only when a rest ends; a fully blocked pose retries after at most eight
running seconds. The head scans and dips while it rests. Local `+x` is forward, so head
pitch turns around local `z`; local `x` would roll the head.

A zero time step changes no timer, mode, body part, or footprint. The existing frame loop
therefore freezes the turtle while paused, hidden, asleep, stopped, or under reduced
motion, with no catch-up. During an ordinary rest, the simulation reuses one pose and its
contact records. It changes only the three head/neck numbers and does not sample terrain
or allocate a fresh footprint each step.

## Placement, terrain, and scenery

The allowed bounds are the edges for the **whole animal**, not its centre. The strip lies
in the bare foreground channel, away from the planted side beds. Three hand-picked,
side-on poses make the first placement visible. If none fits, the model tries checked
random poses and then a fixed grid. It throws if no whole-body pose exists rather than
putting the turtle through scenery.

Nine oriented discs cover the shell, full tail, four separate feet, neck, and the maximum
head/neck sweep. Initial placement, fallback, target choice, turning, and every move step
check every disc against:

- the full tank bounds, inset by that disc's radius;
- turtle-only hardscape bounds plus a 0.12-unit gap;
- the rendered sand-height sampler.

The turtle hardscape does not replace the fish obstacle data. Each rock circle encloses
all transformed vertices of that rendered rock. Low wood circles come from grouped rings
of the rendered branch geometry, including low roots that fish do not treat as obstacles.
The grouping keeps the list small while enclosing the visible vertices in each group.

Terrain uses the same `sandHeight()` function as the rendered riverbed. Each footprint
disc samples its centre and eight perimeter points. The body sits 0.015 units above the
highest sample. This is a useful contact check and a small visual margin, not a proof about
every point of each curved procedural patch. If the next movement pose is blocked, the
turtle stops and rests instead of forcing a clipped pose.

## Saved state

The durable turtle record stays `{ "id": "..." }`. Place, pose, and rest/shuffle phase
remain live state, just as fish swimming positions do. New v3 tanks start with one turtle
id. A v1 or v2 tank has no turtle field; the live layer creates one and saves it at once.
Later starts restore that same id, so they do not add another turtle. Fish records do not
change.

## Checks

`tests/turtle.mjs` covers:

- the Three-free simulation seam;
- curated initial placement and deterministic fallback;
- every rendered body/head vertex inside the footprint across head/neck pose extremes;
- whole-envelope bounds, obstacle clearance, and sampled terrain support on every step;
- the live environment's rendered sand and turtle-only rock and low-wood output;
- actual movement, not just a valid stationary pose, in that live hardscape;
- 20–28 minute production-tuning runs with the real default seed and three other seeds,
  checking every started shuffle moves and movement continues after ten minutes;
- repeated rest → shuffle → rest transitions;
- complete-pose freeze at `dt = 0` and cached terrain contacts during rest;
- a downward world-space snout dip and independent head/neck pivots;
- manual matrix refresh after the scene-wide matrix freeze;
- saved identity, old fish-only tanks, and unchanged fish;
- the three-mesh and three-shadow-caster budget.

Automated tests cannot prove that the animal reads well on screen or that the frame time is
small. Those need the browser and wallpaper visual/performance checks.
