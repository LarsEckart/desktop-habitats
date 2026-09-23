import { register } from "node:module";
import assert from "node:assert/strict";
register("./three-loader.mjs", import.meta.url);
const THREE = await import("three");
const { createFishSchool, COUNT } = await import("../src/fish.js");
const { createPopulation, parse, serialize } = await import("../src/tank-state.js");
const { breedMany } = await import("../src/breeding.js");
const { bloodfinTetra, pygmyCory, honeyGourami } = await import("../src/fish-species.js");

// The gourami needs a long dorsal, a broad anal skirt and two pelvic feelers,
// not a tinted copy of the tetra's fin mesh.
const tetraMesh = bloodfinTetra.createAnatomy();
const coryMesh = pygmyCory.createAnatomy();
const gouramiMesh = honeyGourami.createAnatomy();
function partRange(geometry, part) {
  const position = geometry.getAttribute("position");
  const parts = geometry.getAttribute("aPart");
  const ys = [], xs = [];
  for (let i = 0; i < parts.count; i++) if (parts.getX(i) === part) {
    ys.push(position.getY(i));
    xs.push(position.getX(i));
  }
  return { count: ys.length, low: Math.min(...ys), high: Math.max(...ys), rear: Math.min(...xs) };
}
assert.ok(partRange(gouramiMesh.fins, 2).rear < partRange(tetraMesh.fins, 2).rear - 0.1);
assert.ok(partRange(coryMesh.fins, 3).rear < partRange(tetraMesh.fins, 3).rear - 0.02,
  "cory anal fin sits near the tail");
assert.ok(partRange(coryMesh.fins, 2).high > partRange(tetraMesh.fins, 2).high,
  "cory dorsal spine rises above the tetra fin");
assert.ok(partRange(coryMesh.fins, 1).rear > partRange(tetraMesh.fins, 1).rear + 0.02,
  "cory tail is shorter than the tetra's fork");
assert.ok(partRange(gouramiMesh.fins, 3).low < partRange(tetraMesh.fins, 3).low);
assert.ok(partRange(gouramiMesh.body, 6).low < -0.3, "pelvic feelers reach below the belly");
assert.equal(partRange(gouramiMesh.fins, 12).count, 0, "gouramis have no adipose fin");
for (const mesh of [tetraMesh, gouramiMesh])
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
for (const mesh of [tetraMesh, coryMesh, gouramiMesh]) {
  mesh.body.dispose();
  mesh.fins.dispose();
}

const scene = new THREE.Scene();
const school = createFishSchool(scene, { stockNewSpecies: true });
const counts = () => Object.fromEntries(["bloodfin-tetra", "pygmy-corydoras", "honey-gourami"].map(
  (key) => [key, school.fish.filter((fish) => fish.species === key).length],
));
assert.deepEqual(counts(), { "bloodfin-tetra": 8, "pygmy-corydoras": 9, "honey-gourami": 1 });
assert.equal(scene.getObjectByName("Pygmy corydoras").count, 9);
assert.equal(scene.getObjectByName("Honey gourami").count, 1);
assert.ok(school.fish.filter((f) => f.species === "pygmy-corydoras").every((f) => f.position.y < 2));
const saved = parse(serialize(school.snapshotPopulation()));
assert.ok(saved);
const restored = createFishSchool(new THREE.Scene(), { population: saved, stockNewSpecies: true });
assert.equal(restored.fish.length, school.fish.length, "restoring does not add another group");
assert.deepEqual(restored.snapshotPopulation().fish.map((f) => f.id), saved.fish.map((f) => f.id));
restored.dispose();

const old = createPopulation({ count: 24 });
const upgraded = createFishSchool(new THREE.Scene(), { population: old, stockNewSpecies: true });
assert.equal(upgraded.fish.length, 34);
assert.deepEqual(upgraded.fish.slice(0, 24).map((f) => f.sid), old.fish.map((f) => f.id));
upgraded.dispose();

const cory = school.fish.find((f) => f.species === "pygmy-corydoras");
assert.ok(school.remove(cory.sid));
assert.equal(scene.getObjectByName("Pygmy corydoras").count, 8);
assert.equal(school.snapshotPopulation().fish.length, 17);
assert.equal(school.fish.length, 17);
assert.ok(COUNT >= 34);
// The tank remembers it was stocked even if its lone gourami is taken.
const lone = school.fish.find((f) => f.species === "honey-gourami");
assert.ok(school.remove(lone.sid));
const afterLoss = parse(serialize(school.snapshotPopulation()));
const noReturn = createFishSchool(new THREE.Scene(), { population: afterLoss, stockNewSpecies: true });
assert.equal(noReturn.fish.filter((f) => f.species === "honey-gourami").length, 0);
noReturn.dispose();
const solo = { breedIn: 0, fish: [{ id: "g", species: "honey-gourami", age: 9000, breedIn: 0, adult: true }] };
assert.equal(breedMany(solo, 1).born, false, "a lone gourami cannot breed itself into a group");
school.dispose();
console.log("PASS: mixed fish stocking, separate batches, old saves, removal, lone gourami");
