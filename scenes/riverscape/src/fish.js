import { createFishSimulation } from "./fish-simulation.js";
import { createFishRenderer } from "./fish-renderer.js";

export { BOUNDS, createFishSimulation } from "./fish-simulation.js";
export { CAPACITY as COUNT } from "./tank-state.js";

// Compatibility façade for scene callers. The simulation owns all decisions and state;
// rendering only projects the latest pose into Three.js objects after each step.
export function createFishSchool(scene, options = {}) {
  const simulation = createFishSimulation(options);
  const renderer = createFishRenderer(scene, simulation, options);
  return {
    ...simulation,
    update(dt, time, pointer) {
      simulation.update(dt, time, pointer);
      renderer.update();
    },
    presentBespoke(mode) {
      const result = simulation.presentBespoke(mode);
      renderer.update();
      return result;
    },
    dispose: renderer.dispose,
  };
}
