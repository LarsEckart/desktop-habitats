// Pure saved-state tests: no Three.js, no host, no renderer. These pin down the shape of
// the durable population record — including the v1→v2 migration and the growth/breeding
// fields — and the safety rules for reading an untrusted file.
//
// They cannot run against a browser, so they stand in for the real storage at the
// *format* level: whatever a browser or the wallpaper hands us must survive these rules.
import assert from "node:assert/strict";
import {
  createPopulation,
  fishRecord,
  parse,
  roundAge,
  serialize,
  uid,
  validate,
  SAVE_VERSION,
  DEFAULT_COUNT,
  DEFAULT_SPECIES,
  MAX_SAVED_FISH,
  MAX_AGE_SECONDS,
  LEGACY_V1_COUNT,
  CAPACITY,
} from "../src/tank-state.js";
import {
  FRESH_COUNT,
  POPULATION_CAP,
  MATURITY_AGE,
  TANK_BREED_COOLDOWN,
  PER_FISH_BREED_COOLDOWN,
  breedMany,
} from "../src/breeding.js";

// A fresh tank: FRESH_COUNT adults at maturity (so a new tank reads full-size and matures
// to breed), armed tank cooldown (so the first birth is a discovery later, not an instant
// spawn), age-zero... no — fresh adults carry MATURITY_AGE so they are full-grown.
const fresh = createPopulation();
assert.equal(fresh.version, SAVE_VERSION);
assert.equal(fresh.fish.length, FRESH_COUNT, "a new tank starts with fewer fish than the old 24");
assert.equal(fresh.fish.length, DEFAULT_COUNT);
assert.ok(FRESH_COUNT < POPULATION_CAP, "the fresh population is well under the cap");
assert.ok(FRESH_COUNT < 24, "a new tank starts with fewer fish than the previous 24");
for (const record of fresh.fish) {
  assert.equal(record.species, DEFAULT_SPECIES);
  assert.equal(record.age, MATURITY_AGE, "fresh adults are full-grown and mature");
  assert.equal(record.breedIn, 0, "fresh adults are ready once the tank cooldown clears");
  assert.ok(record.id.startsWith("f"), "ids are prefixed and opaque");
}
assert.equal(fresh.breedIn, TANK_BREED_COOLDOWN, "a fresh tank arms its tank-level cooldown");
const distinctIds = new Set(fresh.fish.map((f) => f.id));
assert.equal(distinctIds.size, FRESH_COUNT, "fresh ids are unique per tank");

// The id maker keeps a preview and a wallpaper from ever handing a fish the same id.
assert.notEqual(uid(Date.now() + 1), uid(Date.now()));
assert.equal(typeof roundAge(1 / 3), "number");

// A deterministic population for a round trip: known ids and ages must come back
// identical, because that is the promise a restart relies on.
const counter = () => { let n = 0; return () => `known-${n++}`; };
const known = createPopulation({ id: counter(), age: 42.5 });
const raw = serialize(known);
const back = parse(raw);
assert.ok(back, "an ordinary save parses");
assert.equal(back.version, SAVE_VERSION);
assert.deepEqual(back.fish, Array.from({ length: FRESH_COUNT }, (_, i) =>
  fishRecord(`known-${i}`, DEFAULT_SPECIES, 42.5)));

// ---- v1 → v2 migration: ids, ages and count are preserved. ----
// A real v1 save (the 24-fish fixed population, no growth or breeding state) becomes a
// v2 record with every id, species, age and the count intact, plus safe breeding defaults.
const compactV1 = (count = 24) => ({
  version: 1,
  fish: Array.from({ length: count }, (_, i) => ({
    id: `old-${i}`, species: DEFAULT_SPECIES, age: 3600 + i,
  })),
});
const migrated = validate(compactV1());
assert.equal(migrated.ok, true);
assert.deepEqual(migrated.state.fish.map((r) => r.id), Array.from({ length: 24 }, (_, i) => `old-${i}`),
  "migration keeps every saved id");
assert.deepEqual(migrated.state.fish.map((r) => r.age), Array.from({ length: 24 }, (_, i) => 3600 + i),
  "migration keeps every saved age");
