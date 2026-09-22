// Issue 03 and 04 turtle tests: pure simulation and hunt cycle, independent mesh coverage,
// the live scene's rendered sand plus turtle-only hardscape output, fish removal and
// scatter, and long accelerated population runs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import {
  createTurtleSimulation,
  inspectTurtlePose,
  lureAt,
  snoutAt,
  HUNT,
  SURFACE_Y,
  TERRAIN_CLEARANCE,
  TURTLE_BOUNDS,
  TURTLE_FOOTPRINT,
} from "../src/turtle-simulation.js";
import { TUNING } from "../src/turtle-simulation.js";
import { breedMany, POPULATION_CAP, MATURITY_AGE } from "../src/breeding.js";

const STEP = 1 / 60;
function seeded(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ seed >>> 15, 1 | seed);
    n = n + Math.imul(n ^ n >>> 7, 61 | n) ^ n;
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}
const terrain = (x, z) => 0.12 + 0.03 * Math.sin(x * 1.8 + z) + 0.02 * z;
const fast = { restMin: 0.25, restMax: 0.45, shuffleSpeed: 0.9, maxShuffle: 1.8 };

function assertWholePose(pose, setup, label) {
  const checked = inspectTurtlePose(pose, setup);
  assert.ok(checked.valid, `${label}: full geometry envelope stays in bounds and clear`);
  const contacts = checked.footprint.flatMap((part) => part.contacts);
  assert.ok(contacts.every((contact) => Number.isFinite(contact.ground)),
    `${label}: centre and perimeter terrain samples are finite`);
  const surface = Math.max(...contacts.map((contact) => contact.ground));
  assert.ok(Math.abs(pose.y - (surface + TERRAIN_CLEARANCE)) < 1e-10,
    `${label}: body includes the documented sand clearance above sampled contacts`);
}

{
  const source = await readFile(new URL("../src/turtle-simulation.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["']three["']|THREE\./,
    "the pure simulation has no Three.js dependency");
}

// Curated placement and checked fallback both fit the enlarged physical envelope.
{
  const sim = createTurtleSimulation({ random: seeded(1), ground: terrain });
  const pose = sim.getPose();
  assert.ok(pose.z > 1.2 && Math.abs(pose.x) < 1.2,
    "normal start is in the visible foreground channel, not a planted side bed");
  assertWholePose(pose, { bounds: TURTLE_BOUNDS, ground: terrain }, "initial pose");

  const bounds = { minX: -3.2, maxX: 3.2, minZ: -2.2, maxZ: 2.2 };
  const obstacle = { center: { x: -1.6, z: -0.6 }, radius: 0.45 };
  const fallback = createTurtleSimulation({
    bounds, obstacles: [obstacle], ground: terrain, random: () => 0,
    initialPoses: [{ x: 50, z: 50, yaw: 0 }],
  });
  assertWholePose(fallback.getPose(), { bounds, obstacles: [obstacle], ground: terrain },
    "deterministic fallback");
}

// Rest updates reuse one output and cached contact data: no repeated ground work or full
// pose allocation during the normal 70–220 second idle period.
{
  let samples = 0;
  const countedGround = (x, z) => { samples++; return terrain(x, z); };
  const sim = createTurtleSimulation({ random: seeded(8), ground: countedGround });
  const pose = sim.getPose(), footprint = pose.footprint;
  const initialSamples = samples;
  for (let i = 0; i < 60 * 10; i++) assert.equal(sim.update(STEP), pose);
  assert.equal(sim.getPose().footprint, footprint, "rest reuses the contact array");
  assert.equal(samples, initialSamples, "rest does not resample unchanged terrain");
}

register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { randomGenerator, sandHeight } = await import("../src/math.js");
const { createEnvironment, ROCKS } = await import("../src/environment.js");
const { createTurtle, TURTLE_RENDER_BUDGET } = await import("../src/turtle.js");

// Build the actual environment in Node. Texture pixels do not affect geometry; the fake
// canvas only supplies the contact-shadow API used while the real meshes are constructed.
globalThis.document ??= {
  createElement() {
    return {
      width: 0, height: 0,
      getContext() {
        return {
          createRadialGradient: () => ({ addColorStop() {} }),
          set fillStyle(_value) {},
          fillRect() {},
        };
      },
    };
  },
};
const oldLoadAsync = THREE.TextureLoader.prototype.loadAsync;
THREE.TextureLoader.prototype.loadAsync = async () => new THREE.Texture();
const environmentScene = new THREE.Scene();
const environment = await createEnvironment(environmentScene);
THREE.TextureLoader.prototype.loadAsync = oldLoadAsync;

// The rendered ground vertices and turtle sampler now share exactly one sand function.
{
  const sand = environmentScene.getObjectByName("Riverbed sand");
  assert.ok(sand, "actual environment exposes its rendered riverbed");
  const positions = sand.geometry.attributes.position;
  for (let i = 0; i < positions.count; i += 37) {
    assert.ok(Math.abs(positions.getY(i) - sandHeight(positions.getX(i), positions.getZ(i))) < 1e-6,
      `rendered sand sample ${i} matches the turtle ground sampler`);
  }
}

// Use the turtle-only data returned by the live environment. It includes conservative
// bounds from rendered rocks and all low wood, while the old fish obstacle list is intact.
{
  assert.equal(environment.obstacles.length, 30, "fish obstacle data remains unchanged");
  assert.equal(environment.turtleObstacles.filter((o) => o.kind === "rock").length, ROCKS.length);
  assert.ok(environment.turtleObstacles.some((o) => o.kind === "wood"),
    "actual low rendered wood contributes turtle collision bounds");
  assert.ok(environment.turtleObstacles.length > ROCKS.length,
    "turtle hardscape contains wood as well as rocks");

  const sim = createTurtleSimulation({
    obstacles: environment.turtleObstacles,
    ground: sandHeight,
    random: seeded(2),
    options: fast,
  });
  const start = { x: sim.getPose().x, z: sim.getPose().z };
  assert.ok(sim.getPose().z > 1.2, "live-hardscape start remains visible in the foreground");
  let shuffled = false, maxTravel = 0;
  for (let i = 0; i < 60 * 90; i++) {
    const pose = sim.update(STEP);
    shuffled ||= pose.mode === "shuffle";
    maxTravel = Math.max(maxTravel, Math.hypot(pose.x - start.x, pose.z - start.z));
    if (pose.mode !== "swim") assertWholePose(pose, {
      bounds: TURTLE_BOUNDS,
      obstacles: environment.turtleObstacles,
      ground: sandHeight,
    }, `live hardscape step ${i}`);
  }
  assert.ok(shuffled, "turtle enters shuffle mode in the real hardscape");
  assert.ok(maxTravel > 0.2, `turtle actually moves through real hardscape (${maxTravel.toFixed(3)})`);
}

