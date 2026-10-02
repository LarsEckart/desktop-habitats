import * as THREE from "three";
import { sizeScale } from "./breeding.js";

// The honey gourami is deliberately not another profile for the shared shoaling rig.
// This module owns one animal end to end: decisions, locomotion, a short articulated
// spine, labyrinth breathing, feeding, and the meshes that consume that state. The
// school only supplies the durable record, shared food, pointer, and simulation step.

export const HONEY_STEP = 1 / 60;
export const HONEY_BOUNDS = Object.freeze({
  minX: -7.6, maxX: 7.6, minY: 1.15, maxY: 7.82, minZ: -3.8, maxZ: 2.7,
});
export const HONEY_JOINTS = 12;
const SPINE_LENGTH = 2.12;

const TAU = Math.PI * 2;
const HEAD = 0.72;
const SURFACE_Y = 8.12;
const CURIOUS_HOLD = 4.5;
const FEED_NOTICE = [0.22, 0.5];
const tmp = new THREE.Vector3();

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const approach = (value, target, rate, dt) =>
  value + (target - value) * (1 - Math.exp(-rate * dt));
const wrap = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const smooth = (value) => value * value * (3 - 2 * value);
const smoothstep = (low, high, value) => smooth(clamp((value - low) / (high - low), 0, 1));

