import { register } from "node:module";
import assert from "node:assert/strict";

register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { BOUNDS, COUNT, createFishSchool } = await import("../src/fish.js");
const { createPopulation } = await import("../src/tank-state.js");
const { MATURITY_AGE, sizeScale } = await import("../src/breeding.js");
const { bloodfinTetra } = await import("../src/fish-species.js");
const { createFood } = await import("../src/food.js");
const { shelteredVelocity } = await import("../src/water.js");
const { THICKETS } = await import("../src/plants.js");
const { randomGenerator } = await import("../src/math.js");

const STEP = 1 / 60;
// A full (cap-sized) adult population is used for every swimming/hunting behavior test
// because those thresholds describe a mature, settled tank. Issue 02 keeps new tanks
// smaller via the *default* (no-population) path, tested separately in tank-state/tank-save.
const FULL = () => createPopulation({ count: COUNT, age: MATURITY_AGE });
// The current sweeps, so upstream is not a fixed direction any more: it has to be read
// off the water where and when each fish is sampled.
const flow = new THREE.Vector3();
const upstream = new THREE.Vector3();
const behindGrass = (p) =>
  p.z < -2.2 && THICKETS.some((bed) => p.x > bed.minX && p.x < bed.maxX);
const insideTank = (p) =>
  p.x >= BOUNDS.minX &&
  p.x <= BOUNDS.maxX &&
  p.y >= BOUNDS.minY &&
  p.y <= BOUNDS.maxY &&
  p.z >= BOUNDS.minZ &&
  p.z <= BOUNDS.maxZ;

// Every school below runs on an explicit seeded random source (not the shared module
// global), so the whole swim/feed run is reproducible under a controlled seed without
// disturbing the default generator. The seed only seeds this school's own randomness;
// breeding remains deterministic (eldest ready adult, fixed ids) and needs no randomness.
const seeded = (n) => randomGenerator(0x5eed3000 + n);
// The school takes its visual parts and body measures from a species definition, rather
// than importing the bloodfin's shape directly. A future species can replace these hooks.
const speciesScene = new THREE.Scene();
const testSpecies = { ...bloodfinTetra, name: "Species seam test fish" };
const speciesSchool = createFishSchool(speciesScene, { species: testSpecies, population: FULL(), random: seeded(0) });
speciesSchool.update(STEP, 0, null);
assert.equal(speciesScene.getObjectByName(testSpecies.name).count, COUNT);
assert.ok(speciesSchool.fish.every((fish) => fish.position.toArray().every(Number.isFinite)));

// Two undisturbed minutes: individuals cross the tank, alternate strokes with glides,
// stay apart, investigate the planting, and face into the current during short rests.
const scene = new THREE.Scene();
const school = createFishSchool(scene, {
  obstacles: [{ center: new THREE.Vector3(1.35, 3.6, -0.65), radius: 0.6 }],
  landmarks: [
    { kind: "wood", point: new THREE.Vector3(1.35, 4.3, 0.1), obstacle: 0 },
  ],
  thickets: THICKETS,
  population: FULL(),
  random: seeded(1),
});
let visits = 0,
  behind = 0,
  mixedStates = 0,
  hovering = 0,
  facingUpstream = 0;
let travelling = 0,
  gliding = 0,
  beatingInPlace = 0,
  peakBeatFrequency = 0;
const swimAttribute = scene
  .getObjectByName(bloodfinTetra.name)
  .geometry.getAttribute("aSwim");