// Production timing and the real default seed must keep producing completed movement,
// not merely rest/shuffle counters. This covers the 20-minute stall found in the browser.
function verifyLongProductionRun(seed, seconds) {
  const sim = createTurtleSimulation({
    obstacles: environment.turtleObstacles,
    ground: sandHeight,
    random: randomGenerator(seed),
  });
  let previous = sim.getPose().mode;
  let shuffleStart = null;
  const completed = [];
  let trips = 0;
  const landings = [];
  for (let i = 0; i < seconds * 60; i++) {
    const pose = sim.update(STEP);
    if (previous === "swim" && pose.mode === "rest") {
      trips++;
      landings.push(pose.elapsed);
      assertWholePose(pose, { bounds: TURTLE_BOUNDS, obstacles: environment.turtleObstacles, ground: sandHeight },
        `seed ${seed}: landing ${trips}`);
    }
    if (previous === "rest" && pose.mode === "shuffle") {
      shuffleStart = { x: pose.x, z: pose.z, elapsed: pose.elapsed };
    }
    if (previous === "shuffle" && pose.mode === "rest") {
      assert.ok(shuffleStart, `seed ${seed}: shuffle has a recorded start`);
      completed.push({
        elapsed: pose.elapsed,
        startElapsed: shuffleStart.elapsed,
        distance: Math.hypot(pose.x - shuffleStart.x, pose.z - shuffleStart.z),
      });
      shuffleStart = null;
    }
    previous = pose.mode;
  }
  assert.ok(completed.length >= 5,
    `seed ${seed}: repeated production shuffles complete (${completed.length})`);
  assert.ok(completed.every((move) => move.distance >= 0.3),
    `seed ${seed}: every started shuffle moves the body (${completed.map((m) => m.distance.toFixed(2)).join(", ")})`);
  assert.ok(completed.filter((move) => move.startElapsed > 600).length >= 2,
    `seed ${seed}: movement repeats after ten minutes`);
  // Movement is a shuffle start or a landing from a breath trip. A pocket may leave no
  // room for a shuffle, in which case the next breath moves the turtle on; the gap between
  // any two movements is therefore bounded by the breath interval, never unbounded.
  const movements = [...completed.map((move) => move.startElapsed), ...landings].sort((a, b) => a - b);
  assert.ok(movements[0] <= 230 && movements.every((at, i) => i === 0 || at - movements[i - 1] <= TUNING.breathMax + 120),
    `seed ${seed}: no unbounded blocked-target retry gap`);
  assert.ok(trips >= 1, `seed ${seed}: the turtle surfaces for air at production timing (${trips})`);
  return completed;
}
{
  const defaultMoves = verifyLongProductionRun(791913, 1710);
  assert.ok(defaultMoves.length >= 8,
    `default production seed keeps moving through the reported 24-minute window (${defaultMoves.length})`);
  for (const seed of [1, 17, 99]) verifyLongProductionRun(seed, 1200);
}

// Repeated transition and complete freeze behavior remain deterministic.
{
  const bounds = { minX: -4, maxX: 4, minZ: -2.5, maxZ: 2.5 };
  const obstacles = [{ center: { x: 0, z: 0 }, radius: 0.55 }];
  const sim = createTurtleSimulation({ bounds, obstacles, ground: terrain, random: seeded(3), options: fast });
  let previous = sim.getPose().mode, starts = 0, finishes = 0;
  for (let i = 0; i < 60 * 180; i++) {
    const pose = sim.update(STEP);
    if (previous === "rest" && pose.mode === "shuffle") starts++;
    if (previous === "shuffle" && pose.mode === "rest") finishes++;
    previous = pose.mode;
  }
  assert.ok(starts >= 2 && finishes >= 2 && starts - finishes <= 1,
    `repeated shuffles settle into rest (${starts}/${finishes})`);

  const before = structuredClone(sim.getPose());
  for (let i = 0; i < 600; i++) sim.update(0);
  assert.deepEqual(sim.getPose(), before, "dt=0 freezes body, articulation, contacts, and timers");
}

// The neck uses the same tube builder as the tail, limbs, and toes. Its centreline
// stays at z=0, so faces on either side must point away from that plane. Check both
// triangle winding (back-face culling) and vertex normals (lighting).
{
  const scene = new THREE.Scene();
  const turtle = createTurtle(scene, { ground: () => 0 });
  const neck = scene.getObjectByName("Turtle neck");
  assert.equal(neck.material.side, THREE.FrontSide);
  const { position, normal } = neck.geometry.attributes;
  assert.equal(neck.geometry.index, null, "merged neck has consecutive triangle vertices");
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const centre = new THREE.Vector3(), face = new THREE.Vector3();
  let checked = 0;
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    centre.copy(a).add(b).add(c).divideScalar(3);
    // Stay off the caps and the top/bottom where the outward z component is zero.
    if (centre.x < 0 || centre.x > 0.3 || Math.abs(centre.z) < 0.04) continue;
    face.crossVectors(b.sub(a), c.sub(a));
    assert.ok(face.z * centre.z > 0, `neck triangle ${i / 3} faces outward`);
    for (let j = i; j < i + 3; j++) {
      assert.ok(normal.getZ(j) * position.getZ(j) > 0, `neck normal ${j} faces outward`);
    }
    checked++;
  }
  assert.ok(checked > 100, "checked both sides of the neck away from the caps");
  turtle.dispose();
}

// Independently project every rendered vertex into turtle-local XZ at all articulation
// extremes. This test does not ask the simulation whether its own envelope is correct.
{
  const scene = new THREE.Scene();
  const turtle = createTurtle(scene, { random: seeded(5), ground: () => 0 });
  const root = scene.getObjectByName("Snapping turtle");
  const neck = scene.getObjectByName("Turtle neck pivot");
  const head = scene.getObjectByName("Turtle head pivot");
  root.position.set(0, 0, 0);
  root.rotation.set(0, 0, 0);
  const point = new THREE.Vector3();
  let checkedVertices = 0;
  const neckMesh = scene.getObjectByName("Turtle neck");
  const headMesh = scene.getObjectByName("Turtle head, beak, jaw, and eyes");
  assert.equal(headMesh.geometry.morphAttributes.position.length, 1, "one jaw gape target");
  const { TURTLE_ARTICULATION: A } = await import("../src/turtle.js");
  // Rest sway, a full aim at every yaw and pitch limit, and the extended strike are all
  // poses the simulation can output, so every one must stay inside the envelope.
  const poses = [];
  for (const neckYaw of [-HUNT.neckYawMax, -0.2, 0, 0.2, HUNT.neckYawMax])
    for (const headYaw of [-HUNT.headYawMax, 0, HUNT.headYawMax])
      for (const neckPitch of [HUNT.neckPitchMin, 0, 0.5, HUNT.neckPitchMax])
        for (const headPitch of [HUNT.headPitchMin, -0.32, 0, HUNT.headPitchMax])
          for (const extend of [0, 1]) poses.push({ neckYaw, headYaw, neckPitch, headPitch, extend });
  for (const { neckYaw, headYaw, neckPitch, headPitch, extend } of poses) {
    {
      {
        neck.rotation.set(0, neckYaw, neckPitch);
        head.rotation.set(0, headYaw, headPitch);
        const reach = 1 + A.stretch * extend;
        neckMesh.scale.set(reach, 1, 1);
        head.position.x = A.headPivotX * reach;
        root.updateMatrix(); neckMesh.updateMatrix(); neck.updateMatrix(); head.updateMatrix();
        root.updateMatrixWorld(true);
        const inverseRoot = root.matrixWorld.clone().invert();
        root.traverse((mesh) => {
          if (!mesh.isMesh) return;
          const localMatrix = inverseRoot.clone().multiply(mesh.matrixWorld);
          // Walking morph targets move the legs, so every stride extreme is checked too.
          const attributes = [mesh.geometry.attributes.position, ...(mesh.geometry.morphAttributes.position ?? [])];
          attributes.forEach((positions, target) => {
            for (let i = 0; i < positions.count; i++) {
              point.fromBufferAttribute(positions, i).applyMatrix4(localMatrix);
              assert.ok(TURTLE_FOOTPRINT.some((disc) =>
                Math.hypot(point.x - disc.x, point.z - disc.z) <= disc.radius + 1e-5),
              `${mesh.name} vertex ${i} (target ${target}) lies inside the physical envelope`);
              checkedVertices++;
            }
          });
        });
      }
    }
  }
  assert.ok(checkedVertices > 50_000, `checked ${checkedVertices} articulated mesh vertices`);
  turtle.dispose();
}

