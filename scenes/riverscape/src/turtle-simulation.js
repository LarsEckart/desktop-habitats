// Pure snapping-turtle movement. No Three.js or browser dependency.
const TAU = Math.PI * 2;
const CONTACT_SAMPLES = 8;

// Where the whole animal may rest on the sand: the open floor between the side beds, from
// the back stand of short grass to the front edge the camera shows. Rocks and wood carve
// this into a few separate pockets that cannot be walked between (the foreground channel is
// only 2.2 wide and the turtle is 1.7 wide), so the turtle changes pocket by surfacing for
// air and gliding down somewhere new.
export const TURTLE_BOUNDS = Object.freeze({
  minX: -3.6,
  maxX: 4.6,
  minZ: -3.5,
  maxZ: 2.75,
});

// The visible water film, where the head breaks the surface for a breath. It matches the
// film the food floats on; the modelled surface in water.js sits above the frame.
export const SURFACE_Y = 8.15;

export const TERRAIN_CLEARANCE = 0.015;

export const TUNING = Object.freeze({
  shuffleSpeed: 0.28,
  turnRate: 1.2,
  restMin: 70,
  restMax: 220,
  maxShuffle: 3.2,
  minShuffleDistance: 0.32,
  maxShuffleDistance: 0.72,
  maxShuffleTurn: 0.18,
  blockedRetry: 8,
  obstacleGap: 0.12,
  terrainClearance: TERRAIN_CLEARANCE,
  headSwayRate: 0.4,
  headSwayAngle: 0.2,
  headDipPeriod: 9,
  headDipAngle: 0.32,
  // How quickly the neck and head slew toward where they want to point, in rad/s. It is
  // faster than any rest sway, so the head follows a drifting fish without lagging.
  trackRate: 2.4,
  // Breathing. A turtle must surface now and then; here that is also how it moves between
  // the floor's separate pockets. Running seconds between breaths, swim speeds, how long
  // the head stays up, how far a landing must be from the last spot to count as new, and
  // the body-centre clearance kept from rocks, wood and beds while swimming.
  breathMin: 540,
  breathMax: 960,
  riseSpeed: 0.7,
  glideSpeed: 0.55,
  breatheMin: 3,
  breatheMax: 5,
  surfaceY: SURFACE_Y,
  landingMinDistance: 1.5,
  swimClearance: 0.8,
  pitchRate: 1.2,
});

// The view's pivots, shared so the pure model can compute the world snout position the
// renderer will actually produce. Local +x is forward, +y up. The neck pivot sits at the
// front of the shell; the head pivot at the neck's end; the snout at the beak tip.
export const TURTLE_ARTICULATION = Object.freeze({
  neckPivot: Object.freeze({ x: 0.55, y: 0.36 }),
  headPivotX: 0.42,
  snout: Object.freeze({ x: 0.55, y: -0.07 }),
  // A strike stretches the neck along its axis by this fraction and carries the head
  // pivot out with it. The head itself is never scaled.
  stretch: 0.75,
});

// Hunting: an ambush predator that eats occasionally, never a chase. Hunger rises only in
// running time; a meal lowers it and starts a long cooldown, a miss a short one. A hunt is
// a head-and-neck lunge from where the turtle already is, so prey must come within reach.
export const HUNT = Object.freeze({
  hungerRate: 1 / 3000,   // empty to full hunger in 50 running minutes
  startHunger: 0.4,       // a new turtle's hunger; the first hunt is some minutes in
  threshold: 0.6,         // hunger needed before prey is even considered
  meal: 0.85,             // hunger removed by one catch
  feedCooldown: 1800,     // running seconds after a meal before the next hunt
  retryCooldown: 45,      // running seconds after a miss before the next attempt
  minPopulation: 6,       // never hunt at or below this many fish
  maxPreySize: 1.0,       // relative body size a turtle will take (adults run 0.83-1.08)
  trackRange: 2.6,        // notice and follow prey within this of the head
  yawLimit: 0.78,         // total neck+head yaw either side of straight ahead
  strikeReach: 0.72,      // rest snout to prey distance that allows a strike
  catchRadius: 0.42,      // prey within this of the extended snout at the snap is caught
  aimTolerance: 0.16,     // rad of aiming error still counted as lined up
  aimTime: 1.1,           // seconds lined up within reach before the lunge
  strikeTime: 0.2,        // launch to snap
  holdTime: 0.35,         // jaws closed before the neck draws back
  settleTime: 0.9,        // neck retraction
  neckYawMax: 0.5,
  headYawMax: 0.28,
  neckPitchMax: 0.95,
  neckPitchMin: -0.15,
  headPitchMax: 0.45,
  headPitchMin: -0.5,
  creepInterval: 20,      // seconds between stalking shuffles toward out-of-reach prey
  creepDistance: 0.5,     // prey further than this from the lure invites a creep
});

// Local +x is forward. The union encloses all rendered body vertices, including four
// feet, claws, the full tail, and the head/neck at their maximum yaw. A renderer test
// projects the independent mesh vertices against these discs.
export const TURTLE_FOOTPRINT = Object.freeze([
  Object.freeze({ name: "shell", x: 0, z: 0, radius: 0.75 }),
  Object.freeze({ name: "tail", x: -1.03, z: 0, radius: 0.4 }),
  Object.freeze({ name: "front left foot", x: 0.32, z: 0.54, radius: 0.29 }),
  Object.freeze({ name: "front right foot", x: 0.32, z: -0.54, radius: 0.29 }),
  Object.freeze({ name: "rear left foot", x: -0.32, z: 0.54, radius: 0.29 }),
  Object.freeze({ name: "rear right foot", x: -0.32, z: -0.54, radius: 0.29 }),
  Object.freeze({ name: "neck base", x: 0.62, z: 0, radius: 0.36 }),
  Object.freeze({ name: "neck reach", x: 0.91, z: 0, radius: 0.47 }),
  Object.freeze({ name: "head reach", x: 1.26, z: 0, radius: 0.58 }),
  Object.freeze({ name: "strike reach left", x: 1.36, z: 0.42, radius: 0.5 }),
  Object.freeze({ name: "strike reach right", x: 1.36, z: -0.42, radius: 0.5 }),
]);

