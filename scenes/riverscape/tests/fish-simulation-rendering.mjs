import { register } from "node:module";
import assert from "node:assert/strict";

register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { createFishSimulation } = await import("../src/fish-simulation.js");
const { createFishRenderer } = await import("../src/fish-renderer.js");
const { bloodfinTetra } = await import("../src/fish-species.js");
const { createPopulation } = await import("../src/tank-state.js");
const { randomGenerator } = await import("../src/math.js");

const STEP = 1 / 60;
const population = createPopulation({
  count: 5,
  age: 123,
  id: (() => { let id = 0; return () => `seam-${id++}`; })(),
});
const options = () => ({
  population: structuredClone(population),
  random: randomGenerator(0x51a7e),
});
const physicalState = (simulation) => simulation.fish.map((fish) => ({
  sid: fish.sid,
  mode: fish.mode,
  position: fish.position.toArray(),
  velocity: fish.velocity.toArray(),
  heading: fish.heading.toArray(),
  phase: fish.phase,
  effort: fish.effort,
  bend: fish.bend,
}));

// The simulation cannot accidentally construct geometry or materials: these hooks throw
// if touched, yet decisions, physics, telemetry, and durable snapshots all keep running.
const headlessSpecies = {
  ...bloodfinTetra,
  createAnatomy() { throw new Error("simulation constructed rendered geometry"); },
  createMaterials() { throw new Error("simulation constructed rendered materials"); },
};
const headless = createFishSimulation({ ...options(), species: headlessSpecies });
for (let frame = 0; frame < 180; frame++) headless.update(STEP, frame * STEP, null);
assert.equal(headless.fish.length, population.fish.length);
assert.ok(headless.fish.every((fish) => fish.position.toArray().every(Number.isFinite)));
assert.deepEqual(
  headless.snapshotPopulation().fish.map((fish) => fish.id),
  population.fish.map((fish) => fish.id),
  "headless simulation preserves stable saved identities",
);
assert.equal(headless.getTelemetry().count, population.fish.length);

// Rendering the same seeded simulation must not feed decisions back into it. A rendered
// and a headless run stay bit-for-bit equal, and repeated render uploads mutate neither
// physical state nor the durable population snapshot.
const headlessTwin = createFishSimulation(options());
const renderedTwin = createFishSimulation(options());
const scene = new THREE.Scene();
const renderer = createFishRenderer(scene, renderedTwin);
for (let frame = 0; frame < 240; frame++) {
  headlessTwin.update(STEP, frame * STEP, null);
  renderedTwin.update(STEP, frame * STEP, null);
  renderer.update();
}
assert.deepEqual(
  physicalState(renderedTwin),
  physicalState(headlessTwin),
  "constructing and updating rendering cannot change simulation decisions or physics",
);
const stateBeforeRender = physicalState(renderedTwin);
const saveBeforeRender = renderedTwin.snapshotPopulation();
for (let i = 0; i < 10; i++) renderer.update();
assert.deepEqual(physicalState(renderedTwin), stateBeforeRender,
  "render uploads cannot mutate authoritative physical state");
assert.deepEqual(renderedTwin.snapshotPopulation(), saveBeforeRender,
  "render uploads cannot mutate durable population state");
assert.equal(scene.getObjectByName(bloodfinTetra.name).count, population.fish.length);
renderer.dispose();

console.log("PASS: fish simulation runs without a rendered scene and rendering is non-authoritative");
