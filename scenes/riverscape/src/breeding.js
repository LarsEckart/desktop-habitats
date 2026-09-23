// Fish growth and breeding, as pure data on a durable population record.
//
// Everything that decides whether a fish is full-grown, which adults may breed, and
// when a baby is born lives here, deliberately free of Three.js and of any host. It
// mutates a plain population record (the same shape tank-state.js saves), so the exact
// same decisions are shared by the live school in fish.js and by headless tests. There
// is no offline simulation and no catch-up: this module only does work when told to step
// by a positive simulation `dt`, and its timers are cooldown *remainders* that a restart
// simply continues from (never wall-clock timestamps that would fire once more on load).
//
// The model is deliberately simple for this first version: no sexes, no genetics, no
// eggs, no mate pair. A mature adult whose own cooldown has elapsed can sire one baby,
// and the tank as a whole may host at most one birth per TANK_BREED_COOLDOWN and never
// more than POPULATION_CAP fish total. That single global gate — one birth per cooldown,
// whichever adult is ready — is what keeps births feeling like occasional discoveries
// rather than a spawning burst, and it is also what guarantees several adults becoming
// ready at once can never overshoot the cap.

// Tuning, chosen for "occasional discoveries". A fry grows to adult size over
// MATURITY_AGE of *running* simulation seconds (an hour and a half of drawn time, not
// wall time), stays small and visibly separate while it grows, and only becomes
// eligible to breed once it actually is adult. The tank allows one birth per ten minutes
// of running time, and an adult that has bred cools down for an hour and a half before
// it can do so again. New tanks start with FRESH_COUNT adults and grow toward
// POPULATION_CAP, which is also the render budget (it matches the tank's previous fixed
// population, so the illustrated frame cost of a full tank is unchanged).
export const MATURITY_AGE = 5400; // running seconds to reach adult size and breeding age
export const GROWTH_SECONDS = MATURITY_AGE;
export const PER_FISH_BREED_COOLDOWN = 5400; // running seconds an adult rests after a birth
export const TANK_BREED_COOLDOWN = 600; // running seconds between any two births
export const FRESH_COUNT = 8; // fish in a brand-new tank
export const POPULATION_CAP = 24; // births still stop at the tank's original ceiling
// A fry is this fraction of adult size at birth and grows steadily to 1 over
// MATURITY_AGE. Grown smoothly (a smoothstep of growth progress) so the change reads as
// a slow swelling, not a step.
export const FRY_MIN_SCALE = 0.4;

/** Growth progress 0..1 by running age, eased so a fry barely moves at first. */
export function growthOf(age) {
  const t = Math.max(0, Math.min(1, (Number(age) || 0) / GROWTH_SECONDS));
  return t * t * (3 - 2 * t);
}

/**
 * Is this record a full-grown fish? A fish marked `adult` (older saves, fresh default
 * tanks — fish that were never fry) is always adult; anything else grows by running age
 * and becomes adult only once it reaches maturity.
 */
export function isGrown(record) {
  return record.adult === true || record.age >= MATURITY_AGE;
}

/**
 * The size multiplier a fish carries relative to an adult: FRY_MIN_SCALE for a newborn
 * rising smoothly to 1 at maturity. Body size, spacing, and feeding reach all scale by
 * this, so a baby is a genuinely smaller shape in the tank. `adult` (a fish born
 * full-grown, e.g. an existing save that predates growth) short-circuits to 1: migrated
 * tanks keep their fish adult-sized no matter how the saved running age reads.
 */
export function sizeScale(age, adult = false) {
  return adult ? 1 : FRY_MIN_SCALE + (1 - FRY_MIN_SCALE) * growthOf(age);
}

/** A brand-new baby's durable record; it is born infant (adult: false) and must grow
 * before it reaches adult size or breeding age. */
function freshChild(id, species) {
  return { id: String(id), species, age: 0, breedIn: 0, adult: false };
}

/**
 * Advance one running step of `dt` (seconds) over a durable population state and, if the
 * tank is ready, spawn a baby. Mutates `state` in place and returns
 * `{ born, parent, child }` so a caller can materialize the new fish where the parent is.
 *
 * `state` has the saved shape: `{ breedIn, fish: [{ id, species, age, breedIn }] }`.
 * `options` may override the tuning (`matureAge`, `perFishCooldown`, `tankCooldown`,
 * `cap`) or, when `options.id` is supplied, replace the default id maker so deterministic
 * tests can drive newborn identity (the default derives an id from Math.random). The only
 * randomness in a birth is that id: the parent is picked deterministically as the eldest
 * ready adult, so there is deliberately no separate random knob to seed. This is pure
 * simulation: age and every cooldown advance only by `dt`, and a `dt` of 0 (paused,
 * hidden, asleep, stopped render) changes nothing.
 */
export function breedMany(state, dt, options = {}) {
  const matureAge = options.matureAge ?? MATURITY_AGE;
  const perFishCooldown = options.perFishCooldown ?? PER_FISH_BREED_COOLDOWN;
  const tankCooldown = options.tankCooldown ?? TANK_BREED_COOLDOWN;
  const cap = options.cap ?? POPULATION_CAP;
  const nextId = options.id ?? (() =>
    `b${Math.floor(Math.random() * 1e9).toString(36)}`);

  // A frozen step (paused, hidden, asleep, stopped render) changes nothing at all: no age
  // advance, no cooldown countdown, and no birth. There is deliberately no catch-up.
  if (dt <= 0) return { born: false };

  // Running clocks: age up and cooldowns down by exactly the simulation step.
  state.breedIn = Math.max(0, state.breedIn - dt);
  for (const fish of state.fish) {
    fish.age += dt;
    fish.breedIn = Math.max(0, fish.breedIn - dt);
  }

  if (state.breedIn > 0 || state.fish.length >= cap) return { born: false };

  // Exactly one mature, cooled-down adult may breed per step, and only while there is
  // room at the cap. Picking the eldest ready adult is deterministic (a chain of ready
  // adults spreads births across the tank rather than piling them on one fish).
  // `adult` matters as well as age: an existing save that predates growth (whose saved
  // running age may be tiny) is still a full-grown breeder.
  let parent = null;
  for (const fish of state.fish) {
    const grown = fish.adult === true || fish.age >= matureAge;
    // Keep the solitary gourami solitary; the schooling fish may still have young.
    if (!grown || fish.breedIn > 0 || fish.species === "honey-gourami") continue;
    if (!parent || fish.age > parent.age) parent = fish;
  }
  if (!parent) return { born: false };

  const child = freshChild(nextId(), parent.species);
  state.fish.push(child);
  parent.breedIn = perFishCooldown;
  state.breedIn = tankCooldown;
  return { born: true, parent, child };
}