export const INITIAL_POSES = Object.freeze([
  Object.freeze({ x: -0.75, z: 1.62, yaw: 0.05 }),
  Object.freeze({ x: 0.65, z: 1.72, yaw: Math.PI - 0.08 }),
  Object.freeze({ x: -0.2, z: 1.55, yaw: 0 }),
]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
function wrapDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}
function worldPart(part, x, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return {
    x: x + part.x * c + part.z * s,
    z: z - part.x * s + part.z * c,
  };
}

// This allocating helper is for tests and occasional inspection, never the idle loop.
export function footprintAt(x, z, yaw, ground = () => 0) {
  return TURTLE_FOOTPRINT.map((part) => {
    const point = worldPart(part, x, z, yaw);
    const contacts = [];
    contacts.push({ x: point.x, z: point.z, ground: ground(point.x, point.z) });
    for (let i = 0; i < CONTACT_SAMPLES; i++) {
      const angle = i * TAU / CONTACT_SAMPLES;
      const cx = point.x + Math.cos(angle) * part.radius;
      const cz = point.z + Math.sin(angle) * part.radius;
      contacts.push({ x: cx, z: cz, ground: ground(cx, cz) });
    }
    return { ...part, ...point, contacts };
  });
}

export function inspectTurtlePose(pose, {
  bounds = TURTLE_BOUNDS,
  obstacles = [],
  ground = () => 0,
  obstacleGap = TUNING.obstacleGap,
  terrainClearance = TUNING.terrainClearance,
} = {}) {
  const footprint = footprintAt(pose.x, pose.z, pose.yaw, ground);
  let valid = true, minClearance = Infinity, surfaceY = -Infinity;
  for (const part of footprint) {
    if (
      part.x - part.radius < bounds.minX || part.x + part.radius > bounds.maxX ||
      part.z - part.radius < bounds.minZ || part.z + part.radius > bounds.maxZ
    ) valid = false;
    for (const contact of part.contacts) surfaceY = Math.max(surfaceY, contact.ground);
    for (const obstacle of obstacles) {
      const clearance = Math.hypot(
        part.x - obstacle.center.x,
        part.z - obstacle.center.z,
      ) - obstacle.radius - part.radius - obstacleGap;
      minClearance = Math.min(minClearance, clearance);
      if (clearance < 0) valid = false;
    }
  }
  return {
    valid,
    surfaceY,
    supportY: surfaceY + terrainClearance,
    minClearance,
    footprint,
  };
}


// Rotations matching the view's Euler order (Three's default XYZ with no x term): a pitch
// around local z is applied first, then a yaw around y. Positive pitch raises a point on
// local +x; positive yaw swings it toward local -z.
function rotateYZ(p, yaw, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const x1 = p.x * cp - p.y * sp, y1 = p.x * sp + p.y * cp;
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  p.x = x1 * cy + p.z * sy;
  p.y = y1;
  p.z = -x1 * sy + p.z * cy;
  return p;
}

// The world-space beak tip for an articulated pose, computed exactly as the renderer's
// pivot chain does it. `extend` is the strike stretch 0..1. Writes into `out` and returns it.
export function snoutAt(pose, out = { x: 0, y: 0, z: 0 }) {
  const A = TURTLE_ARTICULATION;
  const reach = A.headPivotX * (1 + A.stretch * (pose.extend ?? 0));
  out.x = A.snout.x; out.y = A.snout.y; out.z = 0;
  rotateYZ(out, pose.headYaw ?? 0, pose.headPitch ?? 0);
  out.x += reach;
  rotateYZ(out, pose.neckYaw ?? 0, pose.neckPitch ?? 0);
  out.x += A.neckPivot.x; out.y += A.neckPivot.y;
  rotateYZ(out, pose.yaw, pose.pitch ?? 0);
  out.x += pose.x; out.y += pose.y; out.z += pose.z;
  return out;
}

// Where a resting turtle would most like prey to be: ahead of and a little above the
// beak, at the middle of the strike's reach, so an aimed lunge lands on it. Fish that
// come to look at the turtle are drawn toward this point.
export function lureAt(pose, out = { x: 0, y: 0, z: 0 }) {
  const A = TURTLE_ARTICULATION;
  const along = A.headPivotX * (1 + A.stretch * 0.55) + A.snout.x;
  out.x = along; out.y = 0; out.z = 0;
  rotateYZ(out, 0, 0.55);
  out.x += A.neckPivot.x; out.y += A.neckPivot.y;
  rotateYZ(out, pose.yaw, pose.pitch ?? 0);
  out.x += pose.x; out.y += pose.y; out.z += pose.z;
  return out;
}

const EMPTY = Object.freeze([]);
const round3 = (v) => Math.round(Math.max(0, Math.min(1e9, Number(v) || 0)) * 1000) / 1000;

