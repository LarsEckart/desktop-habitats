import {
  applySkin,
  createFishMaterials,
  makeAnatomy,
  SNOUT_X,
  STANDARD_LENGTH,
} from "./fish-anatomy.js";

// A species owns everything that makes a fish look like its species, and a behaviour
// profile for how it uses the shared swimming rig. The school owns the rig itself: the
// physics, the modes, the senses. New species can provide their own anatomy, skin and
// profile without teaching the school about their fins, colours, or eyes.
// `key` is the stable identifier a saved population refers to: it must stay fixed even
// if the display name or shader changes.
// Each species has its own mesh batch and skin, while sharing the swim rig.

// The bloodfin's way of moving is the rig's default, and every other species is written
// as a difference from it. Every number here is read by fish.js and nowhere else.
export const DEFAULT_BEHAVIOUR = Object.freeze({
  // Cruising speed, as a fraction of the shared tetra cruise.
  cruise: 1,
  // Tail gait: strokes per second while a bout is on, and the glide between bouts.
  gait: Object.freeze({ frequency: 3.2, coast: [0.32, 0.65] }),
  // Forward acceleration the pectorals alone can supply. Any demand up to this is met by
  // sculling with the body held straight; only demand beyond it fires a tail stroke.
  // Zero means every bit of forward drive is a tail stroke, which is how a tetra swims.
  pectoralThrust: 0,
  // How quickly (seconds) a hovering fish's station follows the fish itself. Infinity
  // holds a fixed station the fish keeps trimming back to.
  stationDrift: 10,
  // How long, relative to the tetra, a fish holds station before an excursion, and how
  // often a fish arriving somewhere sets straight off again instead of stopping there.
  patience: 1,
  wander: 0.72,
  // The vertical band the species lives in, or null for the whole water column. A fish
  // outside it is drawn gently back unless it is feeding or going up for air. `reach`,
  // for a banded species, is how far one move takes it; null crosses the whole tank.
  band: null,
  reach: null,
  // Whether the fish rests on the sand between moves, and for how long.
  perch: null,
  // Whether the fish goes to look at landmarks and the planting.
  visits: true,
  // Whether it keeps loose company with its own kind.
  shoals: true,
  // Startle: how hard a looming thing has to come on before the fish fires a C-start
  // (lower is jumpier), and how much harder than a tetra the dart after it is.
  startle: Object.freeze({ threshold: 1, burst: 1 }),
  // Mean seconds between trips to the surface for a gulp of air, 0 for a fish that never
  // does, and how much faster than its cruise the trip is made.
  breath: Object.freeze({ interval: 0, hurry: 1 }),
});

