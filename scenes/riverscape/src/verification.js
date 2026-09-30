// Deterministic, opt-in verification fixtures for the Riverscape scene.
// This module is loaded only for ?diagnostics=1&verify=1, so normal wallpaper and
// preview pages do not pay for the workbench, its storage, or its event log.
import {
  createPopulation,
  parse,
  serialize,
  SAVE_VERSION,
  fishRecord,
  CAPACITY,
  STOCKED_COUNT,
} from "./tank-state.js";
import { FRESH_COUNT, MATURITY_AGE, POPULATION_CAP } from "./breeding.js";

const STORAGE_PREFIX = "desktop-habitats/verification/v1";
const DEFAULT_SEED = 42;
const DEFAULT_RUN = "default";

const SCENARIOS = Object.freeze([
  { id: "fresh", title: "Fresh tank", description: "A new tank with mature fish and an armed birth clock." },
  { id: "legacy-save", title: "Legacy save", description: "A v1, 24-fish save that must migrate without duplication." },
  { id: "growth", title: "Growth", description: "A newborn baby grows while the tank runs." },
  { id: "full-tank", title: "Full tank", description: "The population cap is full and cannot breed past it." },
]);
const SCENARIO_IDS = new Set(SCENARIOS.map(({ id }) => id));

function evidenceMetadata(id) {
  const common = {
    class: "prepared-condition",
    naturalBehavior: false,
    pacing: "Do not use this fixture to claim production frequency or rarity.",
  };
  if (id === "growth") return {
    ...common,
    fixtureOverrides: { stages: ["newborn age 0, adult false", "halfway age 2700, adult false", "adult age 5400, adult true"], birthCooldown: 100000 },
    controlledStimuli: [],
    note: "Three prepared stages support a 90-minute normal-time review; growth itself advances only in running simulation time.",
  };
  return {
    ...common,
    fixtureOverrides: id === "legacy-save" ? { source: "version 1 save migrated at load" } : {},
    controlledStimuli: [],
    note: "No controlled movement stimulus is applied.",
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
function population({ id, count = FRESH_COUNT, age = MATURITY_AGE, breedIn = 0, tankBreedIn = 600 } = {}) {
  return createPopulation({ count, age, breedIn, tankBreedIn, id: deterministicIds(`verify-${id}`) });
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
  // The birth cap's worth of tetras; the school stocks the later groups on top, which
  // fills the tank to its render capacity.
  if (id === "full-tank") return population({ id, count: POPULATION_CAP });
  return population({ id: "fresh", count: FRESH_COUNT, tankBreedIn: 600 });
}

function storageKey(scenario, seed, run) {
  return `${STORAGE_PREFIX}/${safePart(run, DEFAULT_RUN)}/${safePart(scenario, "fresh")}/${seed}`;
}

function detailsFor(id, snapshot, runtime) {
  const fish = snapshot?.fish ?? [];
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
  if (id === "fresh") add("fresh-count", "Fresh tank starts at its stocked size", count === FRESH_COUNT + STOCKED_COUNT,
    `expected ${FRESH_COUNT + STOCKED_COUNT}, got ${count}`);
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
  if (id === "full-tank") add("population-cap", "Population stays at capacity", count === CAPACITY,
    `expected ${CAPACITY}, got ${count}`);
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
  const evidence = evidenceMetadata(scenario);
  const storageMetadata = () => ({ available: Boolean(store), warning: storageWarning });
  const events = [{ timestamp: 0, type: "scenario-loaded", details: { scenario, seed, run, evidence, storage: storageMetadata() } }];
  let runtime = null;
  let observedFishIds = null;

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
  function observeFish(timestamp, fish) {
    if (!runtime || !fish) return;
    const now = new Set(fish.fish.map((item) => item.sid));
    if (observedFishIds) {
      for (const sid of now) if (!observedFishIds.has(sid)) record(timestamp, "birth", { fishId: sid });
    }
    observedFishIds = now;
  }
  function state() {
    const current = runtime?.snapshot?.() ?? clone(load() ?? fixture);
    const stats = runtime?.stats?.() ?? null;
    return {
      scenario, seed, run, paused: Boolean(runtime?.paused?.()),
      simulationTime: Number(runtime?.simulationTime?.() ?? 0),
      snapshot: clone(current),
      stats: stats ? clone(stats) : {},
      events: clone(events),
      checks: detailsFor(scenario, current, { ...runtime, events }),
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
    scenario, seed, run, key, fixture, load, savePopulation, storage: storageAdapter,
    resetStorage, record, bind, observeFish, state, api,
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

export { DEFAULT_SEED, DEFAULT_RUN, STORAGE_PREFIX, SAVE_VERSION };