assert.equal(migrated.state.fish.length, 24, "migration keeps the saved count");
assert.ok(migrated.state.fish.every((r) => r.species === DEFAULT_SPECIES));
// A migrated 24-fish tank sits exactly on the restore/render capacity, so its birth
// machinery stays idle (births cap at POPULATION_CAP).
assert.equal(migrated.state.fish.length, POPULATION_CAP);
assert.ok(CAPACITY >= LEGACY_V1_COUNT, "capacity always spans the legacy v1 population");
assert.ok(CAPACITY >= POPULATION_CAP, "capacity always spans the live birth cap");
assert.equal(migrated.state.breedIn, 0, "migrated tanks have no armed birth cooldown");
assert.ok(migrated.state.fish.every((r) => r.breedIn === 0), "migrated adults start ready");
// Round-tripping a migrated save serializes at v2 and reads back identically.
const migratedSnapshot = validate(migrated.state).state;
assert.deepEqual(parse(serialize(migratedSnapshot)), migratedSnapshot);

/// ---- Future cap below the legacy count still restores and serializes the 24 fish. ----
// The restore/render capacity exists so a migrated v1 tank's 24 fish are never orphaned
// if a future tuning lowers the live birth cap (POPULATION_CAP) below 24: serialization,
// re-validation and the render room all key off CAPACITY (max of legacy v1 count and the
// live cap), while the *birth* machinery alone still stops at its own cap. Simulate the
// lowered-cap world by driving breedMany with an explicit small cap on the migrated tank.
const legacy24 = () => validate(compactV1()).state; // 24 migrated fish, exactly CAPACITY's floor
assert.equal(CAPACITY, Math.max(LEGACY_V1_COUNT, POPULATION_CAP));
// A migrated 24-fish tank always serializes to v2 and parses back, whatever the live cap
// is: validation keys off CAPACITY, which spans the legacy count even when a future
// tuning (simulated below by an explicit lower cap) is smaller.
const bigMigrated = legacy24();
assert.deepEqual(parse(serialize(bigMigrated)), bigMigrated,
  "a 24-fish save survives serialize/parse against the capacity ceiling");
// The render room in fish.js (COUNT) is CAPACITY, covered in fish-behavior.mjs; here we
// only pin the guaranteed invariant that the scale of a migrated tank can never exceed it.
assert.ok(CAPACITY >= legacy24().fish.length, "the restore/render capacity always spans LEGACY_V1_COUNT fish");
// Births stop at breedMany's own cap: a hypothetical lowering to (say) 12 leaves the
// 24-fish migrated tank utterly steady -- no baby is ever added because the live cap is
// below the population already present. This is the exact fail-safe the capacity split
// exists to preserve.
const steady24 = legacy24();
breedMany(steady24, TANK_BREED_COOLDOWN + 1, { id: counter(), cap: 12 });
assert.equal(steady24.fish.length, 24, "a migrated tank stays fixed at its own 24 even under a lowered live cap");

// Validation: every bad input is refused cleanly and none of them throw.
const rejects = (value, label) => {
  const result = validate(value);
  assert.equal(result.ok, false, `should reject: ${label}`);
  assert.ok(typeof result.error === "string");
};
rejects(null, "null");
rejects(undefined, "undefined");
rejects("text", "a string");
rejects([], "an array");
rejects(17, "a number");
rejects({}, "missing version and fish");
rejects({ version: 0, fish: [] }, "zero version");
rejects({ version: "1", fish: [] }, "version as a string");
rejects({ version: 99, fish: [{ id: "a", species: DEFAULT_SPECIES, age: 0 }] },
  "unsupported future version is refused, not guessed at");
rejects({ version: SAVE_VERSION, fish: [] }, "empty fish array");
rejects({ version: SAVE_VERSION, fish: [{ id: "a" }] }, "missing species");
rejects({ version: SAVE_VERSION, fish: [{ id: "a", species: "goldfish", age: 0 }] },
  "unknown species");
rejects({ version: SAVE_VERSION, fish: [{ id: "a", species: DEFAULT_SPECIES, age: 0 },
  { id: "a", species: DEFAULT_SPECIES, age: 0 }] }, "duplicate id");
rejects({ version: SAVE_VERSION, fish: [{ id: "a", species: DEFAULT_SPECIES, age: -1 }] },
  "negative age");
rejects({ version: SAVE_VERSION, fish: [{ id: "a", species: DEFAULT_SPECIES, age: "old" }] },
  "non-numeric age");
rejects({ version: SAVE_VERSION, fish: [{ id: "", species: DEFAULT_SPECIES, age: 0 }] },
  "blank id");
rejects({ version: SAVE_VERSION, fish: [{ id: "a", species: DEFAULT_SPECIES, age: 0 }, "b"] },
  "a record that is not an object");

