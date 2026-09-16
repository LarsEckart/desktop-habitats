import * as THREE from "three";
import { randomGenerator } from "./math.js";

const COUNT = 24;
const BOUNDS = {
  minX: -6.45,
  maxX: 6.45,
  minY: 2.12,
  maxY: 6.22,
  minZ: 0.15,
  maxZ: 3.05,
};
const UP = new THREE.Vector3(0, 1, 0);
const FORWARD = new THREE.Vector3(1, 0, 0);
const TAU = Math.PI * 2;

// X is the fish's forward axis. Cross-sections preserve the narrow forehead,
// deeper abdomen and compressed caudal peduncle from every swimming angle.
const PROFILE = [
  [-0.293, 0.015, 0.01, 0.002],
  [-0.248, 0.022, 0.014, 0.001],
  [-0.19, 0.04, 0.021, -0.002],
  [-0.108, 0.062, 0.032, -0.004],
  [-0.012, 0.081, 0.043, -0.005],
  [0.082, 0.084, 0.047, -0.002],
  [0.16, 0.079, 0.049, 0.004],
  [0.225, 0.065, 0.045, 0.007],
  [0.276, 0.048, 0.038, 0.004],
  [0.31, 0.033, 0.028, -0.003],
  [0.335, 0.02, 0.022, -0.008],
  [0.345, 0.014, 0.016, -0.01],
  [0.35, 0.002, 0.004, -0.01],
];
const BODY_CONTOUR = new THREE.CatmullRomCurve3(
  PROFILE.map(
    (section) => new THREE.Vector3(section[0], section[1], section[2]),
  ),
);

function bodySection(t) {
  const sample = t * (PROFILE.length - 1);
  const index = Math.min(Math.floor(sample), PROFILE.length - 2);
  const fraction = sample - index;
  const blend = fraction * fraction * (3 - 2 * fraction);
  const section = BODY_CONTOUR.getPoint(t);
  section.center = THREE.MathUtils.lerp(
    PROFILE[index][3],
    PROFILE[index + 1][3],
    blend,
  );
  return section;
}

function bodySectionAtX(x) {
  let low = 0,
    high = 1;
  for (let step = 0; step < 12; step++) {
    const middle = (low + high) * 0.5;
    if (BODY_CONTOUR.getPoint(middle).x < x) low = middle;
    else high = middle;
  }
  return bodySection((low + high) * 0.5);
}

function gillPoint(x, y, side) {
  const section = bodySectionAtX(x);
  const sine = THREE.MathUtils.clamp(
    (y - section.center) / (section.y * (y < section.center ? 0.94 : 1)),
    -1,
    1,
  );
  const cheek =
    1 + 0.05 * Math.exp(-((x - 0.17) ** 2) / 0.0025) * Math.max(0, -sine);
  const z = Math.pow(Math.sqrt(1 - sine * sine), 0.86) * section.z * cheek;
  return new THREE.Vector3(x, y, side * (z + 0.0007));
}

