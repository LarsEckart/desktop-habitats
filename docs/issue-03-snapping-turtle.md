# Add a bottom-dwelling snapping turtle

Status: Draft
Dependencies: [Fish state and saving](issue-01-fish-state-and-saving.md)
Related: [Babies and growth](issue-02-babies-and-growth.md) can ship independently of this issue.

## Goal

Add a recognizable snapping turtle that rests and moves slowly near the bottom. Establish its look and movement before adding hunting.

## Scope

- Build a turtle with a shell, head, neck, legs, and tail that fits the aquarium's visual style.
- Support independent head and neck movement for a later quick strike.
- Alternate between long rests and short, slow moves along the bottom.
- Keep the turtle within the tank and avoid obvious clipping through terrain, rocks, and wood.
- Save its identity and any lasting state needed to restore it with the tank.
- Add one turtle per tank, including existing tanks, without adding another on each restart.
- Respect pause, visibility, frame pacing, and reduced-motion behavior.

## Acceptance checks

- [ ] The turtle reads clearly as a snapping turtle at normal desktop scale.
- [ ] It rests near the bottom and sometimes moves to a new resting spot.
- [ ] Head and neck motion can support a short strike without moving the entire turtle across the tank.
- [ ] It stays within bounds and avoids obvious scenery clipping in a visual trial.
- [ ] Restarting keeps one turtle per tank, with no duplicates or lost fish.
- [ ] Fish continue their existing behavior; the turtle does not hunt yet.
- [ ] Tests cover movement bounds, rest/move transitions, and save/restore.
- [ ] Check visual quality and added frame cost in preview and wallpaper modes.

## Out of scope

Hunger, prey selection, fish deaths, turtle breeding, and long chases.

## Design note

Do not force the turtle into fish schooling behavior just to reuse code. Share only what fits, such as the simulation clock and saved-state support.