const tracks = school.fish.map((fish) => ({
  minimum: fish.position.clone(),
  maximum: fish.position.clone(),
  phase: fish.phase,
}));
const states = new Set();
let minimumSpacing = Infinity;
for (let frame = 0; frame < 7200; frame++) {
  school.update(STEP, frame * STEP, null);
  const currentStates = new Set();
  for (const fish of school.fish) {
    const track = tracks[fish.id];
    track.minimum.min(fish.position);
    track.maximum.max(fish.position);
    const tailAngle = swimAttribute.getY(fish.id);
    const phaseStep = (fish.phase - track.phase + Math.PI * 2) % (Math.PI * 2);
    peakBeatFrequency = Math.max(peakBeatFrequency, phaseStep / (Math.PI * 2 * STEP));
    track.phase = fish.phase;
    if (fish.mode === "travel") {
      travelling++;
      if (tailAngle < 0.03 && fish.swim.length() > 0.25) gliding++;
    }
    if (tailAngle > 0.15 && fish.velocity.length() < 0.12) beatingInPlace++;
    states.add(fish.mode);
    currentStates.add(fish.mode);
    if (fish.mode === "inspect") visits++;
    if (behindGrass(fish.position)) behind++;
    // Facing into the current only means anything while there is a current to face. The
    // sweep passes through slack twice a cycle, and the fish stop orienting below the
    // same threshold, so those frames are evidence of nothing either way.
    if (frame > 3600 && fish.mode === "hover") {
      shelteredVelocity(fish.position, frame * STEP, flow, THICKETS);
      if (flow.lengthSq() > 0.0025) {
        hovering++;
        upstream.copy(flow).normalize().negate();
        if (fish.heading.dot(upstream) > 0.5) facingUpstream++;
      }
    }
    assert.ok(
      fish.position.toArray().every(Number.isFinite),
      "Fish positions must stay finite",
    );
    assert.ok(insideTank(fish.position), "Fish must remain inside the tank");
    assert.ok(
      Math.abs(fish.quaternion.length() - 1) < 1e-6,
      "Turning must preserve a normalized orientation",
    );
  }
  if (currentStates.size > 1) mixedStates++;
  if (frame % 6 === 0)
    for (let i = 0; i < school.fish.length; i++)
      for (let j = i + 1; j < school.fish.length; j++)
        minimumSpacing = Math.min(
          minimumSpacing,
          school.fish[i].position.distanceTo(school.fish[j].position),
        );
}
assert.deepEqual(
  [...states].sort(),
  ["hover", "inspect", "settle", "travel"],
  "An undisturbed shoal uses every calm state and never a C-start",
);
assert.ok(
  mixedStates > 6500,
  "Individuals should not share one synchronized behavior cycle",
);
assert.ok(
  minimumSpacing > 0.4,
  `Neighbor avoidance must prevent sustained overlap (got ${minimumSpacing.toFixed(3)})`,
);
assert.ok(visits > 600, "Fish should spend time investigating landmarks and grass");
assert.ok(
  behind > 7200 * COUNT * 0.02,
  `Fish should spend time behind the grass (got ${behind} fish-frames)`,
);
const rheotaxis = facingUpstream / hovering;
assert.ok(
  rheotaxis > 0.55 && rheotaxis < 0.97,
  `Most, not all, hovering fish face into the current (got ${(rheotaxis * 100).toFixed(0)}%)`,
);
const roaming = tracks.filter(({ minimum, maximum }) =>
  maximum.x - minimum.x > (BOUNDS.maxX - BOUNDS.minX) * 0.45 &&
  maximum.z - minimum.z > 3 &&
  maximum.y - minimum.y > 1.5,
).length;
assert.ok(
  roaming >= COUNT * 0.75,
  `Most individuals must explore across width, depth and height (got ${roaming})`,
);
assert.ok(
  travelling > 7200 * COUNT * 0.55,
  "Free swimming should dominate over holding a fixed station",
);
assert.ok(
  gliding / travelling > 0.25 && gliding / travelling < 0.75,
  `Swimming must alternate visible strokes with quiet-tail glides (got ${(gliding / travelling * 100).toFixed(0)}% gliding)`,
);
assert.ok(
  beatingInPlace < 7200 * COUNT * 0.04,
  "Fish should rarely beat their tails while barely moving",
);
assert.ok(
  peakBeatFrequency < 4.2,
  `Calm swimming should not vibrate rapidly (got ${peakBeatFrequency.toFixed(2)} Hz)`,
);
school.dispose();

