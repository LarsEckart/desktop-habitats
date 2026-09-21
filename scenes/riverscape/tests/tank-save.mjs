// Integration tests for save/restore across the live school: a saved population restores
// stable ids/species/ages without duplicates, age advances only while the tank is drawn,
// and a snapshot survives a serialize/parse hand-off to either storage adapter.
//
// These run in Node with a stubbed surface, so both host code paths are exercised without
// a browser: the browser adapter against a fake localStorage, and the wallpaper host
// adapter against a fake WebKit message bridge. The real Swift bridge in Wallpaper.swift
// is not exercised here; it is only manual (see docs/saved-state.md).
import { register } from "node:module";
import assert from "node:assert/strict";
register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { createFishSchool } = await import("../src/fish.js");
const { createPopulation, parse, SAVE_VERSION } = await import("../src/tank-state.js");
const { FRESH_COUNT, POPULATION_CAP, MATURITY_AGE, TANK_BREED_COOLDOWN } = await import("../src/breeding.js");
const { createTankStorage } = await import("../src/tank-storage.js");

const STEP = 1 / 60;
// A v2 population with a variable (non-cap) count and breeding state: 12 fish, one armed
// adult cooldown and a running tank cooldown, so a save/restore must carry it all back.
const saved = { ...createPopulation({ age: 12, count: 12 }), breedIn: 42 };
saved.fish[0].breedIn = 77;
const savedIds = new Set(saved.fish.map((f) => f.id));
const savedCount = saved.fish.length;

// ---------- Restore a saved population into a live school --------------------------
const restored = JSON.parse(JSON.stringify(saved)); // read back like a reload would
const school = createFishSchool(new THREE.Scene(), { population: restored });
assert.equal(school.fish.length, savedCount, "a restored tank keeps its saved population count");
const liveIds = school.fish.map((f) => f.sid);
assert.equal(new Set(liveIds).size, savedCount, "restored ids are unique across the tank");
assert.deepEqual(new Set(liveIds), savedIds, "every loaded fish keeps its saved id");
for (const f of school.fish) {
  assert.equal(f.age, 12, "restored fish carry their saved age");
  assert.equal(f.species, "bloodfin-tetra", "restored fish carry their species key");
}
assert.equal(school.fish[0].breedIn, 77, "restored fish carry their saved breeding cooldown");
school.update(STEP, STEP, null);
assert.ok(school.fish.every((f) => f.position.toArray().every(Number.isFinite)));
school.dispose();

// ---------- Age advances only while the simulation runs ----------------------------
const clock = createFishSchool(new THREE.Scene(), { population: restored });
const before = clock.fish[0].age;
for (let i = 0; i < 600; i++) clock.update(0, i * STEP, null);
assert.equal(clock.fish[0].age, before, "age does not advance while stopped (dt = 0)");
clock.update(STEP, 0, null);
assert.ok(Math.abs(clock.fish[0].age - (before + STEP)) < 1e-9,
  "age advances by the frame step while running");
const secondBefore = clock.fish[5].age;
for (let i = 0; i < 120; i++) clock.update(STEP, i * STEP, null);
assert.ok(Math.abs(clock.fish[5].age - (secondBefore + 120 * STEP)) < 1e-9,
  "age follows elapsed running time for the whole shoal");
clock.dispose();

// ---------- A fresh tank starts smaller than the old 24 and is mature ---------------
// A brand-new school (no population) uses the smaller fresh population, and the tank
// cooldown is armed so a baby is a discovery later rather than a first-frame spawn.
const freshSchool = createFishSchool(new THREE.Scene());
assert.equal(freshSchool.fish.length, FRESH_COUNT, "a new tank starts with the smaller fresh population");
assert.equal(freshSchool.getTelemetry().count, FRESH_COUNT);
assert.ok(freshSchool.fish.every((f) => f.age === 12 || f.age > 0), "fresh fish carry a real age");
assert.equal(freshSchool.snapshotPopulation().breedIn, TANK_BREED_COOLDOWN,
  "a fresh tank arms its tank-level birth cooldown");
// A fresh tank's adults are at MA_AGE (full-grown), so they do not look like fry.
assert.ok(freshSchool.fish.every((f) => f.age >= MATURITY_AGE), "fresh fish are mature adults");
freshSchool.dispose();

// ---------- A v1 save migrates through the live school into a v2 save ---------------
// Feed a real v1 file (24 fish, only id/species/age) to the school; the school adopts it
// whole — ids, ages, count — and its next snapshot is v2 with the count preserved and the
// breeding fields filled in. Nothing about the migrated tank may trigger an instant birth.
const v1 = {
  version: 1,
  fish: Array.from({ length: 24 }, (_, i) => ({
    id: `legacy-${i}`, species: "bloodfin-tetra", age: 5000 + i,
  })),
};
const migrated = parse(JSON.stringify(v1));
assert.ok(migrated, "a v1 save parses (migrations happen in parse)");
assert.equal(migrated.version, SAVE_VERSION, "a migrated save is v2");
assert.equal(migrated.fish.length, 24, "migration preserves the saved count");
assert.deepEqual(migrated.fish.map((f) => f.id), Array.from({ length: 24 }, (_, i) => `legacy-${i}`),
  "migration preserves every saved id");
