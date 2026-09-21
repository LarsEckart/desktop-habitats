// Pure snapping-turtle movement. No Three.js or browser dependency.
const TAU = Math.PI * 2;
const CONTACT_SAMPLES = 8;

export const TURTLE_BOUNDS = Object.freeze({
  minX: -3.2,
  maxX: 3.0,
  minZ: 0.55,
  maxZ: 2.75,
});

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
  Object.freeze({ name: "neck base", x: 0.62, z: 0, radius: 0.28 }),
  Object.freeze({ name: "neck reach", x: 0.91, z: 0, radius: 0.36 }),
  Object.freeze({ name: "head reach", x: 1.26, z: 0, radius: 0.58 }),
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

export function createTurtleSimulation({
  id = "turtle",
  obstacles = [],
  ground = () => 0,
  random = Math.random,
  bounds = TURTLE_BOUNDS,
  initialPoses = INITIAL_POSES,
  options = {},
} = {}) {
  const tuning = { ...TUNING, ...options };
  const range = (a, b) => a + random() * (b - a);

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

  // The output and all contact records are durable mutable objects. During a long rest,
  // body contacts and ground samples remain cached while only articulation numbers change.
  const pose = {
    id, mode, elapsed, transitions,
    x: body.x, y: body.y, z: body.z, yaw: body.yaw,
    neckYaw: 0, headYaw: 0, headPitch: 0,
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
  }

  function updateArticulation() {
    pose.mode = mode; pose.elapsed = elapsed; pose.transitions = transitions;
    if (mode === "rest") {
      pose.neckYaw = Math.sin(elapsed * TAU * tuning.headSwayRate + swaySeed) * tuning.headSwayAngle;
      pose.headYaw = Math.sin(elapsed * TAU * tuning.headSwayRate * 1.4 + swaySeed * 1.7) * 0.1;
      const phase = ((elapsed + swaySeed * 3) % tuning.headDipPeriod) / tuning.headDipPeriod;
      // Negative local-z rotation lowers a point on local +x.
      pose.headPitch = -tuning.headDipAngle * smoothstep(0.05, 0.35, phase) *
        (1 - smoothstep(0.6, 0.95, phase));
    } else {
      pose.neckYaw = 0.05;
      pose.headYaw = Math.sin(elapsed * TAU * 0.3 + swaySeed) * 0.05;
      pose.headPitch = -0.04 * Math.sin(elapsed * TAU * 0.7);
    }
    return pose;
  }

  function completeShuffle() {
    mode = "rest";
    target = null;
    transitions++;
    restUntil = elapsed + range(tuning.restMin, tuning.restMax);
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

  function beginShuffle() {
    // Random local arcs keep repeated movement from looking mechanical. Search happens
    // once at rest-end, never each frame.
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

  updateArticulation();
  return {
    update(dt) {
      if (!(dt > 0)) return pose;
      elapsed += dt;
      if (mode === "rest" && elapsed >= restUntil) beginShuffle();
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
      return updateArticulation();
    },
    getPose: () => pose,
    snapshot: () => ({ id: String(id) }),
    inspect: (candidate = body) => inspectTurtlePose(candidate, {
      bounds, obstacles, ground,
      obstacleGap: tuning.obstacleGap,
      terrainClearance: tuning.terrainClearance,
    }),
  };
}
