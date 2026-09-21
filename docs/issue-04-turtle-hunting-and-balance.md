# Turtle hunting and ecosystem balance

Status: Draft
Dependencies:
- [Fish state and saving](issue-01-fish-state-and-saving.md)
- [Babies and growth](issue-02-babies-and-growth.md)
- [Snapping turtle](issue-03-snapping-turtle.md)

## Goal

Let the turtle watch and stalk prey, then make a quick, visible neck strike. Keep the tank alive without requiring care from the user.

## Scope

- Add a hunt cycle: rest, get hungry, track prey, creep or wait within reach, snap, and settle.
- Increase hunger only during running simulation time. A successful hunt lowers hunger and starts a feeding cooldown.
- Select a suitably sized nearby fish and turn the head toward it before striking.
- Use a short head/neck lunge, not a chase across the whole tank.
- Resolve the catch at the strike moment using actual reach and prey position. Allow misses and use a retry cooldown.
- Remove caught fish from both the simulation and saved population exactly once.
- Make nearby fish scatter at the snap, whether it hits or misses.
- Stop hunting at a protected minimum fish count. Check that limit again when resolving a strike.
- Tune births, hunger, and cooldowns together so hunts and births remain rare and the population can recover.
- Save hunger and cooldown progress. On reload, return any unfinished hunt to a safe state without granting a catch.
- Keep feeding gentle and non-graphic: no blood or remains.

## Acceptance checks

- [ ] The user can see prey tracking followed by a fast strike and a return to rest.
- [ ] A fish is caught only if it is still present and within reach when the strike resolves.
- [ ] A fish that escapes produces a visible miss; the turtle does not snap again immediately.
- [ ] Nearby fish scatter on both hits and misses.
- [ ] A successful hunt removes one fish and lowers hunger once.
- [ ] Hunting never reduces the population below the protected minimum.
- [ ] Missing or invalid prey cancels the hunt safely.
- [ ] Pausing, closing, or stopping rendering does not advance hunger or trigger catch-up hunts.
- [ ] Reloading during a hunt cannot duplicate a catch or bypass a cooldown.
- [ ] Tests cover hunt transitions, reach, misses, prey loss, minimum population, and save/restore.
- [ ] Run a long, accelerated simulation across several random seeds to check that births and hunts stay within population limits.
- [ ] Review real-time pacing, strike clarity, scattering, and frame cost in preview and wallpaper modes.

## Out of scope

Long pursuit chases, turtle starvation or death, multiple predators, offline simulation, and a fully realistic food chain.

## Tuning

Pick hunger rate, prey-size limits, strike reach, cooldowns, and minimum population through tests and visual trials. The turtle should make the tank feel alive, not turn the background into constant combat.