// The world-space beak must move down during a rest dip. Also enforce matrices and draws.
{
  const scene = new THREE.Scene();
  const turtle = createTurtle(scene, { random: seeded(9), ground: () => 0 });
  const root = scene.getObjectByName("Snapping turtle");
  const head = scene.getObjectByName("Turtle head pivot");
  const snout = scene.getObjectByName("Turtle snout tip");
  assert.deepEqual(turtle.renderStats(), TURTLE_RENDER_BUDGET);
  scene.traverse((object) => { object.updateMatrix(); object.matrixAutoUpdate = false; });
  scene.updateMatrixWorld(true);
  let levelY = -Infinity, dippedY = Infinity, mostDip = 0;
  const world = new THREE.Vector3();
  for (let i = 0; i < 60 * 9; i++) {
    turtle.update(STEP);
    const pitch = turtle.getState().headPitch;
    snout.getWorldPosition(world);
    if (Math.abs(pitch) < 0.005) levelY = Math.max(levelY, world.y);
    if (pitch < mostDip) { mostDip = pitch; dippedY = world.y; }
  }
  assert.ok(mostDip < -0.25, `rest pose reaches a downward pitch (${mostDip.toFixed(3)})`);
  assert.ok(dippedY < levelY - 0.12,
    `world snout moves down (${levelY.toFixed(3)} -> ${dippedY.toFixed(3)})`);
  assert.equal(head.rotation.x, 0, "head never rolls around forward x for a dip");
  assert.equal(root.matrixAutoUpdate, false, "manual matrix freeze remains active");
  turtle.dispose();
}

// The walking stride is a morph blend on the single body mesh: silent at rest, alternating
// diagonal pairs during a shuffle, and never both targets at once.
{
  const scene = new THREE.Scene();
  const turtle = createTurtle(scene, {
    random: seeded(4), ground: () => 0,
    options: { restMin: 0.5, restMax: 0.6, shuffleSpeed: 0.6, maxShuffle: 2.4 },
  });
  const body = scene.getObjectByName("Turtle merged shell, legs, claws, and ridged tail");
  assert.equal(body.geometry.morphAttributes.position.length, 2, "two stride targets");
  assert.equal(body.geometry.morphAttributes.normal.length, 2, "stride targets carry normals");
  assert.deepEqual([...body.morphTargetInfluences], [0, 0], "legs start at rest");
  let restingMax = 0, strideMax = 0, both = 0;
  for (let i = 0; i < 60 * 12; i++) {
    turtle.update(STEP);
    const [a, b] = body.morphTargetInfluences;
    if (a > 1e-6 && b > 1e-6) both++;
    if (turtle.getState().mode === "rest" && i < 20) restingMax = Math.max(restingMax, a, b);
    if (turtle.getState().mode === "shuffle") strideMax = Math.max(strideMax, a, b);
  }
  assert.equal(restingMax, 0, "no stride before the first shuffle");
  assert.ok(strideMax > 0.8, `legs swing during a shuffle (${strideMax.toFixed(2)})`);
  assert.equal(both, 0, "diagonal pairs alternate rather than blend together");
  assert.deepEqual(turtle.renderStats(), TURTLE_RENDER_BUDGET, "stride adds no mesh");
  turtle.dispose();
}

const { turtleRecord, createPopulation, parse, serialize, SAVE_VERSION } =
  await import("../src/tank-state.js");
const { FRESH_COUNT } = await import("../src/breeding.js");
{
  const fresh = createPopulation();
  assert.equal(fresh.fish.length, FRESH_COUNT);
  const turtle = createTurtle(new THREE.Scene(), { turtle: fresh.turtle, random: seeded(6) });
  const back = parse(serialize({ ...fresh, turtle: turtle.snapshot() }));
  assert.equal(back.turtle.id, fresh.turtle.id);
  assert.deepEqual(back.fish, fresh.fish, "turtle persistence leaves fish unchanged");
  turtle.dispose();
  const legacy = { version: SAVE_VERSION, fish: [{ id: "f1", species: "bloodfin-tetra", age: 10 }] };
  assert.equal(parse(serialize(legacy)).turtle, undefined);
  assert.deepEqual(turtleRecord("t-1"), { id: "t-1", hunger: 0, feedIn: 0, retryIn: 0 });
}


// ---- Issue 04: the hunt cycle on the pure simulation with synthetic prey ----------------
const preyAt = (sid, point, size = 0.9) => ({
  sid, position: { x: point.x, y: point.y, z: point.z }, size,
});
const farPrey = (n) => Array.from({ length: n }, (_, i) =>
  preyAt(`far-${i}`, { x: 6 * (i % 2 ? 1 : -1), y: 5, z: 0 }));
function makeHunter({ hunger = 1, feedIn = 0, retryIn = 0, options = {}, seed = 11 } = {}) {
  const events = [], caught = [];
  const sim = createTurtleSimulation({
    random: seeded(seed), ground: () => 0, hunger, feedIn, retryIn, options,
    onCatch: (id) => { caught.push(id); return true; },
    onSnap: (event) => events.push({ ...event }),
  });
  return { sim, pose: sim.getPose(), events, caught };
}
function runFor(sim, seconds, prey, each = null) {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    const pose = sim.update(STEP, typeof prey === "function" ? prey() : prey);
    if (each && each(pose, i) === true) return true;
  }
  return false;
}