// ---- v1 count is fixed legacy history, not coupled to today's tuning cap. ----
// A v1 save is always exactly LEGACY_V1_COUNT (24) fish no matter how POPULATION_CAP has
// been tuned since, so changing the live cap can never silently re-read or drop an old
// file's fish. Only the exact legacy size is accepted as v1; anything else is refused so
// a tuned-down cap never guesses and loses fish.
assert.equal(LEGACY_V1_COUNT, 24, "the v1 format is the fixed 24-fish population");
assert.equal(
  validate(compactV1()).state.fish.length,
  LEGACY_V1_COUNT,
  "v1 migration keeps all LEGACY_V1_COUNT fish, independent of POPULATION_CAP",
);
rejects(compactV1(LEGACY_V1_COUNT - 1), "a v1 file with one fewer fish is refused");
rejects(compactV1(LEGACY_V1_COUNT + 1), "a v1 file with one more fish is refused");
assert.ok(LEGACY_V1_COUNT <= MAX_SAVED_FISH, "the legacy v1 population always fits the reader's upper net");

// ---- Strict, coercion-free validation. A saved record must carry a real non-blank
// string id and a finite, non-negative, bounded age. Nothing here may ever throw (parse
// is the defensive front door), including a malicious object id that would blow up a
// naive String(...) coercion. Build a full cap population and corrupt one field at a
// time: each refused save is the whole population becoming a fresh tank, never a crash.
const full = (mutate) => {
  const fish = Array.from({ length: POPULATION_CAP }, (_, i) => ({
    id: `id-${i}`, species: DEFAULT_SPECIES, age: 1, breedIn: 0,
  }));
  mutate?.(fish);
  return { version: SAVE_VERSION, fish };
};
rejects(full((f) => { delete f[0].id; }), "a missing id is refused, never coerced from undefined");
rejects(full((f) => { f[0].id = null; }), "a null id is refused, never coerced from null");
rejects(full((f) => { f[0].id = 123; }), "a numeric id is refused, not string-coerced");
rejects(full((f) => { f[0].id = "  "; }), "a whitespace-only id is blank");
rejects(
  full((f) => {
    f[0].id = { id: "trap-id", toString() { throw new Error("must never run"); } };
  }),
  "an object id is refused by a type check, it is never String()-coerced and parse never throws");
rejects(full((f) => { f[0].age = null; }), "a null age is refused, not coerced to 0");
rejects(full((f) => { f[0].age = "12"; }), "a string age is refused, not Number()-coerced");
rejects(full((f) => { f[0].age = true; }), "a boolean age is refused, not coerced to 1");
rejects(full((f) => { f[0].age = Infinity; }), "an infinite age is refused");
rejects(full((f) => { f[0].age = NaN; }), "a NaN age is refused");
rejects(full((f) => { f[0].age = 1e308; }),
  "an overflowing age (1e308) is refused, not rounded to Infinity");
rejects(full((f) => { f[0].age = MAX_AGE_SECONDS + 1; }),
  "an age beyond the accepted bound is refused, not silently clamped");
rejects(full((f) => { f[0].breedIn = "soon"; }),
  "a non-numeric breeding cooldown is refused, not coercible");
rejects(full((f) => { f[0].breedIn = -3; }), "a negative breeding cooldown is refused");

// ---- Issue 02: variable populations are allowed up to the restore/render capacity ----
// v2 accepts any count from 1 through CAPACITY (the larger of the legacy v1 count and the
// live birth cap), and refuses anything that would outgrow what the renderer has room for.
for (const n of [1, 5, 8, 12, 24, CAPACITY]) {
  const ok = validate({
    version: SAVE_VERSION,
    fish: Array.from({ length: n }, (_, i) => ({ id: `v-${i}`, species: DEFAULT_SPECIES, age: 0 })),
  });
  assert.equal(ok.ok, true, `v2 accepts a ${n}-fish population`);
  assert.equal(ok.state.fish.length, n);
}
rejects(
  { version: SAVE_VERSION, fish: Array.from({ length: CAPACITY + 1 }, (_, i) => ({ id: `over-${i}`, species: DEFAULT_SPECIES, age: 0 })) },
  "a population above the restore/render capacity is refused");
rejects(
  { version: SAVE_VERSION, fish: Array.from({ length: MAX_SAVED_FISH + 1 }, (_, i) => ({ id: `big-${i}`, species: DEFAULT_SPECIES, age: 0 })) },
  "a population above the MAX_SAVED_FISH guard is refused");
