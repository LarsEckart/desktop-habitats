import * as THREE from "three";
import { GeometryBatch, groundHeight, range, random, vec } from "./math.js";

const waterTime = { value: 0 };
const leafVertex = `
  uniform float waterTime;
  attribute vec3 anchor;
  attribute float flex;
  varying vec2 leafUv;
  varying vec3 leafPosition;
  vec3 circulation(vec3 p, vec3 base, float softness) {
    float a = waterTime * .46 + base.x * .19 + base.z * .26;
    float b = waterTime * .73 + base.x * .11 - base.z * .31;
    return p + softness * vec3(.095 * sin(a) + .035 * sin(b), .009 * sin(b), .044 * cos(a + .6));
  }
`;

function foliageMaterial() {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.46,
    metalness: 0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.36,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = waterTime;
    shader.vertexShader = leafVertex + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      vec3 transformed = circulation(position, anchor, flex);
      leafUv = uv; leafPosition = position;
    `,
    );
    shader.fragmentShader =
      `varying vec2 leafUv; varying vec3 leafPosition;
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      float midrib = 1.0 - smoothstep(.006, .024, abs(leafUv.x - .5));
      float veins = pow(.5 + .5 * cos((leafUv.y - abs(leafUv.x - .5) * .32) * 155.0), 22.0);
      float edge = pow(abs(leafUv.x - .5) * 2.0, 5.0);
      float mottling = .965 + .035 * sin(leafUv.y * 64.0 + sin(leafUv.x * 25.0));
      diffuseColor.rgb *= mottling * (1.0 - .09 * edge + .12 * veins);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.33 + vec3(.008,.012,0.), midrib * .6);
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
      float rib = exp(-pow((leafUv.x-.5)*60.,2.))*.0015;
      float veinHeight = pow(.5+.5*cos((leafUv.y-abs(leafUv.x-.5)*.32)*155.),16.)*.00025;
      float detailFade = 1.-smoothstep(.003,.012,max(fwidth(leafUv.x),fwidth(leafUv.y)));
      float micro = sin(leafUv.x*230.)*sin(leafUv.y*310.)*.00003*detailFade;
      float surfaceHeight = rib + veinHeight + micro;
      vec3 dp1=dFdx(-vViewPosition),dp2=dFdy(-vViewPosition);
      vec3 r1=cross(dp2,normal),r2=cross(normal,dp1);
      float det=dot(dp1,r1);
      normal=normalize(abs(det)*normal-sign(det)*(dFdx(surfaceHeight)*r1+dFdy(surfaceHeight)*r2));
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <lights_fragment_end>",
      `#include <lights_fragment_end>
      vec3 leafLight = normalize(vec3(-.25, .92, .3));
      float transmitted = pow(max(0.0, dot(-normal, leafLight)), 1.5);
      float topLight = .3 + .7 * smoothstep(.0, 7.5, leafPosition.y);
      reflectedLight.indirectDiffuse += diffuseColor.rgb * vec3(.35,.72,.08) * (.04 + transmitted * .85) * topLight;
    `,
    );
  };
  material.customProgramCacheKey = () => "aquatic-leaves-v1";
  return material;
}

function foliageDepth() {
  const material = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = waterTime;
    shader.vertexShader = leafVertex + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      "vec3 transformed = circulation(position, anchor, flex);",
    );
  };
  material.customProgramCacheKey = () => "aquatic-leaf-shadow-v1";
  return material;
}

