// Deterministic, opt-in verification fixtures for the Riverscape scene.
// This module is loaded only for ?diagnostics=1&verify=1, so normal wallpaper and
// preview pages do not pay for the workbench, its storage, or its event log.
import {
  createPopulation,
  parse,
  serialize,
  SAVE_VERSION,
  fishRecord,
  turtleRecord,
} from "./tank-state.js";
import { FRESH_COUNT, MATURITY_AGE, POPULATION_CAP } from "./breeding.js";
import { CAPACITY } from "./tank-state.js";
import { HUNT } from "./turtle-simulation.js";

const STORAGE_PREFIX = "desktop-habitats/verification/v1";
const DEFAULT_SEED = 42;
const DEFAULT_RUN = "default";

const SCENARIOS = Object.freeze([
  { id: "fresh", title: "Fresh tank", description: "A new tank with mature fish and an armed birth clock." },
  { id: "legacy-save", title: "Legacy save", description: "A v1, 24-fish save that must migrate without duplication." },
  { id: "growth", title: "Growth", description: "A newborn baby grows while the tank runs." },
  { id: "full-tank", title: "Full tank", description: "The population cap is full and cannot breed past it." },
  { id: "turtle-rest", title: "Turtle rest", description: "The turtle rests with long running clocks." },
  { id: "turtle-walk", title: "Turtle walk", description: "Short rest intervals make a slow shuffle easy to inspect." },
  { id: "turtle-breathe", title: "Turtle breathe", description: "The turtle starts due for a real surface trip." },
  { id: "hunt-hit", title: "Hunt hit", description: "A deterministic prey placement lets the real strike catch one fish." },
  { id: "hunt-miss", title: "Hunt miss", description: "The real strike is made to miss by moving prey at resolution." },
  { id: "prey-loss", title: "Prey loss", description: "The selected prey disappears before the real strike resolves." },
  { id: "minimum-population", title: "Minimum population", description: "The protected minimum blocks hunting." },
]);
const SCENARIO_IDS = new Set(SCENARIOS.map(({ id }) => id));

