import * as THREE from "three";

export function randomGenerator(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    n = (n + Math.imul(n ^ (n >>> 7), 61 | n)) ^ n;
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

export const random = randomGenerator(34191);
export const range = (a, b) => a + (b - a) * random();
export const vec = (x, y, z) => new THREE.Vector3(x, y, z);

function hash(x, y, z) {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

export function noise(x, y, z) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    iz = Math.floor(z);
  let fx = x - ix,
    fy = y - iy,
    fz = z - iz;
  fx *= fx * (3 - 2 * fx);
  fy *= fy * (3 - 2 * fy);
  fz *= fz * (3 - 2 * fz);
  const mix = THREE.MathUtils.lerp;
  return mix(
    mix(
      mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx),
      mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx),
      fy,
    ),
    mix(
      mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx),
      mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx),
      fy,
    ),
    fz,
  );
}

export function groundHeight(x, z) {
  return (
    0.12 +
    0.055 * Math.sin(x * 1.8 + z) +
    0.045 * Math.sin(z * 2.3 - x * 0.7) +
    0.34 * Math.max(0, -z / 5) +
    0.14 * Math.exp(-((x + 5) ** 2 / 5 + (z + 1) ** 2 / 4))
  );
}

export class GeometryBatch {
  constructor() {
    this.positions = [];
    this.uvs = [];
    this.colors = [];
    this.indices = [];
    this.anchors = [];
    this.flex = [];
  }
  vertex(p, uv, color, anchor = p, flex = 0) {
    const i = this.positions.length / 3;
    this.positions.push(p.x, p.y, p.z);
    this.uvs.push(...uv);
    this.colors.push(color.r, color.g, color.b);
    this.anchors.push(anchor.x, anchor.y, anchor.z);
    this.flex.push(flex);
    return i;
  }
  quad(a, b, c, d) {
    this.indices.push(a, c, b, b, c, d);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(this.positions, 3),
    );
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uvs, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
    g.setAttribute("anchor", new THREE.Float32BufferAttribute(this.anchors, 3));
    g.setAttribute("flex", new THREE.Float32BufferAttribute(this.flex, 1));
    g.setIndex(this.indices);
    g.computeVertexNormals();
    return g;
  }
}
