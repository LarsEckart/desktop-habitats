# Snapping turtle (issues 03 and 04) — implementation notes

The turtle is a bottom animal. It rests, shuffles short distances, hunts by ambush from
where it sits (a head-and-neck lunge, never a chase), and every so often swims up for a
breath and glides down to a new spot on the floor. It does not grow or breed.

## Shape and draw cost

The body is smaller than the first draft and starts in the open sandy foreground. Every
part is built from smooth procedural shapes rather than boxes and cones: a deformed
sphere for the shell, skull, jaw, and foot pads, and a tapering tube along a curve for
the neck, tail, limbs, and toes. The silhouette uses traits that should survive desktop
scale:

- a low shell, wider behind than in front, with a marginal lip, a serrated rear edge,
  three keels of knobbed scutes, and dented, darker seams between the plates;
- a long tapered tail with a saw-tooth dorsal ridge that shrinks toward the tip;
- stout limbs with skin folds, front elbows pointing back and rear knees forward, ending
  in broad paddle-shaped pads with five toes in front and four behind, thin webbing, and
  short curved horn-coloured claws;
- a massive, flat-crowned head, triangular from above, with bulging jaw muscles at the
  back and a sharp downturned beak hook at the front; the mouth line sits low at the beak,
  sweeps up toward the back of the head, and gapes slightly at the front to show a dark
  interior; small amber eyes sit high and forward in shallow sockets under heavy brow
  ridges, with black pupils and eyelid rims, plus warty skin on the crown, a tympanum
  behind each eye, nostrils at the beak tip, and two barbels under the chin;
- a thick, wrinkled neck that is paler underneath, with separate neck and head pivots.

Skin, shell, and horn colours are vertex colours in merged geometry, shaded darker on top
and paler below. The turtle adds exactly three meshes: one merged body, one neck, and one
merged head. All three cast shadows, for at most three beauty draws and three shadow draws
when shadows refresh. `tests/turtle.mjs` enforces this budget. This is a code-level budget,
not a measured frame-time claim.

The legs walk during a shuffle without extra meshes. The body geometry carries two morph
targets built from the same part list with the diagonal leg pairs swung forward or back
and the swinging feet lifted. `src/turtle.js` blends between them at the body-rock rate
and eases the blend in and out over about a third of a second, so legs never snap between
rest and stride. At rest both influences are zero and the mesh is the plain resting build.

`tests/turtle-preview.mjs` is a development aid, not a test. It rasterises the real
geometry to PNG views in Node, with approximate lighting, so shape changes can be checked
without a browser. The browser and wallpaper remain the only true visual checks.

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

## Breathing trips

Walking alone leaves the turtle where it started. Mapping every whole-body pose against
the real hardscape shows the floor is a few separate pockets: the foreground channel is
2.2 units wide against a 1.7-unit-wide turtle and is walled at both ends by rocks, so the
only poses there lie in one row about a unit long. Behind the wood a longer channel runs
back to the middle sand, and there is a patch in front of the right bed. None of them
connect on foot. A turtle also has to breathe, so the trip to the surface is how it moves
between them.

`breathIn` counts down in running time from a `breathMin`–`breathMax` interval (9 to 16
minutes). When it reaches zero and no hunt is under way, the turtle plans the trip before
it lifts off:

- **Landing.** A random floor position at least `landingMinDistance` from the current
  spot, checked with the full ground footprint against bounds, rocks, low wood and the
  grass beds (`beds`, rectangles never landed in), with room for at least a short step
  forward or back so the turtle is not pinned until its next breath. The landing faces the glide direction
  when that fits, otherwise the nearest yaw up to a right angle off it, because pockets
  differ in which way a turtle can lie. The first candidates come from the other half of
  the floor (front if the turtle is behind the wood, behind if it is in front), so trips
  alternate between the plainly visible foreground pocket and the larger ones behind
  rather than favouring the back by area.
- **Surface point.** Chosen per landing so that both legs are clear: the rise from the
  resting spot to the film and the straight glide from the film down to the landing. Points
  along the way between the two spots are tried first, then a ring around the body at
  growing reach. The swim uses the fish obstacle spheres (`swimObstacles`), which include
  the trunk and branches the ground circles ignore, with a body-centre clearance of
  `swimClearance`; the trunk is what divides the water above the back channel from the
  foreground and makes this pairing necessary. If no trip fits, the breath is postponed
  and tried again.

