// Tank saved state: the part of an aquarium that survives a restart.
//
// A living tank owns far more than can be kept on disk — every fish's spine bend, its
// chosen landmark, the pellet it is chasing. None of that travels. What a restart needs
// is the *identity* of the population — which fish is which, what species it is, how old
// it is in running simulation time — plus the growth and breeding state a fish must not
// lose. This module is the single place that decides what that saved record looks like,
// how it is written and read, and how a bad or unknown file is refused without ever
// throwing into the scene.
//
// It is deliberately free of Three.js and of any host (browser window, Swift wallpaper),
// so it can be unit-tested headless and so a future scene can reuse it untouched. The
// render-only school in fish.js turns a population into live shoaling fish; the storage
// adapter in tank-storage.js decides where the bytes live on each host; the breeding
// engine in breeding.js holds the growth and birth *rules*. This file only owns the
// *shape* of the distribution record and the rules about it.

import {
  FRESH_COUNT,
  POPULATION_CAP,
  MATURITY_AGE,
  TANK_BREED_COOLDOWN,
} from "./breeding.js";

// Re-export the shared counts so a caller (the school, the format tests) can get every
// tank constant from one place; they are defined once in breeding.js.
export { FRESH_COUNT, POPULATION_CAP, MATURITY_AGE, TANK_BREED_COOLDOWN };

// Bump whenever the meaning of a saved record changes in a way an old reader could
// misread. The reader treats any version above the one it knows as "too new to read"
// and starts a fresh tank rather than guess.
export const SAVE_VERSION = 2;

// Species are stored by a short stable key, never by a human-readable display name and
// never by a numbered index, so renaming a species's label or moving it in a list cannot
// silently re-home somebody's fish onto the wrong body.
export const DEFAULT_SPECIES = "bloodfin-tetra";
// A brand-new tank's population. v1 started every tank (and every existing save) at 24;
// issue 02 starts new tanks smaller and lets the population grow slowly toward the cap.
export const DEFAULT_COUNT = FRESH_COUNT;
// The hard population ceiling: how many fish the birth machinery may grow a tank to, and
// how crowded it may ever be. New tanks grow toward it; existing v1 saves at 24 are
// already at or above it, so they simply hold steady. A saved file may never claim more
// than this.
export const MAX_SAVED_FISH = 128;
// The fixed population a v1 (issue 01) save carries: always exactly 24 fish, whatever the
// current POPULATION_CAP tuning says. v1 needs this history, not the live cap, so that a
// later tuning change to POPULATION_CAP can never shift what an old file means.
export const LEGACY_V1_COUNT = 24;
// The restore/render capacity: how many fish a tank can hold into the renderer and how
// many a saved file is trusted to claim. It is the larger of the legacy v1 population and
// the live birth cap, so a future tuning that lowers POPULATION_CAP below LEGACY_V1_COUNT
// can never orphan an existing 24-fish save (the renderer keeps room for it and the reader
// still accepts it). Births alone stop at POPULATION_CAP; this ceiling only guarantees a
// migrated v1 tank keeps every fish it owns and still renders all of them.
export const CAPACITY = Math.max(LEGACY_V1_COUNT, POPULATION_CAP);
// The oldest age a saved fish may claim. Clamped on write (roundAge) and enforced on read
// so a corrupt or hostile value can never become Infinity or NaN in a record. It sits far
// above any age running time could reach; it exists to keep rounding and validation
// finite, not to mark old fish. (The two constants above are the fish-count guards; this
// is the age bound, kept here so the reader enforces exactly one place for each.)
export const MAX_AGE_SECONDS = 10 * 365 * 24 * 3600;

// A counter keeps ids unique within one page even if two fresh populations are created
// close together, and the time+random tail makes ids unique across pages on the same
// machine (the preview and the wallpaper must never hand a fish the same id and then
// fight over it in shared storage).
let idCounter = 0;
/**
 * A globally-unique, opaque fish id. Opaqueness is deliberate: nothing downstream may
 * parse the id for meaning (no "tank 3, slot 7"), because later issues can remove fish
 * and the array index would then change meaning while a saved fish still claimed it.
 */
export function uid(now = Date.now()) {
  idCounter++;
  const random = Math.floor(Math.random() * 0x40000000).toString(36);
  return `f${now.toString(36)}-${idCounter.toString(36)}-${random}`;
}

/** The externally visible species keys the reader knows how to render. */
export const SPECIES_KEYS = Object.freeze([DEFAULT_SPECIES]);