function bodyGeometry() {
  const positions = [],
    uvs = [],
    indices = [];
  const around = 32;
  const length = 64;
  for (let row = 0; row <= length; row++) {
    const t = row / length;
    const section = bodySection(t);
    const x = section.x;
    const height = section.y;
    const width = section.z;
    const center = section.center;
    for (let col = 0; col <= around; col++) {
      const theta = (col / around) * TAU;
      const s = Math.sin(theta);
      const y = center + s * height * (s < 0 ? 0.94 : 1);
      const c = Math.cos(theta);
      const cheek =
        1 + 0.05 * Math.exp(-((x - 0.17) ** 2) / 0.0025) * Math.max(0, -s);
      positions.push(
        x,
        y,
        Math.sign(c) * Math.pow(Math.abs(c), 0.86) * width * cheek,
      );
      uvs.push(t, col / around);
      if (row < length && col < around) {
        const i = row * (around + 1) + col;
        indices.push(
          i,
          i + around + 1,
          i + 1,
          i + 1,
          i + around + 1,
          i + around + 2,
        );
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function geometryBuilder() {
  const positions = [],
    normals = [],
    uvs = [],
    parts = [],
    progress = [],
    indices = [];
  return {
    add(geometry, part, matrix, finProgress) {
      if (matrix) geometry.applyMatrix4(matrix);
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      const uv = geometry.getAttribute("uv");
      const offset = positions.length / 3;
      for (let i = 0; i < position.count; i++) {
        positions.push(position.getX(i), position.getY(i), position.getZ(i));
        normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
        uvs.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
        parts.push(part);
        progress.push(finProgress ? finProgress[i] : 0);
      }
      const index = geometry.getIndex();
      for (let i = 0; i < (index ? index.count : position.count); i++) {
        indices.push(offset + (index ? index.getX(i) : i));
      }
      geometry.dispose();
    },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(positions, 3),
      );
      geometry.setAttribute(
        "normal",
        new THREE.Float32BufferAttribute(normals, 3),
      );
      geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geometry.setAttribute(
        "aPart",
        new THREE.Float32BufferAttribute(parts, 1),
      );
      geometry.setAttribute(
        "aFinProgress",
        new THREE.Float32BufferAttribute(progress, 1),
      );
      geometry.setIndex(indices);
      return geometry;
    },
  };
}

function finSurface(root, rim, part, builder, rayBuilder) {
  const positions = [],
    uvs = [],
    progress = [],
    indices = [];
  const radialSteps = 7;
  const origin = new THREE.Vector3(...root);
  const outline = new THREE.CatmullRomCurve3(
    rim.map((point) => new THREE.Vector3(...point)),
  );
  const outlineSteps = (rim.length - 1) * 3;
  const side = part === 5 ? -1 : 1;
  function hingeAt(t) {
    const hinge = origin.clone();
    if (part === 1) {
      hinge.y = THREE.MathUtils.lerp(0.013, -0.012, t);
    } else if (part === 2 || part === 3) {
      hinge.x = THREE.MathUtils.lerp(rim[0][0], rim[rim.length - 1][0], t);
      const body = bodySectionAtX(hinge.x);
      hinge.y = body.center + body.y * (part === 2 ? 0.995 : -0.935);
    }
    return hinge;
  }
  for (let ray = 0; ray <= outlineSteps; ray++) {
    const along = ray / outlineSteps;
    const edge = outline.getPoint(along);
    const hinge = hingeAt(along);
    edge.lerp(
      hinge,
      0.018 * (1 - Math.cos(along * (rim.length - 1) * Math.PI * 2)),
    );
    for (let step = 0; step <= radialSteps; step++) {
      const t = step / radialSteps;
      const p = hinge.clone().lerp(edge, t);
      p.z += Math.sin(t * Math.PI) * 0.007 * side;
      p.z += Math.sin(along * Math.PI) * t * 0.003 * side;
      positions.push(p.x, p.y, p.z);
      uvs.push(along, t);
      progress.push(t);
      if (ray < outlineSteps && step < radialSteps) {
        const i = ray * (radialSteps + 1) + step;
        indices.push(
          i,
          i + 1,
          i + radialSteps + 1,
          i + 1,
          i + radialSteps + 2,
          i + radialSteps + 1,
        );
      }
    }
    if (ray % 3 === 0 && ray > 0 && ray < outlineSteps) {
      const midpoint = hinge.clone().lerp(edge, 0.55);
      midpoint.z += 0.007 * side;
      const curve = new THREE.QuadraticBezierCurve3(hinge, midpoint, edge);
      const rayGeometry = new THREE.TubeGeometry(
        curve,
        7,
        part === 1 ? 0.00058 : 0.0004,
        3,
        false,
      );
      const rayProgress = [];
      const rayPosition = rayGeometry.getAttribute("position");
      const distance = hinge.distanceTo(edge);
      for (let i = 0; i < rayPosition.count; i++) {
        rayProgress.push(
          Math.min(
            1,
            new THREE.Vector3()
              .fromBufferAttribute(rayPosition, i)
              .distanceTo(hinge) / Math.max(distance, 0.001),
          ),
        );
      }
      rayBuilder.add(rayGeometry, part, null, rayProgress);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  builder.add(geometry, part, null, progress);
}

function makeAnatomy() {
  const opaque = geometryBuilder();
  const fins = geometryBuilder();
  opaque.add(bodyGeometry(), 0);
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const eyeNormal = new THREE.Vector3();
  const outOfEye = new THREE.Vector3(0, 0, 1);
  for (const side of [-1, 1]) {
    const eyeCenter = new THREE.Vector3(0.26, 0.028, side * 0.047);
    eyeNormal.set(0.42, 0.06, side * 0.905).normalize();
    quaternion.setFromUnitVectors(outOfEye, eyeNormal);
    position.copy(eyeCenter);
    scale.set(1.04, 1, 0.84);
    matrix.compose(position, quaternion, scale);
    opaque.add(new THREE.SphereGeometry(0.0132, 20, 14), 10, matrix);
    position.copy(eyeCenter).addScaledVector(eyeNormal, 0.0102);
    scale.set(1, 1, 0.24);
    matrix.compose(position, quaternion, scale);
    opaque.add(new THREE.SphereGeometry(0.0102, 20, 12), 7, matrix);
    position.copy(eyeCenter).addScaledVector(eyeNormal, 0.0123);
    scale.set(1, 1, 0.2);
    matrix.compose(position, quaternion, scale);
    opaque.add(new THREE.SphereGeometry(0.0064, 18, 12), 8, matrix);
    const gill = new THREE.CatmullRomCurve3([
      gillPoint(0.167, 0.069, side),
      gillPoint(0.142, 0.039, side),
      gillPoint(0.149, -0.005, side),
      gillPoint(0.185, -0.045, side),
    ]);
    opaque.add(new THREE.TubeGeometry(gill, 16, 0.00105, 4, false), 9);
    const mouth = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.333, -0.014, side * 0.02),
      new THREE.Vector3(0.347, -0.011, side * 0.015),
      new THREE.Vector3(0.353, -0.01, 0),
    ]);
    opaque.add(new THREE.TubeGeometry(mouth, 10, 0.0012, 4, false), 9);
    const upperLip = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.334, -0.01, side * 0.02),
      new THREE.Vector3(0.348, -0.007, side * 0.014),
      new THREE.Vector3(0.353, -0.006, 0),
    ]);
    opaque.add(new THREE.TubeGeometry(upperLip, 10, 0.0016, 5, false), 11);
  }
  finSurface(
    [-0.286, 0.001, 0],
    [
      [-0.31, 0.027, 0],
      [-0.352, 0.062, 0.002],
      [-0.41, 0.095, 0.003],
      [-0.455, 0.106, 0.002],
      [-0.453, 0.076, 0],
      [-0.429, 0.038, 0],
      [-0.403, 0.014, 0],
      [-0.395, 0, 0],
      [-0.405, -0.017, 0],
      [-0.435, -0.054, 0],
      [-0.452, -0.099, 0.002],
      [-0.414, -0.091, 0.003],
      [-0.351, -0.052, 0.002],
      [-0.306, -0.021, 0],
    ],
    1,
    fins,
    opaque,
  );
  finSurface(
    [-0.048, 0.076, 0],
    [
      [0.076, 0.085, 0],
      [0.031, 0.118, 0.003],
      [-0.018, 0.133, 0.004],
      [-0.071, 0.113, 0.003],
      [-0.119, 0.098, 0.002],
      [-0.164, 0.054, 0],
    ],
    2,
    fins,
    opaque,
  );
  finSurface(
    [-0.123, -0.048, 0],
    [
      [-0.03, -0.068, 0],
      [-0.079, -0.106, 0.002],
      [-0.139, -0.101, 0.003],
      [-0.192, -0.085, 0.002],
      [-0.237, -0.03, 0],
    ],
    3,
    fins,
    opaque,
  );
  for (const side of [-1, 1]) {
    finSurface(
      [0.147, -0.021, side * 0.043],
      [
        [0.129, -0.036, side * 0.062],
        [0.093, -0.067, side * 0.092],
        [0.044, -0.078, side * 0.106],
        [-0.001, -0.059, side * 0.102],
        [0.026, -0.03, side * 0.077],
        [0.076, -0.017, side * 0.052],
      ],
      side > 0 ? 4 : 5,
      fins,
      opaque,
    );
    finSurface(
      [0.013, -0.07, side * 0.016],
      [
        [0.023, -0.078, side * 0.022],
        [-0.019, -0.121, side * 0.043],
        [-0.065, -0.11, side * 0.05],
        [-0.077, -0.075, side * 0.026],
      ],
      6,
      fins,
      opaque,
    );
  }
  return { body: opaque.finish(), fins: fins.finish() };
}