function heading(yaw, pitch, target = new THREE.Vector3()) {
  return target.set(
    Math.cos(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    Math.sin(yaw) * Math.cos(pitch),
  );
}

function livingPellet(pellet) {
  return pellet && !pellet.gone && !pellet.eatenAt && pellet.position;
}

/** Pure transient simulation. It depends on Three's vector math, but never constructs a
 * mesh or touches a scene, so behavior checks run without WebGL or rendered geometry. */
export function createHoneyGouramiSimulation({
  random = Math.random,
  food = null,
  position = new THREE.Vector3(1.8, 4.4, 1.2),
} = {}) {
  const range = (low, high) => low + random() * (high - low);
  const state = {
    time: 0,
    mode: "hover",
    position: position.clone(),
    velocity: new THREE.Vector3(),
    heading: new THREE.Vector3(1, 0, 0),
    yaw: random() < 0.5 ? 0 : Math.PI,
    pitch: 0,
    yawRate: 0,
    tailPhase: range(0, TAU),
    tailEffort: 0.08,
    pectoralPhase: range(0, TAU),
    pectoralEffort: 0.4,
    breath: 0,
    mouth: 0,
    operculum: 0,
    goal: position.clone(),
    station: position.clone(),
    until: range(5, 10),
    nextSurface: range(18, 30),
    target: null,
    noticeAt: Infinity,
    strikeAt: 0,
    handleUntil: 0,
    pointerInside: false,
    pointerMovedAt: -Infinity,
    pointer: new THREE.Vector3(),
    interest: new THREE.Vector3(),
    strikes: 0,
    eaten: 0,
    transitions: [],
    spine: Array.from({ length: HONEY_JOINTS }, () => new THREE.Vector3()),
  };
  heading(state.yaw, state.pitch, state.heading);

  function chooseGoal(lowY = 2, highY = 6.6) {
    const direction = Math.cos(state.yaw) >= 0 ? 1 : -1;
    for (let attempt = 0; attempt < 12; attempt++) {
      state.goal.set(
        range(HONEY_BOUNDS.minX + 0.7, HONEY_BOUNDS.maxX - 0.7),
        range(lowY, highY),
        clamp(state.position.z + range(-0.45, 0.45), -1.3, HONEY_BOUNDS.maxZ - 0.3),
      );
      if (attempt > 5 || (state.goal.x - state.position.x) * direction > 1.5) break;
    }
  }

  function setMode(mode) {
    if (state.mode !== mode) state.transitions.push(`${state.mode}->${mode}`);
    state.mode = mode;
    if (mode === "hover") {
      state.station.copy(state.position);
      state.until = state.time + range(5, 11);
    } else if (mode === "cruise") {
      chooseGoal();
      state.until = state.time + 18;
    } else if (mode === "surface") {
      state.goal.set(
        clamp(state.position.x + range(-1.3, 1.3), HONEY_BOUNDS.minX + 1, HONEY_BOUNDS.maxX - 1),
        SURFACE_Y,
        clamp(state.position.z + range(-0.4, 0.4), -1.5, HONEY_BOUNDS.maxZ - 0.3),
      );
      state.until = state.time + 14;
    } else if (mode === "breathe") {
      state.until = state.time + range(0.8, 1.25);
      state.nextSurface = state.time + range(35, 55);
    } else if (mode === "descend") {
      chooseGoal(2.2, 5.1);
      state.until = state.time + 14;
    } else if (mode === "curious") {
      state.interest.copy(state.pointer);
    } else if (mode === "feed") {
      state.target = null;
      state.strikeAt = 0;
      state.handleUntil = state.time;
    }
  }

  function nearestPellet() {
    if (!food?.pellets) return null;
    let nearest = null;
    let distance = Infinity;
    const mouth = tmp.copy(state.position).addScaledVector(state.heading, HEAD);
    for (const pellet of food.pellets) {
      if (!livingPellet(pellet)) continue;
      const d = mouth.distanceToSquared(pellet.position);
      if (d < distance) { nearest = pellet; distance = d; }
    }
    return nearest;
  }

  function appetite() {
    const pellet = nearestPellet();
    if (!pellet && !state.strikeAt) {
      state.noticeAt = Infinity;
      if (state.mode === "feed") setMode("hover");
      return;
    }
    if (state.mode === "feed") return;
    if (!Number.isFinite(state.noticeAt)) state.noticeAt = state.time + range(...FEED_NOTICE);
    if (state.time >= state.noticeAt) setMode("feed");
  }

  function desiredMotion(dt) {
    appetite(); // Food is considered before curiosity and therefore always wins.
    const curious =
      state.mode !== "feed" && state.pointerInside &&
      state.time - state.pointerMovedAt < CURIOUS_HOLD;
    if (curious && state.mode !== "curious") setMode("curious");
    if (!curious && state.mode === "curious") setMode("hover");

    const target = new THREE.Vector3();
    let speed = 0;
    if (state.mode === "hover") {
      if (state.time >= state.nextSurface) setMode("surface");
      else if (state.time >= state.until) setMode(random() < 0.62 ? "cruise" : "hover");
      target.copy(state.station);
      target.x += Math.sin(state.time * 0.37) * 0.12;
      target.y += Math.sin(state.time * 0.53) * 0.08;
      speed = 0.12;
    } else if (state.mode === "curious") {
      state.interest.lerp(state.pointer, 1 - Math.exp(-2.4 * dt));
      // Gouramis inspect side-on with one eye, keeping a respectful distance from glass.
      const side = Math.cos(state.yaw) >= 0 ? -1 : 1;
      target.copy(state.interest).add(new THREE.Vector3(side * 0.85, 0, -0.45));
      target.clamp(
        new THREE.Vector3(HONEY_BOUNDS.minX, HONEY_BOUNDS.minY, HONEY_BOUNDS.minZ),
        new THREE.Vector3(HONEY_BOUNDS.maxX, HONEY_BOUNDS.maxY, HONEY_BOUNDS.maxZ),
      );
      speed = 0.5;
    } else if (state.mode === "surface") {
      target.copy(state.goal);
      speed = 0.62;
      if (state.position.y > HONEY_BOUNDS.maxY - 0.05) setMode("breathe");
      else if (state.time > state.until) setMode("hover");
    } else if (state.mode === "breathe") {
      target.copy(state.position);
      state.mouth = Math.max(state.mouth, 0.95);
      if (state.time > state.until) setMode("descend");
    } else if (state.mode === "cruise" || state.mode === "descend") {
      target.copy(state.goal);
      speed = state.mode === "cruise" ? 0.58 : 0.48;
      if (state.position.distanceTo(state.goal) < 0.35 || state.time > state.until) setMode("hover");
    } else if (state.mode === "feed") {
      if (state.strikeAt && state.time >= state.strikeAt + 0.1) {
        if (livingPellet(state.target) && food?.take?.(state.target)) state.eaten++;
        state.strikeAt = 0;
        state.target = null;
        state.handleUntil = state.time + range(0.3, 0.65);
      }
      if (!livingPellet(state.target) && state.time >= state.handleUntil)
        state.target = nearestPellet();
      if (!state.target) return { target: state.position.clone(), speed: 0 };
      target.copy(state.target.position);
      const mouth = tmp.copy(state.position).addScaledVector(state.heading, HEAD);
      const distance = mouth.distanceTo(target);
      speed = Math.min(0.82, 0.12 + distance * 0.65);
      if (!state.strikeAt && distance < 0.24) {
        state.strikeAt = state.time;
        state.strikes++;
        state.mouth = 1;
        state.velocity.addScaledVector(target.clone().sub(mouth).normalize(), 0.28);
      }
    }
    return { target, speed };
  }

  function updateSpine(dt) {
    state.tailPhase += dt * TAU * (0.85 + 2.2 * state.tailEffort);
    for (let i = 0; i < HONEY_JOINTS; i++) {
      const t = i / (HONEY_JOINTS - 1);
      const x = 0.62 - t * SPINE_LENGTH;
      const tail = smooth(clamp((t - 0.3) / 0.7, 0, 1));
      const turn = -state.yawRate * t * t * 0.16;
      state.spine[i].set(
        x,
        -state.pitch * t * 0.08,
        turn + Math.sin(state.tailPhase - t * 5.1) * tail * (0.025 + state.tailEffort * 0.16),
      );
    }
  }

  function step(dt) {
    dt = clamp(dt, 0, 0.05);
    state.time += dt;
    const motion = desiredMotion(dt);
    const to = motion.target.sub(state.position);
    const distance = to.length();
    const direction = distance > 1e-5 ? to.multiplyScalar(1 / distance) : state.heading;
    const desiredYaw = Math.atan2(direction.z, direction.x);
    const desiredPitch = Math.asin(clamp(direction.y, -0.7, 0.7));
    const turnLimit = state.mode === "feed" ? 1.55 : 0.78;
    state.yawRate = approach(
      state.yawRate,
      clamp(wrap(desiredYaw - state.yaw) * 1.7, -turnLimit, turnLimit),
      3.2,
      dt,
    );
    state.yaw = wrap(state.yaw + state.yawRate * dt);
    state.pitch = approach(state.pitch, desiredPitch, 2.6, dt);
    heading(state.yaw, state.pitch, state.heading);
    const desiredVelocity = state.heading.clone().multiplyScalar(motion.speed);
    state.velocity.lerp(desiredVelocity, 1 - Math.exp(-2.1 * dt));
    state.position.addScaledVector(state.velocity, dt);
    state.position.x = clamp(state.position.x, HONEY_BOUNDS.minX, HONEY_BOUNDS.maxX);
    state.position.y = clamp(state.position.y, HONEY_BOUNDS.minY, HONEY_BOUNDS.maxY);
    state.position.z = clamp(state.position.z, HONEY_BOUNDS.minZ, HONEY_BOUNDS.maxZ);

    const drive = clamp((motion.speed - 0.12) / 0.7, 0, 1);
    state.tailEffort = approach(state.tailEffort, drive, drive > state.tailEffort ? 5 : 1.6, dt);
    state.pectoralEffort = approach(state.pectoralEffort, 1 - drive * 0.45, 4, dt);
    state.pectoralPhase += dt * TAU * (3.2 + 2 * state.pectoralEffort);
    const respiration = 0.5 - 0.5 * Math.cos(state.time * TAU * (1.15 + drive * 0.7));
    state.breath = respiration;
    state.operculum = Math.pow(0.5 - 0.5 * Math.cos(state.time * TAU * (1.15 + drive * 0.7) - 1.1), 2);
    state.mouth = approach(state.mouth, 0.14 * respiration, 8, dt);
    updateSpine(dt);
  }

  updateSpine(0);
  return {
    state,
    step,
    point(world, moved = true) {
      if (!world) { state.pointerInside = false; return; }
      state.pointer.copy(world);
      state.pointerInside = true;
      if (moved) state.pointerMovedAt = state.time;
    },
    forceMode(mode) { setMode(mode); },
    present(mode) {
      setMode(mode);
      state.position.set(-3, mode === "breathe" ? 4.5 : 6.45, 2.45);
      state.yaw = 0;
      state.pitch = 0;
      state.pectoralPhase = Math.PI / 2;
      state.pectoralEffort = 0.85;
      if (mode === "curious") {
        state.interest.copy(state.position).add(new THREE.Vector3(1.2, 0.25, 1));
        state.pectoralEffort = 1;
      } else if (mode === "breathe") {
        state.position.y = HONEY_BOUNDS.maxY;
        state.pitch = 0.9;
        state.mouth = 1;
      } else if (mode === "feed") {
        state.tailEffort = 0.9;
        state.pectoralEffort = 1;
        state.mouth = 1;
      }
      const bend = mode === "feed" ? 0.25 : mode === "curious" ? -0.06 : 0;
      for (let i = 0; i < state.spine.length; i++) {
        const t = i / (state.spine.length - 1);
        state.spine[i].set(
          0.62 - t * SPINE_LENGTH,
          mode === "feed" ? 0.5 * t * t : 0,
          bend * t * t,
        );
      }
      heading(state.yaw, state.pitch, state.heading);
      return this.diagnostics();
    },
    diagnostics() {
      const finite = [
        ...state.position, ...state.velocity, state.yaw, state.pitch, state.mouth,
        ...state.spine.flatMap((point) => point.toArray()),
      ].every(Number.isFinite);
      return {
        time: state.time, mode: state.mode, finite,
        strikes: state.strikes, eaten: state.eaten,
        transitions: [...state.transitions],
      };
    },
  };
}

function makeGeometry(points, indices, uvs, progress = null) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.setAttribute("aLocal", new THREE.Float32BufferAttribute(points.flat(), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs.flat(), 2));
  if (progress) geometry.setAttribute("aFinProgress", new THREE.Float32BufferAttribute(progress, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function bodyProfile(x) {
  const u = clamp((0.66 - x) / 1.28, 0, 1);
  const fullness = Math.pow(Math.sin(Math.PI * u), 0.42);
  const shoulder = Math.exp(-(((u - 0.26) / 0.22) ** 2));
  const peduncle = 1 - 0.48 * smooth(clamp((u - 0.72) / 0.28, 0, 1));
  return {
    centre: 0.018 - 0.025 * u,
    upper: fullness * peduncle * (0.205 + 0.055 * shoulder),
    lower: fullness * peduncle * (0.185 + 0.07 * shoulder),
    width: fullness * peduncle * (0.092 + 0.018 * shoulder),
  };
}

function createBodyGeometry() {
  const along = 64, around = 36;
  const points = [], uvs = [], indices = [];
  for (let i = 0; i <= along; i++) {
    const u = i / along;
    const x = 0.66 - 1.28 * u;
    const profile = bodyProfile(x);
    for (let j = 0; j <= around; j++) {
      const v = j / around;
      const angle = v * Math.PI * 2;
      const vertical = Math.sin(angle);
      const depth = vertical >= 0 ? profile.upper : profile.lower;
      points.push([x, profile.centre + vertical * depth, Math.cos(angle) * profile.width]);
      uvs.push([u, v]);
    }
  }
  for (let i = 0; i < along; i++) for (let j = 0; j < around; j++) {
    const a = i * (around + 1) + j, b = a + around + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return makeGeometry(points, indices, uvs);
}

// A fin is a field of curved rays. Every ray starts at an anatomical insertion and the
// membrane is stitched between it and its neighbours; there are no detached shape cards.
function finSurface(roots, tips, { steps = 9, cup = 0.012 } = {}) {
  const points = [], uvs = [], progress = [], indices = [];
  for (let ray = 0; ray < roots.length; ray++) {
    const root = new THREE.Vector3(...roots[ray]);
    const tip = new THREE.Vector3(...tips[ray]);
    for (let step = 0; step <= steps; step++) {
      const p = step / steps;
      const point = root.clone().lerp(tip, p);
      point.z += Math.sin(Math.PI * p) * cup * Math.sin(ray * 2.35);
      points.push(point.toArray());
      uvs.push([ray / (roots.length - 1), p]);
      progress.push(p);
    }
  }
  for (let ray = 0; ray < roots.length - 1; ray++) for (let step = 0; step < steps; step++) {
    const a = ray * (steps + 1) + step, b = a + steps + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  return makeGeometry(points, indices, uvs, progress);
}

function line(low, high, count, make) {
  return Array.from({ length: count }, (_, index) => make(low + (high - low) * index / (count - 1), index / (count - 1)));
}

function skinMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.48, metalness: 0, clearcoat: 0.1,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMouth = { value: 0 };
    shader.uniforms.uBreath = { value: 0 };
    material.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aLocal; varying vec3 vGouramiLocal; varying vec2 vGouramiUV;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGouramiLocal = aLocal; vGouramiUV = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform float uMouth; uniform float uBreath; varying vec3 vGouramiLocal; varying vec2 vGouramiUV;")
      .replace("#include <color_fragment>", /* glsl */ `
        #include <color_fragment>
        float back = smoothstep(-0.23, 0.2, vGouramiLocal.y);
        vec3 honey = mix(vec3(0.58, 0.16, 0.025), vec3(0.93, 0.48, 0.075), back);
        float scaleRow = floor(vGouramiUV.y * 17.0);
        vec2 scaleCell = fract(vec2(vGouramiUV.x * 27.0 + mod(scaleRow, 2.0) * 0.5, vGouramiUV.y * 17.0));
        float scaleRim = smoothstep(0.7, 0.96, length((scaleCell - vec2(0.5, 0.54)) * vec2(1.0, 1.35)) * 2.0);
        honey *= mix(1.015, 0.955, scaleRim * smoothstep(0.05, 0.18, vGouramiUV.x));
        float throat = (1.0 - smoothstep(-0.15, 0.08, vGouramiLocal.y))
          * smoothstep(0.02, 0.24, vGouramiLocal.x)
          * (1.0 - smoothstep(0.43, 0.58, vGouramiLocal.x));
        honey = mix(honey, vec3(0.055, 0.075, 0.11), throat * 0.78);
        float gill = 1.0 - smoothstep(0.006, 0.018,
          abs(length(vec2((vGouramiLocal.x - 0.27) / 0.11, (vGouramiLocal.y + 0.005) / 0.19)) - 1.0));
        float mouth = smoothstep(0.53, 0.62, vGouramiLocal.x)
          * (1.0 - smoothstep(0.008 + uMouth * 0.012, 0.022 + uMouth * 0.018, abs(vGouramiLocal.y + 0.026)));
        honey = mix(honey, vec3(0.10, 0.045, 0.025), max(gill * 0.45, mouth * 0.9));
        honey *= 1.0 + uBreath * 0.04 * smoothstep(0.08, 0.34, vGouramiLocal.x);
        diffuseColor.rgb = honey;
      `);
  };
  material.customProgramCacheKey = () => "bespoke-honey-gourami-skin-v2";
  return material;
}

function finMaterial(rayCount, opacity = 0.62) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transparent: true, opacity, roughness: 0.5,
    side: THREE.DoubleSide, depthWrite: false, transmission: 0.04,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFinUV;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFinUV = uv;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vFinUV;")
      .replace("#include <color_fragment>", /* glsl */ `
        #include <color_fragment>
        float cells = vFinUV.x * ${rayCount.toFixed(1)};
        float rayDistance = min(fract(cells), 1.0 - fract(cells));
        float ray = 1.0 - smoothstep(0.035, 0.16, rayDistance);
        float root = 1.0 - smoothstep(0.0, 0.28, vFinUV.y);
        float rim = smoothstep(0.76, 1.0, vFinUV.y);
        vec3 membrane = mix(vec3(0.78, 0.25, 0.035), vec3(0.97, 0.58, 0.11), vFinUV.y);
        diffuseColor.rgb = membrane * mix(0.92, 1.08, ray) * mix(1.08, 1.0, root);
        diffuseColor.a *= mix(0.78, 1.0, ray) * (1.0 - rim * 0.12);
      `);
  };
  material.customProgramCacheKey = () => `bespoke-honey-gourami-fin-${rayCount}-v2`;
  return material;
}

export function createHoneyGouramiRenderer(scene, simulation) {
  const root = new THREE.Group();
  root.name = "Honey gourami bespoke rig";
  scene.add(root);

  const bodyGeometry = createBodyGeometry();
  const baseBody = Float32Array.from(bodyGeometry.attributes.position.array);
  const bodyMaterial = skinMaterial();
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.name = "Honey gourami articulated body";
  body.castShadow = body.receiveShadow = true;
  root.add(body);

  const dorsalRoots = line(0.33, -0.54, 15, (x) => [x, bodyProfile(x).centre + bodyProfile(x).upper - 0.006, 0]);
  const dorsalTips = line(0.33, -0.54, 15, (x, p) => [
    x - 0.025 * p, bodyProfile(x).centre + bodyProfile(x).upper + 0.11 + 0.09 * Math.sin(Math.PI * p), 0,
  ]);
  const dorsal = new THREE.Mesh(finSurface(dorsalRoots, dorsalTips), finMaterial(15));
  dorsal.name = "Honey gourami articulated dorsal fin";
  const analRoots = line(0.29, -0.57, 17, (x) => [x, bodyProfile(x).centre - bodyProfile(x).lower + 0.006, 0]);
  const analTips = line(0.29, -0.57, 17, (x, p) => [
    x - 0.035 * p, bodyProfile(x).centre - bodyProfile(x).lower - 0.11 - 0.07 * Math.sin(Math.PI * p), 0,
  ]);
  const anal = new THREE.Mesh(finSurface(analRoots, analTips), finMaterial(17));
  anal.name = "Honey gourami articulated anal fin";
  root.add(dorsal, anal);

  const tailRoots = line(0.11, -0.11, 17, (y) => [-0.58, y, 0]);
  const tailTips = line(0.25, -0.25, 17, (y, p) => [
    -0.92 - 0.055 * Math.sin(Math.PI * p), y, 0,
  ]);
  const tail = new THREE.Mesh(finSurface(tailRoots, tailTips, { steps: 10, cup: 0.016 }), finMaterial(17, 0.68));
  tail.name = "Honey gourami articulated tail";
  root.add(tail);

  const pectorals = [];
  for (const side of [-1, 1]) {
    const roots = line(0.31, 0.19, 9, (x, p) => [x, -0.01 - p * 0.08, side * (bodyProfile(x).width - 0.003)]);
    const tips = line(0.18, -0.13, 9, (x, p) => [x, 0.03 - p * 0.13, side * (0.22 + 0.035 * Math.sin(Math.PI * p))]);
    const mesh = new THREE.Mesh(finSurface(roots, tips, { steps: 8, cup: side * 0.008 }), finMaterial(9, 0.42));
    mesh.name = `Honey gourami ${side < 0 ? "left" : "right"} pectoral fin`;
    root.add(mesh);
    pectorals.push({ side, mesh, base: Float32Array.from(mesh.geometry.attributes.position.array) });
  }

  const feelerMaterial = new THREE.MeshStandardMaterial({ color: 0xffd56b, roughness: 0.65 });
  const feelers = [];
  for (const side of [-1, 1]) {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.22, -0.18, side * 0.075),
      new THREE.Vector3(0.16, -0.43, side * 0.10),
      new THREE.Vector3(0.04, -0.72, side * 0.13),
    ]);
    const feeler = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.006, 5, false), feelerMaterial);
    feeler.name = "Honey gourami pelvic feeler";
    root.add(feeler);
    feelers.push({ side, line: feeler });
  }

  const eyeMaterial = new THREE.MeshPhysicalMaterial({ color: 0x6b4213, roughness: 0.22, clearcoat: 0.4 });
  const pupilMaterial = new THREE.MeshStandardMaterial({ color: 0x050403, roughness: 0.18 });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.052, 18, 12), eyeMaterial);
    eye.position.set(0.43, 0.082, side * 0.092);
    const pupil = new THREE.Mesh(new THREE.CircleGeometry(0.027, 18), pupilMaterial);
    pupil.position.set(0.43, 0.082, side * 0.139);
    if (side < 0) pupil.rotation.y = Math.PI;
    root.add(eye, pupil);
  }

  function bendPoint(x, y, z, out = new THREE.Vector3()) {
    const t = clamp((0.62 - x) / SPINE_LENGTH, 0, 1) * (HONEY_JOINTS - 1);
    const i = Math.min(HONEY_JOINTS - 2, Math.floor(t));
    const f = t - i;
    const a = simulation.state.spine[i], b = simulation.state.spine[i + 1];
    const angle = Math.atan2(b.z - a.z, b.x - a.x);
    const cx = a.x + (b.x - a.x) * f;
    const cz = a.z + (b.z - a.z) * f;
    // Rotate the *lateral* cross-section around the bent x/z spine. Using `y` here would
    // shear the deep body vertically into the tail and was visibly wrong end-on.
    return out.set(
      cx - z * Math.sin(angle),
      a.y + y,
      cz + z * Math.cos(angle),
    );
  }

  function deformGeometry(geometry, base, flutter = 0, pectoral = null) {
    const position = geometry.attributes.position;
    const progress = geometry.attributes.aFinProgress;
    for (let i = 0; i < position.count; i++) {
      const x = base[i * 3];
      let y = base[i * 3 + 1];
      let z = base[i * 3 + 2];
      if (geometry === bodyGeometry) {
        // The gape is anatomy, not a torus pasted on the snout. The lower lip and jaw
        // drop during a gulp or strike, while the opercular region expands as it breathes.
        const snout = smooth(clamp((x - 0.48) / 0.18, 0, 1));
        if (y < -0.005) y -= simulation.state.mouth * snout * 0.026;
        const branchial = smoothstep(0.05, 0.3, x) * (1 - smoothstep(0.3, 0.48, x));
        z *= 1 + simulation.state.breath * branchial * 0.055;
      }
      if (pectoral) {
        const reach = progress.getX(i);
        const beat = Math.sin(simulation.state.pectoralPhase + (pectoral.side < 0 ? Math.PI : 0));
        z += pectoral.side * reach * beat * simulation.state.pectoralEffort * 0.075;
      }
      const loose = clamp((0.35 - x) / 1.8, 0, 1);
      bendPoint(
        x,
        y,
        z + flutter * loose * Math.sin(simulation.state.time * 2.1 - x * 4.2),
        tmp,
      );
      position.setXYZ(i, tmp.x, tmp.y, tmp.z);
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  const median = [dorsal, anal, tail].map((mesh) => ({
    mesh, base: Float32Array.from(mesh.geometry.attributes.position.array),
  }));

  function update(scale = 1) {
    const state = simulation.state;
    root.position.copy(state.position);
    root.rotation.set(0, -state.yaw, state.pitch, "YXZ");
    root.scale.setScalar(1.12 * scale);
    deformGeometry(bodyGeometry, baseBody);
    for (const item of median)
      deformGeometry(item.mesh.geometry, item.base, 0.008 + state.tailEffort * 0.022);
    for (const item of pectorals)
      deformGeometry(item.mesh.geometry, item.base, 0, item);
    for (const { side, line } of feelers) {
      line.rotation.z = Math.sin(state.time * 1.1 + side) * 0.06;
      line.rotation.x = side * Math.sin(state.time * 0.9) * 0.04;
      line.updateMatrix();
    }
    if (bodyMaterial.userData.shader) {
      bodyMaterial.userData.shader.uniforms.uMouth.value = state.mouth;
      bodyMaterial.userData.shader.uniforms.uBreath.value = state.breath;
    }
    root.updateMatrix();
  }

  update();
  return {
    root,
    update,
    dispose() {
      scene.remove(root);
      const geometries = new Set(), materials = new Set();
      root.traverse((object) => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) materials.add(object.material);
      });
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}

/** Narrow scene-facing adapter. `fish` is the school-owned transient mirror of the saved
 * record; all decisions and all rendering remain private to this animal. */
export function createHoneyGourami(scene, { fish, food = null, random = Math.random } = {}) {
  const simulation = createHoneyGouramiSimulation({ random, food, position: fish.position });
  const renderer = createHoneyGouramiRenderer(scene, simulation);
  let hadPointer = false;
  function syncFish() {
    renderer.update(fish.scale * sizeScale(fish.age, fish.adult));
    const state = simulation.state;
    fish.position.copy(state.position);
    fish.velocity.copy(state.velocity);
    fish.swim.copy(state.velocity);
    fish.heading.copy(state.heading);
    fish.mode = state.mode;
    fish.breathing = state.mode === "surface" || state.mode === "breathe";
    fish.scull = state.pectoralEffort;
    fish.stroke = state.tailEffort > 0.28 ? { bespoke: true } : null;
    fish.finBrake = state.pectoralEffort;
    fish.effort = state.tailEffort;
  }
  function update(dt, pointer) {
    const moved = Boolean(pointer) && (!hadPointer || pointer.velocity?.lengthSq?.() > 0.0004);
    simulation.point(pointer?.position ?? null, moved);
    hadPointer = Boolean(pointer);
    simulation.step(dt);
    syncFish();
  }
  return {
    update,
    diagnostics: simulation.diagnostics,
    forceMode: simulation.forceMode,
    // Verification-only callers use this to inspect readable poses without waiting for
    // a rare transition. It is not exposed by production pages.
    present(mode) {
      const result = simulation.present(mode);
      syncFish();
      return result;
    },
    simulation,
    renderer,
    dispose: renderer.dispose,
  };
}