// A full successful hunt: watch, track with the head turning onto the fish, a fast lunge,
// one catch, one hunger drop, one cooldown, and a return to rest with the neck retracted.
{
  const { sim, pose, events, caught } = makeHunter();
  const far = farPrey(7);
  runFor(sim, 5, far);
  assert.equal(pose.hunt.phase, "watch", "a hungry turtle with no prey in reach only watches");
  assert.equal(pose.hunt.hunger, 1, "hunger saturates at 1");
  const meal = preyAt("meal", pose.lure);
  const prey = [meal, ...far];
  const phases = new Set();
  let pitchWhileTracking = 0, extendWhileStriking = 0;
  const struck = runFor(sim, 8, prey, (p) => {
    phases.add(p.hunt.phase);
    if (p.hunt.phase === "track") pitchWhileTracking = Math.max(pitchWhileTracking, p.neckPitch + p.headPitch);
    if (p.hunt.phase === "strike") extendWhileStriking = Math.max(extendWhileStriking, p.extend);
    return p.hunt.snaps === 1;
  });
  assert.ok(struck, "a fish at the lure is struck within seconds");
  assert.ok(["track", "strike", "hold"].every((p) => phases.has(p)), `tracks, lunges and holds (${[...phases]})`);
  assert.ok(pitchWhileTracking > 0.3, `the head lifts toward prey above the beak (${pitchWhileTracking.toFixed(2)})`);
  assert.ok(extendWhileStriking > 0.5, "the neck extends during the lunge");
  assert.equal(pose.hunt.target, "meal", "the tracked fish is the one struck");
  assert.deepEqual(caught, ["meal"], "exactly one catch callback for the tracked fish");
  assert.equal(events.length, 1);
  assert.equal(events[0].hit, true);
  assert.equal(events[0].preyId, "meal");
  assert.ok(Math.hypot(events[0].x - pose.snout.x, events[0].y - pose.snout.y, events[0].z - pose.snout.z) < 1e-9,
    "the snap event is at the extended snout");
  assert.ok(Math.abs(pose.hunt.hunger - (1 - HUNT.meal)) < 1e-9, "one meal lowers hunger once");
  assert.ok(Math.abs(pose.hunt.feedIn - HUNT.feedCooldown) < 0.05, "a meal starts the feeding cooldown");
  assert.equal(pose.hunt.hits, 1);
  assert.equal(pose.hunt.misses, 0);
  // The eaten fish is gone from the tank; the turtle settles back to rest.
  const settled = runFor(sim, 5, far, (p) => p.hunt.phase === "idle" && p.extend === 0);
  assert.ok(settled, "the neck draws back and the hunt ends");
  assert.equal(pose.gape, 0, "jaws close after the snap");
  assert.equal(caught.length, 1, "no second catch from the same hunt");
  // Fed and cooling down: prey at the lure is ignored.
  runFor(sim, 30, [preyAt("tempting", pose.lure), ...far]);
  assert.equal(pose.hunt.phase, "idle");
  assert.equal(pose.hunt.snaps, 1, "the feeding cooldown blocks the next hunt");
}

// A miss: the fish leaves as the lunge launches. The snap still happens, nothing is
// caught, and a retry cooldown keeps the turtle from snapping again at once.
{
  const { sim, pose, events, caught } = makeHunter();
  const far = farPrey(7);
  const meal = preyAt("meal", pose.lure);
  const prey = [meal, ...far];
  runFor(sim, 8, prey, (p) => {
    if (p.hunt.phase === "strike") { meal.position.x += 3; meal.position.y += 2; }
    return p.hunt.snaps === 1;
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].hit, false, "the escaped fish is not caught");
  assert.deepEqual(caught, [], "no catch callback on a miss");
  assert.equal(pose.hunt.misses, 1);
  assert.equal(pose.hunt.hunger, 1, "a miss leaves hunger unchanged");
  assert.ok(Math.abs(pose.hunt.retryIn - HUNT.retryCooldown) < 0.05, "a miss arms the retry cooldown");
  meal.position.x = pose.lure.x; meal.position.y = pose.lure.y; meal.position.z = pose.lure.z;
  runFor(sim, HUNT.retryCooldown - 1, prey);
  assert.equal(pose.hunt.snaps, 1, "no second snap inside the retry cooldown");
  runFor(sim, 6, prey, (p) => p.hunt.snaps === 2);
  assert.equal(pose.hunt.snaps, 2, "the turtle tries again once the retry cooldown has passed");
  assert.equal(pose.hunt.hits, 1);
}

// Prey that vanishes, is the wrong size, is behind the shell, or is out of reach never
// produces a snap; tracking simply ends or never starts.
{
  const { sim, pose, events } = makeHunter();
  const far = farPrey(7);
  const meal = preyAt("meal", pose.lure);
  runFor(sim, 3, [meal, ...far], (p) => p.hunt.phase === "track");
  assert.equal(pose.hunt.phase, "track");
  sim.update(STEP, far); // the fish is gone
  assert.equal(pose.hunt.phase, "watch", "losing the tracked fish cancels the hunt safely");
  assert.equal(pose.hunt.target, null);
  assert.equal(events.length, 0);
  const rejected = [
    preyAt("big", pose.lure, 1.3),
    preyAt("nosize", pose.lure, NaN),
    { sid: "noposition", size: 0.9 },
    preyAt("behind", { x: pose.x - 1.5, y: pose.lure.y, z: pose.z }),
    preyAt("high", { x: pose.lure.x, y: pose.lure.y + 3, z: pose.lure.z }),
  ];
  runFor(sim, 4, [...rejected, ...far]);
  assert.equal(pose.hunt.phase, "watch", "unsuitable prey is never tracked");
  // In sight but beyond the neck's reach even when aimed straight at it: the head follows
  // it, the turtle never lunges. (Reach is measured from the aimed snout, so a fish only a
  // little above the lure is still catchable; this one is well above the whole neck.)
  const teasing = preyAt("teasing", { x: pose.lure.x, y: pose.lure.y + 1.3, z: pose.lure.z });
  const distance = Math.hypot(teasing.position.x - pose.snout.x, teasing.position.y - pose.snout.y,
    teasing.position.z - pose.snout.z);
  assert.ok(distance > HUNT.strikeReach && distance < HUNT.trackRange);
  let tracked = 0;
  runFor(sim, 12, [teasing, ...far], (p) => { if (p.hunt.phase === "track") tracked++; });
  assert.ok(tracked > 60 * 8, "prey inside sight but beyond reach is watched");
  assert.equal(events.length, 0, "no lunge at prey the neck cannot reach");
  assert.ok(pose.neckPitch + pose.headPitch > 0.5, "the head is aimed up at it");
}

