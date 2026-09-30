// Offline software rasteriser for a fish species' meshes. It writes PNG views of the
// actual Three.js geometry without a browser or GPU, so a new species' shape can be
// inspected quickly. This is a development aid, not a test: it shades by part with a
// fixed palette and ignores the skin shader, the swim bend and the water light model.
//
//   node scenes/riverscape/tests/fish-preview.mjs <species-key> [out-prefix]
//
// Species keys are those in fish-species.js, for example `marbled-hatchetfish`.
import { register } from "node:module";
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const [key = "bloodfin-tetra", outPrefix = key] = process.argv.slice(2);
register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { speciesByKey } = await import("../src/fish-species.js");
const species = speciesByKey[key];
if (!species) {
  console.error(`unknown species ${key}; choose one of ${Object.keys(speciesByKey).join(", ")}`);
  process.exit(1);
}
const anatomy = species.createAnatomy();
const proportions = new THREE.Vector3(...(species.proportions ?? [1, 1, 1]));

// Approximate colours per part id (see fish-anatomy.js): body, caudal, dorsal, anal, the
// pectorals, pelvic, iris, pupil, oral slit, corneal rim, upper lip, adipose, barbels.
const PALETTE = {
  0: [0.62, 0.64, 0.60], 1: [0.55, 0.42, 0.34], 2: [0.55, 0.42, 0.34], 3: [0.55, 0.42, 0.34],
  4: [0.60, 0.58, 0.50], 5: [0.60, 0.58, 0.50], 6: [0.55, 0.42, 0.34], 7: [0.72, 0.60, 0.30],
  8: [0.03, 0.03, 0.03], 9: [0.10, 0.06, 0.05], 10: [0.85, 0.85, 0.80], 11: [0.40, 0.36, 0.30],
  12: [0.55, 0.42, 0.34], 13: [0.35, 0.30, 0.22],
};

// Gather triangles with per-vertex normals and part colours from both meshes.
const tris = [];
for (const geometry of [anatomy.body, anatomy.fins]) {
  const pos = geometry.getAttribute("position"), nor = geometry.getAttribute("normal");
  const parts = geometry.getAttribute("aPart"), index = geometry.getIndex();
  const count = index ? index.count : pos.count;
  const read = (k) => {
    const i = index ? index.getX(k) : k;
    return {
      p: new THREE.Vector3().fromBufferAttribute(pos, i).multiply(proportions),
      n: new THREE.Vector3().fromBufferAttribute(nor, i).normalize(),
      c: PALETTE[parts.getX(i)] ?? [1, 0, 1],
      membrane: geometry === anatomy.fins,
    };
  };
  for (let k = 0; k < count; k += 3) tris.push([read(k), read(k + 1), read(k + 2)]);
}
console.log(species.name, "triangles", tris.length);

function render(name, { eye, target, up = [0, 1, 0], width = 1000, height = 620, scale }) {
  const eyeV = new THREE.Vector3(...eye), tgt = new THREE.Vector3(...target);
  const view = new THREE.Matrix4().lookAt(eyeV, tgt, new THREE.Vector3(...up)).invert();
  const light = new THREE.Vector3(0.35, 1, 0.6).normalize();
  const fill = new THREE.Vector3(-0.6, 0.2, -0.4).normalize();
  const img = new Float32Array(width * height * 3).fill(0.13);
  const depth = new Float32Array(width * height).fill(Infinity);
  const tv = new THREE.Vector3();
  for (const tri of tris) {
    const pts = tri.map((v) => {
      tv.copy(v.p).sub(tgt).applyMatrix4(view);
      return { x: width / 2 + tv.x * scale, y: height / 2 - tv.y * scale, z: -tv.z, v };
    });
    const minX = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.x))));
    const maxX = Math.min(width - 1, Math.ceil(Math.max(...pts.map((p) => p.x))));
    const minY = Math.max(0, Math.floor(Math.min(...pts.map((p) => p.y))));
    const maxY = Math.min(height - 1, Math.ceil(Math.max(...pts.map((p) => p.y))));
    const [A, B, C] = pts;
    const area = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (Math.abs(area) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5, py = y + 0.5;
        const w0 = ((B.x - px) * (C.y - py) - (B.y - py) * (C.x - px)) / area;
        const w1 = ((C.x - px) * (A.y - py) - (C.y - py) * (A.x - px)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * A.z + w1 * B.z + w2 * C.z;
        const idx = y * width + x;
        if (z >= depth[idx]) continue;
        depth[idx] = z;
        const n = new THREE.Vector3()
          .addScaledVector(A.v.n, w0).addScaledVector(B.v.n, w1).addScaledVector(C.v.n, w2).normalize();
        // Membranes are double-sided sheets: light either face.
        const facing = A.v.membrane ? Math.abs(n.dot(light)) : Math.max(0, n.dot(light));
        const shade = 0.25 + 0.75 * facing + 0.2 * Math.max(0, n.dot(fill));
        const c = A.v.c;
        img[idx * 3] = c[0] * shade; img[idx * 3 + 1] = c[1] * shade; img[idx * 3 + 2] = c[2] * shade;
      }
    }
  }
  writePng(`${outPrefix}-${name}.png`, img, width, height);
}

function writePng(path, img, width, height) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width * 3; x++) {
      const v = img[y * width * 3 + x];
      raw[y * (width * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(Math.pow(v, 1 / 2.2) * 255)));
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  writeFileSync(path, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0)),
  ]));
  console.log("wrote", path);
}

// Side view from the fish's left, a raised three-quarter view, a top view, a head-on view
// and a close-up of the head. The snout points +X, so the side view looks along -Z.
render("side", { eye: [0, 0, 10], target: [-0.02, -0.05, 0], scale: 1000 });
render("quarter", { eye: [6, 4, 8], target: [-0.02, -0.03, 0], scale: 900 });
render("top", { eye: [0, 10, 0], target: [-0.02, 0, 0], up: [-1, 0, 0], scale: 1000 });
render("front", { eye: [10, 0.5, 0], target: [0.1, -0.05, 0], scale: 1400 });
render("head", { eye: [4, 2, 8], target: [0.26, -0.01, 0], scale: 3200 });
anatomy.body.dispose();
anatomy.fins.dispose();