// Each blade is a curved, cupped surface; the stem and blade use the same root and current.
function blade(
  batch,
  points,
  width,
  color,
  root,
  softness,
  { rows = 12, cols = 4, twist = 0, ribbon = false } = {},
) {
  const curve =
    points.length === 3
      ? new THREE.QuadraticBezierCurve3(...points)
      : ribbon && points.length === 4
        ? new THREE.CubicBezierCurve3(...points)
        : new THREE.CatmullRomCurve3(points);
  const start = batch.positions.length / 3;
  const phase = range(0, 6.28);
  const turn = ribbon ? range(-0.7, 0.7) : range(-0.12, 0.12);
  const broad = width > 0.14 && !ribbon;
  const forwardTilt = broad ? range(0.38, 0.87) : 0;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t);
    const theta = twist + turn * t;
    const side = vec(Math.cos(theta), 0, Math.sin(theta));
    side.addScaledVector(tangent, -side.dot(tangent)).normalize();
    if (broad) {
      const facing = vec(tangent.y, -tangent.x, 0).normalize();
      if (facing.dot(side) < 0) facing.negate();
      side.lerp(facing, forwardTilt).normalize();
    }
    const normal = new THREE.Vector3().crossVectors(side, tangent).normalize();
    const envelope = ribbon
      ? Math.pow(Math.sin(Math.PI * Math.pow(t, 0.58)), 0.34)
      : Math.pow(Math.sin(Math.PI * Math.pow(t, 0.73)), broad ? 0.59 : 0.76);
    const halfWidth = width * Math.max(0.005, envelope);
    const flex =
      softness * Math.min(1, center.distanceTo(root) / (ribbon ? 5 : 2)) ** 1.5;
    const shade = ribbon
      ? 0.35 + 0.65 * THREE.MathUtils.smoothstep(center.y, 0.1, 7.5)
      : 0.9;
    const tint = color
      .clone()
      .multiplyScalar(shade * (0.86 + 0.14 * Math.sin(Math.PI * t * 0.9)));
    for (let j = 0; j <= cols; j++) {
      const u = (j / cols) * 2 - 1;
      const wave = 1 + 0.016 * Math.sin(t * 25 + phase) * u * u;
      const p = center.clone().addScaledVector(side, u * halfWidth * wave);
      p.addScaledVector(
        normal,
        halfWidth *
          (0.19 * u * u + 0.045 * Math.sin(t * 15 + phase) * Math.abs(u)),
      );
      batch.vertex(p, [j / cols, t], tint, root, flex);
      if (i < rows && j < cols) {
        const a = start + i * (cols + 1) + j;
        batch.quad(a, a + 1, a + cols + 1, a + cols + 2);
      }
    }
  }
}

function stem(batch, points, radius, color, root, softness = 0.4) {
  const curve = new THREE.CatmullRomCurve3(points);
  const rows = Math.max(4, points.length * 3),
    cols = 5;
  const start = batch.positions.length / 3;
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      p = curve.getPoint(t),
      tangent = curve.getTangent(t);
    const a = new THREE.Vector3()
      .crossVectors(tangent, vec(0.2, 0.01, 1))
      .normalize();
    const b = new THREE.Vector3().crossVectors(tangent, a).normalize();
    for (let j = 0; j <= cols; j++) {
      const angle = (j / cols) * Math.PI * 2;
      const v = p
        .clone()
        .addScaledVector(a, Math.cos(angle) * radius * (1 - 0.65 * t))
        .addScaledVector(b, Math.sin(angle) * radius * (1 - 0.65 * t));
      batch.vertex(
        v,
        [j / cols, t],
        color,
        root,
        softness * Math.min(1, p.distanceTo(root) / 2) ** 1.5,
      );
      if (i < rows && j < cols) {
        const k = start + i * (cols + 1) + j;
        batch.quad(k, k + 1, k + cols + 1, k + cols + 2);
      }
    }
  }
}

