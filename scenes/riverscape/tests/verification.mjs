// Headless verification fixtures and control contract tests. No DOM, WebGL, or browser storage.
import assert from "node:assert/strict";
import { register } from "node:module";
import {
  createVerificationSession,
  listScenarios,
  scenarioFixture,
} from "../src/verification.js";
import { FRESH_COUNT, MATURITY_AGE, POPULATION_CAP } from "../src/breeding.js";
import { HUNT } from "../src/turtle-simulation.js";

function memoryStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}
function query({ scenario, seed, run } = {}) {
  const params = new URLSearchParams();
  if (scenario !== undefined) params.set("scenario", scenario);
  if (seed !== undefined) params.set("seed", String(seed));
  if (run !== undefined) params.set("run", run);
  return params;
}

const ids = listScenarios().map((item) => item.id);
assert.deepEqual(ids, [
  "fresh", "legacy-save", "growth", "full-tank", "turtle-rest", "turtle-walk",
  "turtle-breathe", "hunt-hit", "hunt-miss", "prey-loss", "minimum-population",
]);

// Missing seed must use the documented default, not Number(null) === 0.
{
  const session = createVerificationSession({ query: query({ scenario: "fresh" }), storage: memoryStorage() });
  assert.equal(session.seed, 42);
  assert.equal(session.run, "default");
  assert.equal(session.state().seed, 42);
}
{
  const session = createVerificationSession({ query: query({ seed: "not-a-number" }), storage: memoryStorage() });
  assert.equal(session.seed, 42);
}

// A blocked localStorage getter must not prevent fixture construction. Saving reports
// false, while state metadata exposes the reason to an evidence runner.
{
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() { throw new Error("SecurityError"); },
  });
  try {
    const session = createVerificationSession({ query: query({ scenario: "fresh" }) });
    assert.equal(session.savePopulation(session.fixture), false);
    assert.equal(session.state().metadata.storage.available, false);
    assert.match(session.state().metadata.storage.warning, /unavailable|skipped/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor);
    else delete globalThis.localStorage;
  }
}

// Every fixture is deterministic and uses an isolated, namespaced save key.
for (const id of ids) {
  const first = scenarioFixture(id);
  const second = scenarioFixture(id);
  assert.deepEqual(first.fish.map(({ id: fishId }) => fishId), second.fish.map(({ id: fishId }) => fishId), `${id}: repeatable fish IDs`);
  assert.equal(new Set(first.fish.map(({ id: fishId }) => fishId)).size, first.fish.length, `${id}: unique fish IDs`);
  assert.ok(first.fish.length >= 1 && first.fish.length <= POPULATION_CAP || id === "legacy-save");
}
assert.equal(scenarioFixture("fresh").fish.length, FRESH_COUNT);
assert.ok(scenarioFixture("fresh").fish.every(({ breedIn }) => breedIn === 0), "fresh adults start ready while tank cooldown is armed");
assert.equal(scenarioFixture("full-tank").fish.length, POPULATION_CAP);
assert.equal(scenarioFixture("legacy-save").fish.length, 24);
assert.deepEqual(
  scenarioFixture("growth").fish.slice(0, 3).map(({ age, adult }) => ({ age, adult })),
  [{ age: 0, adult: false }, { age: MATURITY_AGE / 2, adult: false }, { age: MATURITY_AGE, adult: true }],
);
assert.equal(scenarioFixture("minimum-population").fish.length, HUNT.minPopulation);

// A saved verification fixture reloads as the durable population, rather than appending
// another fixture. The normal tank key is never touched.
{
  const storage = memoryStorage();
  storage.setItem("desktop-habitats/tank:v1", "normal tank data");
  const first = createVerificationSession({ query: query({ scenario: "legacy-save", seed: 42, run: "safe-run" }), storage });
  assert.equal(first.savePopulation(first.fixture), true);
  assert.equal(storage.getItem("desktop-habitats/tank:v1"), "normal tank data");
  const second = createVerificationSession({ query: query({ scenario: "legacy-save", seed: 42, run: "safe-run" }), storage });
  const restored = second.load();
  assert.equal(restored.fish.length, 24);
  assert.deepEqual(restored.fish.map(({ id }) => id), first.fixture.fish.map(({ id }) => id));
  assert.notEqual(second.key, "desktop-habitats/tank:v1");
  second.resetStorage();
  assert.equal(second.load(), null);
  assert.equal(storage.getItem("desktop-habitats/tank:v1"), "normal tank data");
}

// Initial event metadata tells evidence whether a clip is prepared or natural. Dynamic
// checks stay not-exercised until the relevant event has had time to happen.
{
  const storage = memoryStorage();
  const session = createVerificationSession({ query: query({ scenario: "hunt-hit" }), storage });
  const state = session.state();
  assert.equal(state.metadata.class, "prepared-condition");
  assert.ok(state.metadata.controlledStimuli.some((item) => item.startsWith("placed-prey:")));
  assert.equal(state.checks.find((check) => check.id === "hunt-hit").status, "not-exercised");
  assert.equal(state.checks.find((check) => check.id === "hunt-hit").status, "not-exercised");
}