// Deep-merge a species' overrides onto the defaults, so a profile only has to name what
// differs.
function behaviourOf(overrides = {}) {
  const merged = { ...DEFAULT_BEHAVIOUR, ...overrides };
  for (const key of ["gait", "startle", "breath", "perch", "band"])
    if (overrides[key] && DEFAULT_BEHAVIOUR[key])
      merged[key] = { ...DEFAULT_BEHAVIOUR[key], ...overrides[key] };
  return Object.freeze(merged);
}
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
     // The bold line runs from the snout through the eye to a spot at the tail base,
     // with a thinner second line along the lower flank, as on Corydoras pygmaeus.
     float stripe = (1.0 - smoothstep(0.035, 0.095, abs(fishBand - 0.49)))
       * smoothstep(-0.31, -0.24, fishX);
     float spot = 1.0 - smoothstep(0.02, 0.06, length(vec2((fishX + 0.275) * 0.6, fishBand - 0.49)));
     float lower = (1.0 - smoothstep(0.012, 0.03, abs(fishBand - 0.72)))
       * smoothstep(-0.2, -0.1, fishX) * (1.0 - smoothstep(0.1, 0.2, fishX)) * 0.55;
     diffuseColor.rgb = mix(cory, vec3(0.067, 0.066, 0.051), min(1.0, stripe * 0.92 + spot + lower));`,
  ).replace(
    "diffuseColor.rgb = mix(membrane, vec3(0.400, 0.052, 0.020), pigment);",
    "diffuseColor.rgb = mix(membrane, vec3(0.40, 0.36, 0.28), pigment);",
  );
}

// Corydoras pygmaeus is the odd one out in its genus: it hovers in midwater in a shoal,
// sculling on its pectorals, and perches, on the sand and on leaves, between short quick
// hops. The bursts are fast little flutters rather than a tetra's long strokes, and like
// every cory it dashes to the surface now and then for a gulp of air.
export const pygmyCory = {
  key: "pygmy-corydoras",
  shaderKey: "pygmy-corydoras",
  name: "Pygmy corydoras",
  measurements: { snoutX: SNOUT_X * 0.75, standardLength: STANDARD_LENGTH * 0.75 },
  proportions: [0.75, 0.82, 0.9],
  createAnatomy: () => makeAnatomy({ cory: true }),
  createMaterials: createFishMaterials,
  applySkin: corySkin,
  behaviour: behaviourOf({
    cruise: 0.78,
    gait: { frequency: 4.6, coast: [0.45, 1.1] },
    pectoralThrust: 0.55,
    patience: 1.4,
    wander: 0.25,
    band: { minY: 0.7, maxY: 3.0 },
    // A rest lasts a while, and a fish leaving one usually only hops to the next.
    perch: { chance: 0.7, duration: [8, 30], hop: 0.65, hopRange: [0.9, 2.6] },
    visits: false,
    breath: { interval: 110, hurry: 1.8 },
  }),
};

// A male honey gourami in colour: honey-orange over the body, a dark blue-black throat
// and belly running back under the anal fin, a paler back, and yellow-edged fins.
function gouramiSkin(shader) {
  applySkin(shader);
  shader.fragmentShader = shader.fragmentShader.replace(
    "diffuseColor.rgb = skin;",
    `vec3 honey = mix(vec3(0.85, 0.34, 0.055), vec3(0.62, 0.36, 0.14), 1.0 - smoothstep(0.1, 0.4, fishBand));
     float throat = smoothstep(0.52, 0.72, fishBand) * smoothstep(-0.28, -0.1, fishX) * (1.0 - smoothstep(0.3, 0.36, fishX));
     honey = mix(honey, vec3(0.05, 0.06, 0.12), throat * 0.85);
     diffuseColor.rgb = mix(skin, honey, 0.9);`,
  ).replace(
    "diffuseColor.rgb = mix(membrane, vec3(0.400, 0.052, 0.020), pigment);",
    "diffuseColor.rgb = mix(membrane, mix(vec3(0.85, 0.36, 0.06), vec3(0.95, 0.75, 0.2), vFishUV.y), pigment);",
  ).replaceAll("vec3(0.400, 0.052, 0.020)", "vec3(0.85, 0.36, 0.06)");
}

export const honeyGourami = {
  key: "honey-gourami",
  shaderKey: "honey-gourami",
  name: "Honey gourami",
  measurements: { snoutX: SNOUT_X * 1.35, standardLength: STANDARD_LENGTH * 1.35 },
  proportions: [1.35, 1.8, 1.2],
  createAnatomy: () => makeAnatomy({ gourami: true }),
  createMaterials: createFishMaterials,
  applySkin: gouramiSkin,
  // A slow, deliberate fish that sculls on its pectorals, keeps its own company, and
  // rises calmly to the film to breathe. It is not a shoaler and not a percher.
  behaviour: behaviourOf({
    cruise: 0.6,
    gait: { frequency: 2.4, coast: [0.5, 1.3] },
    pectoralThrust: 0.45,
    patience: 1.6,
    wander: 0.5,
    shoals: false,
    breath: { interval: 150, hurry: 1 },
  }),
};

function hatchetSkin(shader) {
  applySkin(shader);
  shader.fragmentShader = shader.fragmentShader.replace(
    "diffuseColor.rgb = skin;",
    `// A silver body, olive-brown over the straight back, with brown-black marbling in
     // oblique bands down the keel, a pale gold line above the bands and a dark keel edge.
     float back = 1.0 - smoothstep(0.06, 0.28, fishBand);
     vec3 silver = mix(vec3(0.66, 0.67, 0.62), vec3(0.24, 0.22, 0.15), back);
     silver = mix(silver, vec3(0.82, 0.80, 0.72), smoothstep(0.62, 0.96, fishBand));
     float flank = smoothstep(0.36, 0.48, fishBand) * (1.0 - smoothstep(0.98, 1.0, fishBand))
       * (1.0 - smoothstep(0.22, 0.30, fishX)) * smoothstep(-0.30, -0.22, fishX);
     float diag = fishBand * 1.6 + fishX * 5.5;
     float marble = smoothstep(0.26, 0.38, abs(fract(diag) - 0.5)) * flank;
     vec3 hatchet = mix(silver, vec3(0.17, 0.13, 0.085), marble * 0.9);
     float goldLine = exp(-pow((fishBand - 0.40) / 0.022, 2.0)) * (1.0 - smoothstep(0.24, 0.31, fishX));
     hatchet = mix(hatchet, vec3(0.86, 0.74, 0.44), goldLine * 0.7);
     float keelEdge = smoothstep(0.955, 0.995, fishBand) * (1.0 - smoothstep(0.22, 0.30, fishX));
     hatchet = mix(hatchet, vec3(0.14, 0.12, 0.09), keelEdge * 0.8);
     diffuseColor.rgb = hatchet;`,
  ).replace(
    "diffuseColor.rgb = mix(membrane, vec3(0.400, 0.052, 0.020), pigment);",
    "diffuseColor.rgb = mix(membrane, vec3(0.34, 0.33, 0.28), pigment);",
  ).replaceAll("vec3(0.400, 0.052, 0.020)", "vec3(0.34, 0.33, 0.28)");
}

// Carnegiella strigata, a surface fish: a deep, thin keeled chest, a straight back and
// wing-like pectorals held up over the body. About 35 mm to the tetra's 40.
export const marbledHatchetfish = {
  key: "marbled-hatchetfish",
  shaderKey: "marbled-hatchetfish",
  name: "Marbled hatchetfish",
  measurements: { snoutX: SNOUT_X * 0.9, standardLength: STANDARD_LENGTH * 0.9 },
  proportions: [0.9, 0.9, 0.9],
  createAnatomy: () => makeAnatomy({ hatchet: true }),
  createMaterials: createFishMaterials,
  applySkin: hatchetSkin,
  // Hangs nearly motionless right under the film on a fixed station, trimming with its
  // wing-like pectorals, and darts hard when anything startles it. The tail is for the
  // dart and for crossing the tank, not for holding position.
  behaviour: behaviourOf({
    cruise: 0.95,
    gait: { frequency: 4.0, coast: [0.6, 1.5] },
    pectoralThrust: 0.5,
    stationDrift: Infinity,
    patience: 2.8,
    wander: 0.2,
    band: { minY: 6.9, maxY: 7.7 },
    reach: [1.2, 4.5],
    visits: false,
    startle: { threshold: 0.6, burst: 1.6 },
  }),
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
  behaviour: DEFAULT_BEHAVIOUR,
};

export const speciesByKey = Object.freeze({
  [bloodfinTetra.key]: bloodfinTetra,
  [pygmyCory.key]: pygmyCory,
  [honeyGourami.key]: honeyGourami,
  [marbledHatchetfish.key]: marbledHatchetfish,
});
