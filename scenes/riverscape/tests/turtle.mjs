// Issue 03 turtle tests: pure simulation, independent mesh coverage, and the live scene's
// rendered sand plus turtle-only hardscape output.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { register } from "node:module";
import {
  createTurtleSimulation,
  inspectTurtlePose,
  TERRAIN_CLEARANCE,
  TURTLE_BOUNDS,
  TURTLE_FOOTPRINT,
} from "../src/turtle-simulation.js";

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
    assertWholePose(pose, {
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
  for (let i = 0; i < seconds * 60; i++) {
    const pose = sim.update(STEP);
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
  const starts = completed.map((move) => move.startElapsed);
  assert.ok(starts[0] <= 230 && starts.every((start, i) => i === 0 || start - starts[i - 1] <= 240),
    `seed ${seed}: no unbounded blocked-target retry gap`);
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
  for (const neckYaw of [-0.2, 0, 0.2]) {
    for (const headYaw of [-0.1, 0, 0.1]) {
      for (const headPitch of [-0.32, 0]) {
        neck.rotation.y = neckYaw;
        head.rotation.y = headYaw;
        head.rotation.z = headPitch;
        root.updateMatrix(); neck.updateMatrix(); head.updateMatrix();
        root.updateMatrixWorld(true);
        const inverseRoot = root.matrixWorld.clone().invert();
        root.traverse((mesh) => {
          if (!mesh.isMesh) return;
          const localMatrix = inverseRoot.clone().multiply(mesh.matrixWorld);
          const positions = mesh.geometry.attributes.position;
          for (let i = 0; i < positions.count; i++) {
            point.fromBufferAttribute(positions, i).applyMatrix4(localMatrix);
            assert.ok(TURTLE_FOOTPRINT.some((disc) =>
              Math.hypot(point.x - disc.x, point.z - disc.z) <= disc.radius + 1e-5),
            `${mesh.name} vertex ${i} lies inside the physical envelope`);
            checkedVertices++;
          }
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
  assert.deepEqual(turtleRecord("t-1"), { id: "t-1" });
}

console.log("PASS: turtle mesh envelope, live sand/hardscape movement, downward dip, idle cache, transitions, matrices, budget, and identity");