// Age is running simulation time in seconds: time that actually passed while this tank
// was being drawn. It is what the school grows and matures a fish on, and a baby's whole
// childhood. Round on the way onto disk so a thousand tiny float additions never
// accumulate pixel-sized drift into a record.
export function roundAge(age) {
  const n = Number(age);
  // Never let a non-number become NaN on disk, and never let an enormous value overflow to
  // Infinity when multiplied by 1000 for the millisecond round. Non-finite collapses to 0
  // (a fresh fish); a finite value is clamped to the accepted age bound so rounding is safe.
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(Math.max(n, 0), MAX_AGE_SECONDS) * 1000) / 1000;
}

/** A single fish's durable record. `breedIn` is the adult's remaining cooldown in running
 * seconds (0 means ready). `adult` marks a fish born full-grown — any fish whose history
 * predates growth (a v1 save, a fresh tank) — versus a baby born to grow. When absent on
 * disk it defaults to true, so a save without the field keeps its fish adult-sized. */
export function fishRecord(id, species = DEFAULT_SPECIES, age = 0, breedIn = 0, adult = true) {
  return {
    id: String(id),
    species,
    age: roundAge(age),
    breedIn: Math.max(0, Number(breedIn) || 0),
    adult: adult === true,
  };
}

/**
 * A brand-new tank: a smaller population of mature adults at running-age `MATURITY_AGE`,
 * ready to grow the tank slowly through births (the tank-level cooldown is armed so the
 * first birth is a discovery some minutes in, not a switch flipped on frame one). Used
 * the first time a host runs, and whenever an existing save is missing or cannot be read.
 * `options.id` overrides the id maker so tests can build deterministic records; callers
 * should leave it alone.
 */
export function createPopulation({
  count = DEFAULT_COUNT,
  species = DEFAULT_SPECIES,
  age = MATURITY_AGE,
  breedIn = 0,
  tankBreedIn = TANK_BREED_COOLDOWN,
  id = uid,
} = {}) {
  const fish = [];
  for (let i = 0; i < count; i++) fish.push(fishRecord(id(), species, age, breedIn, true));
  return { version: SAVE_VERSION, breedIn: tankBreedIn, fish };
}

// A v1 save is exactly the old fixed population: LEGACY_V1_COUNT (24) fish with only id,
// species and age (no growth or breeding state). These fish were adults at whatever age
// the running time had reached; on the way to v2 the reader preserves each id, species,
// age and count and fills in the new fields with the safe "ready" defaults. A migrated
// tank restores up to CAPACITY (the larger of LEGACY_V1_COUNT and POPULATION_CAP), so it
// always keeps and renders every one of its fish, even if a future tuning lowers
// POPULATION_CAP below 24; the birth machinery alone stays capped at POPULATION_CAP, so
// such a migrated tank holds steady with no surprise births for a tank that never asked
// for them.
function migrateV1(fish) {
  return {
    version: SAVE_VERSION,
    breedIn: 0,
    fish: fish.map((record) => fishRecord(record.id, record.species, record.age)),
  };
}

/**
 * Validate a parsed save and normalize it into the canonical v2 shape. Returns
 * { ok: true, state } on success or { ok: false, error } on any problem, never throws.
 * A v1 file is migrated (ids/species/ages/count kept, breeding fields defaulted); a v2
 * file is accepted with a variable population up to CAPACITY -- the larger of the legacy
 * v1 count and the live birth cap, so a migrated 24-fish tank still restores and renders
 * even after a future tuning lowers POPULATION_CAP below 24. Births (breedMany) alone
 * stop at POPULATION_CAP; this ceiling only describes what restore/render may hold. Only
 * the fields the reader owns are accepted; extra fields in a record are ignored so a newer
 * version that added fields degrades to what this version understands.
 */
