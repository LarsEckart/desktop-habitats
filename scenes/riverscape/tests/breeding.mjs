// Pure breeding/growth tests: no Three.js, no host, no renderer. These pin down the
// rules issue 02 is most about — that only mature fish breed, that a baby is visibly a
// fry before it grows to eligibility, that per-fish and tank cooldowns are respected,
// that a restart continues cooldowns instead of reproducing them, and that births can
// never push the population past its cap even when several adults are ready at once —
// all under a controlled clock and random source.
import assert from "node:assert/strict";
import {
  breedMany,
  growthOf,
  sizeScale,
  MATURITY_AGE,
  GROWTH_SECONDS,
  PER_FISH_BREED_COOLDOWN,
  TANK_BREED_COOLDOWN,
  POPULATION_CAP,
  FRY_MIN_SCALE,
} from "../src/breeding.js";

const SEQ = () => { let n = 0; return () => `baby-${n++}`; };
// A ready, full-grown adult (born full-grown, as every fish is unless it was born a baby);
// `breedIn` 0 means it is on deck, peers.
const adult = (id, age = MATURITY_AGE, breedIn = 0) => ({ id, species: "bloodfin-tetra", age, breedIn, adult: true });
// A newborn (born a baby, so it must grow to adult size and breeding age).
const baby = (id, age = 0) => ({ id, species: "bloodfin-tetra", age, breedIn: 0, adult: false });
const tank = (fish, tankCooldown = 0) => ({ breedIn: tankCooldown, fish });

// ---- Growth is gradual and a baby is visibly smaller than an adult. ----
assert.equal(growthOf(0), 0, "a newborn has made no growth");
assert.equal(growthOf(MATURITY_AGE), 1, "a fish at maturity is fully grown");
assert.equal(growthOf(MATURITY_AGE * 100), 1, "growth saturates at adult size");
const mid = growthOf(MATURITY_AGE / 2);
assert.ok(mid > 0 && mid < 1, "growth progresses steadily in between");
assert.ok(mid <= 0.5, "growth eases in from a static start, so a fry stays small early");
assert.equal(sizeScale(0), FRY_MIN_SCALE, "a newborn is a fraction of adult size");
assert.equal(sizeScale(MATURITY_AGE), 1, "an adult is full size");
assert.ok(sizeScale(MATURITY_AGE / 2) < 1, "a growing fish is not yet adult-sized");
assert.equal(sizeScale(0, true), 1, "a fish born full-grown stays adult-sized however young");

// ---- Only mature fish breed; a baby must grow before it can. ----
assert.equal(
  breedMany(tank([baby("young")]), 1).born,
  false, "a newborn stays far below breeding age and never breeds");
assert.equal(breedMany(tank([baby("young")]), 1000, { id: SEQ() }).born, false,
  "a baby grows for a long time before it can breed");
// An old save with a tiny running age is still adult (it was born before growth existed).
assert.equal(breedMany(tank([adult("legacy", 0)]), 1, { id: SEQ() }).born, true,
  "a fish marked adult can breed even with a small saved age");
const grownOut = tank([adult("pappa")]);
let res = breedMany(grownOut, 1, { id: SEQ() });
assert.equal(res.born, true, "a mature, ready adult breeds when the tank is ready");
assert.equal(res.child.age, 0, "the baby is born at age zero");
assert.equal(res.child.breedIn, 0, "the baby starts with no cooldown debt");
assert.equal(grownOut.fish.length, 2, "the birth added exactly one fish");
assert.equal(res.parent.id, "pappa", "the recorded parent is the adult that bred");
assert.equal(res.child.adult, false, "the baby is recorded as a fish born to grow");

// ---- Births are guided by a controlled clock: cooldowns count down only as dt passes. ----
const timed = tank([adult("one")], TANK_BREED_COOLDOWN);
breedMany(timed, TANK_BREED_COOLDOWN / 2); // half the tank cooldown passes, not enough yet
assert.equal(timed.fish.length, 1, "no birth until the tank cooldown fully clears");
breedMany(timed, TANK_BREED_COOLDOWN / 2); // the rest passes
assert.equal(timed.fish.length, 2, "a birth fires once the tank cooldown clears");
// After a birth the parent rests PER_FISH_BREED_COOLDOWN and the tank TANK_BREED_COOLDOWN,
// whatever was ready at once.
breedMany(timed, 1);
assert.equal(timed.fish.length, 2, "the tank cooldown blocks an immediate second birth");

// ---- dt === 0 changes nothing (paused / hidden / asleep / stopped rendering). ----
const frozen = tank([adult("f")]);
const before = breedMany(frozen, 0, { id: SEQ() });
assert.equal(before.born, false, "a zero step never breeds");
assert.equal(frozen.fish[0].age, MATURITY_AGE, "a zero step does not advance age");
assert.equal(frozen.fish[0].breedIn, 0, "a zero step does not touch cooldowns");

// ---- Save/restore: cooldown progress is a remainder the next run simply continues. ----
const s2 = tank([]);
s2.fish.push(adult("x"));
breedMany(s2, TANK_BREED_COOLDOWN + 1, { id: SEQ() }); // clears tank cooldown -> one birth
assert.equal(s2.fish.length, 2, "one birth in the first session");
const parentAfterFirst = s2.fish.reduce((p, r) => (r.age > MATURITY_AGE ? r : p), null);
assert.ok(parentAfterFirst && parentAfterFirst.breedIn > 0, "the parent's per-fish cooldown is armed");
// "Reload" the state (a deep copy is what a parse(serialize(...)) would hand back) — the
// surviving remainder must not reproduce the same birth on the next tick.
const reloaded = JSON.parse(JSON.stringify(s2));
breedMany(reloaded, 1, { id: SEQ() });
assert.equal(reloaded.fish.length, 2, "a restart does not grant a duplicate birth from the same tick");
// After a birth the parent's cooldown and the tank cooldown both elapsed, the same adult
// may breed again — but only once its own cooldown (which outlives the tank's) has passed.
const reAdult = reloaded.fish.find((r) => r.age > MATURITY_AGE);
breedMany(reloaded, reAdult.breedIn + TANK_BREED_COOLDOWN + 1, { id: SEQ() });
assert.equal(reloaded.fish.length >= 3, true, "an adult breeds again only after its own cooldown");

// ---- The cap is hard even when many adults are ready at once. ----
// Fill a tank to just under the cap with ripe adults and a zero tank cooldown, then let
// breedMany run as many timesteps as it wants: births may fill to the cap and then must
// stop at exactly POPULATION_CAP, never beyond — no matter how many stay ready.
const nearCap = tank([]);
for (let i = 0; i < POPULATION_CAP - 1; i++) nearCap.fish.push(adult(`ripe-${i}`));
let guard = 0;
while (nearCap.fish.length < POPULATION_CAP && guard++ < 10000) {
  breedMany(nearCap, 1, { id: SEQ(), tankCooldown: 0, perFishCooldown: 0 });
}
assert.equal(nearCap.fish.length, POPULATION_CAP, "births fill the tank to exactly the cap");
assert.ok(guard < 10000, "cap fill terminates quickly");
breedMany(nearCap, 1, { id: SEQ(), tankCooldown: 0, perFishCooldown: 0 });
assert.equal(nearCap.fish.length, POPULATION_CAP, "at the cap, ready adults cannot force one more birth");
assert.ok(nearCap.fish.every((r) => r.age >= 0 && Number.isFinite(r.age)), "ages stay finite across many steps");

console.log("PASS: growth curve, mature-only breeding, controlled-clock cooldowns, save/restore continuity, hard cap");
