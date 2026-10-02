// Headless verification fixtures and control contract tests. No DOM, WebGL, or browser storage.
import assert from "node:assert/strict";
import { register } from "node:module";
import {
  createVerificationSession,
  listScenarios,
  scenarioFixture,
} from "../src/verification.js";
import { FRESH_COUNT, MATURITY_AGE, POPULATION_CAP } from "../src/breeding.js";
import { CAPACITY, STOCKED_COUNT } from "../src/tank-state.js";

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
assert.deepEqual(ids, ["fresh", "legacy-save", "growth", "full-tank"]);

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
  const session = createVerificationSession({ query: query({ scenario: "growth" }), storage });
  const state = session.state();
  assert.equal(state.metadata.class, "prepared-condition");
  assert.equal(state.metadata.fixtureOverrides.stages.length, 3);
  assert.equal(state.checks.find((check) => check.id === "baby-present").status, "passed");
  assert.equal(state.checks.find((check) => check.id === "baby-grows").status, "not-exercised");
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

// Real headless scene integration: the fresh fixture stocks every species the way the
// scene does, saves at the stocked size, and a reload adds no second group.
register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { createFishSchool } = await import("../src/fish.js");
const { randomGenerator } = await import("../src/math.js");
{
  const storage = memoryStorage();
  const session = createVerificationSession({ query: query({ scenario: "fresh", seed: 42, run: "headless-fresh" }), storage });
  const scene = new THREE.Scene();
  const fish = createFishSchool(scene, {
    obstacles: [], landmarks: [], thickets: [], population: session.fixture,
    stockNewSpecies: true, random: randomGenerator(42),
  });
  session.bind({
    snapshot: () => fish.snapshotPopulation(), stats: () => ({}), telemetry: () => ({}),
    paused: () => true, simulationTime: () => 0,
  });
  let time = 0;
  for (let i = 0; i < 60; i++) {
    time += 1 / 60;
    fish.update(1 / 60, time, null);
    session.observeFish(time, fish);
  }
  const state = session.state();
  assert.equal(state.snapshot.fish.length, FRESH_COUNT + STOCKED_COUNT, "the fresh scene stocks every species once");
  assert.equal(state.checks.find((check) => check.id === "fresh-count").status, "passed");
  assert.ok(session.savePopulation(fish.snapshotPopulation()));
  const again = createFishSchool(new THREE.Scene(), {
    obstacles: [], landmarks: [], thickets: [], population: session.load(),
    stockNewSpecies: true, random: randomGenerator(42),
  });
  assert.equal(again.fish.length, FRESH_COUNT + STOCKED_COUNT, "a reload adds no second group");
  fish.dispose(); again.dispose();
}
{
  const session = createVerificationSession({
    query: query({ scenario: "legacy-save", seed: 42, run: "headless-legacy" }),
    storage: memoryStorage(),
  });
  const fish = createFishSchool(new THREE.Scene(), {
    population: session.fixture,
    stockNewSpecies: true,
    random: randomGenerator(42),
  });
  session.bind({
    snapshot: () => fish.snapshotPopulation(), stats: () => ({}), telemetry: () => ({}),
    paused: () => true, simulationTime: () => 0,
  });
  const state = session.state();
  assert.equal(state.snapshot.fish.length, 24 + STOCKED_COUNT,
    "scene startup preserves all legacy residents and stocks each newer species once");
  assert.equal(state.checks.find((check) => check.id === "legacy-count").status, "passed");
  fish.dispose();
}
{
  const full = createFishSchool(new THREE.Scene(), {
    obstacles: [], landmarks: [], thickets: [], population: scenarioFixture("full-tank"),
    stockNewSpecies: true, random: randomGenerator(42),
  });
  assert.equal(full.fish.length, CAPACITY, "the full tank fixture fills the render capacity once stocked");
  full.dispose();
}

console.log("PASS: verification fixtures, metadata, default seed, isolated reload storage, checks, controls, and real-school stocking");
