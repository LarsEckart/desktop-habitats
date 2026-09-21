// Three.js view for the pure turtle simulation in turtle-simulation.js.
import * as THREE from "three";
import { randomGenerator, sandHeight } from "./math.js";
import { uid } from "./tank-state.js";
import {
  createTurtleSimulation,
  TURTLE_BOUNDS,
  TUNING,
} from "./turtle-simulation.js";

export { TURTLE_BOUNDS, TUNING } from "./turtle-simulation.js";

// One merged body, one neck, and one merged head. Fine traits such as eyes, claws, shell
// scutes, and tail ridges add triangles and vertex colours, but not draw calls.
export const TURTLE_RENDER_BUDGET = Object.freeze({ meshes: 3, shadowCasters: 3 });

const COLORS = {
  shell: 0x465033,
  shellDark: 0x283522,
  scute: 0x687044,
  skin: 0x4b543d,
  skinLight: 0x697056,
  jaw: 0x31372b,
  claw: 0xc1b890,
  eye: 0xd7b448,
  pupil: 0x090b07,
};

function transformed(geometry, {
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  scale = [1, 1, 1],
  color = COLORS.skin,
} = {}) {
  const copy = geometry.clone();
  geometry.dispose();
  copy.scale(...scale);
  copy.rotateX(rotation[0]);
  copy.rotateY(rotation[1]);
  copy.rotateZ(rotation[2]);
  copy.translate(...position);
  const flat = copy.index ? copy.toNonIndexed() : copy;
  if (flat !== copy) copy.dispose();
  return { geometry: flat, color };
}

