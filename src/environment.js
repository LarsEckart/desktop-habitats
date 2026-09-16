import * as THREE from "three";
import {
  groundHeight,
  noise,
  random,
  randomGenerator,
  range,
  vec,
} from "./math.js";

async function surface(loader, name, repeat, color) {
  const [map, normalMap] = await Promise.all([
    loader.loadAsync(`assets/${name}_diff.jpg`),
    loader.loadAsync(`assets/${name}_nor_gl.jpg`),
  ]);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, normalMap]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(...repeat);
    texture.anisotropy = 8;
  }
  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    color,
    roughness: 0.92,
    normalScale: new THREE.Vector2(0.65, 0.65),
  });
}

function rockGeometry(seed, detail = 112) {
  const geometry = new THREE.SphereGeometry(
    1,
    detail,
    Math.floor(detail * 0.7),
  );
  const positions = geometry.attributes.position;
  const color = new THREE.Color();
  const colors = [];
  const planes = [];
  const sample = randomGenerator(Math.round(seed * 1000) + 27461);
  const pits = [];
  if (detail > 20)
    for (let i = 0; i < 115; i++) {
      const y = sample() * 2 - 1,
        a = sample() * Math.PI * 2,
        r = Math.sqrt(1 - y * y);
      const radius = 0.022 + sample() ** 2 * 0.18;
      pits.push({
        x: Math.cos(a) * r,
        y,
        z: Math.sin(a) * r,
        radius,
        depth: radius * (0.3 + sample() * 0.8),
      });
    }
  for (let i = 0; i < 15; i++) {
    const a = i * 2.399963 + seed,
      y = 1 - (2 * (i + 0.5)) / 15,
      r = Math.sqrt(1 - y * y);
    planes.push({
      normal: vec(Math.cos(a) * r, y, Math.sin(a) * r),
      distance: 0.76 + noise(i, seed, 4) * 0.35,
    });
  }
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const a = noise(x * 2.5 + seed, y * 2.5, z * 2.5);
    const b = noise(x * 7 + seed, y * 7, z * 7);
    const c = noise(x * 22 + seed, y * 22, z * 22);
    const strata = Math.pow(
      Math.abs(Math.sin(x * 3.2 + y * 9 + z * 2.7 + a * 6)),
      18,
    );
    let radius = 1.28;
    for (const plane of planes) {
      const dot = x * plane.normal.x + y * plane.normal.y + z * plane.normal.z;
      if (dot > 0) radius = Math.min(radius, plane.distance / dot);
    }
    radius +=
      (a - 0.5) * 0.1 + (b - 0.5) * 0.055 + (c - 0.5) * 0.023 - strata * 0.017;
    let depression = 0;
    let rim = 0;
    for (const pit of pits) {
      const d =
        Math.sqrt(
          (x - pit.x) ** 2 + ((y - pit.y) * 1.17) ** 2 + (z - pit.z) ** 2,
        ) / pit.radius;
      if (d < 1) depression += pit.depth * (1 - d * d) ** 0.65;
      else if (d < 1.2) rim += (1.2 - d) * 0.1;
    }
    radius -= Math.min(0.25, depression);
    positions.setXYZ(i, x * radius, y * radius, z * radius);
    color
      .setRGB(1, 0.985, 0.945)
      .multiplyScalar(
        (0.8 + 0.2 * a + rim) * (1 - Math.min(0.52, depression * 2.1)),
      );
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function branchGeometry(points, baseRadius, tipRadius, seed) {
  const curve = new THREE.CatmullRomCurve3(points);
  const length = curve.getLength();
  const rows = Math.ceil(length * 30),
    cols = 96;
  const positions = [],
    uv = [],
    indices = [],
    colors = [];
  const frames = curve.computeFrenetFrames(rows, false);
  const splitRandom = randomGenerator(Math.round(seed * 1000) + 51781);
  const splits = Array.from({ length: 14 }, () => ({
    a: splitRandom() * Math.PI * 2,
    t: splitRandom(),
    width: 0.025 + splitRandom() * 0.09,
    length: 0.025 + splitRandom() * 0.15,
    depth: 0.08 + splitRandom() * 0.32,
  }));
  for (let i = 0; i <= rows; i++) {
    const t = i / rows,
      p = curve.getPointAt(t);
    const radius = THREE.MathUtils.lerp(
      baseRadius,
      tipRadius,
      Math.pow(t, 0.8),
    );
    for (let j = 0; j <= cols; j++) {
      const a = (j / cols) * Math.PI * 2;
      const ridges =
        0.077 * Math.sin(a * 9 + t * 12 + seed) +
        0.042 * Math.sin(a * 17 - t * 7) +
        0.022 * Math.sin(a * 31 + t * 33);
      const weather = noise(Math.cos(a) * 5 + seed, t * 30, Math.sin(a) * 5);
      const channel =
        Math.pow(0.5 + 0.5 * Math.sin(a * 13 + Math.sin(t * 15) * 0.25), 10) *
        0.07;
      const knot = 1 + 0.15 * Math.exp(-(((t - 0.47) / 0.08) ** 2));
      let splitDepth = 0;
      for (const split of splits) {
        const angle = a - split.a - 0.07 * Math.sin(t * 37 + seed);
        const around =
          Math.atan2(Math.sin(angle), Math.cos(angle)) / split.width;
        const along = (t - split.t) / split.length;
        const distance = around * around + along * along;
        if (distance < 1)
          splitDepth += split.depth * Math.pow(1 - distance, 0.6);
      }
      const r =
        radius *
        knot *
        (1 +
          ridges +
          (weather - 0.5) * 0.3 -
          channel -
          Math.min(0.65, splitDepth));
      const radial = frames.normals[i]
        .clone()
        .multiplyScalar(Math.cos(a))
        .addScaledVector(frames.binormals[i], Math.sin(a));
      const v = p.clone().addScaledVector(radial, r);
      positions.push(v.x, v.y, v.z);
      uv.push(j / cols, length * t * 0.32);
      const tint =
        (0.7 + weather * 0.27 + ridges * 0.7 - channel) *
        (1 - Math.min(0.6, splitDepth * 1.5));
      colors.push(tint, tint * 0.97, tint * 0.92);
      if (i < rows && j < cols) {
        const k = i * (cols + 1) + j;
        indices.push(k, k + 1, k + cols + 1, k + 1, k + cols + 2, k + cols + 1);
      }
    }
  }
  // Close the weathered tips; the narrower branches intersect inside their parent.
  for (const i of [0, rows]) {
    const p = curve.getPointAt(i / rows),
      k = positions.length / 3;
    positions.push(p.x, p.y, p.z);
    uv.push(0.5, 0.5);
    colors.push(0.38, 0.32, 0.23);
    for (let j = 0; j < cols; j++) {
      if (i === 0) indices.push(k, j + 1, j);
      else indices.push(k, i * (cols + 1) + j, i * (cols + 1) + j + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createContactShadows(scene, rocks) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 5, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,0,0,.85)");
  gradient.addColorStop(0.42, "rgba(0,0,0,.48)");
  gradient.addColorStop(1, "rgba(0,0,0,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const map = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    opacity: 0.67,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  for (const rock of rocks) {
    const plane = new THREE.Mesh(
      new THREE.PlaneGeometry(rock.rx * 3.5, rock.rz * 3.5),
      material,
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(rock.x, groundHeight(rock.x, rock.z) + 0.008, rock.z);
    scene.add(plane);
  }
}

export async function createEnvironment(scene) {
  const loader = new THREE.TextureLoader();
  const [rockMaterial, woodMaterial, sandMaterial] = await Promise.all([
    surface(loader, "rock_boulder_dry", [1.8, 1.4], 0x71756c),
    surface(loader, "rough_wood", [2.1, 1.4], 0xc3ad8e),
    surface(loader, "sand_01", [10, 6], 0xfff1d5),
  ]);
  rockMaterial.vertexColors = true;
  rockMaterial.normalScale.set(0.85, 0.85);
  woodMaterial.vertexColors = true;
  woodMaterial.roughness = 0.86;
  woodMaterial.normalScale.set(0.8, 0.8);
  sandMaterial.normalScale.set(0.32, 0.32);
  sandMaterial.vertexColors = true;

  const ground = new THREE.PlaneGeometry(24, 18, 200, 140);
  ground.rotateX(-Math.PI / 2);
  const position = ground.attributes.position;
  const groundColors = [];
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i),
      z = position.getZ(i);
    position.setY(i, groundHeight(x, z) + 0.008 * noise(x * 40, 0, z * 40));
    const shade = 0.035 + 0.965 * THREE.MathUtils.smoothstep(z, -4.2, 0.7);
    groundColors.push(shade, shade, shade);
  }
  ground.setAttribute(
    "color",
    new THREE.Float32BufferAttribute(groundColors, 3),
  );
  ground.computeVertexNormals();
  const sand = new THREE.Mesh(ground, sandMaterial);
  sand.receiveShadow = true;
  scene.add(sand);

  const rocks = [
    { x: -5.35, z: 0.7, rx: 1.3, ry: 0.92, rz: 0.83 },
    { x: -4.6, z: -0.3, rx: 1.02, ry: 1.37, rz: 0.87 },
    { x: -3.15, z: -1.28, rx: 0.84, ry: 1.1, rz: 0.67 },
    { x: -6.1, z: -0.8, rx: 1.12, ry: 0.89, rz: 0.8 },
    { x: 4.72, z: 0.3, rx: 1.55, ry: 0.86, rz: 0.9 },
    { x: 6.45, z: -0.8, rx: 1.45, ry: 1.03, rz: 1.04 },
    { x: 7.5, z: 0.24, rx: 1.06, ry: 0.7, rz: 0.7 },
    { x: 2.22, z: 1.05, rx: 0.65, ry: 0.57, rz: 0.61, pale: true },
    { x: -0.64, z: 1.25, rx: 0.37, ry: 0.29, rz: 0.38 },
    { x: -1.68, z: -0.04, rx: 0.33, ry: 0.31, rz: 0.31 },
    { x: 3.65, z: 1.53, rx: 0.38, ry: 0.4, rz: 0.31 },
  ];
  const obstacles = [];
  const pale = rockMaterial.clone();
  pale.color.set(0xb2a078);
  rocks.forEach((r, i) => {
    const mesh = new THREE.Mesh(
      rockGeometry(i * 2.63),
      r.pale ? pale : rockMaterial,
    );
    mesh.scale.set(r.rx, r.ry, r.rz);
    mesh.position.set(r.x, groundHeight(r.x, r.z) + r.ry * 0.57, r.z);
    mesh.rotation.set(range(-0.2, 0.2), range(-3, 3), range(-0.18, 0.18));
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    obstacles.push({
      center: mesh.position.clone(),
      radius: Math.max(r.rx, r.ry, r.rz) * 0.82,
    });
  });
  createContactShadows(scene, rocks);

  const smallRockGeometry = rockGeometry(37, 12);
  const gravel = new THREE.InstancedMesh(smallRockGeometry, rockMaterial, 235);
  const matrix = new THREE.Object3D(),
    color = new THREE.Color();
  for (let i = 0; i < gravel.count; i++) {
    const x = range(-8.7, 8.7),
      z = range(-3, 3.1),
      s = range(0.025, 0.135) * (i < 30 ? 2 : 1);
    matrix.position.set(x, groundHeight(x, z) + s * 0.4, z);
    matrix.scale.set(s * range(0.7, 1.5), s * range(0.5, 0.95), s);
    matrix.rotation.set(range(0, 3), range(0, 3), range(0, 3));
    matrix.updateMatrix();
    gravel.setMatrixAt(i, matrix.matrix);
    gravel.setColorAt(i, color.setHSL(0.12, 0.13, range(0.25, 0.7)));
  }
  gravel.castShadow = gravel.receiveShadow = true;
  scene.add(gravel);

  const gritMaterial = new THREE.MeshStandardMaterial({
    color: 0xb6a07a,
    roughness: 1,
  });
  const grit = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    gritMaterial,
    4200,
  );
  for (let i = 0; i < grit.count; i++) {
    const x = range(-9, 9),
      z = range(-4, 4),
      s = range(0.006, 0.022);
    matrix.position.set(x, groundHeight(x, z) + s * 0.3, z);
    matrix.scale.set(s, s * 0.55, s);
    matrix.rotation.set(range(0, 3), range(0, 3), range(0, 3));
    matrix.updateMatrix();
    grit.setMatrixAt(i, matrix.matrix);
    grit.setColorAt(
      i,
      color.setHSL(range(0.08, 0.16), range(0.12, 0.34), range(0.15, 0.66)),
    );
  }
  grit.receiveShadow = true;
  scene.add(grit);

  const branches = [
    {
      p: [
        [3.48, 0.37, -0.15],
        [2.64, 1.52, -0.42],
        [1.37, 3.6, -0.65],
        [0.15, 5.25, -0.85],
        [-1.49, 6.76, -1.05],
        [-3.33, 7.95, -1.05],
      ],
      r: 0.78,
      t: 0.047,
    },
    {
      p: [
        [-1.53, 6.73, -1.04],
        [-2.08, 7.14, -1.17],
        [-2.17, 7.85, -1.15],
        [-2.64, 8.43, -1.08],
      ],
      r: 0.27,
      t: 0.017,
    },
    {
      p: [
        [2.71, 1.36, -0.37],
        [3.15, 0.95, -0.6],
        [4.16, 0.36, -0.92],
        [4.84, 0.17, -0.7],
      ],
      r: 0.33,
      t: 0.012,
    },
    {
      p: [
        [1.67, 3.2, -0.59],
        [2.05, 3.28, -0.93],
        [2.34, 3.71, -1],
        [2.86, 3.92, -0.92],
      ],
      r: 0.27,
      t: 0.018,
    },
    {
      p: [
        [0.3, 5.03, -0.82],
        [-0.23, 5.59, -0.31],
        [-0.59, 5.76, -0.18],
      ],
      r: 0.21,
      t: 0.012,
    },
    {
      p: [
        [2.9, 0.84, -0.3],
        [1.95, 0.48, -0.06],
        [1.46, 0.14, 0.39],
        [0.74, 0.13, 0.55],
      ],
      r: 0.35,
      t: 0.02,
    },
    {
      p: [
        [2.34, 2.12, -0.38],
        [3.2, 2.58, -1.4],
        [3.55, 3.14, -1.67],
      ],
      r: 0.25,
      t: 0.022,
    },
  ];
  branches.forEach((branch, i) => {
    const mesh = new THREE.Mesh(
      branchGeometry(
        branch.p.map((p) => vec(...p)),
        branch.r,
        branch.t,
        i * 5.7,
      ),
      woodMaterial,
    );
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    if (i === 0) {
      const curve = new THREE.CatmullRomCurve3(branch.p.map((p) => vec(...p)));
      for (let t = 0; t < 1; t += 0.075)
        obstacles.push({
          center: curve.getPoint(t),
          radius: THREE.MathUtils.lerp(0.68, 0.05, t) + 0.12,
        });
    }
  });
  return { obstacles };
}

export function createParticles(scene) {
  const count = 180,
    positions = new Float32Array(count * 3),
    seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions.set([range(-10, 10), range(0.2, 10), range(-5, 5)], i * 3);
    seeds[i] = random();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("seed", new THREE.BufferAttribute(seeds, 1));
  const uniforms = { time: { value: 0 }, pixelRatio: { value: 1 } };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    vertexShader: `uniform float time;uniform float pixelRatio;attribute float seed;varying float alpha;
    void main(){vec3 p=position;p.x+=sin(time*.09+seed*28.)*.15;p.y=mod(p.y+time*(.008+seed*.01),10.);p.z+=cos(time*.07+seed*30.)*.1;
    vec4 v=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*v;gl_PointSize=clamp((.45+seed*.45)*pixelRatio*20./(-v.z),.45,1.55*pixelRatio);alpha=.035+seed*.085;}`,
    fragmentShader: `varying float alpha;void main(){float d=length(gl_PointCoord-.5)*2.;gl_FragColor=vec4(.73,.79,.63,alpha*(1.-smoothstep(.0,1.,d)));}`,
  });
  const particles = new THREE.Points(geometry, material);
  scene.add(particles);
  return {
    update(t, ratio) {
      uniforms.time.value = t;
      uniforms.pixelRatio.value = ratio;
    },
  };
}