// A slow approach is read as something to keep a distance from, never as an attack.
const calm = createFishSchool(new THREE.Scene(), { population: FULL(), random: seeded(2) });
for (let i = 0; i < 480; i++) calm.update(STEP, i * STEP, null);
const subject = calm.fish[0].position.clone();
const slowPointer = {
  position: subject.clone().add(new THREE.Vector3(0.7, 0, 1.0)),
  velocity: new THREE.Vector3(-0.12, 0, -0.16),
};
const watched = calm.fish
  .filter((fish) => fish.position.distanceTo(slowPointer.position) < 1.8)
  .map((fish) => fish.id);
const distanceTo = (school, ids, point) =>
  ids.reduce((sum, id) => sum + school.fish[id].position.distanceTo(point), 0) /
  ids.length;
const before = distanceTo(calm, watched, slowPointer.position);
for (let i = 0; i < 360; i++) {
  if (i < 180) slowPointer.position.addScaledVector(slowPointer.velocity, STEP);
  else slowPointer.velocity.set(0, 0, 0);
  calm.update(STEP, 8 + i * STEP, slowPointer);
}
assert.equal(calm.getTelemetry().escapes, 0, "A slow approach must not fire a C-start");
const after = distanceTo(calm, watched, slowPointer.position);
assert.ok(
  after > before + 0.3,
  `Fish give a slowly approaching object room (${before.toFixed(2)} to ${after.toFixed(2)})`,
);
calm.dispose();

// A lunge at the glass fires C-starts in the fish in front of it, the alarm spreads to
// their neighbours, and everyone coasts and settles again.
const startledSchool = createFishSchool(new THREE.Scene(), { population: FULL(), random: seeded(3) });
for (let i = 0; i < 480; i++) startledSchool.update(STEP, i * STEP, null);
const location = startledSchool.fish[0].position.clone();
const nearby = startledSchool.fish
  .filter((fish) => fish.position.distanceTo(location) < 1.9)
  .map((fish) => fish.id);
const lunge = {
  position: location.clone().add(new THREE.Vector3(0, 0, 2.4)),
  velocity: new THREE.Vector3(0, 0, -9),
};
const passedThrough = new Set();
let peakSpeed = 0;
for (let i = 0; i < 360; i++) {
  if (i < 15) lunge.position.addScaledVector(lunge.velocity, STEP);
  else lunge.velocity.set(0, 0, 0);
  startledSchool.update(STEP, 8 + i * STEP, i < 90 ? lunge : null);
  for (const id of nearby) {
    passedThrough.add(startledSchool.fish[id].mode);
    peakSpeed = Math.max(peakSpeed, startledSchool.fish[id].velocity.length());
  }
}
const telemetry = startledSchool.getTelemetry();
assert.ok(
  telemetry.pointerResponses > 0 && telemetry.pointerResponses < COUNT,
  `A lunge startles the fish in front of it, not the whole tank (got ${telemetry.pointerResponses})`,
);
assert.ok(
  telemetry.escapes > telemetry.pointerResponses,
  "Alarm should spread from startled fish to their neighbours",
);
for (const state of ["escape", "settle", "hover"])
  assert.ok(passedThrough.has(state), `An escape should pass through ${state}`);
assert.ok(
  peakSpeed > 4,
  `A C-start should reach several body lengths a second (got ${peakSpeed.toFixed(2)})`,
);
assert.ok(
  startledSchool.fish.some((fish) => fish.mode === "hover" && fish.effort < 0.35),
  "Some fish must settle back to quiet station keeping",
);
startledSchool.dispose();

