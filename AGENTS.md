
### Verification workbench

Use `npm run verify` for all named scenarios, or `npm run verify -- --scenario fresh,growth`
for a short first review of the stocked tank and growth. These start a separate Chrome
profile and collect real scene clips, screenshots, state checks, and a local feedback page. `npm run verify:checks` saves test
logs; `npm run verify:performance` measures paced runs separately from recording.

For real Mac-host checks, `sh wallpaper/dev.sh run` builds and starts a separate, windowed
**Desktop Habitats Dev** app with its own saves. It does not replace or stop your installed
wallpaper or add a login item.

See [the verification guide](docs/verification.md) for commands, save isolation, the
16-check acceptance map, and the physical-display tests that still need a person.