The trip itself is `mode: "swim"` with phases `rise` (paddling, nose up, toward the surface
point), `breathe` (holding with the beak just through the visible film at `SURFACE_Y`,
neck stretched a little, turning on the spot to face the way down), `glide` (legs still,
nose down along the path, levelling out for the last body length, easing in), and then
`rest` at the landing pose with fresh rest and breath intervals. Body pitch is a new pose
field, applied around the same local axis as the walking rock, and `paddle` drives the
leg morph on the way up. The film is the one the food floats on, inside the frame; the
modelled surface in `water.js` sits above it.

`TURTLE_BOUNDS` is now the whole open floor between the beds, front edge to the back stand
of short grass; the three hand-picked initial poses still start the turtle in the
foreground. Hunting is off while swimming, a due breath waits for a hunt to finish, and a
zero step freezes the trip like everything else. `breathIn` is saved as a remainder; a
reload lands the turtle on the sand.

## Placement, terrain, and scenery

The allowed bounds are the edges for the **whole animal**, not its centre. Three hand-picked,
side-on poses in the bare foreground channel make the first placement visible. If none fits, the model tries checked
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

## Hunting (issue 04)

All hunt decisions live in `src/turtle-simulation.js`, next to the movement model, with
no Three.js. `HUNT` holds the tuning. The cycle is:

1. **Hunger** rises at `hungerRate` per running second (empty to full in 50 minutes) and
   only while `dt > 0`. A new turtle starts at `startHunger`.
2. **Watch.** Once hunger passes `threshold`, both cooldowns are zero, and the tank holds
   more than `minPopulation` fish, the turtle considers prey. Each step it reads the live
   fish list (stable `sid`, `position`, relative body `size`) and picks the nearest fish
   that is no bigger than `maxPreySize`, within `trackRange` of the beak, and within
   `yawLimit` of straight ahead. Fish behind the shell are never prey.
3. **Track.** The neck and head slew toward the fish at `trackRate`. The turn is split
   between the two pivots and clamped to the anatomy's yaw and pitch limits. If the fish
   hangs in sight but wide of the lure point for `creepInterval`, a resting turtle takes one
   short shuffle toward it, choosing among the usual random arcs the one that ends nearest
   the fish. A tracked fish that leaves, disappears, or stops being suitable ends the
   hunt with no cooldown. Rest-end shuffles are postponed while a fish is being tracked.
4. **Strike.** After `aimTime` seconds lined up with the fish inside `strikeReach` of the
   aimed beak, the neck launches. Over `strikeTime` (0.2 s) the neck stretches by
   `TURTLE_ARTICULATION.stretch` along its own axis, the head pivot rides out with it, and
   the jaw gape morph opens then closes. The aim is frozen for the lunge.
5. **Resolve.** At the snap the model computes the extended world snout with `snoutAt()`
   and looks the tracked fish up by id in the current list. It is caught only if it is
   still present, within `catchRadius` of the snout, and the tank is still above
   `minPopulation`. A hit calls `onCatch(sid)`; the school removes the fish from the live
   shoal and the saved population in one call and returns `true`. A `false` return (the
   fish was already gone) is a miss. A hit lowers hunger by `meal` once and arms
   `feedCooldown`; a miss arms `retryCooldown`. Every snap calls `onSnap()` with the snout
   point, and `main.js` scatters the fish near it whether it hit or missed.
6. **Hold and settle.** The jaws stay closed for `holdTime`, then the neck retracts over
   `settleTime` and the rest sway resumes.

Snappers wait for prey to come to them, and the fish otherwise stay a body length or more
above the turtle. The school therefore treats the turtle's `lure` point as one more thing
worth a visit, alongside rocks, wood and grass. A fish that has gone to look at it holds a
little further off than it does a rock and keeps a quarter of its usual room above the
sand; the hard floor clamp is unchanged. `lureAt()` places that point ahead of and above
the beak at the middle of the strike's reach, and `turtle.lure` is a Three vector updated
in place each step so the school sees it move. Reach is measured from the *aimed* beak,
so a fish a little above the lure is still catchable; the tests place unreachable prey
well above the whole neck.

The strike changes no draw calls: the neck stretch is a mesh scale, the gape is a second
morph target on the merged head, and the three-mesh budget holds. The footprint gained two
`strike reach` discs and wider neck discs so a fully extended head turned to its limits
stays inside the envelope; the mesh test checks every neck and head vertex at every yaw
and pitch limit with the neck both resting and extended.