// A pinch of food on the surface: the shoal hears it land, gathers over seconds rather
// than at once, scrambles for it without holding formation, misses some of it, and comes
// back together with nothing left to chase.
const tank = new THREE.Scene();
const food = createFood(tank, { thickets: THICKETS });
const fed = createFishSchool(tank, {
  obstacles: [{ center: new THREE.Vector3(1.35, 3.6, -0.65), radius: 0.6 }],
  landmarks: [
    { kind: "wood", point: new THREE.Vector3(1.35, 4.3, 0.1), obstacle: 0 },
  ],
  thickets: THICKETS,
  food,
  population: FULL(),
  random: seeded(4),
});
// Mean distance from each of a set of fish to its nearest neighbour anywhere in the
// school: the measure of how tightly packed they are.
const spacingOf = (school, subset) => {
  let total = 0;
  for (const fish of subset) {
    let nearest = Infinity;
    for (const other of school.fish)
      if (other !== fish)
        nearest = Math.min(nearest, fish.position.distanceTo(other.position));
    total += nearest;
  }
  return total / subset.length;
};
const PINCH = 8;
const DROP = 480;
for (let frame = 0; frame < DROP; frame++) {
  food.update(STEP, frame * STEP);
  fed.update(STEP, frame * STEP, null);
}
const calmSpacing = spacingOf(fed, fed.fish);
food.drop(new THREE.Vector3(0.4, 8.2, 1.2), PINCH);
const arrivals = new Map();
const held = new Array(COUNT).fill(0);
const chasing = new Array(COUNT).fill(-1);
let crowding = Infinity,
  regrouped = 0,
  regroupedFrames = 0,
  feedingPeak = 0,
  longestFeed = 0;
for (let frame = DROP; frame < DROP + 75 * 60; frame++) {
  const time = frame * STEP;
  food.update(STEP, time);
  fed.update(STEP, time, null);
  const since = (frame - DROP) * STEP;
  for (const fish of fed.fish) {
    if (fish.mode === "feed") {
      if (!arrivals.has(fish.id)) arrivals.set(fish.id, since);
      // Time spent on one pellet, not time spent feeding. A fish working through a
      // scatter in turn is doing exactly what it should; only a fish that cannot let go
      // of a single pellet is stuck, so the clock restarts whenever the target changes.
      if (chasing[fish.id] !== fish.foodSerial) {
        chasing[fish.id] = fish.foodSerial;
        held[fish.id] = 0;
      }
      held[fish.id] += STEP;
      longestFeed = Math.max(longestFeed, held[fish.id]);
      feedingPeak = Math.max(feedingPeak, fish.velocity.length());
    } else {
      held[fish.id] = 0;
      chasing[fish.id] = -1;
    }
    assert.ok(
      fish.position.toArray().every(Number.isFinite),
      "Feeding must not put a fish position off the number line",
    );
    assert.ok(insideTank(fish.position), "A feeding fish must stay inside the tank");
  }
  for (const pellet of food.pellets)
    assert.ok(
      pellet.position.toArray().every(Number.isFinite),
      "Pellet positions must stay finite",
    );
  // How close the fish at the food let each other come, against how far apart the whole
  // shoal sits once the scramble is over.
  const scrambling = fed.fish.filter((fish) => fish.mode === "feed");
  if (scrambling.length > 2) crowding = Math.min(crowding, spacingOf(fed, scrambling));
  if (since > 65) {
    regrouped += spacingOf(fed, fed.fish);
    regroupedFrames++;
  }
}
regrouped /= regroupedFrames;
const feeding = fed.getTelemetry();
assert.ok(
  food.stats.eaten > PINCH / 2,
  `Most of a pinch of food should be eaten (got ${food.stats.eaten} of ${PINCH})`,
);
assert.ok(
  food.pellets.every((pellet) => food.settled(pellet)),
  "Uneaten food must reach the sand, not hang in mid-water",
);
const times = [...arrivals.values()].sort((a, b) => a - b);
assert.ok(
  arrivals.size > 3 && arrivals.size < COUNT,
  `Food should draw much of the shoal, but not telepathically all of it (got ${arrivals.size})`,
);
assert.ok(
  times[times.length - 1] - times[0] > 3,
  `Fish must arrive over seconds, not together (spread ${(times[times.length - 1] - times[0]).toFixed(1)}s)`,
);
assert.ok(
  times.filter((t) => t < times[0] + 0.5).length < 5,
  "A pellet is seen by one fish at a time, not by a crowd on one frame",
);
assert.ok(
  feeding.strikes > feeding.bites && feeding.bites > 0,
  `Some strikes must miss (${feeding.bites} taken in ${feeding.strikes} strikes)`,
);
assert.ok(
  Number.isFinite(feeding.states.feed),
  "Feeding must be counted in the telemetry like any other state",
);
assert.ok(
  feedingPeak > 1.8 && feedingPeak < 4,
  `A rush at food is faster than cruising and slower than a C-start (got ${feedingPeak.toFixed(2)})`,
);
assert.equal(feeding.escapes, 0, "Food must never fire a C-start");
assert.ok(
  longestFeed < 8,
  `No fish may be stuck chasing one pellet (longest ${longestFeed.toFixed(1)}s)`,
);
assert.ok(
  crowding < calmSpacing * 0.7,
  `Fish at food must tolerate crowding they normally flick away from (${calmSpacing.toFixed(2)} to ${crowding.toFixed(2)})`,
);
assert.ok(
  regrouped > crowding * 1.4,
  `The shoal must open out again once the scramble is over (${crowding.toFixed(2)} to ${regrouped.toFixed(2)})`,
);
fed.dispose();
food.dispose();