// The protected minimum: no hunt at or below it, and a lunge already in the air resolves
// as a miss if the tank has shrunk to the minimum by the time it lands.
{
  const { sim, pose, events } = makeHunter();
  const prey = [preyAt("meal", pose.lure), ...farPrey(HUNT.minPopulation - 1)];
  assert.equal(prey.length, HUNT.minPopulation);
  runFor(sim, 10, prey);
  assert.equal(pose.hunt.phase, "idle", "a hungry turtle does not hunt at the protected minimum");
  assert.equal(events.length, 0);

  const late = makeHunter();
  const roster = [preyAt("meal", late.pose.lure), ...farPrey(HUNT.minPopulation)];
  runFor(late.sim, 8, () => roster, (p) => {
    if (p.hunt.phase === "strike" && roster.length > HUNT.minPopulation) roster.pop();
    return p.hunt.snaps === 1;
  });
  assert.equal(late.events.length, 1);
  assert.equal(late.events[0].hit, false, "the limit is checked again when the strike resolves");
  assert.deepEqual(late.caught, []);
  assert.equal(late.pose.hunt.hunger, 1);
}

// A catch the tank refuses (the fish was already gone) is a miss, not a phantom meal.
{
  const events = [];
  const sim = createTurtleSimulation({
    random: seeded(11), ground: () => 0, hunger: 1,
    onCatch: () => false, onSnap: (event) => events.push({ ...event }),
  });
  const pose = sim.getPose();
  runFor(sim, 8, [preyAt("meal", pose.lure), ...farPrey(7)], (p) => p.hunt.snaps === 1);
  assert.equal(events[0].hit, false);
  assert.equal(pose.hunt.hunger, 1, "a refused catch does not feed the turtle");
  assert.ok(pose.hunt.retryIn > 0);
}

// Creeping: prey hanging in sight but wide of the lure draws a short shuffle toward it.
{
  const { sim, pose } = makeHunter({ options: { restMin: 500, restMax: 600 } });
  const heading = { x: Math.cos(pose.yaw), z: -Math.sin(pose.yaw) };
  const wide = preyAt("wide", {
    x: pose.lure.x + heading.x * 1.0, y: pose.lure.y + 0.3, z: pose.lure.z + heading.z * 1.0,
  });
  const before = Math.hypot(wide.position.x - pose.lure.x, wide.position.z - pose.lure.z);
  let shuffled = false;
  runFor(sim, HUNT.creepInterval + 8, [wide, ...farPrey(7)], (p) => {
    shuffled ||= p.mode === "shuffle";
    return p.hunt.creeps >= 1 && p.mode === "rest";
  });
  assert.ok(shuffled && pose.hunt.creeps >= 1, "the turtle creeps toward out-of-reach prey");
  const after = Math.hypot(wide.position.x - pose.lure.x, wide.position.z - pose.lure.z);
  assert.ok(after < before - 0.05, `the creep closes the gap (${before.toFixed(2)} -> ${after.toFixed(2)})`);
}

// Frozen time: hunger, cooldowns and the hunt phase all stand still at dt = 0, including
// in the middle of a lunge.
{
  const { sim, pose } = makeHunter();
  const prey = [preyAt("meal", pose.lure), ...farPrey(7)];
  runFor(sim, 8, prey, (p) => p.hunt.phase === "strike");
  assert.equal(pose.hunt.phase, "strike");
  const frozen = structuredClone(pose);
  for (let i = 0; i < 600; i++) sim.update(0, prey);
  assert.deepEqual(sim.getPose(), frozen, "dt = 0 advances neither hunger nor the lunge");
}

// Saving: hunger and cooldown remainders travel; the hunt phase does not. A save taken in
// the middle of a lunge restores to rest, cannot land the catch, and keeps its cooldowns.
{
  const { sim, pose } = makeHunter();
  const prey = [preyAt("meal", pose.lure), ...farPrey(7)];
  runFor(sim, 8, prey, (p) => p.hunt.snaps === 1);
  const fed = sim.snapshot();
  assert.deepEqual(Object.keys(fed).sort(), ["breathIn", "feedIn", "hunger", "id", "retryIn"]);
  assert.ok(fed.feedIn > HUNT.feedCooldown - 1 && fed.hunger < 0.2);
  const resumed = createTurtleSimulation({ ...fed, random: seeded(12), ground: () => 0 });
  assert.equal(resumed.getPose().hunt.feedIn, fed.feedIn, "the feeding cooldown continues from the save");
  assert.equal(resumed.getPose().hunt.hunger, fed.hunger);
  runFor(resumed, 20, [preyAt("meal", resumed.getPose().lure), ...farPrey(7)]);
  assert.equal(resumed.getPose().hunt.snaps, 0, "a reload cannot bypass the cooldown");

  const mid = makeHunter({ seed: 13 });
  const midPrey = [preyAt("meal", mid.pose.lure), ...farPrey(7)];
  runFor(mid.sim, 8, midPrey, (p) => p.hunt.phase === "strike");
  const interrupted = mid.sim.snapshot();
  assert.equal(interrupted.hunger, 1);
  const reloaded = makeHunter({ ...interrupted, seed: 14 });
  assert.equal(reloaded.pose.hunt.phase, "idle", "an interrupted lunge reloads at rest");
  assert.equal(reloaded.pose.extend, 0);
  runFor(reloaded.sim, 0.5, [preyAt("meal", reloaded.pose.lure), ...farPrey(7)]);
  assert.equal(reloaded.caught.length, 0, "no catch is granted for the lunge that was interrupted");
  assert.equal(reloaded.pose.hunt.hunger, 1);
  runFor(reloaded.sim, 8, [preyAt("meal", reloaded.pose.lure), ...farPrey(7)], (p) => p.hunt.snaps === 1);
  assert.equal(reloaded.caught.length, 1, "a fresh hunt after reload must aim and lunge again");
}

// The saved record: the format keeps the clocks, refuses bad ones without losing the fish,
// and an issue-03 record without clocks reads as a turtle at the default hunger.
{
  const { validate } = await import("../src/tank-state.js");
  const fresh = createPopulation();
  const saved = parse(serialize({ ...fresh, turtle: { id: "t", hunger: 0.42, feedIn: 900.5, retryIn: 3 } }));
  assert.deepEqual(saved.turtle, { id: "t", hunger: 0.42, feedIn: 900.5, retryIn: 3 });
  const breathing = parse(serialize({ ...fresh, turtle: { id: "t", hunger: 0.1, breathIn: 321.25 } }));
  assert.equal(breathing.turtle.breathIn, 321.25, "the breath remainder travels with the save");
  const clamped = parse(serialize({ ...fresh, turtle: { id: "t", hunger: 7 } }));
  assert.equal(clamped.turtle.hunger, 1, "hunger is clamped to 1 on the way to disk");
  const bad = validate({ ...fresh, turtle: { id: "t", hunger: "high" } });
  assert.ok(bad.ok && bad.state.turtle === undefined, "a bad clock drops only the turtle");
  assert.equal(bad.state.fish.length, fresh.fish.length);
  const legacy = parse(serialize({ ...fresh, turtle: { id: "old" } }));
  assert.equal(legacy.turtle.id, "old");
  assert.equal(legacy.turtle.hunger, undefined, "an issue-03 record carries no hunger");
  assert.equal(legacy.turtle.breathIn, undefined, "nor a breath remainder");
  assert.equal(legacy.turtle.feedIn, 0);
  const restored = createTurtle(new THREE.Scene(), { turtle: legacy.turtle, random: seeded(6) });
  assert.equal(restored.getState().hunt.hunger, HUNT.startHunger, "the live turtle applies its default hunger");
  assert.equal(restored.snapshot().id, "old");
  restored.dispose();
}

