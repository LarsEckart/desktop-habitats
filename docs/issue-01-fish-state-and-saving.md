# Fish state and saving

Status: Draft
Dependencies: None

## Goal

Keep the same fish when the aquarium restarts. Add the state needed for later growth and hunting without changing today's fish behavior.

## Scope

- Give each fish a stable ID and record its species and age in running simulation time.
- Separate saved fish data from meshes and other render-only objects.
- Save and restore each tank's population locally in the browser preview and Mac wallpaper.
- Version the save format and handle missing, invalid, or unsupported saves safely.
- Keep tanks on separate displays independent. Define how a tank is matched to a display after restart or reconnection.
- Save at sensible intervals and lifecycle points, not every frame.
- Advance age only while the simulation runs. Do not catch up for time spent closed, paused, asleep, or with rendering stopped.

## Acceptance checks

- [ ] A fresh tank keeps the current population and behavior.
- [ ] Restarting restores fish IDs, species, and ages without duplicates.
- [ ] Each display restores its own tank without overwriting another tank.
- [ ] A missing or invalid save starts a usable tank without crashing; storage failures do not stop the scene.
- [ ] Pausing or closing the app does not advance age on return.
- [ ] Existing swimming, feeding, cursor reactions, and power controls still work.
- [ ] Tests cover save round trips, invalid data, and the simulation clock.

## Out of scope

Births, growth visuals, deaths, predators, exact replay of swimming positions, and offline simulation.

## Implementation decisions to resolve

Choose the local storage path for each host and the display-to-tank mapping. Check that wallpaper reinstall/update does not unintentionally reset the population.