// The public control shape is headless-testable and step bounds are deterministic.
{
  const calls = [];
  const session = createVerificationSession({ query: query({ scenario: "fresh" }), storage: memoryStorage() });
  const api = session.api({
    step: (frames) => calls.push(frames),
    pause: () => calls.push("pause"),
    play: () => calls.push("play"),
  });
  api.pause(); api.play(); api.step(9999);
  assert.deepEqual(calls, ["pause", "play", 600]);
  for (const name of ["list", "state", "pause", "play", "step", "reset", "save", "reload", "export"])
    assert.equal(typeof api[name], "function", `public API has ${name}()`);
}

// Real headless scene integration: the actual fish school updates first, then the
// verification hook prepares only the named stimulus before the real turtle simulation.
// This catches moving-snount prey, repeated miss stimulus, and post-catch retargeting.
register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { createFishSchool } = await import("../src/fish.js");
const { createFood } = await import("../src/food.js");
const { createTurtle } = await import("../src/turtle.js");
const { randomGenerator } = await import("../src/math.js");

async function runPreparedHunt(id, seed = 42) {
  const storage = memoryStorage();
  const session = createVerificationSession({ query: query({ scenario: id, seed, run: `headless-${id}-${seed}` }), storage });
  const scene = new THREE.Scene();
  const food = createFood(scene, { thickets: [] });
  let time = 0;
  let scatteredAtSnap = 0;
  let fish;
  const turtle = createTurtle(scene, {
    ground: () => 0,
    obstacles: [], swimObstacles: [], beds: [],
    turtle: session.fixture.turtle,
    random: randomGenerator(seed + 1),
    options: session.options,
    onCatch: (sid) => fish.remove(sid),
    onSnap: (snap) => {
      scatteredAtSnap = fish.scatter(snap);
      session.record(time, "hunt-snap", { ...snap, scattered: scatteredAtSnap });
    },
  });
  fish = createFishSchool(scene, {
    obstacles: [], landmarks: [], thickets: [], food, lure: turtle.lure,
    population: session.fixture, random: randomGenerator(seed),
  });
  session.bind({
    snapshot: () => { const value = fish.snapshotPopulation(); value.turtle = turtle.snapshot(); return value; },
    turtleState: turtle.getState(), stats: () => ({}), telemetry: () => ({}),
    paused: () => true, simulationTime: () => time,
  });
  session.prepareScene({ fish, turtle });
  for (let i = 0; i < 20 * 60; i++) {
    time += 1 / 60;
    fish.update(1 / 60, time, null);
    session.observeFish(time, fish);
    session.beforeTurtleUpdate({ simulationTime: time, fish, turtle });
    turtle.update(1 / 60, fish.fish);
    session.observeTurtle(time, turtle);
  }
  const result = turtle.getState().hunt;
  const state = session.state();
  fish.dispose(); turtle.dispose(); food.dispose?.();
  return { result, state, scatteredAtSnap };
}
for (const seed of [1, 42, 100]) {
  const { result, state, scatteredAtSnap } = await runPreparedHunt("hunt-hit", seed);
  assert.ok(result.hits >= 1, `prepared real-school hit completed for seed ${seed} (${result.hits})`);
  assert.ok(scatteredAtSnap > 0, `real fish.scatter moves bystanders for seed ${seed} (${scatteredAtSnap})`);
  const setup = state.events.find((event) => event.type === "stimulus-prey-placed");
  assert.equal(setup.details.bystanders.length, 2, `two natural bystanders prepared for seed ${seed}`);
  assert.equal(state.snapshot.fish.length, FRESH_COUNT - 1, `real hit removes exactly one fish for seed ${seed}`);
}
{
  const { result, state, scatteredAtSnap } = await runPreparedHunt("hunt-miss");
  assert.ok(result.misses >= 1, `prepared real-school miss completed (${result.misses})`);
  assert.ok(scatteredAtSnap > 0, `real fish.scatter moves bystanders on miss (${scatteredAtSnap})`);
  assert.equal(state.snapshot.fish.length, FRESH_COUNT, "real miss keeps the population");
}
{
  const { result, state } = await runPreparedHunt("prey-loss");
  assert.equal(result.snaps, 0, "prey loss cancels before a snap");
  assert.equal(result.target, null, "prey loss clears the tracked target");
  assert.equal(state.snapshot.fish.length, FRESH_COUNT - 1, "prey loss removes only the prepared prey");
}

console.log("PASS: verification fixtures, metadata, default seed, isolated reload storage, checks, controls, and real-school hunt stimuli");