function evidenceMetadata(id) {
  const common = {
    class: "prepared-condition",
    naturalBehavior: false,
    pacing: "Do not use this fixture to claim production frequency or rarity.",
  };
  if (id === "turtle-rest") return {
    ...common,
    fixtureOverrides: { restMin: 1000, restMax: 1000, breathIn: 1000, breathMin: 1000, breathMax: 1000 },
    controlledStimuli: [],
    note: "Long clocks make a resting reference; this does not prove natural movement frequency.",
  };
  if (id === "turtle-walk") return {
    ...common,
    fixtureOverrides: { restMin: 0.12, restMax: 0.18, breathMin: 1000, breathMax: 1000 },
    controlledStimuli: [],
    note: "Shortened rest is a prepared movement demonstration; production timing is not exercised.",
  };
  if (id === "turtle-breathe") return {
    ...common,
    fixtureOverrides: { breathIn: 0, restMin: 1000, restMax: 1000, breatheMin: 0.12, breatheMax: 0.18 },
    controlledStimuli: ["forced-departure: turtle starts due for air"],
    note: "The surface trip is explicitly forced; it does not prove natural breath timing.",
  };
  if (id === "hunt-hit") return {
    ...common,
    fixtureOverrides: { hunger: 1, breathIn: 1000, restMin: 1000, restMax: 1000, breathMin: 1000, breathMax: 1000 },
    controlledStimuli: ["placed-prey: target starts in the strike corridor", "held-prey: target is positioned after each real school update", "bystanders-placed: two live fish placed near snap radius, then left to school updates"],
    note: "The school, turtle aim, reach, catch and removal remain production logic; prey placement is prepared.",
  };
  if (id === "hunt-miss") return {
    ...common,
    fixtureOverrides: { hunger: 1, breathIn: 1000, restMin: 1000, restMax: 1000, breathMin: 1000, breathMax: 1000 },
    controlledStimuli: ["placed-prey: target starts in the strike corridor", "stimulus-prey-moved: target leaves reach at strike resolution", "bystanders-placed: two live fish placed near snap radius, then left to school updates"],
    note: "The miss is deterministic stimulus, not a claim about natural escape odds.",
  };
  if (id === "prey-loss") return {
    ...common,
    fixtureOverrides: { hunger: 1, breathIn: 1000, restMin: 1000, restMax: 1000, breathMin: 1000, breathMax: 1000, minPopulation: 7 },
    controlledStimuli: ["placed-prey: target starts in the strike corridor", "stimulus-prey-loss: target is removed during track; protected floor blocks retargeting"],
    note: "Prey loss is an explicit safety stimulus; the real hunt cancels during tracking before a strike.",
  };
  if (id === "growth") return {
    ...common,
    fixtureOverrides: { stages: ["newborn age 0, adult false", "halfway age 2700, adult false", "adult age 5400, adult true"], birthCooldown: 100000 },
    controlledStimuli: [],
    note: "Three prepared stages support a 90-minute normal-time review; growth itself advances only in running simulation time.",
  };
  return {
    ...common,
    fixtureOverrides: id === "legacy-save"
      ? { source: "version 1 save migrated at load", turtle: "deterministic turtle identity minted for the legacy fixture" }
      : id === "minimum-population"
        ? { hunger: 1, breathIn: 1000 }
        : {},
    controlledStimuli: [],
    note: "No controlled prey or movement stimulus is applied.",
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const safePart = (value, fallback) => {
  const text = String(value ?? fallback).trim();
  const safe = text.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80);
  return safe || fallback;
};
const numberSeed = (value) => {
  if (value === null || value === undefined || value === "") return DEFAULT_SEED;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : DEFAULT_SEED;
};
function deterministicIds(prefix) {
  let next = 0;
  return () => `${prefix}-${next++}`;
}
function population({ id, count = FRESH_COUNT, age = MATURITY_AGE, breedIn = 0, tankBreedIn = 600, turtle = {} } = {}) {
  const ids = deterministicIds(`verify-${id}`);
  const turtleId = turtle.id ?? `verify-${id}-turtle`;
  const result = createPopulation({
    count,
    age,
    breedIn,
    tankBreedIn,
    id: ids,
    turtleId: () => turtleId,
  });
  Object.assign(result.turtle, turtleRecord(
    turtleId,
    turtle.hunger ?? 0,
    turtle.feedIn ?? 0,
    turtle.retryIn ?? 0,
    turtle.breathIn ?? null,
  ));
  return result;
}

/** Return a fresh, deterministic durable population for a named fixture. */
export function scenarioFixture(id) {
  if (!SCENARIO_IDS.has(id)) id = "fresh";
  if (id === "legacy-save") {
    const raw = {
      version: 1,
      fish: Array.from({ length: 24 }, (_, index) => ({
        id: `legacy-fish-${index}`,
        species: "bloodfin-tetra",
        age: 7200 + index,
      })),
    };
    return parse(JSON.stringify(raw));
  }
  if (id === "growth") {
    // Three durable stages make a normal 90-minute review useful: newborn, halfway, adult.
    // Birth cooldowns stay armed so the fixture does not add random newborn IDs while it runs.
    const result = population({ id, count: FRESH_COUNT, tankBreedIn: 100000 });
    result.fish[0] = fishRecord(result.fish[0].id, result.fish[0].species, 0, 100000, false);
    result.fish[1] = fishRecord(result.fish[1].id, result.fish[1].species, MATURITY_AGE / 2, 100000, false);
    result.fish[2] = fishRecord(result.fish[2].id, result.fish[2].species, MATURITY_AGE, 100000, true);
    return result;
  }
  if (id === "full-tank") return population({ id, count: POPULATION_CAP });
  if (id === "turtle-rest") {
    return population({ id, turtle: { hunger: 0, breathIn: 1000 } });
  }
  if (id === "turtle-walk") {
    return population({ id, turtle: { hunger: 0, breathIn: 1000 } });
  }
  if (id === "turtle-breathe") {
    return population({ id, turtle: { hunger: 0, breathIn: 0 } });
  }
  if (id === "hunt-hit" || id === "hunt-miss" || id === "prey-loss") {
    return population({ id, turtle: { hunger: 1, breathIn: 1000 } });
  }
  if (id === "minimum-population") {
    return population({ id, count: HUNT.minPopulation, turtle: { hunger: 1, breathIn: 1000 } });
  }
  return population({ id: "fresh", count: FRESH_COUNT, tankBreedIn: 600 });
}

/** Options are passed to the real turtle simulation only for verification fixtures. */
export function scenarioOptions(id) {
  if (id === "turtle-rest") return { restMin: 1000, restMax: 1000, breathMin: 1000, breathMax: 1000 };
  if (id === "turtle-walk") return { restMin: 0.12, restMax: 0.18, breathMin: 1000, breathMax: 1000 };
  if (id === "turtle-breathe") return { restMin: 1000, restMax: 1000, breatheMin: 0.12, breatheMax: 0.18 };
  if (id === "hunt-hit" || id === "hunt-miss" || id === "prey-loss") {
    // Keep production aim, strike, hold, and settle timing for normal-speed evidence.
    // Only the long idle wait is removed so a prepared hunt starts promptly.
    return {
      restMin: 1000, restMax: 1000, breathMin: 1000, breathMax: 1000,
      ...(id === "prey-loss" ? { minPopulation: 7 } : {}),
    };
  }
  return {};
}

function storageKey(scenario, seed, run) {
  return `${STORAGE_PREFIX}/${safePart(run, DEFAULT_RUN)}/${safePart(scenario, "fresh")}/${seed}`;
}

function detailsFor(id, snapshot, runtime) {
  const fish = snapshot?.fish ?? [];
  const turtle = snapshot?.turtle;
  const state = runtime?.turtleState;
  const count = fish.length;
  const statuses = [];
  const add = (checkId, label, passed, detail, exercised = true) => statuses.push({
    id: checkId,
    label,
    status: !exercised ? "not-exercised" : passed ? "passed" : "failed",
    detail,
  });
  add("scenario-loaded", "Scenario fixture loaded", Boolean(snapshot), snapshot ? id : "no fixture");
  add("durable-population", "Durable population is valid", count > 0 && count <= CAPACITY,
    `${count} fish in the parsed durable snapshot`);
  if (id === "fresh") add("fresh-count", "Fresh tank starts small", count === FRESH_COUNT + 10,
    `expected ${FRESH_COUNT + 10}, got ${count}`);
  if (id === "legacy-save") {
    add("legacy-count", "Legacy population preserved", count === 24, `expected 24, got ${count}`);
    add("legacy-ids", "Legacy IDs preserved", fish[0]?.id === "legacy-fish-0" && fish[23]?.id === "legacy-fish-23",
      "v1 IDs survive migration");
  }
  if (id === "growth") {
    const baby = fish.find((record) => record.adult === false);
    add("baby-present", "Baby remains durable", Boolean(baby), baby ? `age ${baby.age}` : "no baby record");
    add("baby-grows", "Baby age advances", Boolean(baby && baby.age > 0), baby ? `age ${baby.age}` : "not exercised", Boolean(baby && baby.age > 0));
  }
  if (id === "full-tank") add("population-cap", "Population stays at cap", count === CAPACITY,
    `expected ${CAPACITY}, got ${count}`);
  if (id === "turtle-rest") add("turtle-resting", "Turtle is resting", state?.mode === "rest", state?.mode ?? "not exercised", Boolean(state));
  if (id === "turtle-walk") {
    const exercised = (state?.transitions ?? 0) > 0 || state?.mode === "shuffle";
    add("turtle-walked", "Turtle enters a walk", exercised,
      state ? `${state.mode}, ${state.transitions} transitions` : "not exercised", exercised);
  }
  if (id === "turtle-breathe") {
    const exercised = state?.mode === "swim" || (state?.trips ?? 0) > 0;
    add("turtle-breathed", "Turtle starts a surface trip", exercised,
      state ? `${state.mode}, ${state.trips} trips` : "not exercised", exercised);
    const returned = (state?.trips ?? 0) > 0;
    add("turtle-returned", "Surface trip returns to the floor", returned,
      `${state?.trips ?? 0} completed trips`, returned);
  }
  if (id === "hunt-hit") {
    const hits = state?.hunt?.hits ?? 0;
    const exercised = (state?.hunt?.snaps ?? 0) > 0;
    const snap = runtime?.events?.find?.((event) => event.type === "hunt-snap");
    add("hunt-hit", "Real hunt catches prey", hits > 0, `${hits} hit(s)`, exercised);
    add("catch-reduces-population", "Hit removes exactly one fish", hits === 1 && count === FRESH_COUNT + 9,
      `${count} fish after ${hits} hit(s)`, exercised);
    add("catch-hunger-cooldown", "Meal lowers hunger and starts a cooldown", turtle?.hunger < 0.2 && turtle?.feedIn > 0,
      `hunger ${turtle?.hunger}, feedIn ${turtle?.feedIn}`, exercised);
    add("scatter-visible", "Bystanders scatter on hit", Number(snap?.details?.scattered) > 0,
      snap ? `${snap.details.scattered} fish scattered` : "not exercised", exercised);
  }
  if (id === "hunt-miss") {
    const misses = state?.hunt?.misses ?? 0;
    const exercised = (state?.hunt?.snaps ?? 0) > 0;
    const snap = runtime?.events?.find?.((event) => event.type === "hunt-snap");
    add("hunt-miss", "Real hunt misses prey", misses > 0, `${misses} miss(es)`, exercised);
    add("miss-keeps-prey", "Miss keeps population", count === FRESH_COUNT + 10,
      `${count} fish after ${misses} miss(es)`, exercised);
    add("scatter-visible", "Bystanders scatter on miss", Number(snap?.details?.scattered) > 0,
      snap ? `${snap.details.scattered} fish scattered` : "not exercised", exercised);
  }
  if (id === "prey-loss") {
    const cancelled = runtime?.preyLoss && state?.hunt?.target === null && ["idle", "watch"].includes(state?.hunt?.phase);
    add("prey-loss", "Missing prey cancels safely", Boolean(cancelled), cancelled ? "tracked prey disappeared before the strike" : "waiting", Boolean(runtime?.preyLoss));
  }
  if (id === "minimum-population") {
    const snaps = state?.hunt?.snaps ?? 0;
    const exercised = (runtime?.simulationTime?.() ?? 0) >= 1;
    add("minimum-protected", "Protected minimum blocks hunting", count === HUNT.minPopulation && snaps === 0,
      `${count} fish, ${snaps} snap(s)`, exercised);
  }
  if (turtle) add("turtle-durable", "Turtle state is durable", typeof turtle.id === "string", turtle.id ?? "missing");
  return statuses;
}

export function listScenarios() {
  return SCENARIOS.map((scenario) => ({ ...scenario }));
}

/**
 * Build the browser-side verification session. The returned storage adapter is deliberately
 * separate from tank-storage.js: it cannot read or write the normal preview key or a host tank.
 */
export function createVerificationSession({ query, storage } = {}) {
  let store = storage;
  let storageWarning = null;
  if (store === undefined) {
    try {
      store = globalThis.localStorage;
    } catch {
      store = null;
      storageWarning = "verification storage is unavailable; running memory-only";
    }
  }
  if (!store && !storageWarning) storageWarning = "verification storage is unavailable; running memory-only";
  const scenario = SCENARIO_IDS.has(query?.get("scenario")) ? query.get("scenario") : "fresh";
  const seed = numberSeed(query?.get("seed"));
  const run = safePart(query?.get("run"), DEFAULT_RUN);
  const key = storageKey(scenario, seed, run);
  const fixture = scenarioFixture(scenario);
  const options = scenarioOptions(scenario);
  const evidence = evidenceMetadata(scenario);
  const storageMetadata = () => ({ available: Boolean(store), warning: storageWarning });
  const events = [{ timestamp: 0, type: "scenario-loaded", details: { scenario, seed, run, evidence, storage: storageMetadata() } }];
  let runtime = null;
  let preyLoss = false;
  let missStimulus = false;
  let targetSid = null;
  let preparedPreyPoint = null;
  let bystanderIds = [];
  let huntFinished = false;
  let observedFishIds = null;
  let observedMode = null;
  let observedHuntPhase = null;

  function load() {
    try {
      const saved = typeof store?.getItem === "function" ? store.getItem(key) : null;
      return parse(saved) ?? null;
    } catch {
      storageWarning = "verification storage read failed; running memory-only";
      return null;
    }
  }
  function savePopulation(value) {
    try {
      const text = serialize(value);
      if (typeof store?.setItem !== "function") {
        storageWarning = storageWarning ?? "verification storage is unavailable; save skipped";
        return false;
      }
      store.setItem(key, text);
      return true;
    } catch {
      storageWarning = "verification storage write failed; save skipped";
      return false;
    }
  }
  function storageAdapter() {
    return { initial: load, save: savePopulation };
  }
  function resetStorage() {
    try { store?.removeItem?.(key); } catch { storageWarning = "verification storage reset failed"; }
  }
  function record(timestamp, type, details = {}) {
    events.push({ timestamp: Number.isFinite(timestamp) ? Number(timestamp.toFixed(3)) : 0, type, details: clone(details) });
  }
  function bind(next) { runtime = next; }
  function prepareScene({ fish, turtle }) {
    if (!runtime || !fish || !turtle || !["hunt-hit", "hunt-miss", "prey-loss"].includes(scenario)) return;
    const pose = turtle.getState();
    // Adult proportions vary by seeded fish. Choose a live fish the production turtle
    // would accept instead of assuming slot zero fits maxPreySize for every seed.
    const target = fish.fish.find((item) => Number(item.size) > 0 && item.size <= HUNT.maxPreySize);
    if (!target) return;
    const headingX = Math.cos(pose.yaw), headingZ = -Math.sin(pose.yaw);
    preparedPreyPoint = { x: pose.snout.x + headingX * 0.52, y: pose.snout.y, z: pose.snout.z + headingZ * 0.52 };
    targetSid = target.sid;
    target.position.set(preparedPreyPoint.x, preparedPreyPoint.y, preparedPreyPoint.z);
    target.velocity?.set(0, 0, 0);
    const bystanders = fish.fish.filter((item) => item !== target).slice(0, 2);
    bystanderIds = bystanders.map((item) => item.sid);
    const offsets = [0.55, -0.55];
    for (let i = 0; i < bystanders.length; i++) {
      bystanders[i].position.set(preparedPreyPoint.x, preparedPreyPoint.y, preparedPreyPoint.z + offsets[i]);
      bystanders[i].velocity?.set(0, 0, 0);
    }
    observedFishIds = new Set(fish.fish.map((item) => item.sid));
    const current = turtle.getState();
    observedMode = current.mode;
    observedHuntPhase = current.hunt.phase;
    record(0, "stimulus-prey-placed", {
      preyId: target.sid,
      size: target.size,
      mode: "initial fixture placement",
      selection: `live fish with size <= HUNT.maxPreySize (${HUNT.maxPreySize})`,
      bystanders: bystanderIds,
      bystanderMotion: "natural school updates after initial placement; not held",
    });
  }
  function observeFish(timestamp, fish) {
    if (!runtime || !fish) return;
    const now = new Set(fish.fish.map((item) => item.sid));
    if (observedFishIds) {
      for (const sid of now) if (!observedFishIds.has(sid)) record(timestamp, "birth", { fishId: sid });
    }
    observedFishIds = now;
  }
  function observeTurtle(timestamp, turtle) {
    if (!runtime || !turtle) return;
    const current = turtle.getState();
    if (observedMode !== null && current.mode !== observedMode)
      record(timestamp, "turtle-mode", { from: observedMode, to: current.mode });
    if (observedHuntPhase !== null && current.hunt.phase !== observedHuntPhase)
      record(timestamp, "hunt-phase", { from: observedHuntPhase, to: current.hunt.phase });
    observedMode = current.mode;
    observedHuntPhase = current.hunt.phase;
  }
  function beforeTurtleUpdate({ simulationTime, fish, turtle }) {
    if (!runtime || !fish || !turtle) return;
    if (!["hunt-hit", "hunt-miss", "prey-loss"].includes(scenario)) return;
    const pose = turtle.getState();
    if (pose.hunt.snaps > 0) huntFinished = true;
    if (huntFinished || !targetSid || !preparedPreyPoint) return;
    const target = fish.fish.find((item) => item.sid === targetSid) ?? null;
    if (!target) return;
    const headingX = Math.cos(pose.yaw), headingZ = -Math.sin(pose.yaw);
    if (scenario === "prey-loss" && pose.hunt.phase === "track" && !preyLoss) {
      preyLoss = fish.remove(targetSid);
      record(simulationTime, "stimulus-prey-loss", { preyId: targetSid, removed: preyLoss, phase: "track" });
      return;
    }
    if (pose.hunt.phase === "strike") {
      if (scenario === "hunt-miss") {
        if (!missStimulus) {
          target.position.set(preparedPreyPoint.x + headingX * 2, preparedPreyPoint.y, preparedPreyPoint.z + headingZ * 2);
          target.velocity?.set(0, 0, 0);
          missStimulus = true;
          record(simulationTime, "stimulus-prey-moved", { preyId: targetSid, reason: "deterministic miss" });
        }
        return;
      }
      if (scenario === "prey-loss") return;
      // During a prepared hit, keep prey at one fixed world point through the lunge.
      // This is not snout chasing: the real strike resolves against stable geometry.
      target.position.set(preparedPreyPoint.x, preparedPreyPoint.y, preparedPreyPoint.z);
      target.velocity?.set(0, 0, 0);
      return;
    }
    if (["idle", "watch", "track"].includes(pose.hunt.phase)) {
      target.position.set(preparedPreyPoint.x, preparedPreyPoint.y, preparedPreyPoint.z);
      target.velocity?.set(0, 0, 0);
    }
  }
  function state() {
    const current = runtime?.snapshot?.() ?? clone(load() ?? fixture);
    const runtimeState = runtime?.turtleState ?? null;
    const stats = runtime?.stats?.() ?? null;
    return {
      scenario, seed, run, paused: Boolean(runtime?.paused?.()),
      simulationTime: Number(runtime?.simulationTime?.() ?? 0),
      snapshot: clone(current),
      stats: stats ? clone(stats) : {},
      turtle: runtimeState ? clone({
        x: runtimeState.x, y: runtimeState.y, z: runtimeState.z, yaw: runtimeState.yaw,
        mode: runtimeState.mode, swim: runtimeState.swim, trips: runtimeState.trips,
        snout: runtimeState.snout, hunt: runtimeState.hunt,
      }) : null,
      events: clone(events),
      checks: detailsFor(scenario, current, { ...runtime, turtleState: runtimeState, events, preyLoss }),
      metadata: { ...clone(evidence), storage: storageMetadata() },
      ready: Boolean(runtime),
    };
  }
  function api(callbacks = {}) {
    return {
      list: listScenarios,
      state,
      pause() { callbacks.pause?.(); return state(); },
      play() { callbacks.play?.(); return state(); },
      step(frames = 1) {
        const count = Math.max(1, Math.min(600, Math.floor(Number(frames) || 1)));
        callbacks.step?.(count);
        return state();
      },
      reset() {
        resetStorage();
        callbacks.reset?.();
        return state();
      },
      save() { return Boolean(callbacks.save?.() ?? savePopulation(runtime?.snapshot?.() ?? fixture)); },
      reload() {
        const ok = Boolean(callbacks.save?.() ?? savePopulation(runtime?.snapshot?.() ?? fixture));
        callbacks.reload?.();
        return ok;
      },
      export: state,
    };
  }
  return {
    scenario, seed, run, key, fixture, options, load, savePopulation, storage: storageAdapter,
    resetStorage, record, bind, prepareScene, observeFish, observeTurtle, beforeTurtleUpdate, state, api,
    get preyLoss() { return preyLoss; },
  };
}

export function installVerificationControls(api, scenarios = listScenarios()) {
  if (typeof document === "undefined" || document.getElementById("verification-controls")) return;
  const panel = document.createElement("div");
  panel.id = "verification-controls";
  panel.style.cssText = "position:fixed;z-index:20;left:12px;top:12px;padding:8px;background:#07130fcc;color:#d9eee4;border:1px solid #507565;border-radius:6px;font:12px system-ui;display:flex;gap:5px;align-items:center";
  const select = document.createElement("select");
  select.setAttribute("aria-label", "Verification scenario");
  for (const item of scenarios) {
    const option = document.createElement("option");
    option.value = item.id; option.textContent = item.title;
    if (item.id === api.state().scenario) option.selected = true;
    select.append(option);
  }
  select.onchange = () => {
    const url = new URL(location.href);
    url.searchParams.set("scenario", select.value);
    location.href = url.href;
  };
  const button = (label, action) => {
    const element = document.createElement("button"); element.textContent = label; element.onclick = action; return element;
  };
  panel.append(select,
    button("Pause", () => api.pause()), button("Play", () => api.play()),
    button("Step", () => api.step(1)), button("Reset", () => api.reset()),
    button("Save", () => api.save()), button("Reload", () => api.reload()));
  document.body.append(panel);
}

export { DEFAULT_SEED, DEFAULT_RUN, STORAGE_PREFIX, HUNT, SAVE_VERSION };