function mergeVertexColored(parts) {
  let vertices = 0;
  for (const part of parts) vertices += part.geometry.attributes.position.count;
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const color = new THREE.Color();
  let offset = 0;
  for (const part of parts) {
    const p = part.geometry.attributes.position;
    const n = part.geometry.attributes.normal;
    color.set(part.color);
    for (let i = 0; i < p.count; i++) {
      const at = (offset + i) * 3;
      positions[at] = p.getX(i);
      positions[at + 1] = p.getY(i);
      positions[at + 2] = p.getZ(i);
      normals[at] = n.getX(i);
      normals[at + 1] = n.getY(i);
      normals[at + 2] = n.getZ(i);
      colors[at] = color.r;
      colors[at + 1] = color.g;
      colors[at + 2] = color.b;
    }
    offset += p.count;
    part.geometry.dispose();
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildBodyGeometry() {
  const parts = [];
  // A low, rough dome and a darker under-rim give the shell a heavy snapper shape.
  parts.push(transformed(new THREE.IcosahedronGeometry(1, 2), {
    position: [0, 0.36, 0], scale: [0.72, 0.31, 0.58], color: COLORS.shell,
  }));
  parts.push(transformed(new THREE.CylinderGeometry(0.62, 0.68, 0.12, 16), {
    position: [0, 0.16, 0], scale: [1, 1, 0.83], color: COLORS.shellDark,
  }));
  // Three raised keels and side scutes are the shell traits that survive desktop scale.
  for (const z of [-0.28, 0, 0.28])
    for (const x of [-0.34, 0, 0.34])
      parts.push(transformed(new THREE.ConeGeometry(0.09, 0.13, 5), {
        position: [x, 0.68 - 0.12 * Math.abs(x) - (z === 0 ? 0 : 0.045), z],
        scale: [1, 1, z === 0 ? 0.72 : 0.5],
        color: z === 0 ? COLORS.scute : COLORS.shellDark,
      }));

  // A long tapering tail with a jagged dorsal ridge is the clearest snapper silhouette.
  parts.push(transformed(new THREE.ConeGeometry(0.16, 0.95, 7), {
    position: [-0.92, 0.19, 0], rotation: [0, 0, Math.PI / 2], color: COLORS.skin,
  }));
  for (let i = 0; i < 4; i++)
    parts.push(transformed(new THREE.ConeGeometry(0.055 - i * 0.007, 0.11, 4), {
      position: [-0.63 - i * 0.18, 0.32 - i * 0.025, 0], color: COLORS.shellDark,
    }));

  // Broad, low feet and pale forward claws. Each foot is part of this same body mesh.
  for (const front of [-1, 1]) {
    for (const side of [-1, 1]) {
      const x = front * 0.32;
      const z = side * 0.53;
      parts.push(transformed(new THREE.SphereGeometry(1, 8, 5), {
        position: [x, 0.15, z], scale: [0.3, 0.12, 0.2], color: COLORS.skinLight,
      }));
      for (let claw = -1; claw <= 1; claw++)
        parts.push(transformed(new THREE.ConeGeometry(0.025, 0.15, 5), {
          position: [x + front * (0.13 + claw * 0.04), 0.12, z + side * 0.15],
          rotation: [side * Math.PI / 2, 0, 0], color: COLORS.claw,
        }));
    }
  }
  return mergeVertexColored(parts);
}

function buildHeadGeometry() {
  const parts = [
    transformed(new THREE.BoxGeometry(0.45, 0.27, 0.35), {
      position: [0.23, 0, 0], color: COLORS.skin,
    }),
    transformed(new THREE.ConeGeometry(0.16, 0.25, 4), {
      position: [0.51, 0.015, 0], rotation: [0, 0, -Math.PI / 2],
      scale: [1, 1, 1.25], color: COLORS.skinLight,
    }),
    transformed(new THREE.BoxGeometry(0.43, 0.075, 0.32), {
      position: [0.27, -0.15, 0], color: COLORS.jaw,
    }),
  ];
  // Gold eyes under angular brow plates, with black pupils on the outer faces.
  for (const side of [-1, 1]) {
    parts.push(transformed(new THREE.SphereGeometry(0.055, 7, 5), {
      position: [0.29, 0.11, side * 0.175], color: COLORS.eye,
    }));
    parts.push(transformed(new THREE.SphereGeometry(0.028, 6, 4), {
      position: [0.31, 0.11, side * 0.218], color: COLORS.pupil,
    }));
    parts.push(transformed(new THREE.BoxGeometry(0.22, 0.055, 0.05), {
      position: [0.25, 0.18, side * 0.15],
      rotation: [side * 0.18, 0, 0.1], color: COLORS.shellDark,
    }));
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

  const body = new THREE.Mesh(buildBodyGeometry(), material);
  body.name = "Turtle merged shell, feet, claws, and ridged tail";
  body.castShadow = body.receiveShadow = true;
  group.add(body);

  const neckPivot = new THREE.Group();
  neckPivot.name = "Turtle neck pivot";
  neckPivot.position.set(0.55, 0.38, 0);
  const neck = new THREE.Mesh(
    mergeVertexColored([
      transformed(new THREE.CylinderGeometry(0.12, 0.17, 0.48, 10), {
        position: [0.24, 0, 0], rotation: [0, 0, -Math.PI / 2], color: COLORS.skin,
      }),
    ]),
    material,
  );
  neck.name = "Turtle neck";
  neck.castShadow = neck.receiveShadow = true;
  neckPivot.add(neck);

  const headPivot = new THREE.Group();
  headPivot.name = "Turtle head pivot";
  headPivot.position.x = 0.48;
  const head = new THREE.Mesh(buildHeadGeometry(), material);
  head.name = "Turtle angular head, jaw, and eyes";
  head.castShadow = head.receiveShadow = true;
  headPivot.add(head);
  // A non-rendering landmark makes the physical direction of the beak testable.
  const snout = new THREE.Object3D();
  snout.name = "Turtle snout tip";
  snout.position.set(0.64, 0.015, 0);
  headPivot.add(snout);
  neckPivot.add(headPivot);
  group.add(neckPivot);
  return { group, neckPivot, headPivot, material };
}

function applyPose(anatomy, pose) {
  anatomy.group.position.set(pose.x, pose.y, pose.z);
  const rock = pose.mode === "shuffle" ? 0.025 * Math.sin(pose.elapsed * TAU * 0.9) : 0;
  anatomy.group.rotation.set(0, pose.yaw, rock);
  anatomy.neckPivot.rotation.set(0, pose.neckYaw, 0);
  // Local +x points forward. A dip therefore turns around local z; x would be head roll.
  anatomy.headPivot.rotation.set(0, pose.headYaw, pose.headPitch);
  anatomy.group.updateMatrix();
  anatomy.neckPivot.updateMatrix();
  anatomy.headPivot.updateMatrix();
  anatomy.group.updateMatrixWorld(true);
}

const TAU = Math.PI * 2;

export function createTurtle(scene, {
  obstacles = [],
  turtle = null,
  random = randomGenerator(791913),
  ground = sandHeight,
  bounds = TURTLE_BOUNDS,
  initialPoses,
  options = {},
} = {}) {
  const simulation = createTurtleSimulation({
    id: turtle?.id ?? uid(),
    obstacles,
    ground,
    random,
    bounds,
    initialPoses,
    options: {
      ...options,
      shuffleSpeed: options.speed ?? options.shuffleSpeed ?? TUNING.shuffleSpeed,
    },
  });
  const anatomy = buildAnatomy();
  scene.add(anatomy.group);
  applyPose(anatomy, simulation.getPose());

  return {
    update(dt) {
      if (!(dt > 0)) return;
      applyPose(anatomy, simulation.update(dt));
    },
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