export function validate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "not an object" };
  }
  if (!Number.isInteger(value.version) || value.version < 1) {
    return { ok: false, error: "missing or invalid version" };
  }
  if (value.version > SAVE_VERSION) {
    return { ok: false, error: `unsupported future version ${value.version}` };
  }
  if (!Array.isArray(value.fish) || value.fish.length < 1) {
    return { ok: false, error: "missing fish array" };
  }
  if (value.fish.length > MAX_SAVED_FISH) {
    return { ok: false, error: `population of ${value.fish.length} exceeds the ${MAX_SAVED_FISH} cap` };
  }

  // Shared per-record strictness below (never throws on a hostile object, never coerces).
  const readRecord = (record) => {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { error: "a fish record is not an object" };
    }
    // Strict identity: a saved id must be a real, non-blank string. We check the type and
    // only then read it (no String(...) coercion), so a malicious object id can never make
    // parsing throw, and a missing/null id is rejected rather than coerced to "undefined".
    const id = record.id;
    if (typeof id !== "string" || !id.trim()) {
      return { error: "blank fish id" };
    }
    // A hostile object species (e.g. {toString:null, valueOf:null}) must not be coerced
    // into the error text: String(...) on it throws. Refuse with a fixed message instead.
    if (!SPECIES_KEYS.includes(record.species)) {
      return { error: "unknown species" };
    }
    const age = record.age;
    if (
      typeof age !== "number" ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > MAX_AGE_SECONDS
    ) {
      return { error: `invalid age for ${id}` };
    }
    return { id, species: record.species, age };
  };

  // ---- v1 migration: exactly the legacy 24-fish population, no breeding state. ----
  if (value.version === 1) {
    if (value.fish.length !== LEGACY_V1_COUNT) {
      // v1 files always carried exactly LEGACY_V1_COUNT (the old fixed 24 fish),
      // independent of today's POPULATION_CAP tuning. Accepting anything else as v1
      // would be guessing; refuse so a defaced v1 file starts a fresh tank.
      return { ok: false, error: `v1 save has ${value.fish.length} fish; expected ${LEGACY_V1_COUNT}` };
    }
    // Tuning tradeoff: a v1 save is trusted at its full LEGACY_V1_COUNT fish even if the
    // current POPULATION_CAP were lowered below 24 by a future tuning change, because
    // refusing would silently drop the fish the tank owner already has. The reader keeps
    // every one of them up to the restore/render capacity (CAPACITY) and the renderer is
    // sized to the same ceiling, so they all render; the price is only that the birth
    // machinery (capped at POPULATION_CAP) has no room to add a baby until a fish leaves --
    // never a silver loss.
    const fish = [];
    const seen = new Set();
    for (const record of value.fish) {
      const read = readRecord(record);
      if (read.error) return { ok: false, error: read.error };
      if (seen.has(read.id)) return { ok: false, error: `duplicate fish id ${read.id}` };
      seen.add(read.id);
      fish.push(fishRecord(read.id, read.species, read.age));
    }
    return { ok: true, state: migrateV1(fish) };
  }

  // ---- v2: variable population up to the restore/render capacity, breeding state. ----
  if (value.fish.length > CAPACITY) {
    return {
      ok: false,
      error: `population of ${value.fish.length} exceeds the ${CAPACITY} restore capacity`,
    };
  }
  const fish = [];
  const seen = new Set();
  for (const record of value.fish) {
    const read = readRecord(record);
    if (read.error) return { ok: false, error: read.error };
    if (seen.has(read.id)) return { ok: false, error: `duplicate fish id ${read.id}` };
    seen.add(read.id);
    // Cooldown is optional on disk (so old partial v2s, or a hand-built record, still
    // parse); when present it must be a real finite non-negative number, never coerced.
    let breedIn = 0;
    if (record.breedIn !== undefined) {
      if (typeof record.breedIn !== "number" || !Number.isFinite(record.breedIn) || record.breedIn < 0) {
        return { ok: false, error: "invalid breeding cooldown" };
      }
      breedIn = record.breedIn;
    }
    // The adult flag is optional; absent means adult (a save from before growth). When
    // present it must be a real boolean, never coerced.
    let adult = true;
    if (record.adult !== undefined) {
      if (typeof record.adult !== "boolean") {
        return { ok: false, error: "invalid adult flag" };
      }
      adult = record.adult;
    }
    fish.push(fishRecord(read.id, read.species, read.age, breedIn, adult));
  }
  let tankBreedIn = 0;
  if (value.breedIn !== undefined) {
    if (typeof value.breedIn !== "number" || !Number.isFinite(value.breedIn) || value.breedIn < 0) {
      return { ok: false, error: "invalid tank breeding cooldown" };
    }
    tankBreedIn = value.breedIn;
  }
  return { ok: true, state: { version: SAVE_VERSION, breedIn: tankBreedIn, fish } };
}

/**
 * Parse a serialized save into a validated state, or return null if it is missing,
 * malformed, or from an unsupported version. Never throws. Callers that get null must
 * start from a fresh population rather than crash. A v1 string is migrated to v2.
 */
export function parse(text) {
  if (typeof text !== "string" || !text || text.length > 2_000_000) return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const result = validate(raw);
  return result.ok ? result.state : null;
}

/**
 * Serialize a state to the on-disk record. The reader and writer agree on the shape, and
 * saving through this function guarantees the version is stamped, so a file written now
 * can always be read by the same code after an update.
 */
export function serialize(state) {
  const normalized = validate(state);
  if (!normalized.ok) {
    throw new Error(`Cannot serialize an invalid tank state: ${normalized.error}`);
  }
  return JSON.stringify(normalized.state);
}