assert.deepEqual(migrated.fish.map((f) => f.age), Array.from({ length: 24 }, (_, i) => 5000 + i),
  "migration preserves every saved age");
const legacySchool = createFishSchool(new THREE.Scene(), { population: migrated });
assert.equal(legacySchool.fish.length, 24, "the school adopts a migrated 24-fish tank");
assert.equal(legacySchool.snapshotPopulation().version, SAVE_VERSION);
assert.equal(legacySchool.snapshotPopulation().fish.length, 24, "no duplicate fish on the migrated save");
// A migrated tank is at the cap, so the birth gate is closed and no baby appears.
assert.equal(legacySchool.fish.length, POPULATION_CAP);
legacySchool.update(STEP, 0, null);
assert.equal(legacySchool.fish.length, 24, "an at-cap migrated tank cannot spawn a birth");
legacySchool.dispose();

// ---------- Births grow a tank over running time and a save captures the baby ---------
// A fresh school, run at maturity with its tank cooldown exhausted, must produce a baby;
// the snapshot then contains the new fish (a real v2 record, age zero) and writes back an
// incremented population that survives a restore — proving no birth is lost or duplicated.
const growing = createFishSchool(new THREE.Scene());
const growStart = growing.fish.length;
// The fresh tank cooldown must clear and the waterclock advanced past maturity is already
// true (adults are mature); running TANK_BREED_COOLDOWN + room makes the first birth occur.
for (let i = 0; i < (TANK_BREED_COOLDOWN + 2) / STEP; i++) {
  growing.update(STEP, i * STEP, null);
  if (growing.fish.length > growStart) break; // freeze the moment the first baby appears
}
assert.ok(growing.fish.length > growStart, "a fresh tank grows a baby once its cooldown clears");
const bornRound = growing.snapshotPopulation();
assert.ok(bornRound.fish.length >= growStart + 1);
// Let the baby's world wander a little more so its age is a small, bounded number (not yet
// anywhere near maturity), then snapshot again and confirm the birth is durable.
growing.update(STEP, 0, null);
const babySnapshot = growing.snapshotPopulation();
assert.equal(babySnapshot.fish.length, growStart + 1);
const baby = babySnapshot.fish[babySnapshot.fish.length - 1];
assert.ok(baby.age < 1, "a newborn is recorded as a baby (age ~0), far below breeding age");
assert.ok(baby.age === 0 || baby.age < STEP + 0.0001, "a newborn is born at essentially age zero");
assert.equal(baby.breedIn, 0);
assert.ok(new Set(babySnapshot.fish.map((f) => f.id)).size === babySnapshot.fish.length,
  "a birth adds a unique id, never a duplicate");
// The snapshot hands back to a fresh store whole — the baby is retained across a restart.
const babyData = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (babyData.has(k) ? babyData.get(k) : null),
    setItem: (k, v) => babyData.set(k, v),
    removeItem: (k) => babyData.delete(k),
  },
};
const babyStore = createTankStorage({});
babyStore.save(babySnapshot);
// Restoring this snapshot into a brand-new school reproduces the grown population.
const reborn = createFishSchool(new THREE.Scene(), { population: babyStore.initial() });
assert.equal(reborn.fish.length, growStart + 1, "the baby survives save and restore");
reborn.dispose();
growing.dispose();

// ---------- A live snapshot hands back to a working browser store ------------------
const storeData = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storeData.has(k) ? storeData.get(k) : null),
    setItem: (k, v) => storeData.set(k, v),
    removeItem: (k) => storeData.delete(k),
  },
};
const logged = createFishSchool(new THREE.Scene(), { population: restored });
logged.update(STEP, 0, null);
const snapshot = logged.snapshotPopulation();
assert.equal(snapshot.version, SAVE_VERSION);
assert.equal(snapshot.fish.length, savedCount);
assert.ok(Math.abs(snapshot.breedIn - saved.breedIn) < 0.1,
  "the snapshot carries the tank breeding cooldown (minus the one frame of running time)");
const store = createTankStorage({});
assert.equal(store.host, false, "a bare adapter (no host globals) is a browser adapter");
assert.equal(store.save(snapshot), true, "browser save succeeds");

// Re-open storage the way a fresh page would and read it back whole (no duplicates, no loss).
const roundTripped = store.initial();
assert.ok(roundTripped, "the browser save reads back");
assert.deepEqual(new Set(roundTripped.fish.map((f) => f.id)), savedIds,
  "no fish is lost or duplicated across a stop/start");
logged.dispose();

