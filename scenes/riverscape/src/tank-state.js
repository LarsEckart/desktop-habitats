// Tank saved state: the part of an aquarium that survives a restart.
//
// A living tank owns far more than can be kept on disk — every fish's spine bend, its
// chosen landmark, the pellet it is chasing. None of that travels. What a restart needs
// is the *identity* of the population: which fish is which, what species it is, and how
// much running simulation time has passed since it was born. This module is the single
// place that decides what that saved record looks like, how it is written and read, and
// how a bad or unknown file is refused without ever throwing into the scene.
//
// It is deliberately free of Three.js and of any host (browser window, Swift wallpaper),
// so it can be unit-tested headless and so a future scene can reuse it untouched. The
// render-only school in fish.js turns a population into live shoaling fish; the storage
// adapter in tank-storage.js decides where the bytes live on each host. This file only
// owns the *shape* of the record and the rules about it.

// Bump whenever the meaning of a saved record changes in a way an old reader could
// misread. The reader treats any version above the one it knows as "too new to read"
// and starts a fresh tank rather than guess.
export const SAVE_VERSION = 1;

// Species are stored by a short stable key, never by a human-readable display name and
// never by a numbered index, so renaming a species's label or moving it in a list cannot
// silently re-home somebody's fish onto the wrong body.
export const DEFAULT_SPECIES = "bloodfin-tetra";
export const DEFAULT_COUNT = 24;
// The largest population a saved file may claim. v1 saves are exactly DEFAULT_COUNT; this
// bound is a belt-and-braces guard on top of that (DEFAULT_COUNT < MAX) so a corrupt file
// can never inflate a restore on a machine that later grows a variable count. Variable
// restored counts — births — are deliberately out of scope for v1 and deferred to a
// version migration (v2), as documented in docs/saved-state.md.
export const MAX_SAVED_FISH = 128;
// The oldest fish this reader accepts, in seconds of running simulation time (about ten
// years). Real ages stay far below this; the bound exists so a corrupt file claiming, say,
// 1e308 cannot overflow to Infinity when the age is rounded to the millisecond for disk.
// Anything older is refused as invalid — the whole save is rejected and a fresh tank
// starts — rather than silently resurrected with an absurd age.
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
// was being drawn. It is what later issues grow a fish on. Round on the way onto disk so
// a thousand tiny float additions never accumulate pixel-sized drift into a record.
export function roundAge(age) {
  const n = Number(age);
  // Never let a non-number become NaN on disk, and never let an enormous value overflow to
  // Infinity when multiplied by 1000 for the millisecond round. Non-finite collapses to 0
  // (a fresh fish); a finite value is clamped to the accepted age bound so rounding is safe.
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(Math.max(n, 0), MAX_AGE_SECONDS) * 1000) / 1000;
}

/** A single fish's durable record. */
export function fishRecord(id, species = DEFAULT_SPECIES, age = 0) {
  return { id: String(id), species, age: roundAge(age) };
}

/**
 * A brand-new tank: a full population at age zero. Used the first time a host runs, and
 * whenever an existing save is missing or cannot be read. `options.id` overrides the id
 * maker so tests can build deterministic records; callers should leave it alone.
 */
export function createPopulation({
  count = DEFAULT_COUNT,
  species = DEFAULT_SPECIES,
  age = 0,
  id = uid,
} = {}) {
  const fish = [];
  for (let i = 0; i < count; i++) fish.push(fishRecord(id(), species, age));
  return { version: SAVE_VERSION, fish };
}

/**
 * Validate a parsed save and normalize it into the canonical shape. Returns
 * { ok: true, state } on success or { ok: false, error } on any problem, never throws.
 * Only the fields the reader owns are accepted; extra fields in a record are ignored so
 * a newer version that added fields degrades to what this version understands.
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
  const fish = [];
  const seen = new Set();
  for (const record of value.fish) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      return { ok: false, error: "a fish record is not an object" };
    }
    // Strict identity: a saved id must be a real, non-blank string. We check the type and
    // only then read it (no String(...) coercion), so a malicious object id can never make
    // parsing throw, and a missing/null id is rejected rather than coerced to "undefined".
    const id = record.id;
    if (typeof id !== "string" || !id.trim()) {
      return { ok: false, error: "blank fish id" };
    }
    if (seen.has(id)) {
      return { ok: false, error: `duplicate fish id ${id}` };
    }
    seen.add(id);
    // A hostile object species (e.g. {toString:null, valueOf:null}) must not be coerced
    // into the error text: String(...) on it throws. Refuse with a fixed message instead,
    // so parse can never crash on a malicious record. The species value is checked only
    // for membership (===), never coerced.
    if (!SPECIES_KEYS.includes(record.species)) {
      return { ok: false, error: "unknown species" };
    }
    // Strict age: a real finite number in [0, MAX_AGE_SECONDS]. null, a string, a boolean,
    // NaN, Infinity and an absurd overflow are all refused rather than coerced.
    const age = record.age;
    if (
      typeof age !== "number" ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > MAX_AGE_SECONDS
    ) {
      return { ok: false, error: `invalid age for ${id}` };
    }
    fish.push(fishRecord(id, record.species, age));
  }
  // v1 saves exactly the default population. The validator therefore requires that exact
  // count now, so a save that claims a different number of fish is refused (fresh tank)
  // rather than accepted and then silently trimmed to a different count by the school.
  // Variable restored counts are deferred to a version migration.
  if (fish.length !== DEFAULT_COUNT) {
    return {
      ok: false,
      error: `v1 save has ${fish.length} fish; this version requires exactly ${DEFAULT_COUNT}`,
    };
  }
  return { ok: true, state: { version: value.version, fish } };
}

/**
 * Parse a serialized save into a validated state, or return null if it is missing,
 * malformed, or from an unsupported version. Never throws. Callers that get null must
 * start from a fresh population rather than crash.
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
