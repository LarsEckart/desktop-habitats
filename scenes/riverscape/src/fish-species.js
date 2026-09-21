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
