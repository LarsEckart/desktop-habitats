import { register } from "node:module";
import assert from "node:assert/strict";
register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { createFishSchool, COUNT } = await import("../src/fish.js");
const { createPopulation, parse, serialize, CAPACITY, STOCKED_COUNT } = await import("../src/tank-state.js");
const { breedMany } = await import("../src/breeding.js");
const { bloodfinTetra, pygmyCory, marbledHatchetfish } = await import("../src/fish-species.js");

const KEYS = ["bloodfin-tetra", "pygmy-corydoras", "honey-gourami", "marbled-hatchetfish"];
const FRESH = { "bloodfin-tetra": 8, "pygmy-corydoras": 9, "honey-gourami": 1, "marbled-hatchetfish": 6 };
assert.equal(Object.values(FRESH).reduce((a, b) => a + b) - FRESH["bloodfin-tetra"], STOCKED_COUNT);

// Species on the shared rig need their own shape, not a tinted tetra: the cory a low
// armored body, short fins and barbels; the hatchetfish a deep thin keel and wing-like
// pectorals. The gourami's actual geometry belongs to its bespoke renderer and is checked
// on the constructed scene below.
const tetraMesh = bloodfinTetra.createAnatomy();
const coryMesh = pygmyCory.createAnatomy();
const hatchetMesh = marbledHatchetfish.createAnatomy();
function partRange(geometry, part) {
  const position = geometry.getAttribute("position");
  const parts = geometry.getAttribute("aPart");
  const ys = [], xs = [], zs = [];
  for (let i = 0; i < parts.count; i++) if (parts.getX(i) === part) {
    ys.push(position.getY(i));
    xs.push(position.getX(i));
    zs.push(Math.abs(position.getZ(i)));
  }
  return { count: ys.length, low: Math.min(...ys), high: Math.max(...ys), rear: Math.min(...xs), width: Math.max(...zs) };
}
assert.ok(partRange(coryMesh.fins, 3).rear < partRange(tetraMesh.fins, 3).rear - 0.02,
  "cory anal fin sits near the tail");
assert.ok(partRange(coryMesh.fins, 2).high > partRange(tetraMesh.fins, 2).high,
  "cory dorsal spine rises above the tetra fin");
assert.ok(partRange(coryMesh.fins, 1).rear > partRange(tetraMesh.fins, 1).rear + 0.02,
  "cory tail is shorter than the tetra's fork");
for (const mesh of [tetraMesh, hatchetMesh])
  assert.equal(partRange(mesh.body, 13).count, 0, "only corys grow barbels");
const whiskers = coryMesh.body;
const parts = whiskers.getAttribute("aPart");
const positions = whiskers.getAttribute("position");
const progress = whiskers.getAttribute("aFinProgress");
const roots = [], tips = [];
for (let i = 0; i < parts.count; i++) if (parts.getX(i) === 13) {
  const point = [positions.getX(i), positions.getY(i), positions.getZ(i)];
  if (progress.getX(i) === 0) roots.push(point);
  if (progress.getX(i) === 1) tips.push(point);
}
assert.equal(roots.length, 4 * 7, "two pairs, each with seven root vertices");
assert.equal(tips.length, roots.length);
assert.ok(roots.every(([x, y]) => x > 0.31 && y < -0.02), "whiskers root by the mouth");
assert.ok(tips.every(([x, y]) => x > 0.34 && y < -0.06), "whiskers reach forward and down");
assert.ok(tips.some(([, , z]) => z > 0.05) && tips.some(([, , z]) => z < -0.05));
assert.equal(partRange(coryMesh.fins, 13).count, 0, "barbels use the opaque mesh");

// The hatchetfish keel hangs far below a tetra's belly and thins toward its edge; the
// back stays where the tetra's is; the pectorals sweep up above the back.
const tetraBody = partRange(tetraMesh.body, 0), hatchetBody = partRange(hatchetMesh.body, 0);
assert.ok(hatchetBody.low < tetraBody.low - 0.12, `keel reaches ${hatchetBody.low} vs ${tetraBody.low}`);
assert.ok(Math.abs(hatchetBody.high - tetraBody.high) < 0.015, "the back stays straight and level");
assert.ok(hatchetBody.width <= tetraBody.width, "the keel adds no width");
assert.ok(partRange(hatchetMesh.fins, 4).high > tetraBody.high + 0.08, "pectoral wings rise over the back");
assert.ok(partRange(hatchetMesh.fins, 4).high > partRange(tetraMesh.fins, 4).high + 0.15);
assert.ok(partRange(hatchetMesh.fins, 3).low < partRange(tetraMesh.fins, 3).low - 0.05, "anal fin follows the keel down");
assert.ok(partRange(hatchetMesh.fins, 2).rear < partRange(tetraMesh.fins, 2).rear - 0.08, "dorsal sits far back");
assert.equal(partRange(hatchetMesh.fins, 12).count, 0, "hatchetfish have no adipose fin");
// The eye and mouth keep their place: the keel deformation starts below them.
for (const part of [7, 8, 9, 11]) {
  const a = partRange(tetraMesh.body, part), b = partRange(hatchetMesh.body, part);
  assert.ok(Math.abs(a.low - b.low) < 0.004 && Math.abs(a.high - b.high) < 0.004, `part ${part} is left alone`);
}
for (const mesh of [tetraMesh, coryMesh, hatchetMesh]) {
  mesh.body.dispose();
  mesh.fins.dispose();
}