### Tuning

Chosen with the multi-seed population runs in `tests/turtle.mjs` and the live-tank run:

- `hungerRate` 1/3000 and `threshold` 0.6: after a meal (hunger falls by 0.85) the turtle
  wants food again about 22 running minutes later; `feedCooldown` 1800 s holds it to one
  meal per half hour at most, and in practice a fish has to wander in, so meals are rarer.
- `retryCooldown` 45 s after a miss.
- `minPopulation` 6: a fresh tank of 8 can lose two fish before hunting stops; births
  (one per 10 minutes at most) refill it.
- `maxPreySize` 1.0: the largest adults (individual scale up to 1.08) are never taken;
  babies and ordinary adults are.
- `catchRadius` 0.42 around the extended beak; `strikeReach` 0.72 from the aimed beak.

Population runs at production tuning over six hours and four seeds stayed between the
minimum and the cap with roughly one to two meals an hour once the tank had grown.

## Saved state

The durable turtle record is `{ "id", "hunger", "feedIn", "retryIn", "breathIn" }`:
identity, hunger 0–1, and the running-second remainders of the after-meal and after-miss
cooldowns and of the time to the next breath. The
hunt phase is live state and is not saved, so a reload lands the turtle at rest with its
clocks intact: an interrupted lunge can neither land its catch nor repeat, and the
cooldowns cannot be skipped by restarting. Place, pose, and rest/shuffle phase remain live
state, just as fish swimming positions do. New v3 tanks start with one turtle id. A v1 or
v2 tank has no turtle field; the live layer creates one and saves it at once. Later starts
restore that same id, so they do not add another turtle. An issue-03 record carrying only
an id reads as a turtle at the default hunger. A malformed clock drops the turtle record
without touching the fish. Fish records do not change shape; a caught fish is simply gone
from the list.

## Checks

`tests/turtle.mjs` covers:

- the Three-free simulation seam;
- curated initial placement and deterministic fallback;
- every rendered body/head vertex, including both walking morph targets, inside the
  footprint across head/neck pose extremes;
- stride morphs silent at rest, alternating during a shuffle, and adding no mesh;
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
- the three-mesh and three-shadow-caster budget;
- the hunt cycle on synthetic prey: watch → track → strike → hold → settle, one catch
  callback and one hunger drop per hit, feeding and retry cooldowns, a visible miss when
  the fish leaves as the lunge launches, tracking that ends when prey vanishes or is
  unsuitable, prey in sight but beyond reach never lunged at, a refused catch counted as a
  miss, and the creep toward wide prey;
- the protected minimum both before a hunt and again at the snap;
- a complete freeze at `dt = 0` in the middle of a lunge;
- hunger and cooldown remainders round-tripping through the save, a reload mid-lunge that
  lands at rest without a catch, and the save format's clock validation;
- the rendered snout landmark matching `snoutAt()` through a whole strike, the gape and
  neck stretch opening and closing, and no added mesh;
- the school's `remove()` (live and saved lists together, index renumbering, once only)
  and `scatter()` (nearby fish break, distant fish do not);
- a live school plus turtle for fifteen accelerated minutes: fish visit the turtle, hits
  remove exactly one fish from both counts, misses none, snaps scatter, and the count
  never drops below the minimum; and no snap at all when the tank starts at the minimum;
- six-hour accelerated population runs at production tuning across four seeds with
  births and hunts together;
- breath trips in the real hardscape: repeated trips, the beak through the film, paddled
  rise and slower glide with the matching body pitch, no intrusion into any rock or wood
  sphere, a valid level ground pose at every non-swim step, landings in more than one
  pocket and never in a bed, each trip somewhere new, and the turtle ending well away from
  its start; a due breath waiting for a hunt; a frozen glide at `dt = 0`; the breath
  remainder saved and continued; and the rendered body tilting and paddling on the rise;
- production-timing runs now also require at least one surfacing and a valid landing.

Automated tests cannot prove that the animal reads well on screen, that a strike is legible
at desktop scale, or that the frame time is small. Those need the browser and wallpaper
visual/performance checks. `tests/turtle-preview.mjs <prefix> [swing] [extend] [gape]`
renders the strike pose offline (`0 1 1` is the snap at full reach) for a first look.