function ribbonRosette(batch, x, z, height, count) {
  const root = vec(x, groundHeight(x, z) - 0.025, z);
  for (let i = 0; i < count; i++) {
    const theta = range(0, Math.PI * 2);
    const h = height * range(0.55, 1.15);
    const sweep = range(1.3, 3.8);
    const direction = vec(Math.cos(theta), 0, Math.sin(theta));
    const base = root.clone().addScaledVector(direction, range(0, 0.08));
    const points = [
      base,
      base.clone().add(vec(direction.x * 0.08, h * 0.7, direction.z * 0.08)),
      base
        .clone()
        .add(
          vec(direction.x * sweep * 0.3, h * 1.2, direction.z * sweep * 0.3),
        ),
      base
        .clone()
        .add(vec(direction.x * sweep, h * range(0.87, 1), direction.z * sweep)),
    ];
    const color = new THREE.Color().setHSL(
      range(0.255, 0.31),
      range(0.79, 0.95),
      range(0.19, 0.32),
    );
    blade(batch, points, range(0.044, 0.115), color, root, range(0.8, 1.3), {
      rows: 32,
      cols: 6,
      twist: theta + Math.PI / 2,
      ribbon: true,
    });
  }
}

function broadRosette(batch, x, y, z, size, count) {
  const root = vec(x, y, z);
  const crown = root.clone().add(vec(0.1 * size, 0.55 * size, -0.08 * size));
  stem(
    batch,
    [root, root.clone().lerp(crown, 0.4), crown],
    0.033 * size,
    new THREE.Color("#30451a"),
    root,
    0.2,
  );
  for (let i = 0; i < count; i++) {
    const angle = i * 2.39996 + range(-0.4, 0.4),
      elevation = range(0.22, 1.4);
    const length = size * range(0.48, 0.94);
    const direction = vec(
      Math.cos(angle),
      elevation,
      Math.sin(angle),
    ).normalize();
    const petiole = length * range(0.25, 0.55);
    const node = root.clone().lerp(crown, range(0.15, 1));
    const attach = node.clone().addScaledVector(direction, petiole);
    stem(
      batch,
      [
        node,
        node
          .clone()
          .lerp(attach, 0.5)
          .add(vec(0, 0.06, 0)),
        attach,
      ],
      0.013 * size,
      new THREE.Color("#36551a"),
      root,
      0.25,
    );
    const end = attach
      .clone()
      .addScaledVector(direction, length)
      .add(vec(0, -0.07 * size, 0));
    const mid = attach
      .clone()
      .lerp(end, 0.5)
      .add(vec(0, 0.1 * size, 0));
    const color = new THREE.Color().setHSL(
      range(0.25, 0.31),
      range(0.76, 0.9),
      range(0.13, 0.25),
    );
    blade(
      batch,
      [attach, mid, end],
      length * range(0.26, 0.39),
      color,
      root,
      0.25,
      { rows: 24, cols: 10, twist: angle + Math.PI / 2 },
    );
  }
}

function stemPlant(batch, x, z, height, phase) {
  const root = vec(x, groundHeight(x, z) - 0.02, z);
  const lean = vec(range(-0.4, 0.4), 0, range(-0.3, 0.3));
  const pointAt = (t) =>
    root
      .clone()
      .add(
        vec(
          lean.x * t * t + 0.055 * Math.sin(t * 9 + phase),
          height * t,
          lean.z * t * t,
        ),
      );
  stem(
    batch,
    [root, pointAt(0.33), pointAt(0.66), pointAt(1)],
    0.014,
    new THREE.Color("#586b20"),
    root,
    0.6,
  );
  const layers = Math.floor(height * 5.5);
  for (let layer = 1; layer < layers; layer++) {
    const t = layer / layers;
    const attach = pointAt(t);
    const n = random() < 0.35 ? 4 : 3;
    const len = range(0.2, 0.45) * (1 - 0.4 * t);
    for (let j = 0; j < n; j++) {
      const angle = (j / n) * 6.28 + layer * 1.7 + phase;
      const end = attach
        .clone()
        .add(
          vec(Math.cos(angle) * len, range(0.11, 0.27), Math.sin(angle) * len),
        );
      const color = new THREE.Color().setHSL(
        range(0.215, 0.27),
        0.78,
        range(0.2, 0.36),
      );
      blade(
        batch,
        [
          attach,
          attach
            .clone()
            .lerp(end, 0.6)
            .add(vec(0, 0.035, 0)),
          end,
        ],
        range(0.023, 0.058),
        color,
        root,
        0.65,
        { rows: 5, cols: 2, twist: angle + 1.57 },
      );
    }
  }
}