const scene = new THREE.Scene();
const school = createFishSchool(scene, { stockNewSpecies: true });
const counts = (s) => Object.fromEntries(KEYS.map((key) => [key, s.fish.filter((fish) => fish.species === key).length]));
assert.deepEqual(counts(school), FRESH);
assert.equal(scene.getObjectByName("Pygmy corydoras").count, 9);
assert.ok(scene.getObjectByName("Honey gourami bespoke rig"),
  "the gourami renders through its species-owned rig rather than an instanced batch");
assert.ok(scene.getObjectByName("Honey gourami articulated dorsal fin"));
assert.ok(scene.getObjectByName("Honey gourami left pectoral fin"));
assert.equal(scene.getObjectByName("Marbled hatchetfish").count, 6);
assert.ok(school.fish.filter((f) => f.species === "pygmy-corydoras").every((f) => f.position.y < 2));
assert.ok(school.fish.filter((f) => f.species === "marbled-hatchetfish").every((f) => f.position.y > 6.5),
  "hatchetfish start just under the surface");
// Each species uses the shared rig in its own way (fish-species.js behaviour profiles).
// Two and a half undisturbed minutes: hatchetfish keep to the top of the water and hang
// nearly still on their pectorals; corys keep low, come to rest on the sand and go up
// for air; the gourami sculls slowly and never perches; the tetras swim as they always
// have (fish-behavior.mjs holds that run to its own numbers).
const { groundHeight } = await import("../src/math.js");
const tally = Object.fromEntries(KEYS.map((key) => [key, {
  frames: 0, speed: 0, strokes: 0, perched: 0, lying: 0, levelLying: 0, breathed: 0,
  lowest: Infinity, highest: -Infinity, surfaced: false, sculled: 0, high: 0,
}]));
let hatchetsUnderFilm = 0;
for (let i = 0; i < 60 * 150; i++) {
  school.update(1 / 60, i / 60, null);
  for (const f of school.fish) {
    const s = tally[f.species];
    const above = f.position.y - groundHeight(f.position.x, f.position.z);
    s.frames++;
    s.speed += f.velocity.length();
    if (f.stroke) s.strokes++;
    if (f.scull > 0.5) s.sculled++;
    if (f.mode === "perch") s.perched++;
    if (f.held) {
      assert.ok(above < 0.16, `a fish lying on the sand has its belly on it (${above})`);
      s.lying++;
      if (Math.abs(Math.asin(f.heading.y)) < 0.2) s.levelLying++;
      assert.ok(f.velocity.length() < 0.15, `a fish lying on the sand is still: ${f.velocity.length()}`);
    }
    if (f.breathing) s.breathed++;
    // Up out of the low water without being on the way to the film: coming back down
    // from a breath is the only reason a cory should be found here.
    if (f.position.y > 3.6 && !f.breathing) s.high++;
    if (f.position.y > 7.0) s.surfaced = true;
    s.lowest = Math.min(s.lowest, above);
    s.highest = Math.max(s.highest, f.position.y);
    assert.ok(above > 0.05, `${f.species} never sinks into the sand (${above})`);
  }
  if (school.fish.some((f) => f.species === "marbled-hatchetfish" && f.position.y > 7.0)) hatchetsUnderFilm++;
}
const tetra = tally["bloodfin-tetra"], cory = tally["pygmy-corydoras"];
const gourami = tally["honey-gourami"], hatchet = tally["marbled-hatchetfish"];
const mean = (s) => s.speed / s.frames;
const share = (s, k) => s[k] / s.frames;
// The hatchetfish: high, still, and not beating its tail to stay there.
const hatchets = school.fish.filter((f) => f.species === "marbled-hatchetfish");
assert.ok(hatchets.every((f) => f.position.y > 5.8), `hatchetfish stay high: ${hatchets.map((f) => f.position.y.toFixed(2))}`);
assert.ok(hatchet.lowest > 5.5, `no hatchetfish ever left the upper water (${hatchet.lowest})`);
assert.ok(hatchetsUnderFilm > 60 * 150 * 0.8, "a hatchetfish is hanging right under the film nearly all the time");
assert.ok(mean(hatchet) < 0.6 * mean(tetra), `hatchetfish hang nearly still: ${mean(hatchet).toFixed(3)} vs tetra ${mean(tetra).toFixed(3)}`);
assert.ok(share(hatchet, "strokes") < 0.5 * share(tetra, "strokes"), `hatchetfish tails mostly rest: ${share(hatchet, "strokes").toFixed(3)} vs ${share(tetra, "strokes").toFixed(3)}`);
assert.ok(share(hatchet, "sculled") > 0.1, "hatchetfish trim on their pectorals");
assert.equal(hatchet.perched, 0, "hatchetfish never rest on the sand");
// The corys: low, on the sand for a real share of the time, level when lying, and up for
// a gulp of air at least once between them.
assert.ok(share(cory, "high") < 0.12, `corys keep to the low water except for air (${share(cory, "high").toFixed(3)} of the time high)`);
assert.ok(share(cory, "perched") > 0.05, `corys rest on the sand: ${share(cory, "perched").toFixed(3)}`);
assert.ok(share(cory, "lying") > 0.03, `corys actually get their bellies down: ${share(cory, "lying").toFixed(3)}`);
assert.ok(cory.levelLying > 0.9 * cory.lying, "a cory lies level on the sand");
assert.ok(cory.lowest < 0.1 && cory.lowest > 0.05, `a resting cory's belly is on the substrate (${cory.lowest})`);
assert.ok(cory.breathed > 0 && cory.surfaced, "a cory went up for air");
assert.ok(share(cory, "strokes") < 0.6 * share(tetra, "strokes"), "corys scull more than they stroke");
// The gourami: slow, sculling, never perching. The tetras: unchanged rig, no sculling.
assert.ok(mean(gourami) < mean(tetra), "the gourami is the slower fish");
assert.equal(gourami.perched, 0, "the gourami never rests on the sand");
assert.ok(share(gourami, "sculled") > 0.2, "the gourami sculls on its pectorals");
assert.equal(tetra.perched, 0);
assert.equal(tetra.sculled, 0, "a tetra has no pectoral drive");
assert.ok(tetra.lowest > 0.5, "tetras keep their ground clearance");
assert.ok(school.getTelemetry().states.perch >= 0 && "breathing" in school.getTelemetry());
const saved = parse(serialize(school.snapshotPopulation()));
assert.ok(saved);
assert.equal(saved.stocked, undefined, "the save carries no stocking flag");
const restored = createFishSchool(new THREE.Scene(), { population: saved, stockNewSpecies: true });
assert.equal(restored.fish.length, school.fish.length, "restoring does not add another group");
assert.deepEqual(restored.snapshotPopulation().fish.map((f) => f.id), saved.fish.map((f) => f.id));
restored.dispose();