// The rendered turtle follows the pure model exactly: the snout landmark sits where the
// model says, the jaws open during the lunge and close after, the neck stretches, and the
// strike adds no mesh.
{
  const scene = new THREE.Scene();
  const caught = [];
  const turtle = createTurtle(scene, {
    random: seeded(9), ground: () => 0, turtle: { id: "t", hunger: 1 },
    onCatch: (id) => { caught.push(id); return true; },
  });
  const head = scene.getObjectByName("Turtle head, beak, jaw, and eyes");
  const neck = scene.getObjectByName("Turtle neck");
  const snout = scene.getObjectByName("Turtle snout tip");
  scene.traverse((object) => { object.updateMatrix(); object.matrixAutoUpdate = false; });
  scene.updateMatrixWorld(true);
  const pose = turtle.getState();
  const prey = [preyAt("meal", pose.lure), ...farPrey(7)];
  const world = new THREE.Vector3();
  let maxGape = 0, maxStretch = 1, worst = 0;
  for (let i = 0; i < 60 * 8 && pose.hunt.phase !== "idle" || i < 60; i++) {
    turtle.update(STEP, prey);
    snout.getWorldPosition(world);
    const modelSnout = snoutAt(pose);
    worst = Math.max(worst, world.distanceTo(new THREE.Vector3(modelSnout.x, modelSnout.y, modelSnout.z)));
    maxGape = Math.max(maxGape, head.morphTargetInfluences[0]);
    maxStretch = Math.max(maxStretch, neck.scale.x);
    if (pose.hunt.snaps === 1 && prey[0].sid === "meal") prey.shift();
  }
  assert.equal(caught.length, 1, "the rendered turtle completes a hunt");
  assert.ok(worst < 1e-6, `the pure snout matches the rendered landmark (${worst.toExponential(1)})`);
  assert.ok(maxGape > 0.9, `the jaw opens for the snap (${maxGape.toFixed(2)})`);
  assert.equal(head.morphTargetInfluences[0], 0, "the jaw is closed again at rest");
  assert.ok(maxStretch > 1.5, `the neck stretches (${maxStretch.toFixed(2)})`);
  assert.equal(neck.scale.x, 1, "the neck is back to length at rest");
  assert.equal(scene.getObjectByName("Turtle head pivot").rotation.x, 0, "no head roll");
  assert.deepEqual(turtle.renderStats(), TURTLE_RENDER_BUDGET, "hunting adds no mesh");
  turtle.dispose();
}

// ---- Breathing trips: the way between the floor's pockets ------------------------------
// The foreground channel holds exactly one pocket a whole turtle fits in, so walking never
// leaves it. Surfacing for air and gliding down somewhere new is what moves the turtle
// around the tank. Real hardscape, real sand, the fish obstacle spheres for the swim, and
// the grass beds excluded from landings.
const { THICKETS } = await import("../src/plants.js");
{
  const sim = createTurtleSimulation({
    obstacles: environment.turtleObstacles, swimObstacles: environment.obstacles, beds: THICKETS,
    ground: sandHeight, random: randomGenerator(791913), options: { breathMin: 40, breathMax: 60 },
  });
  const pose = sim.getPose();
  const start = { x: pose.x, z: pose.z };
  let previous = pose.mode, snoutTop = -Infinity, breathing = 0, paddled = 0, glided = 0;
  let maxPitch = 0, minPitch = 0, intrusions = 0;
  const landings = [];
  let rose = null;
  for (let i = 0; i < 60 * 600; i++) {
    sim.update(STEP);
    assert.ok([pose.x, pose.y, pose.z, pose.yaw, pose.pitch].every(Number.isFinite));
    if (pose.mode === "swim") {
      assert.ok(pose.hunt.phase === "idle", "no hunting while swimming");
      if (pose.swim === "rise") { paddled++; if (!rose) rose = { x: pose.x, z: pose.z }; }
      if (pose.swim === "breathe") { breathing++; snoutTop = Math.max(snoutTop, pose.snout.y); }
      if (pose.swim === "glide") glided++;
      maxPitch = Math.max(maxPitch, pose.pitch); minPitch = Math.min(minPitch, pose.pitch);
      // The body centre stays out of every rock, branch and trunk sphere while it is
      // clear of the sand; the last stretch down is covered by the landing footprint.
      if (pose.y > sandHeight(pose.x, pose.z) + 1.3) {
        for (const o of environment.obstacles) {
          if (Math.hypot(pose.x - o.center.x, pose.y - o.center.y, pose.z - o.center.z) < o.radius + 0.3) intrusions++;
        }
      }
    } else {
      assertWholePose(pose, { bounds: TURTLE_BOUNDS, obstacles: environment.turtleObstacles, ground: sandHeight },
        `ground step ${i}`);
      assert.ok(Math.abs(pose.pitch) < 0.25, "the body is level on the sand");
    }
    if (previous === "swim" && pose.mode === "rest") landings.push({ x: pose.x, z: pose.z, yaw: pose.yaw });
    previous = pose.mode;
  }
  assert.ok(landings.length >= 5, `repeated breath trips in ten minutes (${landings.length})`);
  assert.equal(pose.trips, landings.length);
  assert.ok(breathing >= 60 * 3 * landings.length * 0.9, "each breath holds the head up for seconds");
  assert.ok(snoutTop >= SURFACE_Y, `the beak breaks the film (${snoutTop.toFixed(2)} vs ${SURFACE_Y})`);
  assert.ok(paddled > 0 && glided > paddled, "a slow glide follows a paddled rise");
  assert.ok(maxPitch > 0.35 && minPitch < -0.3, `nose up on the way up, down on the glide (${maxPitch.toFixed(2)}/${minPitch.toFixed(2)})`);
  assert.equal(intrusions, 0, "the swim clears rocks, wood and the trunk");
  assert.ok(landings.some((l) => l.z > 1.2) && landings.some((l) => l.z < 0.8),
    `landings reach more than one pocket (${landings.map((l) => `${l.x.toFixed(1)},${l.z.toFixed(1)}`).join(" ")})`);
  assert.ok(landings.every((l, i) => i === 0
    ? Math.hypot(l.x - start.x, l.z - start.z) > 0.8
    : Math.hypot(l.x - landings[i - 1].x, l.z - landings[i - 1].z) > 0.8),
  "every trip lands somewhere new");
  assert.ok(landings.every((l) => !THICKETS.some((b) => l.x > b.minX && l.x < b.maxX && l.z > b.minZ && l.z < b.maxZ)),
    "never lands in a grass bed");
  const walked = Math.max(...landings.map((l) => Math.hypot(l.x - start.x, l.z - start.z)));
  assert.ok(walked > 2, `the turtle ends up well away from where it started (${walked.toFixed(2)})`);
}

