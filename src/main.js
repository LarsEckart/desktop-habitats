import * as THREE from "three";
import { createEnvironment, createParticles } from "./environment.js";
import { createPlants } from "./plants.js";
import { createFishSchool } from "./fish.js";

const canvas = document.querySelector("#scene");
const aquarium = document.querySelector("#aquarium");
const loading = document.querySelector("#loading");
const inspection = document.querySelector("#inspection");
const pauseButton = document.querySelector("#pause");
let paused = matchMedia("(prefers-reduced-motion: reduce)").matches;
let resolution = 1.5;
let measuring = null;

function fail(error) {
  console.error(error);
  loading.hidden = true;
  const box = document.querySelector("#error");
  box.hidden = false;
  box.textContent = `The aquarium could not start. ${error.message} Serve this folder with “npm start” or “python3 -m http.server 8080”, then open http://localhost:8080 in a browser with WebGL2 enabled.`;
}

async function start() {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.17;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#04100e");
  scene.fog = new THREE.FogExp2("#071812", 0.026);
  const camera = new THREE.PerspectiveCamera(25.8, 1420 / 740, 0.2, 65);
  camera.position.set(0, 4.65, 20.5);
  camera.lookAt(0, 4.15, 0);

  scene.add(new THREE.HemisphereLight(0xc3d7bd, 0x353427, 0.42));
  const key = new THREE.DirectionalLight(0xfff8ee, 4.15);
  key.position.set(-3, 11.5, 4.4);
  key.target.position.set(0, 1, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, {
    left: -12,
    right: 12,
    top: 10,
    bottom: -10,
    near: 1,
    far: 27,
  });
  key.shadow.bias = -0.00012;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 3;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xc2d8e4, 0.44);
  fill.position.set(1, 5, 10);
  scene.add(fill);
  const back = new THREE.DirectionalLight(0xdbf9ba, 0.55);
  back.position.set(2, 10, -4);
  scene.add(back);

  // A compact HDR environment gives silver scales a broad overhead reflection.
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color("#253129");
  const strip = new THREE.Mesh(
    new THREE.PlaneGeometry(16, 4),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(3.7, 3.8, 3.4),
      side: THREE.DoubleSide,
    }),
  );
  strip.position.set(0, 6, 1);
  strip.rotation.x = Math.PI / 2;
  envScene.add(strip);
  const frontBounce = new THREE.Mesh(
    new THREE.PlaneGeometry(18, 8),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.24, 0.32, 0.29),
      side: THREE.DoubleSide,
    }),
  );
  frontBounce.position.z = 8;
  envScene.add(frontBounce);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(envScene, 0.025, 0.1, 30);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();
  strip.geometry.dispose();
  strip.material.dispose();
  frontBounce.geometry.dispose();
  frontBounce.material.dispose();

  const { obstacles } = await createEnvironment(scene);
  const plants = createPlants(scene);
  const fish = createFishSchool(scene, { obstacles });
  const particles = createParticles(scene);

  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const postScene = new THREE.Scene(),
    postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const post = new THREE.ShaderMaterial({
    uniforms: {
      beauty: { value: target.texture },
      depth: { value: target.depthTexture },
      size: { value: new THREE.Vector2() },
      nearFar: { value: new THREE.Vector2(camera.near, camera.far) },
    },
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader: `
      uniform sampler2D beauty;uniform sampler2D depth;uniform vec2 size;uniform vec2 nearFar;varying vec2 vUv;
      float distanceAt(vec2 p){float z=texture2D(depth,p).x;return nearFar.x*nearFar.y/(nearFar.y-z*(nearFar.y-nearFar.x));}
      void main(){
        vec3 color=texture2D(beauty,vUv).rgb;float center=distanceAt(vUv);float occlusion=0.;
        for(int i=0;i<12;i++) {
          float a=float(i)*2.399963;float radius=2.5+float(i)*1.35;
          float sampleDepth=distanceAt(vUv+vec2(cos(a),sin(a))*radius/size);
          float difference=center-sampleDepth;
          occlusion+=smoothstep(.012,.13,difference)*(1.-smoothstep(.2,.8,difference));
        }
        color*=1.-occlusion*.022;
        float vignette=dot((vUv-.5)*vec2(1.,.85),(vUv-.5)*vec2(1.,.85));
        color*=1.-vignette*.15;
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));

  const dimensions = new THREE.Vector2();
  function resize() {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.round(bounds.width * resolution),
      height = Math.round(bounds.height * resolution);
    renderer.setSize(width, height, false);
    target.setSize(width, height);
    post.uniforms.size.value.set(width, height);
    dimensions.set(width, height);
    camera.aspect = bounds.width / bounds.height;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(aquarium);
  resize();

  let pointer = null,
    lastPointerTime = 0;
  const pointerPosition = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const waterPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -2.6);
  canvas.addEventListener("pointermove", (event) => {
    const bounds = canvas.getBoundingClientRect();
    const normalized = new THREE.Vector2(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      (-(event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(normalized, camera);
    if (raycaster.ray.intersectPlane(waterPlane, pointerPosition)) {
      const now = performance.now();
      const speed = pointer
        ? Math.min(
            1,
            pointer.position.distanceTo(pointerPosition) /
              Math.max(0.016, (now - lastPointerTime) / 1000) /
              16,
          )
        : 0.2;
      pointer = {
        position: pointerPosition.clone(),
        strength: Math.max(speed, pointer?.strength || 0),
      };
      lastPointerTime = now;
    }
  });
  canvas.addEventListener("pointerleave", () => {
    pointer = null;
  });

  function setPaused(value) {
    paused = value;
    pauseButton.textContent = paused ? "Resume" : "Pause";
    pauseButton.setAttribute(
      "aria-label",
      paused ? "Resume aquarium" : "Pause aquarium",
    );
  }
  function toggleInspection() {
    inspection.hidden = !inspection.hidden;
    document
      .querySelector("#inspect")
      .setAttribute("aria-pressed", String(!inspection.hidden));
  }
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else
      aquarium
        .requestFullscreen()
        .catch((error) => console.warn(error.message));
  }
  pauseButton.addEventListener("click", () => setPaused(!paused));
  document
    .querySelector("#inspect")
    .addEventListener("click", toggleInspection);
  document
    .querySelector("#close-inspection")
    .addEventListener("click", toggleInspection);
  document.querySelector("#fullscreen").addEventListener("click", fullscreen);
  document.querySelector("#resolution").addEventListener("change", (event) => {
    resolution = Number(event.target.value);
    resize();
  });
  document.querySelector("#view").addEventListener("change", (event) => {
    const views = {
      full: [0, 4.15, 1],
      wood: [1.3, 3.35, 2.1],
      plant: [-5.35, 1.6, 2.4],
      fish: [0.1, 4.65, 2],
    };
    const [x, y, zoom] = views[event.target.value];
    camera.position.set(x, y + 0.5, 20.5);
    camera.lookAt(x, y, 0);
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
  });
  document.addEventListener("keydown", (event) => {
    if (event.target.matches("select,input,textarea")) return;
    if (event.code === "Space") {
      if (event.target.matches("button")) return;
      event.preventDefault();
      setPaused(!paused);
    }
    if (event.key.toLowerCase() === "i") toggleInspection();
    if (event.key.toLowerCase() === "f") fullscreen();
  });
  setPaused(paused);

  let captureRequested = false;
  document.querySelector("#capture").addEventListener("click", () => {
    captureRequested = true;
  });
  const measurement = document.querySelector("#measurement");
  document.querySelector("#measure").addEventListener("click", () => {
    if (paused) setPaused(false);
    measuring = {
      start: performance.now(),
      samples: [],
      width: dimensions.x,
      height: dimensions.y,
    };
    measurement.textContent = "Measuring for 15 seconds…";
  });

  let last = performance.now(),
    time = 0,
    frameTimes = [],
    lastDisplay = last;
  let ready = false;
  const gl = renderer.getContext();
  const gpuInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = gpuInfo
    ? gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL)
    : gl.getParameter(gl.RENDERER);
  function frame(now) {
    requestAnimationFrame(frame);
    const elapsed = now - last;
    last = now;
    if (document.hidden) {
      frameTimes = [];
      return;
    }
    const dt = Math.min(0.05, elapsed / 1000);
    if (!paused) {
      time += dt;
      fish.update(dt, time, pointer);
      plants.update(time);
      particles.update(time, resolution);
    }
    if (pointer) {
      pointer.strength *= Math.exp(-dt * 3.2);
      if (pointer.strength < 0.005) pointer = null;
    }
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(postScene, postCamera);
    if (captureRequested) {
      captureRequested = false;
      canvas.toBlob((blob) => {
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "aquarium.png";
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      });
    }
    if (!ready) {
      ready = true;
      loading.style.opacity = 0;
      setTimeout(() => {
        loading.hidden = true;
      }, 850);
    }
    if (elapsed < 500) {
      frameTimes.push(elapsed);
      if (frameTimes.length > 180) frameTimes.shift();
    }
    if (measuring) {
      measuring.samples.push(elapsed);
      if (now - measuring.start >= 15000) {
        const samples = measuring.samples.slice(1).sort((a, b) => a - b);
        const average = samples.reduce((a, b) => a + b, 0) / samples.length;
        const text = `${measuring.width} × ${measuring.height} rendered pixels\n${(1000 / average).toFixed(1)} fps average · ${(1000 / samples[Math.floor(samples.length * 0.95)]).toFixed(1)} fps at 95th-percentile frame time\n${samples.length} frames / 15 seconds\n${gpu}\n${navigator.userAgent}`;
        measurement.textContent = text;
        console.info("AQUARIUM BENCHMARK\n" + text);
        measuring = null;
      }
    }
    if (now - lastDisplay > 700) {
      lastDisplay = now;
      const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
      document.querySelector("#performance").textContent =
        `${dimensions.x} × ${dimensions.y} · ${(1000 / avg).toFixed(1)} fps\n${paused ? "Paused" : `Live · ${time.toFixed(0)} s`} · WebGL2`;
      const telemetry = fish.getTelemetry();
      document.querySelector("#behavior").textContent =
        `${telemetry.count} fish · ${telemetry.states.hover} hovering · ${telemetry.states.relocate} relocating\n${telemetry.states.dart} darting · ${telemetry.states.brake} braking\nPointer responses: ${telemetry.pointerResponses}`;
    }
  }
  requestAnimationFrame(frame);
  setTimeout(() => {
    document.querySelector("#hint").style.opacity = 0;
  }, 6500);
  document.body.classList.add("controls-visible");
  setTimeout(() => document.body.classList.remove("controls-visible"), 3800);
  console.info(`Aquarium ready. Three.js ${THREE.REVISION}. ${gpu}`);
}

start().catch(fail);
