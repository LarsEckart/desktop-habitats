// Pure saved-state tests: no Three.js, no host, no renderer. These pin down the shape of
// the durable population record and the safety rules for reading an untrusted file.
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
} from "../src/tank-state.js";

// A fresh tank: full count, adult-bloodfin default, age zero, unique opaque ids.
const fresh = createPopulation();
assert.equal(fresh.version, SAVE_VERSION);
assert.equal(fresh.fish.length, DEFAULT_COUNT);
for (const record of fresh.fish) {
  assert.equal(record.species, DEFAULT_SPECIES);
  assert.equal(record.age, 0);
  assert.ok(record.id.startsWith("f"), "ids are prefixed and opaque");
}
const distinctIds = new Set(fresh.fish.map((f) => f.id));
assert.equal(distinctIds.size, DEFAULT_COUNT, "fresh ids are unique per tank");

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
assert.deepEqual(back.fish, Array.from({ length: DEFAULT_COUNT }, (_, i) =>
  fishRecord(`known-${i}`, DEFAULT_SPECIES, 42.5)));

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

// ---- Finding 5: strict, coercion-free validation. A saved record must carry a real
// non-blank string id and a finite, non-negative, bounded age. Nothing here may ever throw
// (parse is the defensive front door), including a malicious object id that would blow up a
// naive String(...) coercion. Build a full 24-fish population and corrupt one field at a
// time: each refused save is the whole population becoming a fresh tank, never a crash.
const full = (mutate) => {
  const fish = Array.from({ length: DEFAULT_COUNT }, (_, i) => ({
    id: `id-${i}`, species: DEFAULT_SPECIES, age: 1,
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

// ---- Finding 6: v1 saves exactly the default population. The validator requires that
// exact count now (variable restored counts are deferred to a version migration), so a
// save with a different number of fish is refused as a fresh-tank case instead of being
// accepted and then silently trimmed by the school.
rejects(
  { version: SAVE_VERSION, fish: Array.from({ length: DEFAULT_COUNT - 1 }, (_, i) => ({ id: `c-${i}`, species: DEFAULT_SPECIES, age: 0 })) },
  "fewer than the default count is refused (variable counts deferred)");
rejects(
  { version: SAVE_VERSION, fish: Array.from({ length: DEFAULT_COUNT + 1 }, (_, i) => ({ id: `d-${i}`, species: DEFAULT_SPECIES, age: 0 })) },
  "more than the default count is refused");
rejects(
  { version: SAVE_VERSION, fish: Array.from({ length: MAX_SAVED_FISH + 1 }, (_, i) => ({ id: `big-${i}`, species: DEFAULT_SPECIES, age: 0 })) },
  "a population above the MAX_SAVED_FISH cap is refused");

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

// parse() is the defensive front door and must never throw, even when a hostile record is
// serialized and read back through the real parse(JSON.stringify(...)) path. The error text
// must not String()-coerce an unknown species or id (a {toString:null,valueOf:null} object
// makes String() throw a TypeError); such a save comes back null, never a crash.
const hostileSpecies = {
  version: SAVE_VERSION,
  fish: Array.from({ length: DEFAULT_COUNT }, (_, i) => ({
    id: `hostile-species-${i}`, species: { toString: null, valueOf: null }, age: 0,
  })),
};
assert.equal(
  parse(JSON.stringify(hostileSpecies)), null,
  "a hostile species object is refused without coercion and parse never throws");
const hostileId = {
  version: SAVE_VERSION,
  fish: Array.from({ length: DEFAULT_COUNT }, (_, i) => ({
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
  fish: Array.from({ length: DEFAULT_COUNT }, (_, i) => ({
    id: `extra-${i}`, species: DEFAULT_SPECIES, age: 3, growth: 0.5,
  })),
};
assert.deepEqual(parse(JSON.stringify(withExtra)), {
  version: SAVE_VERSION,
  fish: Array.from({ length: DEFAULT_COUNT }, (_, i) => ({
    id: `extra-${i}`, species: DEFAULT_SPECIES, age: 3,
  })),
});

// serialize refuses an object its own validation would reject.
assert.throws(() => serialize({ version: SAVE_VERSION, fish: [] }));

console.log(`PASS: tank state format (v${SAVE_VERSION}), create/uid, validate, safe parse, round trip`);