rejects(compactV1(8),
  "a v1 file with a non-24 count is refused (v1 always carried exactly 24)");

// ---- Growth/breeding state round trips and is preserved on restore. ----
const bred = {
  version: SAVE_VERSION,
  breedIn: 123.4,
  fish: [
    { id: "a", species: DEFAULT_SPECIES, age: 9000, breedIn: 77, adult: true },
    { id: "b", species: DEFAULT_SPECIES, age: 100, breedIn: 0, adult: false },
  ],
};
const bredBack = parse(serialize(bred));
assert.deepEqual(bredBack, bred, "breeding state (tank + per-fish cooldown + adult flag) survives a round trip");
assert.equal(bredBack.fish[0].adult, true, "an adult flag survives restore");
assert.equal(bredBack.fish[1].adult, false, "a baby flag survives restore")
// A v2 record missing the optional cooldown fields defaults safely to ready, and tank
// cooldown 0, rather than failing or guessing at cooldown timestamps.
const partial = parse(serialize({ version: SAVE_VERSION, fish: [{ id: "x", species: DEFAULT_SPECIES, age: 5 }] }));
assert.equal(partial.breedIn, 0);
assert.equal(partial.fish[0].breedIn, 0);

// roundAge is a safe formatter even under malicious input: non-numbers collapse to 0 and a
// huge finite value is bounded so it can never round up to Infinity on disk.
assert.equal(roundAge(1e308), MAX_AGE_SECONDS, "roundAge never returns Infinity");
assert.equal(roundAge(NaN), 0);
assert.equal(roundAge("nope"), 0);
assert.equal(roundAge(-5), 0);

// parse is the defensive front door: garbage, oversized and unknown-version files all
// come back null, never an exception.
assert.equal(parse(null), null);
assert.equal(parse(""), null);
assert.equal(parse("not json"), null);
assert.equal(parse('{"broken":'), null);
assert.equal(parse("x".repeat(2_000_001)), null, "oversized save is refused");
assert.equal(parse(JSON.stringify({ version: 5, fish: [] })), null, "unknown version -> null");
assert.ok(parse(raw), "an ordinary save parses");
assert.ok(parse(serialize(compactV1())), "a v1 save migrates through parse and reads back");

// parse() is the defensive front door and must never throw, even when a hostile record is
// serialized and read back through the real parse(JSON.stringify(...)) path. The error text
// must not String()-coerce an unknown species or id (a {toString:null,valueOf:null} object
// makes String() throw a TypeError); such a save comes back null, never a crash.
const hostileSpecies = {
  version: SAVE_VERSION,
  fish: Array.from({ length: POPULATION_CAP }, (_, i) => ({
    id: `hostile-species-${i}`, species: { toString: null, valueOf: null }, age: 0,
  })),
};
assert.equal(
  parse(JSON.stringify(hostileSpecies)), null,
  "a hostile species object is refused without coercion and parse never throws");
const hostileId = {
  version: SAVE_VERSION,
  fish: Array.from({ length: POPULATION_CAP }, (_, i) => ({
    id: { toString: null, valueOf: null }, species: DEFAULT_SPECIES, age: 0,
  })),
};
assert.equal(
  parse(JSON.stringify(hostileId)), null,
  "a hostile id object is refused by the type check and parse never throws");

// Extra fields on a record (a future version's additions) degrade to what this version
// reads rather than failing.
const withExtra = {
  version: SAVE_VERSION,
  fish: Array.from({ length: 3 }, (_, i) => ({
    id: `extra-${i}`, species: DEFAULT_SPECIES, age: 3, growth: 0.5, hunting: 1,
  })),
};
assert.deepEqual(parse(JSON.stringify(withExtra)), {
  version: SAVE_VERSION,
  breedIn: 0,
  fish: Array.from({ length: 3 }, (_, i) => ({
    id: `extra-${i}`, species: DEFAULT_SPECIES, age: 3, breedIn: 0, adult: true,
  })),
});

// serialize refuses an object its own validation would reject.
assert.throws(() => serialize({ version: SAVE_VERSION, fish: [] }));

console.log(`PASS: tank state format (v${SAVE_VERSION}), fresh ${FRESH_COUNT}->cap ${POPULATION_CAP}, v1->v2 migration, create/uid, validate, safe parse, round trip`);
