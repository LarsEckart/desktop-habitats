import { register } from "node:module";
import assert from "node:assert/strict";
register("./three-loader.mjs", import.meta.url);

const THREE = await import("three");
const {
  HONEY_BOUNDS,
  HONEY_JOINTS,
  HONEY_STEP,
  createHoneyGouramiSimulation,
} = await import("../src/honey-gourami.js");
const { randomGenerator } = await import("../src/math.js");

function snapshot(simulation) {
  const { state } = simulation;
  return {
    mode: state.mode,
    position: state.position.toArray(),
    velocity: state.velocity.toArray(),
    yaw: state.yaw,
    pitch: state.pitch,
    tailPhase: state.tailPhase,
    spine: state.spine.map((point) => point.toArray()),
    transitions: [...state.transitions],
  };
}

// A fixed seed and fixed step produce the same complete physical and behavioral state.
const first = createHoneyGouramiSimulation({ random: randomGenerator(941) });
const second = createHoneyGouramiSimulation({ random: randomGenerator(941) });
for (let i = 0; i < 60 * 45; i++) {
  first.step(HONEY_STEP);
  second.step(HONEY_STEP);
}
assert.deepEqual(snapshot(first), snapshot(second), "the bespoke simulation is repeatable");
assert.equal(first.state.spine.length, HONEY_JOINTS, "the fish owns its articulated spine");
assert.equal(first.diagnostics().finite, true, "long-running pose state stays finite");

// Exercise both sides of every tank boundary during a long run, not just the initial pose.
for (let i = 0; i < 60 * 180; i++) {
  first.step(HONEY_STEP);
  const { x, y, z } = first.state.position;
  assert.ok(x >= HONEY_BOUNDS.minX && x <= HONEY_BOUNDS.maxX, `x remains in bounds: ${x}`);
  assert.ok(y >= HONEY_BOUNDS.minY && y <= HONEY_BOUNDS.maxY, `y remains in bounds: ${y}`);
  assert.ok(z >= HONEY_BOUNDS.minZ && z <= HONEY_BOUNDS.maxZ, `z remains in bounds: ${z}`);
}

// Curiosity is explicit and expires instead of trapping the fish.
const curious = createHoneyGouramiSimulation({ random: randomGenerator(22) });
curious.point(new THREE.Vector3(1.2, 4.2, 2.4), true);
curious.step(HONEY_STEP);
assert.equal(curious.state.mode, "curious", "a moved pointer starts a curious inspection");
for (let i = 0; i < 60 * 5; i++) curious.step(HONEY_STEP);
assert.notEqual(curious.state.mode, "curious", "a still pointer eventually loses its hold");

// A labyrinth-breathing trip has all three observable transitions and returns to swimming.
const breathing = createHoneyGouramiSimulation({ random: randomGenerator(37) });
breathing.state.nextSurface = 0;
const breathingModes = new Set();
for (let i = 0; i < 60 * 35; i++) {
  breathing.step(HONEY_STEP);
  breathingModes.add(breathing.state.mode);
}
for (const mode of ["surface", "breathe", "descend"])
  assert.ok(breathingModes.has(mode), `surface breathing visibly enters ${mode}`);
assert.ok(breathing.state.transitions.includes("surface->breathe"));
assert.ok(breathing.state.transitions.includes("breathe->descend"));

// Food interrupts curiosity, reaches the mouth, is taken exactly once, then releases the
// fish back to curiosity while the pointer is still recent.
const pellet = {
  position: new THREE.Vector3(0.75, 4.4, 0), gone: false, eatenAt: 0,
};
const food = {
  pellets: [pellet],
  take(item) {
    if (item.gone) return false;
    item.gone = true;
    return true;
  },
};
const feeding = createHoneyGouramiSimulation({
  random: randomGenerator(9), food, position: new THREE.Vector3(0, 4.4, 0),
});
feeding.state.yaw = 0;
feeding.state.heading.set(1, 0, 0);
feeding.point(new THREE.Vector3(1.1, 4.4, 1.8), true);
feeding.step(HONEY_STEP);
assert.equal(feeding.state.mode, "curious");
let sawFeed = false, resumedCuriosity = false;
for (let i = 0; i < 60 * 4; i++) {
  feeding.step(HONEY_STEP);
  if (feeding.state.mode === "feed") sawFeed = true;
  if (sawFeed && feeding.state.mode === "curious") resumedCuriosity = true;
  if (feeding.state.eaten) break;
}
assert.equal(sawFeed, true, "food takes priority over curiosity");
assert.equal(feeding.state.strikes, 1, "feeding includes one visible strike");
assert.equal(feeding.state.eaten, 1, "the strike successfully takes the pellet");
for (let i = 0; i < 30; i++) {
  feeding.point(new THREE.Vector3(1.1, 4.4, 1.8), i === 0);
  feeding.step(HONEY_STEP);
  if (feeding.state.mode === "curious") resumedCuriosity = true;
}
assert.equal(resumedCuriosity, true, "curiosity resumes after food is gone");

console.log("PASS: bespoke honey gourami deterministic rig, bounds, curiosity, breathing, food priority and feeding");