// A breath waits for a hunt in progress, and a frozen step freezes the glide. The breath
// remainder is saved and continued.
{
  const { sim, pose, caught } = makeHunter({ options: { breathMin: 1, breathMax: 1 } });
  const prey = [preyAt("meal", pose.lure), ...farPrey(7)];
  runFor(sim, 3, prey, (p) => p.hunt.phase === "track");
  assert.equal(pose.hunt.phase, "track");
  assert.ok(pose.breathIn < 1, "the breath falls due while the fish is being tracked");
  let swamDuringHunt = false;
  runFor(sim, 6, prey, (p) => { swamDuringHunt ||= p.mode === "swim"; return p.hunt.snaps === 1; });
  assert.equal(pose.breathIn, 0, "the breath has been due for a while");
  assert.deepEqual(caught, ["meal"], "the strike lands before the turtle goes up for air");
  assert.ok(!swamDuringHunt && pose.mode === "rest", "no trip began during the hunt");
  runFor(sim, 3, farPrey(7), (p) => p.mode === "swim");
  assert.equal(pose.mode, "swim", "once the hunt has settled the turtle surfaces");
  runFor(sim, 30, farPrey(7), (p) => p.swim === "glide");
  assert.equal(pose.swim, "glide");
  const frozen = structuredClone(pose);
  for (let i = 0; i < 300; i++) sim.update(0, farPrey(7));
  assert.deepEqual(sim.getPose(), frozen, "dt = 0 freezes the glide");
  const saved = sim.snapshot();
  assert.ok(saved.breathIn >= 0);
  const back = createTurtleSimulation({ ...saved, random: seeded(3), ground: () => 0 });
  assert.equal(back.getPose().breathIn, saved.breathIn, "the breath remainder continues from the save");
  assert.equal(back.getPose().mode, "rest", "a reload lands the turtle on the sand");
  const fresh = createTurtleSimulation({ id: "t", random: seeded(3), ground: () => 0 });
  assert.ok(fresh.getPose().breathIn >= TUNING.breathMin && fresh.getPose().breathIn <= TUNING.breathMax,
    "a record without a breath remainder draws a fresh interval");
}

// The rendered body follows the swim: it tilts nose-up on the rise and the legs paddle.
{
  const scene = new THREE.Scene();
  const turtle = createTurtle(scene, { random: seeded(21), ground: () => 0, options: { breathMin: 0.5, breathMax: 0.5 } });
  const root = scene.getObjectByName("Snapping turtle");
  const body = scene.getObjectByName("Turtle merged shell, legs, claws, and ridged tail");
  let tilt = 0, stroke = 0, top = 0;
  for (let i = 0; i < 60 * 40; i++) {
    turtle.update(STEP, []);
    if (turtle.getState().swim === "rise") {
      tilt = Math.max(tilt, root.rotation.z);
      stroke = Math.max(stroke, ...body.morphTargetInfluences);
    }
    top = Math.max(top, root.position.y);
  }
  assert.ok(tilt > 0.35, `the body tilts up on the rise (${tilt.toFixed(2)})`);
  assert.ok(stroke > 0.8, `the legs paddle on the rise (${stroke.toFixed(2)})`);
  assert.ok(top > SURFACE_Y - 1.5, `the body rises to the film (${top.toFixed(2)})`);
  assert.deepEqual(turtle.renderStats(), TURTLE_RENDER_BUDGET);
  turtle.dispose();
}

// The school: taking one fish out removes it from the live shoal and the durable record
// together, exactly once; a snap scatters the fish around it and nothing further away.
const { createFishSchool } = await import("../src/fish.js");
{
  const scene = new THREE.Scene();
  const school = createFishSchool(scene, { population: createPopulation({ count: 10 }), random: randomGenerator(3) });
  for (let i = 0; i < 30; i++) school.update(STEP, i * STEP, null);
  const victim = school.fish[3].sid;
  assert.equal(school.remove(victim), true);
  assert.equal(school.fish.length, 9);
  assert.equal(school.snapshotPopulation().fish.length, 9, "the saved population loses the same fish");
  assert.ok(!school.snapshotPopulation().fish.some((f) => f.id === victim));
  assert.ok(!school.fish.some((f) => f.sid === victim));
  assert.deepEqual(school.fish.map((f) => f.id), [...Array(9).keys()], "render slots are renumbered");
  assert.deepEqual(school.fish.map((f) => f.sid), school.snapshotPopulation().fish.map((f) => f.id),
    "live fish and records stay aligned by index");
  assert.equal(school.remove(victim), false, "a fish can only be taken once");
  assert.equal(school.remove("never-existed"), false);
  const bodies = scene.getObjectByName("Bloodfin tetra") ?? scene.children.find((o) => o.isInstancedMesh);
  assert.equal(bodies.count, 9, "the renderer draws one fewer instance");
  for (let i = 0; i < 60; i++) school.update(STEP, i * STEP, null);
  assert.ok(school.fish.every((f) => f.position.toArray().every(Number.isFinite)));
  assert.equal(school.getTelemetry().taken, 1);

  const near = school.fish[0];
  const point = { x: near.position.x + 0.5, y: near.position.y, z: near.position.z };
  const others = school.fish.filter((f) => f !== near && f.position.distanceTo(point) > 2.2 && f.mode !== "escape");
  const broke = school.scatter(point);
  assert.ok(broke >= 1 && near.mode === "escape", "a fish beside the snap breaks away");
  assert.ok(others.every((f) => f.mode !== "escape"), "fish well away from the snap are not startled directly");
  assert.equal(school.scatter({ x: 50, y: 50, z: 50 }), 0, "nothing scatters from a snap nowhere near");
  school.dispose();
}

