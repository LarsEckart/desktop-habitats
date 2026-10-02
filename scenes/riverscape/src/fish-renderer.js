import * as THREE from "three";
import { sizeScale } from "./breeding.js";
import { bloodfinTetra, pygmyCory, honeyGourami, marbledHatchetfish } from "./fish-species.js";
import { CAPACITY } from "./tank-state.js";
import { createHoneyGouramiRenderer } from "./honey-gourami.js";

const WAVE_ANGLE = 0.78;

// Integrate the spine's tangent, preserving body length. A travelling angular wave
// builds along the trunk and peduncle; the head counter-moves only slightly.
const SWIM_GLSL = /* glsl */ `
  // Part ids come from fish-anatomy.js: 4 and 5 are the pectorals, 1-3, 6 and 12 the other fins; 13 is cory barbels.
  attribute vec4 aSwim; // x: wave phase, y: wave angle, z: turning curvature, w: pectoral brake
  attribute float aFinPhase;
  attribute float aPart;
  attribute float aFinProgress;
  varying vec3 vSkinPoint;
  varying vec2 vFishUV;
  varying float vFishPart;
  const float PIVOT = 0.12;
  vec3 gSwimPosition;
  float spineAngle(float s) {
    float along = clamp(s / 0.57, 0.0, 1.0);
    return aSwim.z * s * (s < 0.0 ? 0.18 : 1.0)
      - 0.025 * aSwim.y * sin(aSwim.x)
      + aSwim.y * pow(along, 1.35) * sin(aSwim.x - s * 7.5);
  }
  vec3 finMotion(vec3 p) {
    if (aPart > 3.5 && aPart < 5.5) {
      float side = aPart < 4.5 ? 1.0 : -1.0;
      float beat = sin(aFinPhase + side * 0.9);
      p.z += side * aFinProgress * (0.013 * beat + 0.018 * aSwim.w);
      p.x += aFinProgress * (0.008 * beat - 0.033 * aSwim.w);
      p.y += aFinProgress * 0.008 * cos(aFinPhase + side * 0.9);
    } else if (aPart > 0.5 && aPart < 1.5) {
      p.z += aSwim.y * 0.045 * aFinProgress * aFinProgress
        * sin(aSwim.x - (PIVOT - p.x) * 7.5 - 0.65);
    } else if ((aPart > 1.5 && aPart < 6.5) || (aPart > 11.5 && aPart < 12.5)) {
      p.z += sin(aFinPhase - p.x * 10.0) * aFinProgress * 0.004;
    } else if (aPart > 12.5) {
      p.z += sin(aFinPhase * 0.55 + p.z * 12.0) * aFinProgress * aFinProgress * 0.003;
    }
    return p;
  }
  vec3 bendSpine(vec3 p, inout vec3 n) {
    float s = PIVOT - p.x;
    float theta = spineAngle(s);
    vec2 spine = vec2(PIVOT, 0.0);
    float kappa = (spineAngle(s + 0.001) - spineAngle(s - 0.001)) / 0.002;
    if (s < 0.0) {
      float mid = spineAngle(s * 0.5);
      spine += vec2(-cos(mid), sin(mid)) * s;
    } else {
      float ds = s / 8.0;
      for (int i = 0; i < 8; i++) {
        float mid = spineAngle((float(i) + 0.5) * ds);
        spine += vec2(-cos(mid), sin(mid)) * ds;
      }
    }
    float c = cos(theta), sn = sin(theta);
    vec3 local = vec3(n.x / max(0.3, 1.0 - p.z * kappa), n.y, n.z);
    n = normalize(vec3(local.x * c + local.z * sn, local.y, -local.x * sn + local.z * c));
    return vec3(spine.x + p.z * sn, p.y, spine.y + p.z * c);
  }
`;

function applySwimming(material, species) {
  const applySkin = species?.applySkin;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      "#include <common>",
      `#include <common>\n${SWIM_GLSL}`,
    );
    if (applySkin) {
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <beginnormal_vertex>",
          /* glsl */ `
          vec3 objectNormal = vec3(normal);
          gSwimPosition = bendSpine(finMotion(position), objectNormal);
        `,
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `
          vec3 transformed = gSwimPosition;
          vSkinPoint = position;
          vFishUV = uv;
          vFishPart = aPart;
        `,
        );
      applySkin(shader);
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        /* glsl */ `
        vec3 swimNormal = vec3(0.0, 1.0, 0.0);
        vec3 transformed = bendSpine(finMotion(position), swimNormal);
      `,
      );
    }
  };
  material.customProgramCacheKey = () =>
    `riverscape-fish-${species?.shaderKey ?? "depth"}-4`;
}