export function createTurtleSimulation({
  id = "turtle",
  hunger = HUNT.startHunger,
  feedIn = 0,
  retryIn = 0,
  breathIn = null,
  obstacles = [],
  // Spheres (centre with x/y/z, radius) the body must clear while swimming: the fish
  // obstacle list, which includes the trunk and branches the ground circles do not.
  swimObstacles = [],
  // Rectangles in x/z (minX, maxX, minZ, maxZ) the turtle never lands in: the grass beds.
  beds = [],
  ground = () => 0,
  random = Math.random,
  bounds = TURTLE_BOUNDS,
  initialPoses = INITIAL_POSES,
  options = {},
  // `onCatch(preyId)` runs exactly once per successful strike, at the snap. It must remove
  // the fish from the live tank and the saved population and return true; a false return
  // (the fish was already gone) turns the strike into a miss. `onSnap(event)` runs at every
  // snap, hit or miss, with the world snout point so nearby fish can scatter.
  onCatch = () => true,
  onSnap = () => {},
} = {}) {
  const tuning = { ...TUNING, ...HUNT, ...options };
  const range = (a, b) => a + random() * (b - a);
  hunger = Math.max(0, Math.min(1, Number(hunger) || 0));
  feedIn = Math.max(0, Number(feedIn) || 0);
  retryIn = Math.max(0, Number(retryIn) || 0);
  breathIn = breathIn === null || breathIn === undefined
    ? range(tuning.breathMin, tuning.breathMax)
    : Math.max(0, Number(breathIn) || 0);

  // Scalar validity is used by movement. It creates no footprint/contact arrays.
  function check(x, z, yaw, sampleGround = true) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    let surfaceY = -Infinity;
    for (const part of TURTLE_FOOTPRINT) {
      const px = x + part.x * c + part.z * s;
      const pz = z - part.x * s + part.z * c;
      if (
        px - part.radius < bounds.minX || px + part.radius > bounds.maxX ||
        pz - part.radius < bounds.minZ || pz + part.radius > bounds.maxZ
      ) return { valid: false, surfaceY };
      for (const obstacle of obstacles) {
        if (Math.hypot(px - obstacle.center.x, pz - obstacle.center.z) <
          obstacle.radius + part.radius + tuning.obstacleGap)
          return { valid: false, surfaceY };
      }
      for (const bed of beds) {
        const nx = clamp(px, bed.minX, bed.maxX), nz = clamp(pz, bed.minZ, bed.maxZ);
        if (Math.hypot(px - nx, pz - nz) < part.radius + tuning.obstacleGap) return { valid: false, surfaceY };
      }
      if (sampleGround) {
        surfaceY = Math.max(surfaceY, ground(px, pz));
        for (let i = 0; i < CONTACT_SAMPLES; i++) {
          const angle = i * TAU / CONTACT_SAMPLES;
          surfaceY = Math.max(surfaceY, ground(
            px + Math.cos(angle) * part.radius,
            pz + Math.sin(angle) * part.radius,
          ));
        }
      }
    }
    return { valid: true, surfaceY };
  }

  function randomCandidate(target) {
    target.x = range(bounds.minX, bounds.maxX);
    target.z = range(bounds.minZ, bounds.maxZ);
    target.yaw = range(-Math.PI, Math.PI);
    return target;
  }

  const scratch = { x: 0, z: 0, yaw: 0 };
  function pickPose(candidates = []) {
    for (const candidate of candidates) {
      const checked = check(candidate.x, candidate.z, candidate.yaw);
      if (checked.valid) return {
        x: candidate.x, z: candidate.z, yaw: candidate.yaw,
        y: checked.surfaceY + tuning.terrainClearance,
      };
    }
    for (let attempt = 0; attempt < 96; attempt++) {
      randomCandidate(scratch);
      const checked = check(scratch.x, scratch.z, scratch.yaw);
      if (checked.valid) return {
        x: scratch.x, z: scratch.z, yaw: scratch.yaw,
        y: checked.surfaceY + tuning.terrainClearance,
      };
    }
    for (let zi = 0; zi <= 20; zi++) {
      for (let xi = 0; xi <= 40; xi++) {
        for (const yaw of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
          const x = bounds.minX + (bounds.maxX - bounds.minX) * xi / 40;
          const z = bounds.minZ + (bounds.maxZ - bounds.minZ) * zi / 20;
          const checked = check(x, z, yaw);
          if (checked.valid) return { x, z, yaw, y: checked.surfaceY + tuning.terrainClearance };
        }
      }
    }
    throw new Error("No whole-body turtle pose fits the supplied bounds and scenery");
  }

  let body = pickPose(initialPoses);
  let target = null;
  let mode = "rest", elapsed = 0, transitions = 0, shuffleStart = 0;
  let restUntil = range(tuning.restMin, tuning.restMax);
  const swaySeed = random() * TAU;
  // The breath trip: rise, breathe with the beak through the film, glide to a chosen
  // landing pose, settle. `landing` is a checked ground pose; `from` is where the glide
  // began. Body pitch is nose-up positive and slews so the body never snaps.
  const swim = { phase: null, t: 0, until: 0, landing: null, surface: null, from: null, breatheY: 0, trips: 0 };
  let pitch = 0, wantPitch = 0, paddle = 0;
  // The neck reaches up a little for air; eased so it never pops.
  let calmExtend = 0;

  // Hunt state. `phase` is live only: a reload comes back to "idle" with the saved hunger
  // and cooldown remainders, so an interrupted lunge can neither land nor repeat.
  const hunt = {
    phase: "idle", target: null, aimed: 0, t: 0,
    snaps: 0, hits: 0, misses: 0, creeps: 0,
  };
  let nextCreep = 0;
  // Smoothed articulation, slewed toward whatever the current behaviour wants.
  const aim = { neckYaw: 0, headYaw: 0, neckPitch: 0, headPitch: 0 };
  const want = { neckYaw: 0, headYaw: 0, neckPitch: 0, headPitch: 0 };
  const scratchPoint = { x: 0, y: 0, z: 0 };

  // The output and all contact records are durable mutable objects. During a long rest,
  // body contacts and ground samples remain cached while only articulation numbers change.
  const pose = {
    id, mode, elapsed, transitions,
    x: body.x, y: body.y, z: body.z, yaw: body.yaw,
    neckYaw: 0, headYaw: 0, neckPitch: 0, headPitch: 0, extend: 0, gape: 0,
    pitch: 0, paddle: 0, swim: null, breathIn, trips: 0,
    hunt: {
      phase: "idle", hunger, feedIn, retryIn, target: null,
      snaps: 0, hits: 0, misses: 0, creeps: 0,
    },
    lure: { x: 0, y: 0, z: 0 },
    snout: { x: 0, y: 0, z: 0 },
    footprint: footprintAt(body.x, body.z, body.yaw, ground),
  };

  function updateBodyOutput() {
    pose.x = body.x; pose.y = body.y; pose.z = body.z; pose.yaw = body.yaw;
    const next = footprintAt(body.x, body.z, body.yaw, ground);
    for (let i = 0; i < next.length; i++) {
      const into = pose.footprint[i], from = next[i];
      into.x = from.x; into.z = from.z;
      for (let j = 0; j < from.contacts.length; j++) Object.assign(into.contacts[j], from.contacts[j]);
    }
    lureAt(pose, pose.lure);
  }

  function restSway() {
    if (mode === "swim") {
      // Neck forward, head lifted with the beak up through the film for the breath, then
      // level and a little down for the glide.
      const breathing = swim.phase === "breathe";
      const rising = swim.phase === "rise";
      want.neckYaw = 0;
      want.headYaw = 0;
      want.neckPitch = breathing ? 0.6 : rising ? 0.2 : -0.05;
      want.headPitch = breathing ? 0.35 : rising ? 0.1 : -0.1;
      return;
    }
    if (mode === "rest") {
      want.neckYaw = Math.sin(elapsed * TAU * tuning.headSwayRate + swaySeed) * tuning.headSwayAngle;
      want.headYaw = Math.sin(elapsed * TAU * tuning.headSwayRate * 1.4 + swaySeed * 1.7) * 0.1;
      const phase = ((elapsed + swaySeed * 3) % tuning.headDipPeriod) / tuning.headDipPeriod;
      // Negative local-z rotation lowers a point on local +x.
      want.headPitch = -tuning.headDipAngle * smoothstep(0.05, 0.35, phase) *
        (1 - smoothstep(0.6, 0.95, phase));
      want.neckPitch = 0;
    } else {
      want.neckYaw = 0.05;
      want.headYaw = Math.sin(elapsed * TAU * 0.3 + swaySeed) * 0.05;
      want.headPitch = -0.04 * Math.sin(elapsed * TAU * 0.7);
      want.neckPitch = 0;
    }
  }

  // Point the neck and head at a world position, splitting the turn between the two
  // pivots and clamping each to what the anatomy allows. Returns the aiming error in rad.
  function aimAt(point) {
    const A = TURTLE_ARTICULATION;
    const c = Math.cos(body.yaw), s = Math.sin(body.yaw);
    // The neck pivot in world space, then the prey in the body's local frame.
    const px = body.x + A.neckPivot.x * c, pz = body.z - A.neckPivot.x * s;
    const dx = point.x - px, dy = point.y - (body.y + A.neckPivot.y), dz = point.z - pz;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    const yaw = Math.atan2(-lz, lx);
    const pitch = Math.atan2(dy, Math.hypot(lx, lz));
    want.neckYaw = clamp(yaw * 0.65, -tuning.neckYawMax, tuning.neckYawMax);
    want.headYaw = clamp(yaw - want.neckYaw, -tuning.headYawMax, tuning.headYawMax);
    want.neckPitch = clamp(pitch * 0.7, tuning.neckPitchMin, tuning.neckPitchMax);
    want.headPitch = clamp(pitch - want.neckPitch, tuning.headPitchMin, tuning.headPitchMax);
    const reachedYaw = want.neckYaw + want.headYaw, reachedPitch = want.neckPitch + want.headPitch;
    return Math.max(Math.abs(yaw - reachedYaw), Math.abs(pitch - reachedPitch));
  }

  function slew(dt) {
    const step = tuning.trackRate * dt;
    for (const key of ["neckYaw", "headYaw", "neckPitch", "headPitch"]) {
      const d = want[key] - aim[key];
      aim[key] += Math.max(-step, Math.min(step, d));
    }
  }

  function findPrey(prey, sid) {
    for (let i = 0; i < prey.length; i++) if (prey[i].sid === sid) return prey[i];
    return null;
  }

  // Facing limits: prey well behind the shell cannot be reached without turning the body.
  function inArc(item) {
    const c = Math.cos(body.yaw), s = Math.sin(body.yaw);
    const dx = item.position.x - body.x, dz = item.position.z - body.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    return Math.abs(Math.atan2(-lz, lx)) <= tuning.yawLimit;
  }

  function suitable(item) {
    if (!item || !item.position) return false;
    const size = Number(item.size);
    if (!(size > 0) || size > tuning.maxPreySize) return false;
    const d = Math.hypot(item.position.x - pose.snout.x, item.position.y - pose.snout.y,
      item.position.z - pose.snout.z);
    return d <= tuning.trackRange && inArc(item);
  }

  function selectPrey(prey) {
    let best = null, bestDistance = Infinity;
    for (let i = 0; i < prey.length; i++) {
      const item = prey[i];
      if (!suitable(item)) continue;
      const d = Math.hypot(item.position.x - pose.snout.x, item.position.y - pose.snout.y,
        item.position.z - pose.snout.z);
      if (d < bestDistance) { best = item; bestDistance = d; }
    }
    return best;
  }

  function endHunt(phase) {
    hunt.phase = phase;
    hunt.target = null;
    hunt.aimed = 0;
    hunt.t = 0;
  }

  function resolveStrike(prey) {
    pose.extend = 1;
    snoutAt(pose, pose.snout);
    const item = findPrey(prey, hunt.target);
    const within = item && Math.hypot(item.position.x - pose.snout.x,
      item.position.y - pose.snout.y, item.position.z - pose.snout.z) <= tuning.catchRadius;
    // The population limit is checked again here, at the moment that matters.
    let hit = Boolean(within) && prey.length > tuning.minPopulation;
    if (hit && onCatch(hunt.target) === false) hit = false;
    hunt.snaps++;
    if (hit) {
      hunt.hits++;
      hunger = Math.max(0, hunger - tuning.meal);
      feedIn = tuning.feedCooldown;
    } else {
      hunt.misses++;
      retryIn = tuning.retryCooldown;
    }
    onSnap({ x: pose.snout.x, y: pose.snout.y, z: pose.snout.z, hit, preyId: hunt.target });
  }

  function updateHunt(dt, prey) {
    hunger = Math.min(1, hunger + dt * tuning.hungerRate);
    feedIn = Math.max(0, feedIn - dt);
    retryIn = Math.max(0, retryIn - dt);
    const canHunt = mode !== "swim" && hunger >= tuning.threshold && feedIn === 0 &&
      retryIn === 0 && prey.length > tuning.minPopulation;
    let useAim = false;
    // Outside a strike the neck is only ever stretched for a breath, and the current snout
    // drives the range tests.
    if (hunt.phase !== "strike" && hunt.phase !== "hold") {
      const breathing = mode === "swim" && swim.phase === "breathe" ? 0.25 : 0;
      calmExtend += Math.max(-dt, Math.min(dt, breathing - calmExtend));
      pose.extend = hunt.phase === "settle" ? pose.extend : calmExtend;
      snoutAt(pose, pose.snout);
    }
    if (hunt.phase === "idle" && canHunt) hunt.phase = "watch";
    if (hunt.phase === "watch") {
      if (!canHunt) hunt.phase = "idle";
      else {
        const chosen = selectPrey(prey);
        if (chosen) { hunt.phase = "track"; hunt.target = chosen.sid; hunt.aimed = 0; }
      }
    }
    if (hunt.phase === "track") {
      const item = findPrey(prey, hunt.target);
      if (!canHunt || !suitable(item)) endHunt(canHunt ? "watch" : "idle");
      else {
        const error = aimAt(item.position);
        useAim = true;
        const d = Math.hypot(item.position.x - pose.snout.x, item.position.y - pose.snout.y,
          item.position.z - pose.snout.z);
        const linedUp = d <= tuning.strikeReach && error <= tuning.aimTolerance &&
          Math.abs(aim.neckYaw - want.neckYaw) + Math.abs(aim.headYaw - want.headYaw) +
          Math.abs(aim.neckPitch - want.neckPitch) + Math.abs(aim.headPitch - want.headPitch)
          <= tuning.aimTolerance;
        hunt.aimed = linedUp ? hunt.aimed + dt : 0;
        if (hunt.aimed >= tuning.aimTime) { hunt.phase = "strike"; hunt.t = 0; }
        // Prey hanging just out of reach invites a short creep toward it, at most once
        // per interval and never during a lunge.
        else if (mode === "rest" && elapsed >= nextCreep) {
          const away = Math.hypot(item.position.x - pose.lure.x, item.position.z - pose.lure.z);
          if (away > tuning.creepDistance) {
            nextCreep = elapsed + tuning.creepInterval;
            beginShuffle({ x: item.position.x, z: item.position.z });
            if (mode === "shuffle") hunt.creeps++;
          }
        }
      }
    }
    if (hunt.phase === "strike") {
      // The lunge is ballistic: the aim freezes where it was when the neck launched.
      useAim = true;
      Object.assign(want, aim);
      hunt.t += dt;
      const u = clamp(hunt.t / tuning.strikeTime, 0, 1);
      pose.extend = 1 - (1 - u) * (1 - u);
      pose.gape = Math.sin(Math.PI * u);
      if (hunt.t >= tuning.strikeTime) {
        resolveStrike(prey);
        pose.gape = 0;
        hunt.phase = "hold";
        hunt.t = 0;
      }
    } else if (hunt.phase === "hold") {
      useAim = true;
      Object.assign(want, aim);
      pose.extend = 1;
      hunt.t += dt;
      if (hunt.t >= tuning.holdTime) { hunt.phase = "settle"; hunt.t = 0; }
    } else if (hunt.phase === "settle") {
      hunt.t += dt;
      pose.extend = 1 - smoothstep(0, tuning.settleTime, hunt.t);
      if (hunt.t >= tuning.settleTime) { pose.extend = 0; calmExtend = 0; endHunt("idle"); }
    }
    if (!useAim) restSway();
    slew(dt);
  }

  function updateArticulation() {
    pose.mode = mode; pose.elapsed = elapsed; pose.transitions = transitions;
    pose.neckYaw = aim.neckYaw; pose.headYaw = aim.headYaw;
    pose.neckPitch = aim.neckPitch; pose.headPitch = aim.headPitch;
    pose.pitch = pitch; pose.paddle = paddle; pose.swim = swim.phase;
    pose.breathIn = breathIn; pose.trips = swim.trips;
    if (hunt.phase !== "strike" && hunt.phase !== "hold") pose.gape = 0;
    snoutAt(pose, pose.snout);
    const h = pose.hunt;
    h.phase = hunt.phase; h.hunger = hunger; h.feedIn = feedIn; h.retryIn = retryIn;
    h.target = hunt.target; h.snaps = hunt.snaps; h.hits = hunt.hits; h.misses = hunt.misses;
    h.creeps = hunt.creeps;
    return pose;
  }

  function completeShuffle() {
    mode = "rest";
    target = null;
    transitions++;
    restUntil = elapsed + range(tuning.restMin, tuning.restMax);
  }

  // Is the body centre clear of the swim obstacles at this point?
  function swimClear(x, y, z) {
    for (const obstacle of swimObstacles) {
      if (Math.hypot(x - obstacle.center.x, y - (obstacle.center.y ?? y), z - obstacle.center.z) <
        obstacle.radius + tuning.swimClearance) return false;
    }
    return true;
  }
  // A straight swim from `a` to `b`, sampled every 0.3 units. The last stretch above the
  // landing is left to the ground footprint check, which is stricter there.
  function pathClear(a, b, skipEnd = 0) {
    const length = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const steps = Math.max(1, Math.ceil(length / 0.3));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (length * (1 - t) < skipEnd) break;
      if (!swimClear(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }
  // How high the body centre sits when the beak just breaks the film in the breathing pose.
  function breatheHeight() {
    const at = snoutAt({
      x: 0, y: 0, z: 0, yaw: 0, pitch: 0.3, neckYaw: 0, headYaw: 0,
      neckPitch: 0.6, headPitch: 0.35, extend: 0.25,
    });
    return tuning.surfaceY + 0.02 - at.y;
  }

  // Pick a checked landing pose somewhere else on the floor whose glide path is clear.
  // Landings face the way the glide travels, so the body arrives nose-first. Prefers a
  // genuinely new spot; if nothing far away fits, any clear valid pose will do.
  // Pockets differ in which way a turtle can lie in them (the foreground channel only
  // along the tank), so the landing may lie up to a right angle off the glide direction;
  // the nearest-to-travel yaw that fits is taken. The first candidates are drawn from the
  // other half of the floor -- front if the turtle is behind the wood, behind if it is in
  // the foreground -- so trips alternate between the plainly visible foreground pocket and
  // the larger ones at the back rather than favouring the back by area.
  function planLanding(surface) {
    const candidate = { x: 0, z: 0, yaw: 0 };
    const frontEdge = Math.max(bounds.minZ, 1.0);
    const preferFront = body.z < frontEdge;
    for (let attempt = 0; attempt < 90; attempt++) {
      randomCandidate(candidate);
      if (attempt < 40) candidate.z = preferFront ? range(frontEdge, bounds.maxZ) : range(bounds.minZ, frontEdge);
      const dx = candidate.x - surface.x, dz = candidate.z - surface.z;
      if (attempt < 70 && Math.hypot(candidate.x - body.x, candidate.z - body.z) < tuning.landingMinDistance) continue;
      const travel = Math.hypot(dx, dz) > 0.3 ? Math.atan2(-dz, dx) : range(-Math.PI, Math.PI);
      for (const offset of [0, 0.5, -0.5, 1.0, -1.0, Math.PI / 2, -Math.PI / 2]) {
        const yaw = travel + offset;
        const checked = check(candidate.x, candidate.z, yaw);
        if (!checked.valid) continue;
        const landing = {
          x: candidate.x, z: candidate.z, yaw,
          y: checked.surfaceY + tuning.terrainClearance,
        };
        if (!pathClear(surface, landing, 1.2)) break;
        return landing;
      }
    }
    return null;
  }

  // A trip is a landing pose and a surface point that clear both legs: the rise from the
  // resting spot to the film and the glide from the film down to the landing. The wood's
  // trunk divides the water above the back channel from the foreground, so the point is
  // chosen per landing: first along the way between the two spots, then around the body.
  const surfaceCandidate = { x: 0, y: 0, z: 0 };
  function planSurface(breatheY, landing) {
    const start = { x: body.x, y: body.y + 1.2, z: body.z };
    surfaceCandidate.y = breatheY;
    const tryPoint = (x, z) => {
      if (x < bounds.minX || x > bounds.maxX || z < bounds.minZ || z > bounds.maxZ) return null;
      surfaceCandidate.x = x; surfaceCandidate.z = z;
      if (!pathClear(start, surfaceCandidate)) return null;
      if (!pathClear(surfaceCandidate, landing, 1.2)) return null;
      return { x, y: breatheY, z };
    };
    for (const f of [0.4, 0.25, 0.55, 0.1, 0.7]) {
      const found = tryPoint(body.x + (landing.x - body.x) * f, body.z + (landing.z - body.z) * f);
      if (found) return found;
    }
    for (const reach of [0.6, 1.5, 2.5, 3.5]) {
      for (let k = 0; k < 8; k++) {
        const angle = body.yaw + k * TAU / 8;
        const found = tryPoint(body.x + Math.cos(angle) * reach, body.z - Math.sin(angle) * reach);
        if (found) return found;
      }
    }
    return null;
  }

  // Pick a checked landing pose somewhere else on the floor that a clear trip can reach.
  // Pockets differ in which way a turtle can lie in them (the foreground channel only
  // along the tank), so the landing may lie up to a right angle off the glide direction;
  // the nearest-to-travel yaw that fits is taken. The first candidates are drawn from the
  // other half of the floor -- front if the turtle is behind the wood, behind if it is in
  // the foreground -- so trips alternate between the plainly visible foreground pocket and
  // the larger ones at the back rather than favouring the back by area. Prefers a genuinely
  // new spot; if nothing far away fits, any reachable valid pose will do.
  function planTrip(breatheY) {
    const candidate = { x: 0, z: 0, yaw: 0 };
    const frontEdge = Math.max(bounds.minZ, 1.0);
    const preferFront = body.z < frontEdge;
    // The foreground pocket is small (about 1 by 0.25 units), so the preferred half gets
    // many draws; this runs once per breath, so the cost does not matter.
    for (let attempt = 0; attempt < 220; attempt++) {
      randomCandidate(candidate);
      if (attempt < 150) candidate.z = preferFront ? range(frontEdge, bounds.maxZ) : range(bounds.minZ, frontEdge);
      const dx = candidate.x - body.x, dz = candidate.z - body.z;
      const away = Math.hypot(dx, dz);
      if (attempt < 190 && away < tuning.landingMinDistance) continue;
      const travel = away > 0.3 ? Math.atan2(-dz, dx) : range(-Math.PI, Math.PI);
      for (const offset of [0, 0.5, -0.5, 1.0, -1.0, Math.PI / 2, -Math.PI / 2]) {
        const yaw = travel + offset;
        const checked = check(candidate.x, candidate.z, yaw);
        if (!checked.valid) continue;
        // Room for at least a short step forward or back, so the turtle is not left
        // pinned until its next breath.
        const step = tuning.minShuffleDistance;
        if (!check(candidate.x + Math.cos(yaw) * step, candidate.z - Math.sin(yaw) * step, yaw, false).valid &&
          !check(candidate.x - Math.cos(yaw) * step, candidate.z + Math.sin(yaw) * step, yaw, false).valid) continue;
        const landing = {
          x: candidate.x, z: candidate.z, yaw,
          y: checked.surfaceY + tuning.terrainClearance,
        };
        const surface = planSurface(breatheY, landing);
        if (!surface) break;
        return { landing, surface };
      }
    }
    return null;
  }

  function beginSwim() {
    const breatheY = breatheHeight();
    const trip = planTrip(breatheY);
    if (!trip) {
      breathIn = tuning.blockedRetry * 8;
      return;
    }
    swim.phase = "rise";
    swim.t = 0;
    swim.landing = trip.landing;
    swim.surface = trip.surface;
    swim.breatheY = breatheY;
    swim.from = null;
    mode = "swim";
    target = null;
    transitions++;
  }

  function updateSwim(dt) {
    if (swim.phase === "rise") {
      wantPitch = 0.45;
      paddle = 1;
      // Paddle toward the chosen point on the film, facing the way it is going.
      const S = swim.surface;
      const dx = S.x - body.x, dy = S.y - body.y, dz = S.z - body.z;
      const remaining = Math.hypot(dx, dy, dz);
      const travel = Math.min(remaining, tuning.riseSpeed * dt);
      if (remaining > 1e-9) {
        body.x += dx / remaining * travel;
        body.y += dy / remaining * travel;
        body.z += dz / remaining * travel;
        if (Math.hypot(dx, dz) > 0.2) {
          const turn = wrapDiff(body.yaw, Math.atan2(-dz, dx));
          const maxTurn = tuning.turnRate * dt;
          body.yaw += Math.abs(turn) <= maxTurn ? turn : Math.sign(turn) * maxTurn;
        }
      }
      swim.t += dt;
      if (remaining - travel <= 1e-6) {
        body.x = S.x; body.y = S.y; body.z = S.z;
        swim.phase = "breathe";
        swim.t = 0;
        swim.until = range(tuning.breatheMin, tuning.breatheMax);
      }
    } else if (swim.phase === "breathe") {
      wantPitch = 0.3;
      paddle = 0.4;
      swim.t += dt;
      // Turn on the spot to face the way down while the head is up.
      const turn = wrapDiff(body.yaw, swim.landing.yaw);
      const maxTurn = tuning.turnRate * dt;
      body.yaw = Math.abs(turn) <= maxTurn ? swim.landing.yaw : body.yaw + Math.sign(turn) * maxTurn;
      if (swim.t >= swim.until && (Math.abs(turn) <= maxTurn || swim.t >= swim.until + 4)) {
        swim.phase = "glide";
        swim.t = 0;
        swim.from = { x: body.x, y: body.y, z: body.z };
      }
    } else if (swim.phase === "glide") {
      paddle = 0;
      const L = swim.landing;
      const dx = L.x - body.x, dy = L.y - body.y, dz = L.z - body.z;
      const remaining = Math.hypot(dx, dy, dz);
      const horizontal = Math.hypot(dx, dz);
      // Nose down along the path, levelling out for the last body length.
      wantPitch = clamp(Math.atan2(dy, Math.max(horizontal, 1e-6)), -0.55, 0) * clamp(remaining / 1.2, 0, 1);
      const ease = Math.max(0.3, Math.min(1, remaining / 1.5));
      const travel = Math.min(remaining, tuning.glideSpeed * ease * dt);
      if (remaining > 1e-9) {
        body.x += dx / remaining * travel;
        body.y += dy / remaining * travel;
        body.z += dz / remaining * travel;
      }
      body.yaw = L.yaw;
      if (remaining - travel <= 1e-6) {
        body.x = L.x; body.y = L.y; body.z = L.z; body.yaw = L.yaw;
        swim.phase = null;
        swim.trips++;
        mode = "rest";
        transitions++;
        restUntil = elapsed + range(tuning.restMin, tuning.restMax);
        breathIn = range(tuning.breathMin, tuning.breathMax);
      }
    }
    updateBodyOutput();
  }

  // Build and validate a short local route before a shuffle begins. The old distant-target
  // scheme could choose a valid end pose that required an impossible turn in this narrow
  // foreground strip. These small arcs check the swept body envelope up front. A turtle
  // may back out with nearly fixed yaw when there is no room to turn around.
  function planRoute(distance, turn, direction) {
    const steps = Math.max(8, Math.ceil(distance / 0.035), Math.ceil(Math.abs(turn) / 0.02));
    const points = [];
    let x = body.x, z = body.z;
    for (let i = 1; i <= steps; i++) {
      const yaw = body.yaw + turn * i / steps;
      const stride = direction * distance / steps;
      x += Math.cos(yaw) * stride;
      z -= Math.sin(yaw) * stride;
      if (!check(x, z, yaw, false).valid) return null;
      points.push({ x, z, yaw });
    }
    // Sample terrain only after the cheap swept bounds/scenery test accepts the route.
    if (!check(x, z, body.yaw + turn).valid) return null;
    return { points, index: 0 };
  }

  // `toward`, when given, is a stalk: of the random arcs that fit, keep the one that ends
  // nearest that point, and only move at all if it closes the distance.
  function beginShuffle(toward = null) {
    // Random local arcs keep repeated movement from looking mechanical. Search happens
    // once at rest-end, never each frame.
    if (toward) {
      const A = TURTLE_ARTICULATION;
      const before = Math.hypot(toward.x - pose.lure.x, toward.z - pose.lure.z);
      let bestDistance = before - 0.08;
      for (let i = 0; i < 16; i++) {
        const distance = range(tuning.minShuffleDistance, tuning.maxShuffleDistance);
        const route = planRoute(distance, range(-tuning.maxShuffleTurn, tuning.maxShuffleTurn), 1);
        if (!route) continue;
        const end = route.points[route.points.length - 1];
        const along = A.headPivotX * (1 + A.stretch * 0.55) + A.snout.x;
        const lx = end.x + Math.cos(end.yaw) * (A.neckPivot.x + along * Math.cos(0.55));
        const lz = end.z - Math.sin(end.yaw) * (A.neckPivot.x + along * Math.cos(0.55));
        const after = Math.hypot(toward.x - lx, toward.z - lz);
        if (after < bestDistance) { bestDistance = after; target = route; }
      }
      if (!target) return;
    }
    for (let i = 0; i < 16 && !target; i++) {
      const direction = random() < 0.24 ? -1 : 1;
      const distance = range(tuning.minShuffleDistance, tuning.maxShuffleDistance);
      const turnLimit = direction < 0 ? tuning.maxShuffleTurn * 0.45 : tuning.maxShuffleTurn;
      target = planRoute(distance, range(-turnLimit, turnLimit), direction);
    }
    // Fixed short choices guarantee a way out when unlucky random arcs all point toward
    // the same wall. Forward is preferred; backward needs no broad in-place turn.
    if (!target) {
      const distances = [0.52, 0.4, tuning.minShuffleDistance];
      const turns = [0, 0.08, -0.08, 0.15, -0.15];
      for (const direction of [1, -1]) {
        for (const distance of distances) {
          for (const turn of turns) {
            target = planRoute(distance, direction < 0 ? turn * 0.4 : turn, direction);
            if (target) break;
          }
          if (target) break;
        }
        if (target) break;
      }
    }
    if (!target) {
      restUntil = elapsed + Math.min(tuning.restMin, tuning.blockedRetry);
      return;
    }
    mode = "shuffle";
    transitions++;
    shuffleStart = elapsed;
  }

  lureAt(pose, pose.lure);
  restSway();
  Object.assign(aim, want);
  updateArticulation();
  return {
    // `prey` is the live list of fish the turtle can see: each item exposes a stable `sid`,
    // a `position` with x/y/z, and a relative body `size`. It is read, never mutated.
    update(dt, prey = EMPTY) {
      if (!(dt > 0)) return pose;
      elapsed += dt;
      breathIn = Math.max(0, breathIn - dt);
      const free = hunt.phase === "idle" || hunt.phase === "watch";
      // Air comes first once the breath is due, but never in the middle of a hunt.
      if (mode === "rest" && breathIn <= 0 && free) beginSwim();
      if (mode === "rest" && elapsed >= restUntil) {
        // A turtle lined up on a fish does not wander off in the middle of it.
        if (free) beginShuffle();
        else restUntil = elapsed + 5;
      }
      if (mode === "swim") updateSwim(dt);
      else {
        wantPitch = 0;
        paddle = 0;
      }
      pitch += Math.max(-tuning.pitchRate * dt, Math.min(tuning.pitchRate * dt, wantPitch - pitch));
      if (mode === "shuffle") {
        const waypoint = target.points[target.index];
        const dx = waypoint.x - body.x, dz = waypoint.z - body.z;
        const distance = Math.hypot(dx, dz);
        const turn = wrapDiff(body.yaw, waypoint.yaw);
        const maxTurn = tuning.turnRate * dt;
        const nextYaw = Math.abs(turn) <= maxTurn
          ? waypoint.yaw
          : body.yaw + Math.sign(turn) * maxTurn;
        const travel = Math.min(distance, tuning.shuffleSpeed * dt);
        const x = distance > 1e-8 ? body.x + dx / distance * travel : waypoint.x;
        const z = distance > 1e-8 ? body.z + dz / distance * travel : waypoint.z;
        const checked = check(x, z, nextYaw);
        if (checked.valid) {
          body.x = x; body.z = z; body.yaw = nextYaw;
          body.y = checked.surfaceY + tuning.terrainClearance;
          updateBodyOutput();
          if (distance <= travel + 1e-8) target.index++;
        } else completeShuffle();
        if (mode === "shuffle" && (
          target.index >= target.points.length ||
          elapsed - shuffleStart >= tuning.maxShuffle / tuning.shuffleSpeed
        )) completeShuffle();
      }
      updateHunt(dt, prey);
      return updateArticulation();
    },
    getPose: () => pose,
    // The durable record: identity plus hunger and cooldown remainders. The hunt phase is
    // not saved, so a reload lands in "idle" and can neither grant nor repeat a catch.
    snapshot: () => ({
      id: String(id), hunger: round3(hunger), feedIn: round3(feedIn), retryIn: round3(retryIn),
      breathIn: round3(breathIn),
    }),
    inspect: (candidate = body) => inspectTurtlePose(candidate, {
      bounds, obstacles, ground,
      obstacleGap: tuning.obstacleGap,
      terrainClearance: tuning.terrainClearance,
    }),
  };
}