function mossTuft(batch, center, radius, count = 55, onWood = false) {
  const normal = onWood ? vec(0, 0.35, 1).normalize() : vec(0, 1, 0);
  const along = new THREE.Vector3().crossVectors(vec(1, 0, 0), normal);
  for (let j = 0; j < count; j++) {
    const phi = range(0, 6.28),
      r = radius * Math.sqrt(random());
    const root = center
      .clone()
      .add(vec(Math.cos(phi) * r, 0, 0))
      .addScaledVector(along, Math.sin(phi) * r * 0.7)
      .addScaledVector(normal, 0.06 - 0.18 * (r / radius) ** 2);
    const outward = vec(Math.cos(phi), onWood ? 0.25 : 0, 0)
      .addScaledVector(along, Math.sin(phi) * 0.5)
      .addScaledVector(normal, range(0.25, 0.8));
    const length = range(0.12, 0.44);
    const tip = root.clone().addScaledVector(outward, length);
    stem(
      batch,
      [
        root,
        root
          .clone()
          .lerp(tip, 0.5)
          .add(vec(0, 0.075, 0)),
        tip,
      ],
      0.005,
      new THREE.Color("#4a6019"),
      root,
      0.28,
    );
    for (let k = 1; k < 6; k++) {
      const attach = root
        .clone()
        .lerp(tip, k / 6)
        .add(vec(0, Math.sin((k / 6) * Math.PI) * 0.075, 0));
      for (const side of [-1, 1]) {
        const theta = phi + side * 1.25;
        const end = attach
          .clone()
          .add(vec(Math.cos(theta) * 0.13, 0.07, Math.sin(theta) * 0.095));
        const color = new THREE.Color().setHSL(
          range(0.205, 0.27),
          0.8,
          range(0.17, 0.31),
        );
        blade(
          batch,
          [
            attach,
            attach
              .clone()
              .lerp(end, 0.5)
              .add(vec(0, 0.025, 0)),
            end,
          ],
          0.012,
          color,
          root,
          0.4,
          { rows: 3, cols: 2, twist: theta },
        );
      }
    }
  }
}

function fernTuft(batch, center, size, count, onWood = false) {
  for (let i = 0; i < count; i++) {
    const a = range(0, 6.28),
      length = range(0.5, 1.15) * size;
    const root = center
      .clone()
      .add(
        vec(
          range(-0.15, 0.15),
          range(onWood ? -0.2 : -0.04, onWood ? 0.2 : 0.04),
          range(-0.1, 0.1),
        ),
      );
    const end = root
      .clone()
      .add(
        vec(
          Math.cos(a) * length,
          range(onWood ? -0.12 : 0.1, onWood ? 0.5 : 0.4) * size,
          Math.sin(a) * length * (onWood ? 0.36 : 0.7),
        ),
      );
    const mid = root
      .clone()
      .lerp(end, 0.45)
      .add(vec(0, length * 0.32, 0));
    const color = new THREE.Color().setHSL(
      range(0.225, 0.29),
      0.85,
      range(0.14, 0.28),
    );
    blade(
      batch,
      [root, mid, end],
      range(0.028, 0.061) * size,
      color,
      root,
      0.38,
      { rows: 18, cols: 4, twist: a + 1.57 },
    );
  }
}