// The live tank: fish come down to look at the turtle, the turtle hunts them, hits remove
// exactly one fish from both live and saved populations, misses remove none, every snap
// scatters, and the population never drops below the protected minimum.
function liveTank({ seed, count, minutes, hunt = {}, landmarks }) {
  const scene = new THREE.Scene();
  let school = null;
  const log = [];
  // The count going into each step, so a snap can be judged against the tank as it was a
  // moment before (births during the run change the total on their own).
  const frame = { before: 0 };
  const turtle = createTurtle(scene, {
    random: randomGenerator(seed), turtle: { id: "t", hunger: 1 },
    options: { hungerRate: 1 / 300, feedCooldown: 60, retryCooldown: 15, minPopulation: 4, ...hunt },
    onCatch: (sid) => school.remove(sid),
    onSnap: (snap) => {
      const live = school.fish.length, saved = school.snapshotPopulation().fish.length;
      const scattered = school.scatter(snap);
      log.push({ ...snap, live, saved, scattered, before: frame.before });
    },
  });
  school = createFishSchool(scene, {
    population: createPopulation({ count }), lure: turtle.lure, landmarks,
    random: randomGenerator(seed + 1),
  });
  const before = { live: school.fish.length, saved: school.snapshotPopulation().fish.length };
  let visits = 0, minimum = Infinity, births = 0, last = school.fish.length;
  for (let i = 0; i < 60 * 60 * minutes; i++) {
    school.update(STEP, i * STEP, null);
    // Only the school adds fish, only the turtle takes them, so a rise here is a birth.
    births += Math.max(0, school.fish.length - last);
    frame.before = school.fish.length;
    turtle.update(STEP, school.fish);
    last = school.fish.length;
    minimum = Math.min(minimum, school.fish.length);
    if (i % 30 === 0 && school.fish.some((f) => f.mode === "inspect" && f.interest?.kind === "turtle")) visits++;
  }
  const result = { turtle: turtle.getState().hunt, log, before, visits, minimum, births, school };
  turtle.dispose();
  return result;
}
// Enough other things to look at that the turtle is one interest among many, as in the
// real tank, where rocks, wood and grass share the fish's curiosity.
const otherInterests = Array.from({ length: 10 }, (_, i) => ({
  kind: i % 2 ? "rock" : "wood", obstacle: -1,
  point: new THREE.Vector3(-6 + i * 1.3, 2.5 + (i % 3), 0.5 + (i % 2)),
}));
{
  const run = liveTank({ seed: 791913, count: 20, minutes: 15, landmarks: otherInterests });
  assert.ok(run.visits > 0, "fish come down to look at the turtle");
  assert.ok(run.turtle.snaps >= 2, `the turtle strikes in the live tank (${run.turtle.snaps} snaps)`);
  for (const snap of run.log) {
    assert.equal(snap.live, snap.saved, "live and saved counts agree at every snap");
    assert.equal(snap.live, snap.before - (snap.hit ? 1 : 0),
      `a hit removes exactly one fish and a miss none (${snap.hit ? "hit" : "miss"})`);
  }
  assert.equal(run.school.fish.length, run.before.live + run.births - run.turtle.hits,
    "the final count is the start plus births minus meals");
  assert.equal(run.school.snapshotPopulation().fish.length, run.school.fish.length);
  assert.equal(run.school.getTelemetry().taken, run.turtle.hits);
  assert.ok(run.school.getTelemetry().scatters > 0, "snaps scatter nearby fish");
  assert.ok(run.log.some((snap) => snap.scattered > 0), "at least one snap sent fish flying");
  assert.ok(run.minimum >= 4, `the population never fell below the protected minimum (${run.minimum})`);
  assert.ok(run.turtle.hunger < 1, "a fed turtle is less hungry");
  run.school.dispose();

  // At the protected minimum from the start, the same hungry turtle never strikes.
  const guarded = liveTank({ seed: 791913, count: 12, minutes: 6, hunt: { minPopulation: 12 }, landmarks: otherInterests });
  assert.equal(guarded.turtle.snaps, 0, "no hunting at the protected minimum");
  assert.equal(guarded.school.fish.length, 12);
  guarded.school.dispose();
}

// Long accelerated runs at production tuning: births and hunts together keep the
// population between the protected minimum and the cap, births refill after meals, and
// hunts stay rare. Prey is synthetic here (a fish drops in to look at the turtle now and
// then); the live-school run above covers the real approach geometry.
function populationRun(seed, hours) {
  const random = seeded(seed);
  const range = (a, b) => a + random() * (b - a);
  const dt = 1 / 20;
  const state = createPopulation({ count: 8 });
  let removed = 0;
  const prey = [];
  const sim = createTurtleSimulation({
    random: seeded(seed + 1), ground: () => 0,
    onCatch: (sid) => {
      const index = state.fish.findIndex((f) => f.id === sid);
      if (index < 0) return false;
      state.fish.splice(index, 1);
      removed++;
      return true;
    },
  });
  const pose = sim.getPose();
  let visitor = null, visitUntil = 0, nextVisit = range(30, 120), births = 0;
  let minimum = Infinity, maximum = 0, hitsBelowLimit = 0;
  const steps = Math.round(hours * 3600 / dt);
  for (let i = 0; i < steps; i++) {
    const t = i * dt;
    const result = breedMany(state, dt, { id: () => `b-${seed}-${i}` });
    if (result.born) births++;
    prey.length = 0;
    for (const record of state.fish) {
      record.position ??= { x: 6, y: 5, z: 0 };
      record.sid = record.id;
      record.size = record.adult ? 0.95 : 0.4 + 0.55 * Math.min(1, record.age / MATURITY_AGE);
      prey.push(record);
    }
    if (visitor && (t >= visitUntil || !state.fish.includes(visitor))) {
      if (state.fish.includes(visitor)) visitor.position = { x: 6, y: 5, z: 0 };
      visitor = null;
      nextVisit = t + range(40, 160);
    }
    if (!visitor && t >= nextVisit && state.fish.length) {
      visitor = state.fish[Math.floor(random() * state.fish.length)];
      visitor.position = {
        x: pose.lure.x + range(-0.2, 0.2), y: pose.lure.y + range(-0.1, 0.35), z: pose.lure.z + range(-0.2, 0.2),
      };
      visitUntil = t + range(3, 8);
    }
    const hitsBefore = pose.hunt.hits;
    sim.update(dt, prey);
    if (pose.hunt.hits > hitsBefore && state.fish.length + 1 <= HUNT.minPopulation) hitsBelowLimit++;
    minimum = Math.min(minimum, state.fish.length);
    maximum = Math.max(maximum, state.fish.length);
  }
  return { births, hits: pose.hunt.hits, misses: pose.hunt.misses, removed, minimum, maximum, final: state.fish.length, hitsBelowLimit };
}
{
  const hours = 6;
  for (const seed of [1, 7, 42, 1234]) {
    const run = populationRun(seed, hours);
    assert.ok(run.births >= 3, `seed ${seed}: births happen (${run.births})`);
    assert.ok(run.hits >= 1, `seed ${seed}: the turtle eats now and then (${run.hits})`);
    assert.equal(run.hits, run.removed, `seed ${seed}: every hit removed exactly one fish`);
    assert.equal(run.hitsBelowLimit, 0, `seed ${seed}: no hit took the tank to or below the minimum`);
    assert.ok(run.minimum >= HUNT.minPopulation, `seed ${seed}: population never below ${HUNT.minPopulation} (${run.minimum})`);
    assert.ok(run.maximum <= POPULATION_CAP, `seed ${seed}: population never above the cap (${run.maximum})`);
    assert.ok(run.hits / hours <= 3, `seed ${seed}: hunts stay rare (${(run.hits / hours).toFixed(1)}/h)`);
    assert.ok(run.final > HUNT.minPopulation, `seed ${seed}: the tank recovers (${run.final} fish after ${hours} h)`);
  }
}

console.log("PASS: turtle mesh envelope incl. strike, breath trips between floor pockets, stride and gape morphs, live sand/hardscape movement, downward dip, idle cache, transitions, matrices, budget, identity; hunt transitions, reach, misses, prey loss, protected minimum, creep, freeze, save/reload, fish removal and scatter, live-tank hunts, and multi-seed population runs");
