// Three.js view for the pure turtle simulation in turtle-simulation.js.
import * as THREE from "three";
import { randomGenerator, sandHeight } from "./math.js";
import { uid } from "./tank-state.js";
import {
  createTurtleSimulation,
  HUNT,
  TURTLE_ARTICULATION,
  TURTLE_BOUNDS,
  TUNING,
} from "./turtle-simulation.js";

export { HUNT, SURFACE_Y, TURTLE_ARTICULATION, TURTLE_BOUNDS, TUNING } from "./turtle-simulation.js";

// One merged body, one neck, and one merged head. Fine traits such as eyes, claws, shell
// scutes, and tail ridges add triangles and vertex colours, but not draw calls. The legs
// stay inside the body mesh; their walking swing is a pair of morph targets, so a shuffle
// costs no extra mesh or shadow pass.
export const TURTLE_RENDER_BUDGET = Object.freeze({ meshes: 3, shadowCasters: 3 });

// How far a diagonal leg pair swings forward or back at full stride, in tank units, and
// how high a swinging foot lifts. Both are small enough to stay inside the foot discs.
export const GAIT = Object.freeze({ stride: 0.055, lift: 0.04, cyclesPerSecond: 0.9, blendRate: 3 });

const TAU = Math.PI * 2;

const COLORS = {
  shell: 0x585939,
  shellDark: 0x2a2d1d,
  scute: 0x807d4e,
  serration: 0x3b3d27,
  plastron: 0x918662,
  skin: 0x6c6451,
  skinLight: 0xab9f7a,
  jaw: 0x776e58,
  mouth: 0x2a1a16,
  claw: 0xcbbf97,
  clawTip: 0x7a7057,
  eye: 0xc9a13e,
  pupil: 0x0b0a07,
  eyeRing: 0x3d3a30,
  nostril: 0x1a1812,
  tympanum: 0x7d7459,
};

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smoothstep(edge0, edge1, v) {
  const t = clamp01((v - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function mottle(x, y, z) {
  // A cheap deterministic speckle so large skin areas are not one flat colour.
  return 0.5 + 0.5 * Math.sin(x * 37.1 + y * 51.7 + z * 29.3) * Math.sin(x * 13.3 - z * 17.9);
}

// Vertex-colour shaders. Each receives world-of-part position and normal and fills `out`.
const skinTop = new THREE.Color(COLORS.skin);
const skinBelly = new THREE.Color(COLORS.skinLight);
function skinShade(p, n, out) {
  out.copy(skinTop).lerp(skinBelly, smoothstep(0.25, -0.85, n.y));
  out.multiplyScalar(0.9 + 0.1 * mottle(p.x, p.y, p.z));
}
const jawTop = new THREE.Color(COLORS.jaw);
function jawShade(p, n, out) {
  out.copy(jawTop).lerp(skinBelly, smoothstep(0.3, -0.7, n.y));
  out.multiplyScalar(0.92 + 0.08 * mottle(p.x, p.y, p.z));
}

// --- Geometry helpers -----------------------------------------------------------------

// A unit sphere whose every vertex direction is remapped by `map(direction, out)`.
// Deforming a sphere rather than stacking boxes keeps heads, pads, and shells smooth.
function deformedSphere(map, { widthSegments = 36, heightSegments = 20 } = {}) {
  const geometry = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const positions = geometry.attributes.position;
  const d = new THREE.Vector3(), out = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    d.fromBufferAttribute(positions, i).normalize();
    map(d, out);
    positions.setXYZ(i, out.x, out.y, out.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

// A tapering, optionally elliptical tube along a smooth curve through `points`.
// `radiusAt(t)` returns a number or `{ up, side }`. Ends can be closed with round caps.
function tube(points, radiusAt, {
  segments = 20, radial = 12, capStart = false, capEnd = true, capRings = 4,
} = {}) {
  const curve = new THREE.CatmullRomCurve3(
    points.map((p) => new THREE.Vector3(...p)), false, "centripetal",
  );
  const rings = [];
  const radiusPair = (t) => {
    const r = radiusAt(t);
    return typeof r === "number" ? { up: r, side: r } : r;
  };
  const addCap = (center, tangent, r, sign) => {
    for (let k = 1; k <= capRings; k++) {
      const a = (k / capRings) * (Math.PI / 2);
      const reach = Math.min(r.up, r.side) * Math.sin(a);
      rings.push({
        center: center.clone().addScaledVector(tangent, sign * reach),
        tangent,
        up: r.up * Math.cos(a),
        side: r.side * Math.cos(a),
      });
    }
  };
  const startTangent = curve.getTangentAt(0).normalize();
  if (capStart) {
    const capped = [];
    const r = radiusPair(0);
    const c = curve.getPointAt(0);
    for (let k = capRings; k >= 1; k--) {
      const a = (k / capRings) * (Math.PI / 2);
      capped.push({
        center: c.clone().addScaledVector(startTangent, -Math.min(r.up, r.side) * Math.sin(a)),
        tangent: startTangent, up: r.up * Math.cos(a), side: r.side * Math.cos(a),
      });
    }
    rings.push(...capped);
  }
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const r = radiusPair(t);
    rings.push({
      center: curve.getPointAt(t), tangent: curve.getTangentAt(t).normalize(),
      up: r.up, side: r.side,
    });
  }
  if (capEnd) addCap(curve.getPointAt(1), curve.getTangentAt(1).normalize(), radiusPair(1), 1);

  const worldUp = new THREE.Vector3(0, 1, 0), alt = new THREE.Vector3(1, 0, 0);
  const side = new THREE.Vector3(), up = new THREE.Vector3();
  const positions = new Float32Array(rings.length * radial * 3);
  for (let i = 0; i < rings.length; i++) {
    const ring = rings[i];
    side.crossVectors(worldUp, ring.tangent);
    if (side.lengthSq() < 1e-6) side.crossVectors(alt, ring.tangent);
    side.normalize();
    up.crossVectors(ring.tangent, side).normalize();
    for (let j = 0; j < radial; j++) {
      const a = (j / radial) * TAU;
      const at = (i * radial + j) * 3;
      positions[at] = ring.center.x + side.x * Math.cos(a) * ring.side + up.x * Math.sin(a) * ring.up;
      positions[at + 1] = ring.center.y + side.y * Math.cos(a) * ring.side + up.y * Math.sin(a) * ring.up;
      positions[at + 2] = ring.center.z + side.z * Math.cos(a) * ring.side + up.z * Math.sin(a) * ring.up;
    }
  }
  const indices = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * radial + j, b = i * radial + (j + 1) % radial;
      const c = a + radial, d = b + radial;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// A slightly curved claw. `dir` is the horizontal heading; `tilt` bends the tip downward.
function claw(base, dir, { length = 0.07, radius = 0.016, tilt = 0.55, bend = 0.5 } = {}) {
  const geometry = new THREE.ConeGeometry(radius, length, 7, 4);
  geometry.translate(0, length / 2, 0);
  geometry.rotateZ(-Math.PI / 2); // axis along +x, base at the origin
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const h = positions.getX(i) / length;
    positions.setY(i, positions.getY(i) - bend * length * h * h);
  }
  geometry.rotateZ(-tilt);
  geometry.rotateY(-Math.atan2(dir[2], dir[0]));
  geometry.translate(...base);
  geometry.computeVertexNormals();
  return geometry;
}

// Orient a y-axis primitive so its axis points along `dir` and place its base at `base`.
function pointed(geometry, base, dir) {
  const q = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir).normalize(),
  );
  geometry.applyQuaternion(q);
  geometry.translate(...base);
  return geometry;
}

function mergeVertexColored(parts) {
  const flats = parts.map((part) => {
    const flat = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    if (flat !== part.geometry) part.geometry.dispose();
    if (!flat.attributes.normal) flat.computeVertexNormals();
    return { geometry: flat, color: part.color, colorAt: part.colorAt };
  });
  let vertices = 0;
  for (const part of flats) vertices += part.geometry.attributes.position.count;
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const color = new THREE.Color();
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  let offset = 0;
  for (const part of flats) {
    const pa = part.geometry.attributes.position;
    const na = part.geometry.attributes.normal;
    if (part.color !== undefined) color.set(part.color);
    for (let i = 0; i < pa.count; i++) {
      const at = (offset + i) * 3;
      p.fromBufferAttribute(pa, i);
      n.fromBufferAttribute(na, i);
      if (part.colorAt) part.colorAt(p, n, color);
      positions[at] = p.x; positions[at + 1] = p.y; positions[at + 2] = p.z;
      normals[at] = n.x; normals[at + 1] = n.y; normals[at + 2] = n.z;
      colors[at] = color.r; colors[at + 1] = color.g; colors[at + 2] = color.b;
    }
    offset += pa.count;
    part.geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

// --- Anatomy ------------------------------------------------------------------------

const SHELL = { cx: 0.02, cy: 0.33, rx: 0.69, ry: 0.31, rz: 0.55 };
// Scute layout in shell-local x/z: a vertebral column, costal bands, and marginals.
const VERTEBRAL_HALF_WIDTH = 0.12;
const COSTAL_EDGE = 0.4;
const SCUTE_PITCH = 0.25;
const VERTEBRAL_SEAMS = [-0.42, -0.17, 0.08, 0.33];
const COSTAL_SEAMS = [-0.55, -0.3, -0.05, 0.2, 0.45];

function shellParts() {
  const parts = [];
  const shellColor = new THREE.Color(COLORS.shell);
  const shellDark = new THREE.Color(COLORS.shellDark);
  const scuteColor = new THREE.Color(COLORS.scute);
  const plastronColor = new THREE.Color(COLORS.plastron);

  // Keel and scute-knob relief along the top, used for both displacement and colour.
  // Knobs sit on the rear half of each scute, as on a real snapper.
  const relief = (x, z) => {
    const fade = smoothstep(-0.66, -0.4, x) * (1 - smoothstep(0.3, 0.55, x));
    let keel = 0;
    for (const zk of [-0.25, 0, 0.25]) {
      const width = zk === 0 ? 0.08 : 0.07;
      const dz = (z - zk) / width;
      const phase = zk === 0 ? -0.33 : -0.46;
      const knob = 0.45 + 0.55 * Math.max(0, Math.cos((x - phase) * TAU / SCUTE_PITCH)) ** 0.9;
      keel = Math.max(keel, Math.exp(-dz * dz) * knob * (zk === 0 ? 1 : 0.85));
    }
    return keel * fade;
  };
  // Proximity to scute seams, 0..1. Seams are colour grooves plus a shallow dent.
  const seam = (x, z) => {
    const az = Math.abs(z);
    let nearest = Math.min(Math.abs(az - VERTEBRAL_HALF_WIDTH), Math.abs(az - COSTAL_EDGE));
    const row = az < VERTEBRAL_HALF_WIDTH ? VERTEBRAL_SEAMS : COSTAL_SEAMS;
    if (az < COSTAL_EDGE) for (const sx of row) nearest = Math.min(nearest, Math.abs(x - sx));
    else for (let k = -5; k <= 5; k++) nearest = Math.min(nearest, Math.abs(x - (0.02 + k * 0.16)) * 0.6);
    const g = nearest / 0.014;
    return Math.exp(-g * g);
  };

  // Carapace: a low dome, flattened below, wider behind than in front, with a lip at
  // the margin, three keels of knobbed scutes, and dented seams between the plates.
  parts.push({
    geometry: deformedSphere((d, out) => {
      const x = SHELL.cx + d.x * SHELL.rx;
      const widen = 1 + 0.07 * smoothstep(0.25, -0.45, x) - 0.06 * smoothstep(0.2, 0.68, x);
      const z = d.z * SHELL.rz * widen;
      const y = d.y * SHELL.ry * (d.y < 0 ? 0.4 : 1);
      const lipBand = 1 - Math.min(1, Math.abs(d.y) / 0.28);
      const lip = 1 + 0.045 * lipBand * lipBand + 0.03 * Math.max(0, -d.x) * lipBand;
      const top = smoothstep(0.05, 0.25, d.y);
      const r = relief(x, z) * top * 0.05 - seam(x, z) * top * 0.007;
      const grain = 0.004 * Math.sin(x * 23 + 1.3) * Math.sin(z * 31 - 0.7) * Math.max(0, d.y);
      out.set(SHELL.cx + (x - SHELL.cx) * lip + d.x * (r + grain),
        SHELL.cy + y + d.y * (r + grain),
        z * lip + d.z * (r + grain));
    }, { widthSegments: 64, heightSegments: 32 }),
    colorAt: (p, n, out) => {
      const top = smoothstep(-0.2, 0.55, n.y);
      out.copy(shellDark).lerp(shellColor, top);
      const above = smoothstep(0.4, 0.5, p.y);
      out.lerp(scuteColor, relief(p.x, p.z) * above * 0.9);
      out.lerp(shellDark, seam(p.x, p.z) * above * 0.75);
      if (n.y < -0.3) out.copy(plastronColor).multiplyScalar(0.8);
      out.multiplyScalar(0.9 + 0.1 * mottle(p.x, p.y, p.z));
    },
  });

  // Serrated rear margin: flat horny points around the back rim.
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + (i - 3) * 0.19;
    const rx = SHELL.rx * 1.02, rz = SHELL.rz * 1.03;
    const geometry = new THREE.ConeGeometry(0.05, 0.11, 3);
    geometry.rotateZ(-Math.PI / 2);
    geometry.translate(0.02, 0, 0);
    geometry.scale(1, 0.3, 1);
    geometry.rotateY(-a);
    geometry.translate(SHELL.cx + rx * Math.cos(a), SHELL.cy + 0.02, rz * Math.sin(a));
    parts.push({ geometry, color: COLORS.serration });
  }

  // Plastron under the shell: flat and paler.
  parts.push({
    geometry: deformedSphere((d, out) => {
      out.set(0.0 + d.x * 0.5, 0.165 + d.y * 0.045 * (d.y < 0 ? 0.6 : 1), d.z * 0.35);
    }, { widthSegments: 24, heightSegments: 10 }),
    colorAt: (p, n, out) => {
      out.copy(plastronColor).multiplyScalar(0.85 + 0.15 * mottle(p.x, p.y, p.z));
    },
  });
  return parts;
}

function tailParts() {
  const parts = [];
  const spine = [
    [-0.5, 0.3, 0], [-0.78, 0.26, 0.0], [-1.03, 0.17, 0.02], [-1.24, 0.09, 0.05], [-1.38, 0.05, 0.08],
  ];
  parts.push({
    geometry: tube(spine, (t) => {
      const r = lerp(0.13, 0.018, Math.pow(t, 0.8)) * (1 + 0.03 * Math.sin(t * 60));
      return { up: r * 1.12, side: r * 0.9 };
    }, { segments: 26, radial: 12 }),
    colorAt: skinShade,
  });
  // Saw-tooth dorsal ridge that shrinks toward the tip.
  const curve = new THREE.CatmullRomCurve3(spine.map((p) => new THREE.Vector3(...p)), false, "centripetal");
  for (let i = 0; i < 7; i++) {
    const t = 0.06 + i * 0.14;
    const c = curve.getPointAt(t);
    const size = 0.055 * (1 - 0.72 * t);
    const r = lerp(0.13, 0.018, Math.pow(t, 0.8)) * 1.12;
    const geometry = new THREE.ConeGeometry(size * 0.75, size * 1.7, 3);
    geometry.translate(0, size * 0.85, 0);
    geometry.scale(1, 1, 0.4);
    geometry.rotateZ(0.5); // lean back toward the tip
    geometry.translate(c.x, c.y + r * 0.8, c.z);
    parts.push({ geometry, color: COLORS.serration });
  }
  return parts;
}

// One leg. `f` is +1 front / -1 rear, `s` is +1 left / -1 right. `swing` in [-1, 1] moves
// the whole limb forward (+) or back (-) for the walking morph targets.
function legParts(f, s, swing) {
  const parts = [];
  const lift = Math.max(0, swing) * GAIT.lift;
  const dx = swing * GAIT.stride;
  const hip = [f * 0.3, 0.25, s * 0.36];
  // The heel, where the limb meets the foot pad.
  const ankle = [f * 0.35 + dx, 0.095 + lift, s * 0.5];
  // Front elbows point back and out; rear knees point forward and out, as on a turtle.
  const elbow = [
    (hip[0] + ankle[0]) / 2 - f * 0.07 + dx * 0.4,
    (hip[1] + ankle[1]) / 2 + 0.04,
    (hip[2] + ankle[2]) / 2 + s * 0.03,
  ];
  parts.push({
    geometry: tube(
      [[hip[0] - f * 0.03, hip[1] + 0.03, hip[2] - s * 0.1], hip, elbow, ankle],
      (t) => {
        const r = lerp(0.13, 0.082, t) * (1 + 0.028 * Math.sin(t * 34));
        return { up: r * 1.04, side: r * 0.92 };
      },
      { segments: 18, radial: 14 },
    ),
    colorAt: skinShade,
  });

  // Toes point forward-outward on the front feet and outward-back on the rear feet.
  const heading = f > 0 ? Math.atan2(s * 0.84, 0.55) : Math.atan2(s * 0.95, -0.32);
  const u = [Math.cos(heading), 0, Math.sin(heading)];
  const w = [-u[2], 0, u[0]];
  // A broad paddle-shaped pad: thick at the heel, thinning and widening toward the toes.
  const foot = [ankle[0] + u[0] * 0.05, 0.048 + lift, ankle[2] + u[2] * 0.05];
  parts.push({
    geometry: deformedSphere((d, out) => {
      const along = d.x * 0.135;
      const across = d.z * 0.1 * (1 + 0.25 * smoothstep(-0.6, 0.8, d.x));
      const thick = 0.046 * (1 - 0.45 * smoothstep(-0.3, 1, d.x)) * (d.y < 0 ? 0.55 : 1);
      out.set(
        foot[0] + u[0] * along + w[0] * across,
        foot[1] + d.y * thick,
        foot[2] + u[2] * along + w[2] * across,
      );
    }, { widthSegments: 22, heightSegments: 12 }),
    colorAt: skinShade,
  });

  const toes = f > 0 ? 5 : 4;
  const spread = f > 0 ? 1.05 : 0.9;
  const clawTip = new THREE.Color(COLORS.clawTip);
  for (let i = 0; i < toes; i++) {
    const a = heading + (i / (toes - 1) - 0.5) * spread * s;
    const dir = [Math.cos(a), 0, Math.sin(a)];
    // Outer toes are a little shorter, so the toe line curves like a real paddle.
    const reach = 1 - 0.18 * Math.abs(i / (toes - 1) - 0.5) * 2;
    const start = [foot[0] + dir[0] * 0.05, foot[1] - 0.002, foot[2] + dir[2] * 0.05];
    const knuckle = [foot[0] + dir[0] * 0.105 * reach, foot[1] + 0.004, foot[2] + dir[2] * 0.105 * reach];
    const end = [foot[0] + dir[0] * 0.155 * reach, foot[1] - 0.02, foot[2] + dir[2] * 0.155 * reach];
    parts.push({
      geometry: tube([start, knuckle, end], (t) => {
        const r = lerp(0.03, 0.02, t) * (1 + 0.08 * Math.exp(-(((t - 0.5) / 0.18) ** 2)));
        return { up: r * 0.9, side: r };
      }, { segments: 8, radial: 9 }),
      colorAt: skinShade,
    });
    parts.push({
      geometry: claw([end[0] + dir[0] * 0.01, end[1] + 0.003, end[2] + dir[2] * 0.01], dir,
        { length: 0.045, radius: 0.011, tilt: 0.65, bend: 0.6 }),
      colorAt: (p, n, out) => {
        out.set(COLORS.claw).lerp(clawTip, smoothstep(0.015, 0.045, foot[1] - p.y));
      },
    });
  }
  // Webbing between the toes: a thin fan just below the toe line.
  // CylinderGeometry measures theta from +z toward +x, so a heading of `a` is PI/2 - a.
  const web = new THREE.CylinderGeometry(0.115, 0.115, 0.006, 12, 1, false,
    Math.PI / 2 - heading - spread / 2, spread);
  web.translate(foot[0], foot[1] - 0.01, foot[2]);
  parts.push({ geometry: web, colorAt: skinShade });
  return parts;
}

function buildBodyGeometry(swing = 0) {
  const parts = [...shellParts(), ...tailParts()];
  for (const f of [1, -1])
    for (const s of [1, -1]) parts.push(...legParts(f, s, swing * f * s));
  return mergeVertexColored(parts);
}

function buildNeckGeometry() {
  return mergeVertexColored([{
    geometry: tube(
      [[-0.14, 0.0, 0], [0.1, 0.0, 0], [0.3, -0.02, 0], [0.47, -0.03, 0]],
      (t) => {
        const r = lerp(0.17, 0.105, smoothstep(0, 0.85, t)) * (1 + 0.03 * Math.sin(t * 46) * (1 - t * 0.5));
        return { up: r * 1.04, side: r };
      },
      { segments: 22, radial: 16, capStart: true, capEnd: true },
    ),
    colorAt: (p, n, out) => {
      skinShade(p, n, out);
      // Darker creases where the radius dips between skin folds.
      out.multiplyScalar(0.94 + 0.06 * Math.sin(p.x * 46 / 0.67));
    },
  }]);
}

// `open` in [0, 1] drops the lower jaw for the strike's gape morph target. The part list
// is identical at every value, so the morph shares the resting mesh's vertex order.
function buildHeadGeometry(open = 0) {
  const parts = [];
  // Snapper skull: massive and triangular from above, flat-crowned, with the jaw muscles
  // bulging at the back and a sharp hooked beak at the front. Local +x is forward.
  const C = { x: 0.2, rx: 0.34, ry: 0.17, rz: 0.24 };
  const eyeAt = (s) => [0.3, 0.07, s * 0.11];
  // Superellipse cross-section: a flat crown and flat cheeks, as on a snapper skull.
  const boxy = (d, n) => {
    const rho = Math.hypot(d.y, d.z);
    if (rho < 1e-6) return { y: 0, z: 0 };
    const cy = d.y / rho, cz = d.z / rho;
    return {
      y: rho * Math.sign(cy) * Math.abs(cy) ** (2 / n),
      z: rho * Math.sign(cz) * Math.abs(cz) ** (2 / n),
    };
  };
  const narrowAt = (x) => 1 - 0.74 * Math.pow(smoothstep(-0.02, 0.54, x), 1.15)
    - 0.12 * smoothstep(0.44, 0.54, x);
  const cheek = (x, y) => 1 + 0.16 * Math.exp(-(((x - 0.03) / 0.14) ** 2)) * smoothstep(0.09, -0.05, y);
  // The mouth line sits low at the beak and sweeps up toward the back of the head, the
  // fixed snapper grin. The jaws part slightly toward the front.
  const mouthY = (x) => -0.062 + 0.048 * smoothstep(0.32, -0.1, x);
  // The jaw hinges at the back of the skull, so the drop grows toward the beak.
  const gape = (x) => (0.03 + 0.13 * open) * smoothstep(0.0, 0.48, x);
  const warts = (x, y, z) => {
    const n = Math.sin(x * 61 + 0.4) * Math.sin(z * 57 + 1.9) * Math.sin(y * 47 + 3.1);
    return 0.011 * smoothstep(0.45, 0.9, Math.abs(n));
  };
  const horn = new THREE.Color(COLORS.claw).lerp(skinTop, 0.35);

  parts.push({
    geometry: deformedSphere((d, out) => {
      const x = C.x + d.x * C.rx;
      const b = boxy(d, 2.8);
      const shorten = 1 - 0.5 * smoothstep(0.02, 0.54, x);
      let y = b.y > 0 ? b.y * C.ry * shorten * 0.9 : b.y * -mouthY(x);
      let z = b.z * C.rz * narrowAt(x) * cheek(x, y);
      const brow = 0.034 * Math.exp(-(((x - 0.29) / 0.09) ** 2) - (((Math.abs(z) - 0.1) / 0.06) ** 2))
        * smoothstep(0.03, 0.1, y);
      const socket = 0.018 * Math.exp(-(((x - 0.3) / 0.055) ** 2) - (((y - 0.07) / 0.045) ** 2))
        * smoothstep(0.5, 0.95, Math.abs(d.z));
      // The hook pulls the front of the upper jaw down into a sharp overhanging point.
      const hook = 0.07 * smoothstep(0.36, 0.54, x) * (1 - smoothstep(-0.03, 0.08, y));
      const skin = smoothstep(0.0, 0.03, y - mouthY(x)) * (1 - smoothstep(0.34, 0.42, x));
      const w = warts(x, y, z) * skin;
      y += brow - hook + d.y * w;
      z += Math.sign(z) * (brow * 0.5 - socket) + d.z * w;
      out.set(x + d.x * w, y, z);
    }, { widthSegments: 48, heightSegments: 26 }),
    colorAt: (p, n, out) => {
      skinShade(p, n, out);
      out.multiplyScalar(0.92);
      // Pale horny beak along the cutting edge and the hooked tip.
      const edge = smoothstep(-0.1, -0.6, n.y) * smoothstep(0.12, 0.3, p.x);
      out.lerp(horn, Math.max(edge, 0.7 * smoothstep(0.44, 0.54, p.x)));
    },
  });
  // Lower jaw: deep at the back, thinner forward, with an upturned tip under the beak.
  parts.push({
    geometry: deformedSphere((d, out) => {
      const x = 0.19 + d.x * 0.29;
      const b = boxy(d, 2.4);
      const top = mouthY(x) - gape(x) + 0.022 * smoothstep(0.36, 0.48, x);
      const depth = 0.075 * (1 - 0.45 * smoothstep(0.0, 0.48, x));
      const y = b.y > 0 ? top + b.y * 0.012 : top + b.y * depth;
      out.set(x, y, b.z * 0.215 * narrowAt(x) * cheek(x, y) * 0.96);
    }, { widthSegments: 36, heightSegments: 16 }),
    colorAt: (p, n, out) => {
      jawShade(p, n, out);
      out.lerp(horn, smoothstep(0.1, 0.6, n.y) * smoothstep(0.12, 0.3, p.x));
    },
  });
  // Dark mouth interior, visible through the gape at the front.
  parts.push({
    geometry: deformedSphere((d, out) => {
      const x = 0.2 + d.x * 0.28;
      const b = boxy(d, 2.8);
      const y = lerp(mouthY(x) - gape(x), mouthY(x), 0.5 + 0.5 * b.y);
      out.set(x, y, b.z * 0.2 * narrowAt(x) * cheek(x, y) * 0.92);
    }, { widthSegments: 24, heightSegments: 8 }),
    color: COLORS.mouth,
  });
  // Two fleshy barbels under the chin.
  for (const s of [-1, 1]) {
    const barbel = new THREE.ConeGeometry(0.009, 0.045, 6);
    barbel.translate(0, 0.0225, 0);
    parts.push({
      geometry: pointed(barbel, [0.3, mouthY(0.3) - gape(0.3) - 0.05, s * 0.045], [0.5, -1, s * 0.25]),
      colorAt: skinShade,
    });
  }

  for (const s of [-1, 1]) {
    const [ex, ey, ez] = eyeAt(s);
    const outward = new THREE.Vector3(0.32, 0.42, s * 0.85).normalize();
    parts.push({ geometry: new THREE.SphereGeometry(0.031, 14, 10).translate(ex, ey, ez), color: COLORS.eye });
    parts.push({
      geometry: new THREE.SphereGeometry(0.017, 10, 8)
        .translate(ex + outward.x * 0.023, ey + outward.y * 0.022, ez + outward.z * 0.023),
      color: COLORS.pupil,
    });
    // Heavy eyelid rim under the brow ridge.
    const rim = new THREE.TorusGeometry(0.031, 0.009, 8, 20);
    rim.rotateX(Math.PI / 2);
    parts.push({
      geometry: pointed(rim, [ex + outward.x * 0.011, ey + outward.y * 0.011, ez + outward.z * 0.011], outward.toArray()),
      color: COLORS.eyeRing,
    });
    // Tympanum behind the eye and a nostril at the beak tip.
    parts.push({
      geometry: new THREE.SphereGeometry(1, 12, 8).scale(0.03, 0.026, 0.005).translate(0.05, -0.01, s * 0.231),
      colorAt: (p, n, out) => out.set(COLORS.tympanum).lerp(skinTop, 0.45),
    });
    parts.push({
      geometry: new THREE.SphereGeometry(0.008, 8, 6).translate(0.53, -0.012, s * 0.02),
      color: COLORS.nostril,
    });
  }
  return mergeVertexColored(parts);
}

function buildAnatomy() {
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0.01,
  });
  const group = new THREE.Group();
  group.name = "Snapping turtle";

  const bodyGeometry = buildBodyGeometry(0);
  const forward = buildBodyGeometry(1);
  const back = buildBodyGeometry(-1);
  bodyGeometry.morphAttributes.position = [forward.attributes.position, back.attributes.position];
  bodyGeometry.morphAttributes.normal = [forward.attributes.normal, back.attributes.normal];
  const body = new THREE.Mesh(bodyGeometry, material);
  body.name = "Turtle merged shell, legs, claws, and ridged tail";
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  const A = TURTLE_ARTICULATION;
  const neckPivot = new THREE.Group();
  neckPivot.name = "Turtle neck pivot";
  neckPivot.position.set(A.neckPivot.x, A.neckPivot.y, 0);
  const neck = new THREE.Mesh(buildNeckGeometry(), material);
  neck.name = "Turtle neck";
  neck.castShadow = neck.receiveShadow = true;
  neckPivot.add(neck);

  const headPivot = new THREE.Group();
  headPivot.name = "Turtle head pivot";
  headPivot.position.x = A.headPivotX;
  const headGeometry = buildHeadGeometry(0);
  const open = buildHeadGeometry(1);
  headGeometry.morphAttributes.position = [open.attributes.position];
  headGeometry.morphAttributes.normal = [open.attributes.normal];
  const head = new THREE.Mesh(headGeometry, material);
  head.name = "Turtle head, beak, jaw, and eyes";
  head.castShadow = head.receiveShadow = true;
  headPivot.add(head);
  // A non-rendering landmark makes the physical direction of the beak testable.
  const snout = new THREE.Object3D();
  snout.name = "Turtle snout tip";
  snout.position.set(A.snout.x, A.snout.y, 0);
  headPivot.add(snout);
  neckPivot.add(headPivot);
  group.add(neckPivot);
  return { group, body, neck, neckPivot, head, headPivot, material };
}

function applyPose(anatomy, pose, gait) {
  const A = TURTLE_ARTICULATION;
  anatomy.group.position.set(pose.x, pose.y, pose.z);
  const rock = 0.025 * Math.sin(gait.phase * TAU) * gait.blend;
  // Body pitch is nose-up positive around local z, the same axis as the walking rock.
  anatomy.group.rotation.set(0, pose.yaw, pose.pitch + rock);
  // Local +x points forward. A dip therefore turns around local z; x would be head roll.
  anatomy.neckPivot.rotation.set(0, pose.neckYaw, pose.neckPitch);
  anatomy.headPivot.rotation.set(0, pose.headYaw, pose.headPitch);
  // A strike stretches the neck along its own axis and carries the head pivot out with
  // it; the head keeps its size. The jaw gape is a morph on the merged head mesh.
  const reach = 1 + A.stretch * pose.extend;
  anatomy.neck.scale.set(reach, 1, 1);
  anatomy.headPivot.position.x = A.headPivotX * reach;
  anatomy.head.morphTargetInfluences[0] = pose.gape;
  // Diagonal leg pairs alternate: target 0 swings one pair forward, target 1 the other.
  const swing = Math.sin(gait.phase * TAU) * gait.blend;
  anatomy.body.morphTargetInfluences[0] = Math.max(0, swing);
  anatomy.body.morphTargetInfluences[1] = Math.max(0, -swing);
  anatomy.group.updateMatrix();
  anatomy.neck.updateMatrix();
  anatomy.neckPivot.updateMatrix();
  anatomy.headPivot.updateMatrix();
  anatomy.group.updateMatrixWorld(true);
}

export function createTurtle(scene, {
  obstacles = [],
  // Spheres to clear while swimming (the fish obstacle list) and grass beds never landed in.
  swimObstacles = [],
  beds = [],
  // The saved record: identity plus hunger and cooldown remainders (issue 04). A record
  // without them is an issue-03 turtle and starts at the default hunger.
  turtle = null,
  random = randomGenerator(791913),
  ground = sandHeight,
  bounds = TURTLE_BOUNDS,
  initialPoses,
  options = {},
  // Hunting hooks, see createTurtleSimulation. Without them a strike still animates but
  // removes nothing.
  onCatch,
  onSnap,
} = {}) {
  const simulation = createTurtleSimulation({
    id: turtle?.id ?? uid(),
    hunger: turtle?.hunger,
    feedIn: turtle?.feedIn,
    retryIn: turtle?.retryIn,
    breathIn: turtle?.breathIn,
    obstacles,
    swimObstacles,
    beds,
    ground,
    random,
    bounds,
    initialPoses,
    onCatch,
    onSnap,
    options: {
      ...options,
      shuffleSpeed: options.speed ?? options.shuffleSpeed ?? TUNING.shuffleSpeed,
    },
  });
  const anatomy = buildAnatomy();
  scene.add(anatomy.group);
  // Walking blend eases in and out so legs never snap between rest and stride.
  const gait = { phase: 0, blend: 0 };
  // Where the turtle would like a fish to be: the fish school treats it as a thing worth a
  // look. The same vector is updated in place every step, so a holder sees it move.
  const lure = new THREE.Vector3();
  const sync = (pose) => {
    applyPose(anatomy, pose, gait);
    lure.set(pose.lure.x, pose.lure.y, pose.lure.z);
  };
  sync(simulation.getPose());

  return {
    // `prey` is the live fish list (stable `sid`, `position`, relative `size`).
    update(dt, prey) {
      if (!(dt > 0)) return;
      const pose = simulation.update(dt, prey);
      // Legs stride on the sand and paddle on the way up; they hang still on the glide.
      const target = pose.mode === "shuffle" ? 1 : pose.paddle;
      const step = GAIT.blendRate * dt;
      gait.blend += Math.max(-step, Math.min(step, target - gait.blend));
      if (gait.blend > 0) gait.phase = (gait.phase + dt * GAIT.cyclesPerSecond) % 1;
      else gait.phase = 0;
      sync(pose);
    },
    lure,
    snapshot: simulation.snapshot,
    getState: simulation.getPose,
    renderStats() {
      let meshes = 0, shadowCasters = 0;
      anatomy.group.traverse((object) => {
        if (!object.isMesh) return;
        meshes++;
        if (object.castShadow) shadowCasters++;
      });
      return { meshes, shadowCasters };
    },
    dispose() {
      scene.remove(anatomy.group);
      anatomy.material.dispose();
      anatomy.group.traverse((object) => object.geometry?.dispose());
    },
  };
}