const old = createPopulation({ count: 24 });
const upgraded = createFishSchool(new THREE.Scene(), { population: old, stockNewSpecies: true });
assert.equal(upgraded.fish.length, 24 + STOCKED_COUNT);
assert.equal(upgraded.fish.length, CAPACITY);
assert.deepEqual(upgraded.fish.slice(0, 24).map((f) => f.sid), old.fish.map((f) => f.id));
upgraded.dispose();
assert.ok(COUNT >= CAPACITY);

// A tank saved before hatchetfish existed (with the earlier stocking flag and a turtle
// record still on disk) keeps every resident and gains only the hatchetfish group.
const earlier = createFishSchool(new THREE.Scene(), { stockNewSpecies: true });
const earlierSave = JSON.parse(serialize(earlier.snapshotPopulation()));
earlierSave.fish = earlierSave.fish.filter((f) => f.species !== "marbled-hatchetfish");
earlierSave.stocked = true;
earlierSave.turtle = { id: "old-turtle", hunger: 0.4, feedIn: 12, retryIn: 0 };
earlier.dispose();
const parsedEarlier = parse(JSON.stringify(earlierSave));
assert.ok(parsedEarlier && !("turtle" in parsedEarlier) && !("stocked" in parsedEarlier), "old turtle fields are dropped");
const gained = createFishSchool(new THREE.Scene(), { population: parsedEarlier, stockNewSpecies: true });
assert.deepEqual(counts(gained), FRESH);
assert.deepEqual(gained.fish.slice(0, 18).map((f) => f.sid), earlierSave.fish.map((f) => f.id), "existing residents keep their ids and order");
gained.dispose();

// A test school that never asks for stocking keeps exactly the population it was given.
const plain = createFishSchool(new THREE.Scene(), { population: createPopulation({ count: 5 }) });
assert.equal(plain.fish.length, 5);
plain.dispose();

const solo = { breedIn: 0, fish: [{ id: "g", species: "honey-gourami", age: 9000, breedIn: 0, adult: true }] };
assert.equal(breedMany(solo, 1).born, false, "a lone gourami cannot breed itself into a group");
const wings = { breedIn: 0, fish: Array.from({ length: 6 }, (_, i) => ({ id: `h${i}`, species: "marbled-hatchetfish", age: 9000, breedIn: 0, adult: true })) };
assert.equal(breedMany(wings, 1).born, false, "the hatchetfish group stays the size it was stocked at");
school.dispose();
console.log("PASS: mixed fish stocking, shared batches plus bespoke gourami rig, per-species behaviour (still hatchetfish under the film, corys resting on the sand and surfacing for air, a slow sculling gourami), old saves, no restocking");
