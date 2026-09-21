# Fish babies and growth

Status: Draft
Dependencies: [Fish state and saving](issue-01-fish-state-and-saving.md)

## Goal

Start new tanks with fewer fish and let the population grow slowly through visible babies.

## Scope

- Choose a smaller starting population for new tanks; do not remove fish from existing saves.
- Let eligible adults produce babies after a breeding cooldown, provided the tank has room.
- Keep breeding simple: no sexes, genetics, eggs, or mate-pair simulation in this first version.
- Spawn small fish near an adult and grow them smoothly into adults over running simulation time.
- Make body size matter for spacing, movement bounds, and feeding reach.
- Cap the population and limit birth frequency so the tank stays calm and within its render budget.
- Save growth and breeding state so restarting cannot trigger extra births or reset progress.
- Keep starting count, population cap, maturity age, growth duration, and cooldowns easy to tune.

## Acceptance checks

- [ ] A new tank starts with fewer fish than the current 24.
- [ ] Existing saves keep their fish.
- [ ] Only mature fish can breed, and babies visibly grow before becoming eligible.
- [ ] Births never exceed the population cap, including when several adults become eligible together.
- [ ] Fish retain growth and breeding progress after restart.
- [ ] Growth and breeding stop whenever the simulation stops; there is no offline catch-up.
- [ ] Babies swim, avoid neighbours, and feed without size-related glitches.
- [ ] Tests use a controlled clock and random source to cover maturity, cooldowns, save/restore, and the cap.
- [ ] Check the scene at the cap in both preview and wallpaper modes for visual crowding and frame cost.

## Out of scope

Old-age deaths, illness, food-dependent survival, genetics, and predators. Age supports growth, not a care obligation.

## Tuning

Choose exact counts and timings during a visual trial. Births should feel like occasional discoveries, not a rapid spawning effect.