// ---- A tank at the cap, mixing adults and babies, stays calm and size-aware ---------
// Fill a tank to the population cap with a spread of ages — several fry and several
// adults — and run it for a couple of minutes with food. This is the headless stand-in
// for the issue's visual cap check: every fish (including the small fry) must stay inside
// the tank, keep finite numbers, and swim without sustaining collision, with a fry's
// smaller body still letting it feed safely alongside bigger fish.
const MIXED = [];
for (let i = 0; i < COUNT; i++) {
  // a quarter fry (born to grow, still small), the rest full-grown adults; all at the cap.
  const fry = i < COUNT / 4;
  MIXED.push({
    id: `cap-${i}`,
    species: "bloodfin-tetra",
    age: fry ? Math.floor(MATURITY_AGE * (i / (COUNT / 4))) : MATURITY_AGE,
    breedIn: 0,
    adult: !fry,
  });
}
const capScene = new THREE.Scene();
const capFood = createFood(capScene, { thickets: THICKETS });
const capped = createFishSchool(capScene, {
  thickets: THICKETS,
  food: capFood,
  // The cap-mixing spacing thresholds were tuned on the production seed, so this school
  // pins the exact default seed rather than an arbitrary test seed.
  random: randomGenerator(583137),
  population: { version: 2, breedIn: 0, fish: MIXED },
});
assert.equal(capped.fish.length, COUNT, "the capped school holds its full population");
const fryIds = capped.fish.filter((f) => sizeScale(f.age, f.adult) < 0.9).map((f) => f.id);
const adultIds = capped.fish.filter((f) => sizeScale(f.age, f.adult) >= 0.9).map((f) => f.id);
assert.ok(fryIds.length > 0 && adultIds.length > 0, "the school holds both small fry and adults");
// Which fish are fry at the running time (their bodies are visibly growing); size-aware
// spacing and feeding are judged against these, never against the whole-school aggregate.
const isFryAt = (f) => sizeScale(f.age, f.adult) < 0.9;

// The closest a pair of fish ever comes over the whole run, by pair kind. If spacing is
// size-aware and considers BOTH bodies, a fry-fry pair must tolerate a smaller gap than a
// fry-adult pair, which must tolerate a smaller gap than an adult-adult pair -- the gap
// grows with the two fish together, not with just the smaller or just the larger one.
const pairKind = (a, b) =>
  isFryAt(a) === isFryAt(b) ? (isFryAt(a) ? "fry-fry" : "adult-adult") : "fry-adult";