const SWIM_GLSL = /* glsl */ `
  attribute vec4 aSwim;
  attribute float aPart;
  attribute float aFinProgress;
  varying vec3 vSkinPoint;
  varying vec2 vFishUV;
  varying float vFishPart;
  float tailWeight(float x) {
    return pow(clamp((0.20 - x) / 0.66, 0.0, 1.0), 1.8);
  }
  vec3 swimDeform(vec3 p) {
    float w = tailWeight(p.x);
    p.z += sin(aSwim.x - p.x * 8.5) * aSwim.y * w;
    p.z += aSwim.z * 0.034 * w;
    if (aPart > 3.5 && aPart < 5.5) {
      float side = aPart < 4.5 ? 1.0 : -1.0;
      float beat = sin(aSwim.x * 1.53 + side * 0.9);
      p.z += side * aFinProgress * (0.013 * beat + 0.018 * aSwim.w);
      p.x += aFinProgress * (0.008 * beat - 0.033 * aSwim.w);
      p.y += aFinProgress * 0.008 * cos(aSwim.x * 1.53 + side * 0.9);
    } else if (aPart > 1.5 && aPart < 6.5) {
      p.z += sin(aSwim.x - p.x * 10.0) * aFinProgress * 0.009;
    }
    return p;
  }
`;

