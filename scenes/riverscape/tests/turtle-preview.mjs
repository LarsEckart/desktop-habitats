// Offline software rasteriser for the turtle meshes. It writes PNG views of the actual
// Three.js geometry without a browser or GPU, so shape changes can be inspected quickly.
// This is a development aid, not a test, and its lighting is only approximate.
//
//   node scenes/riverscape/tests/turtle-preview.mjs <out-prefix> [swing] [extend] [gape]
//
// `swing` in [-1, 1] sets the walking morph: 0 is the resting stance. `extend` in [0, 1]
// stretches the neck as a strike does and lifts it toward the lure point; `gape` in [0, 1]
// opens the jaw. `1 1` together is the snap at full reach.
import { register } from "node:module";
import { writeFileSync } from "node:fs";
import { deflateSync, crc32 } from "node:zlib";

const [outPrefix = "turtle", swingArg = "0", extendArg = "0", gapeArg = "0"] = process.argv.slice(2);
register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { createTurtle, TURTLE_ARTICULATION } = await import("../src/turtle.js");

const scene = new THREE.Scene();
const turtle = createTurtle(scene, { random: () => 0.5, ground: () => 0 });
const root = scene.getObjectByName("Snapping turtle");
root.position.set(0, 0, 0); root.rotation.set(0, 0, 0);
const swing = Number(swingArg);
const extend = Number(extendArg), gape = Number(gapeArg);
const body = scene.getObjectByName("Turtle merged shell, legs, claws, and ridged tail");
body.morphTargetInfluences[0] = Math.max(0, swing);
body.morphTargetInfluences[1] = Math.max(0, -swing);
const head = scene.getObjectByName("Turtle head, beak, jaw, and eyes");
head.morphTargetInfluences[0] = gape;
const neck = scene.getObjectByName("Turtle neck");
const neckPivot = scene.getObjectByName("Turtle neck pivot");
const headPivot = scene.getObjectByName("Turtle head pivot");
const reach = 1 + TURTLE_ARTICULATION.stretch * extend;
neck.scale.set(reach, 1, 1);
headPivot.position.x = TURTLE_ARTICULATION.headPivotX * reach;
neckPivot.rotation.set(0, 0, 0.55 * extend);
headPivot.rotation.set(0, 0, 0.1 * extend);
root.traverse((o) => o.updateMatrix());
scene.updateMatrixWorld(true);

// Gather world-space triangles with per-vertex colours and normals.
const tris = [];
root.traverse((mesh) => {
  if (!mesh.isMesh) return;
  const g = mesh.geometry;
  const pos = g.attributes.position, nor = g.attributes.normal, col = g.attributes.color;
  const morph = g.morphAttributes.position ?? [];
  const morphN = g.morphAttributes.normal ?? [];
  const inf = mesh.morphTargetInfluences ?? [];
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const v = () => ({ p: new THREE.Vector3(), n: new THREE.Vector3(), c: new THREE.Color() });
  const read = (i, out) => {
    out.p.fromBufferAttribute(pos, i);
    out.n.fromBufferAttribute(nor, i);
    for (let k = 0; k < morph.length; k++) {
      if (!inf[k]) continue;
      const mp = new THREE.Vector3().fromBufferAttribute(morph[k], i).sub(new THREE.Vector3().fromBufferAttribute(pos, i));
      out.p.addScaledVector(mp, inf[k]);
      if (morphN[k]) {
        const mn = new THREE.Vector3().fromBufferAttribute(morphN[k], i).sub(new THREE.Vector3().fromBufferAttribute(nor, i));
        out.n.addScaledVector(mn, inf[k]);
      }
    }
    out.p.applyMatrix4(mesh.matrixWorld);
    out.n.applyMatrix3(nm).normalize();
    out.c.fromBufferAttribute(col, i);
  };
  for (let i = 0; i < pos.count; i += 3) {
    const a = v(), b = v(), c = v();
    read(i, a); read(i + 1, b); read(i + 2, c);
    tris.push([a, b, c]);
  }
});
console.log("triangles", tris.length);

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
        const shade = 0.25 + 0.75 * Math.max(0, n.dot(light)) + 0.2 * Math.max(0, n.dot(fill));
        const c = new THREE.Color(
          A.v.c.r * w0 + B.v.c.r * w1 + C.v.c.r * w2,
          A.v.c.g * w0 + B.v.c.g * w1 + C.v.c.g * w2,
          A.v.c.b * w0 + B.v.c.b * w1 + C.v.c.b * w2);
        img[idx * 3] = c.r * shade; img[idx * 3 + 1] = c.g * shade; img[idx * 3 + 2] = c.b * shade;
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

// Side view from the turtle's left, a raised three-quarter view, a top view, a head-on
// view, and close-ups of the head and a front foot.
render("side", { eye: [0, 0.3, 10], target: [0.1, 0.3, 0], scale: 280 });
render("quarter", { eye: [7, 4.5, 8], target: [0.1, 0.25, 0], scale: 260 });
render("top", { eye: [0.1, 10, 0], target: [0.1, 0, 0], up: [-1, 0, 0], scale: 280 });
render("front", { eye: [10, 1.5, 0], target: [0.4, 0.3, 0], scale: 300 });
render("head", { eye: [5, 3, 8], target: [1.28, 0.32, 0], scale: 900 });
render("face", { eye: [7, 3.5, 3.5], target: [1.3, 0.3, 0], scale: 900 });
render("foot", { eye: [4, 5, 8], target: [0.4, 0.05, 0.6], scale: 1500 });
turtle.dispose();