// ---------- Storage failures are never fatal ---------------------------------------
// A store that throws on read must resolve to a fresh tank (null), never crash.
const failingStorage = {
  getItem() { throw new Error("quota exceeded"); },
  setItem() { throw new Error("quota exceeded"); },
};
const originalLS = globalThis.window.localStorage;
globalThis.window.localStorage = failingStorage;
const realWarn = console.warn;
console.warn = () => {}; // silence the adapter's deliberate non-fatal warnings
const brokenStore = createTankStorage({});
assert.equal(brokenStore.initial(), null, "an unreadable save yields a fresh tank");
assert.equal(brokenStore.save(createPopulation()), false, "an unwritable save is refused, not thrown");
console.warn = realWarn;
globalThis.window.localStorage = originalLS;

// A malformed stored value must also yield null (the adapter parses defensively). Write
// raw garbage under the real key (the one the working store wrote) and read it back.
const garbageStore = createTankStorage({});
const realKey = [...storeData.keys()][0];
if (realKey) {
  globalThis.window.localStorage = originalLS;
  globalThis.window.localStorage.setItem(realKey, "not json");
  assert.equal(garbageStore.initial(), null, "a corrupt stored value yields a fresh tank");
}

// ---------- Host (wallpaper) adapter against a fake WebKit bridge ------------------
// The adapter switches to the host path when `globalThis.habitatTankId` is set: it reads
// the injected initial save from `habitatTankInitial` and hands saves back to the host
// through `habitatTankSave` (a page-side alias) or `webkit.messageHandlers.tankSave.`
// Run these last so the host globals cannot leak into the localStorage tests above.
const realHabitatTankId = globalThis.habitatTankId;
const realHabitatTankInitial = globalThis.habitatTankInitial;
const realHabitatTankSave = globalThis.habitatTankSave;
const realWebkit = globalThis.webkit;
const hostMessages = [];
globalThis.habitatTankId = "host-tank-1";
globalThis.habitatTankInitial = JSON.stringify(saved);
globalThis.habitatTankSave = null;
globalThis.webkit = {
  messageHandlers: {
    tankSave: { postMessage: (text) => hostMessages.push(String(text)) },
  },
};

// A host adapter reads the injected initial save whole — same ids, species and age — and
// hands every save back to the bridge as the durable JSON record.
const hostStore = createTankStorage({});
assert.equal(hostStore.host, true, "a host id makes the adapter talk to the host");
const hostInitial = hostStore.initial();
assert.deepEqual(new Set(hostInitial.fish.map((f) => f.id)), savedIds,
  "the host adapter reads its injected save whole");
assert.equal(hostInitial.fish[0].species, "bloodfin-tetra", "host stores carry the species key");
assert.equal(hostStore.save(hostInitial), true, "a host save posts to the WebKit bridge");
assert.equal(hostMessages.length, 1, "a host save posts exactly one message");
assert.deepEqual(
  new Set(JSON.parse(hostMessages[0]).fish.map((f) => f.id)), savedIds,
  "the posted text is the durable record, ids intact");

// Host read failures resolve to a fresh tank, never crash.
globalThis.habitatTankInitial = "not json";
assert.equal(createTankStorage({}).initial(), null, "a corrupt injected save yields a fresh tank");
globalThis.habitatTankInitial = null;
assert.equal(createTankStorage({}).initial(), null, "an absent injected save yields a fresh tank");
globalThis.habitatTankInitial = JSON.stringify(saved);

// Host write failures (the bridge or its alias throws) are a warning and false, never thrown.
const hostWarn = console.warn;
console.warn = () => {};
globalThis.webkit = {
  messageHandlers: { tankSave: { postMessage: () => { throw new Error("bridge down"); } } },
};
assert.equal(createTankStorage({}).save(createPopulation()), false,
  "a throwing WebKit bridge save is refused, not thrown");
globalThis.habitatTankSave = () => { throw new Error("busy"); };
assert.equal(createTankStorage({}).save(createPopulation()), false,
  "a throwing habitatTankSave alias save is refused, not thrown");
console.warn = hostWarn;

// Isolation: each host id is its own tank. A sibling host id with a different injected
// save must never leak into this one's read (two displays never overwrite each other).
globalThis.habitatTankInitial = JSON.stringify(saved);
const isoA = createTankStorage({});
const saveB = createPopulation({ age: 3 });
globalThis.habitatTankInitial = JSON.stringify(saveB);
const isoB = createTankStorage({});
assert.equal(isoA.host, true, "isolation A is a host adapter");
assert.equal(isoB.host, true, "isolation B is a host adapter");
assert.deepEqual(new Set(isoB.initial().fish.map((f) => f.id)), new Set(saveB.fish.map((f) => f.id)),
  "each host id reads its own injected save, not a sibling's");

// Restore the shared globals so a later test run starts clean.
globalThis.habitatTankId = realHabitatTankId;
globalThis.habitatTankInitial = realHabitatTankInitial;
globalThis.habitatTankSave = realHabitatTankSave;
globalThis.webkit = realWebkit;

console.log("PASS: school save/restore, stable ids/species/age, running-only age, both storage adapters and failures");
