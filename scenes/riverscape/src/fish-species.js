import {
  applySkin,
  createFishMaterials,
  makeAnatomy,
  SNOUT_X,
  STANDARD_LENGTH,
} from "./fish-anatomy.js";

// A species owns everything that makes a fish look like its species. The school owns
// only shared tank behaviour and rendering. New species can provide their own anatomy
// and skin functions without teaching the school about their fins, colours, or eyes.
// `key` is the stable identifier a saved population refers to: it must stay fixed even
// if the display name or shader changes.
// Each species has its own mesh batch and skin, while sharing the swim rig.
function colouredSkin(colour, strength, stripe = false) {
  return (shader) => {
    applySkin(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      "diffuseColor.rgb = skin;",
      `diffuseColor.rgb = mix(skin, vec3(${colour.join(", ")}), ${strength});
       ${stripe ? "diffuseColor.rgb *= 1.0 - 0.65 * (1.0 - smoothstep(0.025, 0.09, abs(vFishUV.y - 0.5)));" : ""}`,
    ).replaceAll("vec3(0.400, 0.052, 0.020)", `vec3(${colour.join(", ")})`);
  };
}

function corySkin(shader) {
  applySkin(shader);
  shader.fragmentShader = shader.fragmentShader.replace(
    "diffuseColor.rgb = skin;",
    `// A dark line runs from the gill cover to the tail over a pale, armored flank.
     float back = 1.0 - smoothstep(0.12, 0.37, fishBand);
     float belly = smoothstep(0.60, 0.92, fishBand);
     vec3 cory = mix(vec3(0.49, 0.45, 0.35), vec3(0.26, 0.25, 0.19), back);
     cory = mix(cory, vec3(0.71, 0.66, 0.53), belly);
     float stripe = (1.0 - smoothstep(0.035, 0.095, abs(fishBand - 0.49)))
       * smoothstep(-0.31, -0.24, fishX)
       * (1.0 - smoothstep(0.25, 0.31, fishX));
     diffuseColor.rgb = mix(cory, vec3(0.067, 0.066, 0.051), stripe * 0.92);`,
  ).replace(
    "diffuseColor.rgb = mix(membrane, vec3(0.400, 0.052, 0.020), pigment);",
    "diffuseColor.rgb = mix(membrane, vec3(0.40, 0.36, 0.28), pigment);",
  );
}

export const pygmyCory = {
  key: "pygmy-corydoras",
  shaderKey: "pygmy-corydoras",
  name: "Pygmy corydoras",
  measurements: { snoutX: SNOUT_X * 0.75, standardLength: STANDARD_LENGTH * 0.75 },
  proportions: [0.75, 0.82, 0.9],
  createAnatomy: () => makeAnatomy({ cory: true }),
  createMaterials: createFishMaterials,
  applySkin: corySkin,
};

export const honeyGourami = {
  key: "honey-gourami",
  shaderKey: "honey-gourami",
  name: "Honey gourami",
  measurements: { snoutX: SNOUT_X * 1.35, standardLength: STANDARD_LENGTH * 1.35 },
  proportions: [1.35, 1.8, 1.2],
  createAnatomy: () => makeAnatomy({ gourami: true }),
  createMaterials: createFishMaterials,
  applySkin: colouredSkin([0.85, 0.34, 0.055], 0.88),
};

export const bloodfinTetra = {
  key: "bloodfin-tetra",
  shaderKey: "bloodfin-tetra",
  name: "Bloodfin tetra",
  measurements: {
    snoutX: SNOUT_X,
    standardLength: STANDARD_LENGTH,
  },
  createAnatomy: makeAnatomy,
  createMaterials: createFishMaterials,
  applySkin,
};

export const speciesByKey = Object.freeze({
  [bloodfinTetra.key]: bloodfinTetra,
  [pygmyCory.key]: pygmyCory,
  [honeyGourami.key]: honeyGourami,
});