const closest = { "fry-fry": [], "fry-adult": [], "adult-adult": [] };
// Minimal distance each ordered pair reaches over the run, keyed so the same pair's
// closest-ever gap is counted once, then grouped by what kind of pair it is.
const pairMin = new Map();
// Prove a fry actually feeds: at least one fry reaches the committed chase mode (found a
// pellet and is going for it) and at least one fry launches a strike lunge at a pellet.
const fryThatFed = new Set();
const fryThatStruck = new Set();
let worstOverlap = Infinity;
for (let i = 0; i < 90 * 120; i++) {
  const time = i * STEP;
  capFood.update(STEP, time);
  capped.update(STEP, time, null);
  if (i === 200) capFood.drop(new THREE.Vector3(0.0, 8.2, 1.0), 6);
  for (const f of capped.fish) {
    assert.ok(insideTank(f.position), "a capped-tank fish stays inside the tank");
    assert.ok(f.position.toArray().every(Number.isFinite), "a capped-tank fish position stays finite");
    if (isFryAt(f)) {
      if (f.mode === "feed") fryThatFed.add(f.id);
      if (f.strikeUntil > 0) fryThatStruck.add(f.id);
    }
  }
  // Sample pair clearances every few frames: keep only the closest each pair ever comes.
  if (i % 6 === 0) {
    const fish = capped.fish;
    for (let j = 0; j < fish.length; j++)
      for (let k = j + 1; k < fish.length; k++) {
        const d = fish[j].position.distanceTo(fish[k].position);
        const key = `${j}-${k}`;
        pairMin.set(key, Math.min(pairMin.get(key) ?? Infinity, d));
        worstOverlap = Math.min(worstOverlap, d);
      }
  }
}
let pair = 0;
for (let j = 0; j < capped.fish.length; j++)
  for (let k = j + 1; k < capped.fish.length; k++) closest[pairKind(capped.fish[j], capped.fish[k])].push(pairMin.get(`${j}-${k}`));