function applySwimming(material, withColor = true) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\n${SWIM_GLSL}`)
      .replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `
        vec3 objectNormal = vec3(normal);
        float epsilon = 0.0006;
        float slope = (swimDeform(position + vec3(epsilon, 0.0, 0.0)).z - swimDeform(position - vec3(epsilon, 0.0, 0.0)).z) / (2.0 * epsilon);
        objectNormal.x -= objectNormal.z * slope;
      `,
      )
      .replace(
        "#include <begin_vertex>",
        /* glsl */ `
        vec3 transformed = swimDeform(position);
        vSkinPoint = position;
        vFishUV = uv;
        vFishPart = aPart;
      `,
      );
    if (!withColor) return;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `
        #include <common>
        varying vec3 vSkinPoint;
        varying vec2 vFishUV;
        varying float vFishPart;
        float fishHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        vec2 fishScaleGrid(vec2 uv) {
          vec2 grid = uv * vec2(42.0, 18.0);
          grid.x += mod(floor(grid.y), 2.0) * 0.5;
          return grid;
        }
        float fishDetailMask() {
          vec2 grid = fishScaleGrid(vFishUV);
          float detail = smoothstep(-0.26, -0.15, vSkinPoint.x) * (1.0 - smoothstep(0.13, 0.215, vSkinPoint.x));
          return detail * (1.0 - smoothstep(0.45, 1.2, max(fwidth(grid.x), fwidth(grid.y))));
        }
        float fishScaleRelief() {
          vec2 cell = fract(fishScaleGrid(vFishUV)) - 0.5;
          float dome = 1.0 - smoothstep(0.18, 0.57, length(cell * vec2(0.84, 1.0)));
          return dome * (0.45 + cell.x * 0.7) * fishDetailMask();
        }
      `,
      )
      .replace(
        "#include <color_fragment>",
        /* glsl */ `
        #include <color_fragment>
        if (vFishPart < 0.5) {
          float y = vSkinPoint.y;
          vec3 belly = vec3(0.46, 0.53, 0.48);
          vec3 flank = vec3(0.27, 0.35, 0.35);
          vec3 back = vec3(0.040, 0.105, 0.115);
          vec3 skin = mix(belly, flank, smoothstep(-0.045, 0.026, y));
          skin = mix(skin, back, smoothstep(0.035, 0.087, y));
          float stripeY = y + 0.0018 * sin(vSkinPoint.x * 24.0);
          float stripe = smoothstep(0.006, 0.019, stripeY) * (1.0 - smoothstep(0.032, 0.045, stripeY));
          stripe *= smoothstep(-0.28, -0.15, vSkinPoint.x) * (1.0 - smoothstep(0.24, 0.30, vSkinPoint.x));
          skin = mix(skin, vec3(0.010, 0.255, 0.47), stripe * 0.92);
          float lateral = exp(-pow((y - 0.008) / 0.0036, 2.0));
          skin *= 1.0 - lateral * 0.62 * (1.0 - smoothstep(0.17, 0.28, vSkinPoint.x));
          vec2 grid = fishScaleGrid(vFishUV);
          float scaleNoise = fishHash(floor(grid));
          float rim = smoothstep(0.39, 0.50, length((fract(grid) - 0.5) * vec2(0.83, 1.0)));
          float scaleMask = fishDetailMask();
          skin *= 1.0 + (scaleNoise - 0.5) * 0.20 * scaleMask - rim * 0.075 * scaleMask;
          float tailBlush = (1.0 - smoothstep(-0.27, -0.19, vSkinPoint.x)) * (1.0 - smoothstep(-0.005, 0.030, y));
          skin = mix(skin, vec3(0.70, 0.075, 0.016), tailBlush * 0.8);
          vec3 cheek = mix(vec3(0.36, 0.41, 0.34), vec3(0.19, 0.29, 0.27), smoothstep(-0.025, 0.048, y));
          float head = smoothstep(0.165, 0.265, vSkinPoint.x);
          skin = mix(skin, cheek, head * 0.80);
          float gillPlate = exp(-pow((vSkinPoint.x - 0.176) / 0.037, 2.0) - pow((y + 0.008) / 0.042, 2.0));
          skin = mix(skin, vec3(0.38, 0.45, 0.37), gillPlate * 0.36);
          diffuseColor.rgb = skin;
        } else if (vFishPart < 6.5) {
          float caudal = 1.0 - step(1.5, vFishPart);
          float anal = step(2.5, vFishPart) * (1.0 - step(3.5, vFishPart));
          vec3 membrane = vec3(0.16, 0.29, 0.26);
          float warm = caudal * (0.30 + 0.42 * smoothstep(0.14, 0.7, vFishUV.y)) + anal * 0.34;
          diffuseColor.rgb = mix(membrane, vec3(0.84, 0.10, 0.022), warm);
          float edge = 1.0 - smoothstep(0.86, 1.0, vFishUV.y) * 0.75;
          diffuseColor.a *= mix(0.24, 0.76, caudal) * edge;
        } else if (vFishPart < 7.5) {
          diffuseColor.rgb = vec3(0.39, 0.36, 0.16);
        } else if (vFishPart < 8.5) {
          diffuseColor.rgb = vec3(0.006, 0.009, 0.008);
        } else if (vFishPart < 9.5) {
          diffuseColor.rgb = vec3(0.09, 0.17, 0.155);
        } else if (vFishPart < 10.5) {
          diffuseColor.rgb = vec3(0.055, 0.090, 0.075);
        } else {
          diffuseColor.rgb = vec3(0.34, 0.39, 0.32);
        }
      `,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        /* glsl */ `
        #include <roughnessmap_fragment>
        if (vFishPart < 0.5) {
          float scaleRoughness = 0.32 + fishHash(floor(fishScaleGrid(vFishUV))) * 0.18;
          roughnessFactor = mix(roughnessFactor, scaleRoughness, fishDetailMask());
        } else if (vFishPart > 6.5 && vFishPart < 8.5) {
          roughnessFactor = 0.19;
        }
      `,
      )
      .replace(
        "#include <normal_fragment_maps>",
        /* glsl */ `
        #include <normal_fragment_maps>
        if (vFishPart < 0.5) {
          float relief = fishScaleRelief() * 0.00070;
          vec3 dx = dFdx(-vViewPosition), dy = dFdy(-vViewPosition);
          vec3 rx = cross(dy, normal), ry = cross(normal, dx);
          float determinant = dot(dx, rx);
          vec3 gradient = sign(determinant) * (dFdx(relief) * rx + dFdy(relief) * ry);
          normal = normalize(abs(determinant) * normal - gradient);
        }
      `,
      )
      .replace(
        "#include <clearcoat_normal_fragment_maps>",
        /* glsl */ `
        #include <clearcoat_normal_fragment_maps>
        #ifdef USE_CLEARCOAT
          clearcoatNormal = normal;
        #endif
      `,
      )
      .replace(
        "#include <lights_physical_fragment>",
        /* glsl */ `
        #include <lights_physical_fragment>
        #ifdef USE_IRIDESCENCE
          material.iridescence *= vFishPart < 0.5 ? 0.25 + fishDetailMask() * 0.75 : 0.0;
          material.iridescenceThickness = 140.0 + fishHash(floor(fishScaleGrid(vFishUV))) * 100.0;
        #endif
      `,
      );
  };
  material.customProgramCacheKey = () =>
    `aquarium-fish-${withColor ? "skin" : "depth"}-2`;
}

function clampToTank(position, margin = 0) {
  position.x = THREE.MathUtils.clamp(
    position.x,
    BOUNDS.minX + margin,
    BOUNDS.maxX - margin,
  );
  position.y = THREE.MathUtils.clamp(
    position.y,
    BOUNDS.minY + margin,
    BOUNDS.maxY - margin,
  );
  position.z = THREE.MathUtils.clamp(
    position.z,
    BOUNDS.minZ + margin,
    BOUNDS.maxZ - margin,
  );
  return position;
}

export function createFishSchool(scene, { obstacles = [] } = {}) {
  const random = randomGenerator(583137);
  const range = (min, max) => min + random() * (max - min);
  const geometry = makeAnatomy();
  const swim = new THREE.InstancedBufferAttribute(
    new Float32Array(COUNT * 4),
    4,
  );
  swim.setUsage(THREE.DynamicDrawUsage);
  geometry.body.setAttribute("aSwim", swim);
  geometry.fins.setAttribute("aSwim", swim);
  const skinMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.23,
    roughness: 0.43,
    clearcoat: 0.08,
    clearcoatRoughness: 0.34,
    iridescence: 0.33,
    iridescenceIOR: 1.33,
    iridescenceThicknessRange: [150, 230],
  });
  const finMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.15,
    roughness: 0.48,
    transparent: true,
    opacity: 0.54,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const depthMaterial = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
  });
  applySwimming(skinMaterial);
  applySwimming(finMaterial);
  applySwimming(depthMaterial, false);
  const bodies = new THREE.InstancedMesh(geometry.body, skinMaterial, COUNT);
  const membranes = new THREE.InstancedMesh(geometry.fins, finMaterial, COUNT);
  bodies.name = "Silver-blue freshwater fish";
  membranes.name = "Attached translucent fish fins";
  bodies.castShadow = true;
  bodies.receiveShadow = true;
  bodies.customDepthMaterial = depthMaterial;
  bodies.frustumCulled = false;
  membranes.frustumCulled = false;
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  membranes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(bodies, membranes);

  let elapsed = 0;
  let startled = 0;
  const initialPositions = [];
  const fish = Array.from({ length: COUNT }, (_, id) => {
    const band = id % 6;
    const position = new THREE.Vector3();
    do {
      position.set(
        -5.7 + band * 2.18 + range(-0.45, 0.45),
        range(2.55, 5.75),
        range(0.42, 2.7),
      );
    } while (
      initialPositions.some((other) => other.distanceToSquared(position) < 0.55)
    );
    initialPositions.push(position);
    const heading = new THREE.Vector3(
      random() < 0.72 ? 1 : -1,
      range(-0.045, 0.045),
      range(-0.16, 0.16),
    ).normalize();
    return {
      id,
      position,
      heading,
      velocity: heading.clone().multiplyScalar(range(0.008, 0.055)),
      anchor: position.clone(),
      goal: position.clone(),
      quaternion: new THREE.Quaternion(),
      scale: range(0.83, 1.08),
      phase: range(0, TAU),
      character: range(0.8, 1.2),
      mode: "hover",
      until: range(0.6, 8.4),
      cooldown: range(0, 2),
      effort: range(0.02, 0.07),
      turn: 0,
      finBrake: 0,
      seed: range(0, 100),
    };
  });
  const delta = new THREE.Vector3();
  const target = new THREE.Vector3();
  const desired = new THREE.Vector3();
  const acceleration = new THREE.Vector3();
  const avoidance = new THREE.Vector3();
  const separation = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const alignment = new THREE.Vector3();
  const previousHeading = new THREE.Vector3();
  const axisY = new THREE.Vector3();
  const axisZ = new THREE.Vector3();
  const basis = new THREE.Matrix4();
  const instance = new THREE.Matrix4();
  const targetQuaternion = new THREE.Quaternion();
  const bankQuaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  function brake(individual) {
    individual.mode = "brake";
    individual.until = elapsed + range(0.65, 1.35);
    individual.anchor
      .copy(individual.position)
      .addScaledVector(individual.velocity, 0.22);
    clampToTank(individual.anchor, 0.12);
  }

  function dart(individual, direction, frightened = false) {
    individual.mode = "dart";
    individual.until = elapsed + range(0.26, frightened ? 0.55 : 0.43);
    individual.goal
      .copy(individual.position)
      .addScaledVector(direction, range(0.82, 1.38));
    clampToTank(individual.goal, 0.2);
    individual.cooldown = elapsed + range(6.5, 12.0);
  }

  function decide(individual) {
    if (individual.mode === "dart" || individual.mode === "relocate") {
      brake(individual);
    } else if (individual.mode === "brake") {
      individual.mode = "hover";
      individual.until = elapsed + range(3.1, 10.5) / individual.character;
      individual.anchor.copy(individual.position);
    } else if (random() < 0.16) {
      target.copy(individual.heading).multiplyScalar(range(0.1, 0.7));
      target
        .add(
          new THREE.Vector3(range(-1, 1), range(-0.2, 0.2), range(-0.6, 0.6)),
        )
        .normalize();
      dart(individual, target);
    } else {
      individual.mode = "relocate";
      individual.until = elapsed + range(3.2, 6.5);
      individual.goal
        .copy(individual.position)
        .add(
          new THREE.Vector3(
            range(-2.6, 2.6),
            range(-0.65, 0.65),
            range(-0.85, 0.85),
          ),
        );
      clampToTank(individual.goal, 0.3);
    }
  }

  function update(dt, time, pointer) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    elapsed += dt;
    for (const individual of fish) {
      const { position, velocity } = individual;
      if (elapsed >= individual.until) decide(individual);
      if (
        pointer &&
        pointer.strength > 0.09 &&
        elapsed >= individual.cooldown
      ) {
        delta.subVectors(position, pointer.position);
        const radius = 1.48 + Math.min(pointer.strength, 1) * 0.42;
        if (
          delta.lengthSq() < radius * radius &&
          random() < dt * (1.5 + 4 * pointer.strength)
        ) {
          delta.y *= 0.42;
          if (delta.lengthSq() < 0.01) delta.set(range(-1, 1), 0.1, -0.5);
          dart(individual, delta.normalize(), true);
          startled++;
        }
      }

      centroid.set(0, 0, 0);
      alignment.set(0, 0, 0);
      separation.set(0, 0, 0);
      let neighbors = 0;
      for (const other of fish) {
        if (other === individual) continue;
        delta.subVectors(position, other.position);
        const distanceSquared = delta.lengthSq();
        if (distanceSquared < 5.8) {
          centroid.add(other.position);
          alignment.add(other.heading);
          neighbors++;
          if (distanceSquared < 0.81) {
            separation.addScaledVector(
              delta,
              (0.81 - distanceSquared) / Math.max(distanceSquared, 0.04),
            );
          }
        }
      }

      if (individual.mode === "hover") {
        target.copy(individual.anchor);
        target.x += Math.sin(elapsed * 0.31 + individual.seed) * 0.045;
        target.y += Math.sin(elapsed * 0.69 + individual.seed * 1.4) * 0.028;
        target.z += Math.sin(elapsed * 0.27 + individual.seed * 0.7) * 0.032;
        desired
          .subVectors(target, position)
          .multiplyScalar(0.65)
          .clampLength(0, 0.12);
      } else if (individual.mode === "brake") {
        desired
          .subVectors(individual.anchor, position)
          .multiplyScalar(0.24)
          .clampLength(0, 0.065);
      } else {
        desired.subVectors(individual.goal, position);
        const remaining = desired.length();
        if (individual.mode === "relocate" && remaining < 0.24)
          brake(individual);
        desired.normalize();
        if (neighbors && individual.mode === "relocate") {
          centroid
            .multiplyScalar(1 / neighbors)
            .sub(position)
            .clampLength(0, 1);
          alignment.normalize();
          desired
            .addScaledVector(centroid, 0.12)
            .addScaledVector(alignment, 0.15)
            .normalize();
        }
        const speed =
          individual.mode === "dart"
            ? 1.26
            : (0.23 + individual.character * 0.13) *
              Math.min(1, remaining / 0.55);
        desired.multiplyScalar(speed);
      }

      avoidance
        .copy(separation)
        .multiplyScalar(individual.mode === "hover" ? 0.4 : 0.66);
      for (const obstacle of obstacles) {
        delta.subVectors(position, obstacle.center);
        const distance = delta.length();
        const surface = distance - obstacle.radius - individual.scale * 0.23;
        if (surface < 0.7 && distance > 0.001)
          avoidance.addScaledVector(delta, ((0.7 - surface) * 1.25) / distance);
      }
      const wallDistance = 0.6;
      for (const [axis, minimum, maximum] of [
        ["x", BOUNDS.minX, BOUNDS.maxX],
        ["y", BOUNDS.minY, BOUNDS.maxY],
        ["z", BOUNDS.minZ, BOUNDS.maxZ],
      ]) {
        if (position[axis] < minimum + wallDistance)
          avoidance[axis] += (minimum + wallDistance - position[axis]) * 0.45;
        if (position[axis] > maximum - wallDistance)
          avoidance[axis] -= (position[axis] - maximum + wallDistance) * 0.45;
      }
      desired.add(avoidance);
      previousHeading.copy(individual.heading);
      const wantedSpeed = desired.length();
      if (
        (individual.mode === "dart" ||
          individual.mode === "relocate" ||
          (individual.mode === "hover" && wantedSpeed > 0.14)) &&
        wantedSpeed > 0.02
      ) {
        target.copy(desired).multiplyScalar(1 / wantedSpeed);
        const yaw = Math.atan2(individual.heading.z, individual.heading.x);
        const wantedYaw = Math.atan2(target.z, target.x);
        const difference = Math.atan2(
          Math.sin(wantedYaw - yaw),
          Math.cos(wantedYaw - yaw),
        );
        const turnLimit = dt * (individual.mode === "dart" ? 4.8 : 2.4);
        const nextYaw =
          yaw + THREE.MathUtils.clamp(difference, -turnLimit, turnLimit);
        const pitchLimit = individual.mode === "dart" ? 0.24 : 0.17;
        const pitch = THREE.MathUtils.lerp(
          Math.asin(individual.heading.y),
          Math.asin(THREE.MathUtils.clamp(target.y, -pitchLimit, pitchLimit)),
          1 - Math.exp(-dt * 4),
        );
        individual.heading.set(
          Math.cos(nextYaw) * Math.cos(pitch),
          Math.sin(pitch),
          Math.sin(nextYaw) * Math.cos(pitch),
        );
        if (individual.mode === "dart" || individual.mode === "relocate") {
          const aligned = Math.max(0, individual.heading.dot(target));
          desired
            .copy(individual.heading)
            .multiplyScalar(wantedSpeed * (0.08 + 0.92 * aligned * aligned));
        }
      }
      const response =
        individual.mode === "dart"
          ? 0.15
          : individual.mode === "brake"
            ? 0.27
            : 0.72;
      acceleration.subVectors(desired, velocity).multiplyScalar(1 / response);
      acceleration.clampLength(
        0,
        individual.mode === "dart"
          ? 2.8
          : individual.mode === "brake"
            ? 1.7
            : 0.7,
      );
      velocity.addScaledVector(acceleration, dt);
      velocity.multiplyScalar(Math.exp(-dt * 0.08));
      position.addScaledVector(velocity, dt);
      clampToTank(position);

      const speed = velocity.length();
      const turning =
        (previousHeading.x * individual.heading.z -
          previousHeading.z * individual.heading.x) /
        Math.max(dt, 0.001);
      individual.turn = THREE.MathUtils.lerp(
        individual.turn,
        THREE.MathUtils.clamp(turning, -1, 1),
        1 - Math.exp(-dt * 5),
      );
      const braking =
        individual.mode === "brake"
          ? 1
          : individual.mode === "hover"
            ? 0.18
            : 0;
      individual.finBrake = THREE.MathUtils.lerp(
        individual.finBrake,
        braking,
        1 - Math.exp(-dt * 6),
      );
      const effort =
        individual.mode === "dart"
          ? 1
          : individual.mode === "brake"
            ? 0.18
            : Math.min(0.65, speed * 1.1 + acceleration.length() * 0.28);
      individual.effort = THREE.MathUtils.lerp(
        individual.effort,
        effort,
        1 - Math.exp(-dt * 4.5),
      );
      const frequency = 0.62 + individual.effort * 7.2;
      individual.phase = (individual.phase + dt * TAU * frequency) % TAU;
      const amplitude = 0.0032 + individual.effort * 0.057;
      swim.setXYZW(
        individual.id,
        individual.phase,
        amplitude,
        individual.turn,
        individual.finBrake,
      );

      axisZ.crossVectors(individual.heading, UP).normalize();
      axisY.crossVectors(axisZ, individual.heading).normalize();
      basis.makeBasis(individual.heading, axisY, axisZ);
      targetQuaternion.setFromRotationMatrix(basis);
      bankQuaternion.setFromAxisAngle(FORWARD, -individual.turn * 0.13);
      targetQuaternion.multiply(bankQuaternion);
      individual.quaternion.copy(targetQuaternion);
      scale.setScalar(individual.scale);
      instance.compose(position, individual.quaternion, scale);
      bodies.setMatrixAt(individual.id, instance);
      membranes.setMatrixAt(individual.id, instance);
    }
    bodies.instanceMatrix.needsUpdate = true;
    membranes.instanceMatrix.needsUpdate = true;
    swim.needsUpdate = true;
  }

  update(0, 0, null);
  return {
    update,
    fish,
    getTelemetry() {
      const states = { hover: 0, relocate: 0, dart: 0, brake: 0 };
      let totalSpeed = 0,
        maximumSpeed = 0;
      for (const individual of fish) {
        states[individual.mode]++;
        const speed = individual.velocity.length();
        totalSpeed += speed;
        maximumSpeed = Math.max(maximumSpeed, speed);
      }
      return {
        count: COUNT,
        states,
        averageSpeed: totalSpeed / COUNT,
        maximumSpeed,
        pointerResponses: startled,
        simulationTime: elapsed,
      };
    },
    dispose() {
      scene.remove(bodies, membranes);
      geometry.body.dispose();
      geometry.fins.dispose();
      skinMaterial.dispose();
      finMaterial.dispose();
      depthMaterial.dispose();
    },
  };
}