export function createPlants(scene) {
  const batch = new GeometryBatch();
  for (let i = 0; i < 72; i++) {
    const left = i < 40;
    ribbonRosette(
      batch,
      left ? range(-8.8, -1.9) : range(3.0, 8.7),
      range(-5.7, -2),
      range(6.6, 9.3),
      Math.floor(range(9, 15)),
    );
  }
  for (let i = 0; i < 146; i++) {
    const x = i < 58 ? range(-9, -6.5) : i < 108 ? range(6, 9) : range(-3.7, 4);
    const z = range(-5.8, -3.5);
    stemPlant(batch, x, z, range(3.8, 8.3), range(0, 6.28));
  }
  for (const [x, z, s, n] of [
    [-7.2, 0.1, 1.3, 21],
    [-6.9, -0.4, 1.5, 21],
    [-6.5, 0.3, 1.3, 17],
    [-7.7, 0.8, 1.2, 17],
    [-7.1, -1.1, 1.65, 18],
    [6.6, 0.2, 1.0, 18],
    [7, -0.7, 1.3, 18],
    [5.9, 0.5, 0.8, 14],
  ]) {
    broadRosette(batch, x, groundHeight(x, z) + 0.015, z, s, n);
  }
  for (let i = 0; i < 24; i++) {
    const x = range(-8.4, 8.4),
      z = range(-5.9, -4.8);
    ribbonRosette(batch, x, z, range(4.6, 7.5), 10);
  }
  for (const [x, z, s, n] of [
    [-7.2, -0.8, 1.8, 28],
    [-6.4, -1.2, 2.1, 24],
    [7.3, -1.3, 1.65, 25],
    [-2.6, -2.2, 0.78, 16],
    [-1.8, -3.1, 0.7, 17],
    [-0.3, -3.3, 0.85, 16],
    [0.6, -2.5, 0.72, 12],
    [3.9, -2.4, 1.1, 18],
    [-7.2, 1.15, 0.57, 12],
    [-6.8, 1.4, 0.47, 10],
    [-7.9, 1.2, 0.55, 12],
    [6.7, 1.15, 0.48, 10],
  ])
    broadRosette(batch, x, groundHeight(x, z), z, s, n);
  broadRosette(batch, -6.25, 1.35, -0.65, 1.45, 22);
  broadRosette(batch, -6.95, 1.05, -1.05, 1.55, 20);
  broadRosette(batch, 6.45, 1.05, -0.7, 1.1, 17);
  // Foreground tufts and epiphytes break up the rock-to-sand boundaries.
  for (const [x, z, h, n] of [
    [-3.65, -0.8, 2.5, 15],
    [-4.2, 0.8, 1.1, 12],
    [-2.8, -2, 2.8, 12],
    [0.2, -1.2, 1.6, 10],
    [4.8, -1, 1.8, 11],
    [7.8, 1.2, 0.7, 8],
  ])
    ribbonRosette(batch, x, z, h, n);
  for (const [x, y, z, r, n, onWood] of [
    [1.55, 3.07, 0.05, 0.8, 170, true],
    [2.38, 2.77, 0.15, 0.64, 130, true],
    [0.98, 3.42, -0.3, 0.52, 75, true],
    [-3.55, 0.63, 0.75, 0.5, 75],
    [-2.9, 1.47, -0.6, 0.38, 65],
    [3.8, 0.73, 1.1, 0.4, 65],
    [0.6, 0.4, 0.5, 0.56, 70],
    [-6.1, 0.4, 1.25, 0.5, 65],
  ])
    mossTuft(batch, vec(x, y, z), r, n, onWood);
  for (const [x, y, z, s, n, onWood] of [
    [1.55, 3.07, 0.05, 1.05, 48, true],
    [2.38, 2.77, 0.15, 0.9, 40, true],
    [0.98, 3.42, -0.3, 0.75, 30, true],
    [-3.55, 0.55, 0.75, 0.8, 30],
    [-3.2, 1.12, -0.25, 0.9, 36],
    [0.6, 0.34, 0.5, 0.65, 24],
    [-6.1, 0.35, 1.25, 0.7, 25],
    [4.3, 0.4, -0.3, 0.8, 24],
  ])
    fernTuft(batch, vec(x, y, z), s, n, onWood);
  const mesh = new THREE.Mesh(batch.geometry(), foliageMaterial());
  mesh.customDepthMaterial = foliageDepth();
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return {
    update(time) {
      waterTime.value = time;
    },
    mesh,
  };
}