// The median closest-ever gap for each pair kind: a fry-fry pair may come closer than a
// fry-adult pair, and that closer than two adults, because the tolerated gap grows with
// the two fish together rather than with just the smaller body.
const median = (sorted) => sorted[Math.floor(sorted.length / 2)];
const fryFry = median(closest["fry-fry"].sort((a, b) => a - b));
const fryAdult = median(closest["fry-adult"].sort((a, b) => a - b));
const adultAdult = median(closest["adult-adult"].sort((a, b) => a - b));
assert.ok(
  fryFry < fryAdult && fryAdult < adultAdult,
  `pair spacing must grow with both fish sizes: fry-fry kept ${fryFry.toFixed(2)}, ` +
    `fry-adult ${fryAdult.toFixed(2)}, adult-adult ${adultAdult.toFixed(2)}`,
);
assert.ok(
  adultAdult - fryFry > 0.15,
  `size-aware spacing must be meaningful, not noise (adult-adult ${adultAdult.toFixed(2)} vs fry-fry ${fryFry.toFixed(2)})`,
);
// At the cap, the renderer is told to draw exactly as many instances as there are fish
// (it must not be stuck drawing leftover capacity), so a full tank has the intended frame
// cost and no phantom instance sits off camera.
const rendered = capScene.getObjectByName(bloodfinTetra.name);
assert.equal(rendered.count, COUNT, "the renderer draws only the fish that exist, even at the cap");
// The fry that feed are tiny but functional: some fry must demonstrably feed (commit to a
// pellet and launch a strike), not just be present while adults eat.
const capFeeding = capped.getTelemetry();
assert.ok(
  capFeeding.bites > 0 && fryThatFed.size > 0 && fryThatStruck.size > 0,
  `fry must actually feed (${fryThatFed.size} fry chased food, ${fryThatStruck.size} struck, ${capFeeding.bites} total bites)`,
);
// And the proof must be per fish on the eaten path, not just an aggregate: at least one
// fry demonstrably got a pellet down its own gullet (its per-fish bite counter went up),
// not merely turned up in the same tank where adults did all the eating.
const fryThatBite = capped.fish.filter((f) => isFryAt(f) && f.bites > 0);
assert.ok(
  fryThatBite.length > 0,
  `at least one fry must actually eat a pellet (got ${fryThatBite.length} fry with bites; total bites ${capFeeding.bites})`,
);
assert.ok(capped.fish.every((f) => f.quaternion.length() < 1.0001), "all cap-tank fish keep a sane orientation");
assert.ok(
  worstOverlap >= 0.05,
  `even tiny fry must not pass through each other (closest approach ${worstOverlap.toFixed(3)})`,
);
// The hard clamp gives a *nonzero, body-aware* margin at a wall or the ceiling. Force an
// adult and a fry straight against the right wall with no swimming (their velocities are
// zeroed and the school is told to step one frame): the unbreakable clamp is what stops
// them, and it must stop the smaller fry closer to the wall than the full-grown adult,
// because a fry's safe room is only a proportion of an adult's. (The previous hard clamp
// used margin 0, so every fish ended up pressed to the exact boundary with the same zero
// gap regardless of body size.)
const wallBias = 2; // teleport each fish this far *past* the right wall
const adultProbe = capped.fish[adultIds[0]];
const fryProbe = capped.fish[fryIds[0]];
adultProbe.velocity.set(0, 0, 0);
fryProbe.velocity.set(0, 0, 0);
adultProbe.position.x = BOUNDS.maxX + wallBias;
fryProbe.position.x = BOUNDS.maxX + wallBias;
adultProbe.position.z = 0;
fryProbe.position.z = 0;
adultProbe.position.y = 4;
fryProbe.position.y = 4;
capped.update(STEP, 7200 * STEP, null);
const adultClear = BOUNDS.maxX - capped.fish[adultIds[0]].position.x;
const fryClear = BOUNDS.maxX - capped.fish[fryIds[0]].position.x;
assert.ok(
  adultClear > 0 && fryClear > 0,
  `the hard clamp keeps even a corner-pressed fish off the wall (adult clearance ${adultClear.toFixed(3)}, fry ${fryClear.toFixed(3)})`,
);
assert.ok(
  adultClear > fryClear * 1.5,
  `body-aware wall room: an adult keeps clearly more wall clearance than a fry (adult ${adultClear.toFixed(3)} vs fry ${fryClear.toFixed(3)})`,
);
capped.dispose();
capFood.dispose();

console.log(
  `PASS: 120 simulated seconds; ${roaming}/${COUNT} fish explored all three dimensions; ${(gliding / travelling * 100).toFixed(0)}% of travel was quiet-tail gliding; calm tail beats at most ${peakBeatFrequency.toFixed(2)} Hz; ${visits} inspection frames; ${behind} fish-frames behind the grass; ${(rheotaxis * 100).toFixed(0)}% of hovering fish facing upstream; minimum sampled spacing ${minimumSpacing.toFixed(3)}; slow approach gave room (${before.toFixed(2)} to ${after.toFixed(2)}) without a startle; a lunge startled ${telemetry.pointerResponses} fish directly and ${telemetry.escapes} in all, peaking at ${peakSpeed.toFixed(2)} units per second; a pinch of ${PINCH} pellets drew ${arrivals.size} fish over ${(times[times.length - 1] - times[0]).toFixed(1)} seconds, ${feeding.bites} taken in ${feeding.strikes} strikes, crowding to ${crowding.toFixed(2)} at the food and opening back out to ${regrouped.toFixed(2)}.`,
);