/** Three.js-only projection of fish simulation state. It creates and mutates meshes but
 * never changes fish decisions, physical state, or durable population records. */
export function createFishRenderer(scene, simulation, { species = bloodfinTetra } = {}) {
  function makeBatch(kind) {
    const geometry = kind.createAnatomy();
    const swimAttribute = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY * 4), 4);
    const finPhaseAttribute = new THREE.InstancedBufferAttribute(new Float32Array(CAPACITY), 1);
    swimAttribute.setUsage(THREE.DynamicDrawUsage);
    finPhaseAttribute.setUsage(THREE.DynamicDrawUsage);
    for (const part of [geometry.body, geometry.fins]) {
      part.setAttribute("aSwim", swimAttribute);
      part.setAttribute("aFinPhase", finPhaseAttribute);
    }
    const { skin, fins } = kind.createMaterials();
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    applySwimming(skin, kind);
    applySwimming(fins, kind);
    applySwimming(depth);
    const bodies = new THREE.InstancedMesh(geometry.body, skin, CAPACITY);
    const membranes = new THREE.InstancedMesh(geometry.fins, fins, CAPACITY);
    bodies.name = kind.name;
    membranes.name = `${kind.name} fins`;
    bodies.castShadow = bodies.receiveShadow = true;
    bodies.customDepthMaterial = depth;
    bodies.frustumCulled = membranes.frustumCulled = false;
    bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    membranes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bodies.count = membranes.count = 0;
    scene.add(bodies, membranes);
    return { kind, geometry, swimAttribute, finPhaseAttribute, skin, fins, depth, bodies, membranes };
  }

  const batches = new Map();
  for (const kind of [species, pygmyCory, marbledHatchetfish])
    if (!batches.has(kind.key)) batches.set(kind.key, makeBatch(kind));
  const bespoke = new Map();
  const instance = new THREE.Matrix4();
  const scale = new THREE.Vector3();

  function update() {
    for (const batch of batches.values()) batch.used = 0;
    for (const fish of simulation.fish) {
      if (fish.species === honeyGourami.key) {
        let renderer = bespoke.get(fish);
        if (!renderer) {
          renderer = createHoneyGouramiRenderer(scene, { state: fish.honey });
          bespoke.set(fish, renderer);
        }
        renderer.update(fish.scale * sizeScale(fish.age, fish.adult));
        continue;
      }
      const batch = batches.get(fish.species) ?? batches.get(species.key);
      const slot = batch.used++;
      batch.swimAttribute.setXYZW(
        slot,
        fish.phase,
        fish.effort * WAVE_ANGLE,
        -fish.bend,
        fish.finBrake,
      );
      batch.finPhaseAttribute.setX(slot, fish.finPhase);
      scale.setScalar(fish.size);
      if (batch.kind.proportions) scale.multiply(new THREE.Vector3(...batch.kind.proportions));
      instance.compose(fish.position, fish.quaternion, scale);
      batch.bodies.setMatrixAt(slot, instance);
      batch.membranes.setMatrixAt(slot, instance);
    }
    for (const batch of batches.values()) {
      batch.bodies.count = batch.membranes.count = batch.used;
      batch.bodies.instanceMatrix.needsUpdate = true;
      batch.membranes.instanceMatrix.needsUpdate = true;
      batch.swimAttribute.needsUpdate = true;
      batch.finPhaseAttribute.needsUpdate = true;
    }
  }

  update();
  return {
    update,
    dispose() {
      for (const renderer of bespoke.values()) renderer.dispose();
      for (const batch of batches.values()) {
        scene.remove(batch.bodies, batch.membranes);
        batch.geometry.body.dispose();
        batch.geometry.fins.dispose();
        batch.skin.dispose();
        batch.fins.dispose();
        batch.depth.dispose();
      }
    },
  };
}
