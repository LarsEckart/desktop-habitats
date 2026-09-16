# Freshwater aquarium

A separate interactive 3D aquarium preview, inspired by the supplied aquascape. The scene uses WebGL2, GLSL materials, and persistent fish simulation. All rendering code, textures, and dependencies are included. It makes no network requests outside its local server and does not change desktop backgrounds or wallpaper settings.

## Open the preview

Unzip the package, open a terminal in the resulting folder, and run either:

```sh
npm start
```

This requires Node.js 20 or newer. No `npm install` is needed. Alternatively, with Python 3:

```sh
python3 -m http.server 8080 --bind 127.0.0.1
```

Open **http://localhost:8080** in a current browser with WebGL2 support. The entry point is `index.html`. Serve the folder over HTTP; directly double-clicking the HTML file will not load its JavaScript modules in browsers that restrict local files. Stop the server with Ctrl+C.

To use another port with Node:

```sh
PORT=8081 npm start
```

## Controls

- Move the pointer through the open water. Nearby fish can dart away, brake, and settle.
- **Space** pauses and resumes. A reduced-motion system preference starts the scene paused.
- **I** opens inspection controls; **F** toggles fullscreen.
- **Inspect → View** offers three closer views from the front of the tank.
- **Resolution** changes the number of rendered pixels. The default is 1.5 times the preview's CSS dimensions.
- **Measure 15 seconds** reports frame rate, frame-time tail, resolution, browser, and GPU.
- **Save image** downloads the current rendered frame.

The composition retains the reference aspect ratio. Controls fade when the pointer leaves the preview. There is no sound or camera orbit.

## Files

- `src/main.js`: camera, lighting, water-depth postprocessing, input, and preview controls.
- `src/environment.js`: terrain, rocks, driftwood, and suspended particles.
- `src/plants.js`: curved leaf surfaces, stems, attached foliage, and shared circulation.
- `src/fish.js`: fish anatomy, materials, deformation, and individual behavior.
- `vendor/`: pinned Three.js 0.180.0 runtime and its license.
- `assets/`: bundled surface maps and the supplied visual reference.
- `review/`: original request, independent critic report and captures, revision notes, and measured verification.

The renderer uses PBR materials, a broad overhead reflection environment, shadow mapping, sampled depth occlusion, leaf transmission approximations, and supersampling with multisample antialiasing. This is raster rendering; it does not calculate full path-traced light transport.

## Checks

```sh
npm run check
npm test
```

The behavior check simulates two minutes of tank motion, checks bounds and spacing, exercises local disturbance and recovery, and verifies that individuals use all four states without synchronization. It does not prove anatomical or photographic realism. See `review/verification.md` for the browser inspection and visual review outcome.

Material and library attribution is in `CREDITS.md`.
