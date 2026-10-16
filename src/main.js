import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import GUI from 'lil-gui';
import { createToastMaterial, toastBurn } from './toastMaterial.js';
import { TriangleEmitter, ParticleSystem } from './particles.js';
import { createSmokeMaterial } from './smokeMaterial.js';
import { createLightBeam } from './lightBeam.js';
import { createScreen } from './screen.js';

const FPS = 24;
const LOOP_FRAMES = 200;
const LOOP = LOOP_FRAMES / FPS;
const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

const params = {
  speed: 1,
  paused: false,
  lightScale: 1,
  particles: true,
  toastSmoke: true,
  autoRotate: false,
};

// ---------- Renderer ----------
const canvas = document.querySelector('#webgl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.AgXToneMapping; // equivalente al Filmic de Blender
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
RectAreaLightUniformsLib.init();

const scene = new THREE.Scene();
const WORLD = lin(0.479, 0.332, 0.117); // color del World en Blender
scene.background = WORLD.clone();

// ---------- Environment (reflejos y luz ambiental del World) ----------
function buildEnvironment() {
  const envScene = new THREE.Scene();
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(50, 64, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: { top: { value: WORLD.clone() }, bottom: { value: lin(0.3, 0.09, 0.03) } },
      vertexShader: `varying vec3 vP;
        void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying vec3 vP;
        void main(){ float h = smoothstep(-0.25, 0.35, vP.y); gl_FragColor = vec4(mix(bottom, top, h), 1.0); }`,
    })
  );
  envScene.add(sky);
  // Paneles brillantes para que los metales tengan reflejos definidos
  const panelMat = new THREE.MeshBasicMaterial({ color: lin(2.5, 2.4, 2.2), side: THREE.DoubleSide });
  for (const [x, y, z] of [[2.5, 2.8, 2.4], [-2.0, 2.9, -5.4]]) {
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(10, 6), panelMat);
    panel.position.set(x, y, z).normalize().multiplyScalar(30);
    panel.lookAt(0, 0, 0);
    envScene.add(panel);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(envScene, 0.02).texture;
  pmrem.dispose();
  return tex;
}
scene.environment = buildEnvironment();
scene.environmentIntensity = 0.9;

// ---------- Cámara ----------
const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 200);
let BASE_FOV = 39.6;
function fitFov() {
  const a = window.innerWidth / window.innerHeight;
  camera.aspect = a;
  camera.fov = a >= 1
    ? BASE_FOV
    : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2)) / a));
  camera.updateProjectionMatrix();
}
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 5;
controls.maxDistance = 19;
controls.maxPolarAngle = Math.PI * 0.47;
controls.autoRotateSpeed = 0.6;

// ---------- Post-procesado (brillos) ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.31, 0.55, 1.5);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------- Loader UI ----------
const loaderEl = document.querySelector('#loader');
const barEl = document.querySelector('#loader .bar span');
const setProgress = (p) => { barEl.style.width = `${Math.round(p * 100)}%`; };

// ---------- Luces (W de Blender -> unidades de three, modo compatible del exportador glTF) ----------
const lights = [];
function addLights(data) {
  for (const L of data.lights) {
    const color = lin(...L.color);
    const pos = new THREE.Vector3(...L.position);
    const dir = new THREE.Vector3(...L.dir);
    let light;
    let base;
    if (L.type === 'POINT') {
      base = L.energy / (4 * Math.PI);
      light = new THREE.PointLight(color, base, 0, 2);
      light.position.copy(pos);
    } else if (L.type === 'SUN') {
      base = L.energy;
      light = new THREE.DirectionalLight(color, base);
      light.position.copy(dir).multiplyScalar(-25);
      light.castShadow = true;
      light.shadow.mapSize.set(2048, 2048);
      const c = light.shadow.camera;
      c.left = -10; c.right = 10; c.top = 10; c.bottom = -10; c.near = 1; c.far = 60;
      light.shadow.bias = -0.0005;
      light.shadow.normalBias = 0.02;
      light.shadow.radius = 3;
      scene.add(light.target);
    } else if (L.type === 'AREA') {
      base = L.energy / (4 * Math.PI);
      light = new THREE.RectAreaLight(color, base, 1, 1);
      light.position.copy(pos);
      light.lookAt(pos.clone().add(dir));
    }
    if (!light) continue;
    light.name = L.name;
    light.userData.base = base;
    scene.add(light);
    lights.push(light);
  }
}
function applyLightScale() {
  for (const l of lights) l.intensity = l.userData.base * params.lightScale;
}

// ---------- Materiales especiales ----------
const monitorMat = new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.15, metalness: 0 });

// ---------- Init ----------
const toasts = [];
let beam = null;
let bowl = null; // malla 'Circle' (el cuenco donde vive la escena)
let mixer;
let sparks;
let smoke;
let toastSmoke;
let screen; // texto animado del monitor

// Emisor puntual que sigue a la tostada que está cruzando el haz; el humo sale en la dirección del haz
const toastSmokeEmitter = {
  point: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  sample(pos, nrm) {
    pos.copy(this.point);
    pos.x += (Math.random() - 0.5) * 0.3; pos.y += (Math.random() - 0.5) * 0.3; pos.z += (Math.random() - 0.5) * 0.3;
    nrm.copy(this.dir);
  },
};

async function init() {
  const data = await fetch('/models/scene-data.json').then((r) => r.json());

  // Cámara original de Blender
  BASE_FOV = THREE.MathUtils.radToDeg(2 * Math.atan(data.camera.sensor / 2 / data.camera.lens));
  camera.position.set(...data.camera.position);
  controls.target.set(...data.camera.target);
  fitFov();
  controls.update();

  addLights(data);

  // Haz de luz desde la tira emisiva de la lámpara (Cube.004) que cruza la cinta
  beam = createLightBeam({
    origin: new THREE.Vector3(-4.624, 0.835, -1.2406),
    direction: new THREE.Vector3(-1, 0, 0),
    color: lin(1.0, 0.45, 0.15),
    intensity: 2.2,
    spotIntensity: 80,
  });
  scene.add(beam.mesh, beam.spot, beam.spot.target);

  const gltf = await new GLTFLoader().loadAsync('/models/toastbar.glb', (e) => {
    if (e.total) setProgress(e.loaded / e.total);
  });
  const model = gltf.scene;
  let monitorScreen = null;
  let monitorText = null;

  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const name = o.material?.name;

    if (name === 'Monitor') o.material = monitorMat;
    if (o.name === 'EX_Cube002_1') monitorScreen = o; // pantalla vertical del monitor
    if (o.name === 'EX_Text') { monitorText = o; o.visible = false; } // se reemplaza por la pantalla animada
    if (name === 'floor') {
      bowl = o;
      o.material.side = THREE.DoubleSide;
      o.castShadow = false;
    }
    if (name === 'Light Blue' || name === 'LightOrange') {
      o.castShadow = false;
      o.material.side = THREE.DoubleSide;
    }

    const m = /^Toast_(\d+)$/.exec(o.name);
    if (m) {
      const index = parseInt(m[1], 10);
      o.material = createToastMaterial(Math.random() * 10);
      o.material.shadowSide = THREE.DoubleSide;
      toasts.push({ index, uniforms: o.material.userData.uniforms, mesh: o, inBeam: false, smokeT: 0, smokeAcc: 0 });
    }
  });
  scene.add(model);

  // Pantalla animada: ocupa la pantalla del monitor, justo delante del texto original (mira hacia -X)
  model.updateMatrixWorld(true);
  const screenBox = new THREE.Box3().setFromObject(monitorScreen ?? monitorText ?? model);
  const screenSize = screenBox.getSize(new THREE.Vector3());
  const screenCenter = screenBox.getCenter(new THREE.Vector3());
  screenCenter.x = (monitorText ? new THREE.Box3().setFromObject(monitorText).min.x : screenBox.min.x) - 0.004;
  screen = createScreen({
    center: screenCenter,
    width: monitorScreen ? screenSize.z * 0.94 : 1.5,
    height: monitorScreen ? screenSize.y * 0.94 : 1.18,
    color: lin(0.04, 0.32, 1.0), // azul saturado: con poco rojo/verde no se lava a blanco al brillar
    intensity: 12,
  });
  scene.add(screen.mesh);

  // Animaciones: se desplazan para que el frame 1 sea t=0 y el ciclo dure exactamente 200 frames
  mixer = new THREE.AnimationMixer(model);
  // OJO: el exportador comparte el mismo arreglo de tiempos entre pistas, así que cada uno se desplaza una sola vez
  const shifted = new Set();
  for (const clip of gltf.animations) {
    for (const track of clip.tracks) {
      if (shifted.has(track.times)) continue;
      shifted.add(track.times);
      for (let i = 0; i < track.times.length; i++) track.times[i] = Math.max(0, track.times[i] - 1 / FPS);
    }
    clip.duration = LOOP;
    mixer.clipAction(clip).play();
  }

  // Partículas: chispas azules del túnel (Plane.002 -> Icosphere "Light Blue")
  const wind = new THREE.Vector3(0, 3, 0); // campo Wind, fuerza 3 hacia arriba
  sparks = new ParticleSystem({
    emitter: new TriangleEmitter(data.emitters['Plane.002']),
    max: 600,
    rate: 2000 / (120 / FPS),
    life: 10 / FPS,
    lifeRandom: 1,
    normalVelocity: 2,
    randomVelocity: 0.75,
    acceleration: wind.clone().add(new THREE.Vector3(0, -9.81 * 0.0357, 0)),
    size: 0.034,
    sizeRandom: 1,
    fadeOut: 0.3,
    geometry: new THREE.IcosahedronGeometry(1, 1),
    material: new THREE.MeshBasicMaterial({ color: lin(0, 0.506, 1).multiplyScalar(10) }),
  });
  scene.add(sparks.mesh);

  // Partículas: humo blanco en grupos de esferas (sale desde Cube.005, como en Blender)
  smoke = new ParticleSystem({
    emitter: new TriangleEmitter(data.emitters['Cube.005']),
    max: 1600,
    rate: 55,               // grupos por segundo
    clusterSize: 6,         // esferas por grupo
    clusterSpread: 0.2,     // qué tan apretado está cada grupo
    clusterLifeJitter: 0.25,
    life: 50 / FPS,
    lifeRandom: 0.6,
    normalVelocity: 1,
    randomVelocity: 0.15,
    acceleration: new THREE.Vector3(0, 2.2, 0),
    size: 0.24,
    sizeRandom: 0.45,
    grow: 0.7,
    fadeIn: 0.12,
    fadeOut: 0.35,
    geometry: new THREE.IcosahedronGeometry(1, 2),
    material: createSmokeMaterial(),
  });
  scene.add(smoke.mesh);

  // Partículas: humo horizontal que suelta cada tostada al cruzar el haz de luz.
  // Mismo material que el humo de arriba; se emite a mano desde la posición de la tostada (rate 0).
  toastSmoke = new ParticleSystem({
    emitter: toastSmokeEmitter,
    max: 900,
    rate: 0,
    clusterSize: 5,
    clusterSpread: 0.14,
    clusterLifeJitter: 0.3,
    life: 40 / FPS,
    lifeRandom: 0.5,
    normalVelocity: 1.4,    // empuje inicial en la dirección del haz
    randomVelocity: 0.2,
    acceleration: beam.direction.clone().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.25, 0)),
    size: 0.16,
    sizeRandom: 0.45,
    grow: 1.1,
    fadeIn: 0.1,
    fadeOut: 0.4,
    geometry: new THREE.IcosahedronGeometry(1, 2),
    material: smoke.mesh.material,
  });
  scene.add(toastSmoke.mesh);

  buildGUI();
  loaderEl.classList.add('done');
  tick();
}

// ---------- GUI ----------
function buildGUI() {
  const gui = new GUI({ title: 'Toast Bar' });
  gui.add(params, 'speed', 0, 3, 0.01).name('Velocidad');
  gui.add(params, 'paused').name('Pausa');
  gui.add(params, 'autoRotate').name('Auto-rotar').onChange((v) => { controls.autoRotate = v; });
  gui.add(renderer, 'toneMappingExposure', 0.2, 3, 0.01).name('Exposición');
  gui.add(toastBurn, 'value', 0, 1, 0.01).name('Tostado');
  gui.add(params, 'lightScale', 0.1, 4, 0.01).name('Intensidad luces').onChange(applyLightScale);
  gui.add(scene, 'environmentIntensity', 0, 3, 0.01).name('Ambiente');
  gui.add(smoke.mesh.material.userData.uniforms.uOpacity, 'value', 0, 1, 0.01).name('Densidad humo');
  gui.add(smoke.mesh.material, 'emissiveIntensity', 0, 8, 0.01).name('Brillo humo');
  gui.add(params, 'particles').name('Partículas').onChange((v) => {
    sparks.mesh.visible = v;
    smoke.mesh.visible = v;
    toastSmoke.mesh.visible = v;
  });
  gui.add(params, 'toastSmoke').name('Humo al tostar');
  const fbeam = gui.addFolder('Haz de luz');
  fbeam.add(beam.uniforms.uIntensity, 'value', 0, 3, 0.01).name('Intensidad haz');
  fbeam.add(beam.spot, 'intensity', 0, 100, 0.1).name('Luz sobre panes');
  fbeam.addColor({ c: '#' + beam.uniforms.uColor.value.getHexString() }, 'c').name('Color').onChange((v) => {
    beam.uniforms.uColor.value.set(v);
    beam.spot.color.set(v);
  });
  const fscreen = gui.addFolder('Pantalla');
  fscreen.add(screen.uniforms.uIntensity, 'value', 0, 30, 0.1).name('Brillo texto');
  fscreen.addColor(screen.uniforms.uColor, 'value').name('Color texto');
  const fb = gui.addFolder('Bloom');
  fb.add(bloom, 'strength', 0, 3, 0.01);
  fb.add(bloom, 'threshold', 0, 5, 0.01);
  fb.add(bloom, 'radius', 0, 1.5, 0.01);
  if (window.innerWidth < 700) gui.close();
}

// ---------- Límites de cámara: no atravesar ni bajar del cuenco ----------
const camRay = new THREE.Raycaster();
const _dir = new THREE.Vector3();
const _origin = new THREE.Vector3();
const DOWN = new THREE.Vector3(0, -1, 0);
const CAM_MARGIN = 0.8;    // distancia mínima de la cámara a la superficie del cuenco
const TARGET_MIN_Y = 0.3;  // el punto de mira tampoco baja del piso
const TARGET_MAX_R = 10;   // ni se aleja demasiado del centro al hacer pan

function constrainCamera() {
  if (!bowl) return;
  const t = controls.target;

  // 1) El punto de mira se queda dentro de la escena
  t.y = Math.max(t.y, TARGET_MIN_Y);
  const r = Math.hypot(t.x, t.z);
  if (r > TARGET_MAX_R) { t.x *= TARGET_MAX_R / r; t.z *= TARGET_MAX_R / r; }

  // 2) No atravesar la pared: rayo desde el objetivo hacia la cámara
  _dir.subVectors(camera.position, t);
  const dist = _dir.length();
  _dir.normalize();
  camRay.set(t, _dir);
  camRay.far = dist + CAM_MARGIN;
  let hit = camRay.intersectObject(bowl, false)[0];
  if (hit) camera.position.copy(t).addScaledVector(_dir, Math.max(hit.distance - CAM_MARGIN, controls.minDistance * 0.5));

  // 3) No bajar del piso: rayo vertical desde arriba de la cámara
  _origin.set(camera.position.x, camera.position.y + 50, camera.position.z);
  camRay.set(_origin, DOWN);
  camRay.far = 200;
  hit = camRay.intersectObject(bowl, false)[0];
  if (hit && camera.position.y < hit.point.y + CAM_MARGIN) camera.position.y = hit.point.y + CAM_MARGIN;
}

// ---------- Loop ----------
const clock = new THREE.Clock();
let loopT = 0;
const fract = (x) => x - Math.floor(x);

function updateToasts() {
  const frame = 1 + loopT * FPS;
  for (const t of toasts) {
    const f = fract(t.index / 16 + frame / LOOP_FRAMES);
    t.uniforms.uToast.value = THREE.MathUtils.clamp((f - 0.536) / (0.591 - 0.536), 0, 1);
  }
}

// Cada tostada suelta una ráfaga de humo al entrar en el haz y sigue humeando mientras lo cruza
const TOAST_SMOKE_RATE = 30;   // grupos por segundo por tostada
const TOAST_SMOKE_BURST = 0.6; // segundos que sigue humeando tras entrar
const _toastPos = new THREE.Vector3();
function updateToastSmoke(dt) {
  toastSmokeEmitter.dir.copy(beam.direction);
  for (const t of toasts) {
    t.mesh.getWorldPosition(_toastPos);
    const inside = beam.contains(_toastPos, 0.25);
    if (inside && !t.inBeam) t.smokeT = TOAST_SMOKE_BURST;
    t.inBeam = inside;
    if (inside) t.smokeT = Math.max(t.smokeT, 0.1);
    if (t.smokeT <= 0 || !params.toastSmoke) continue;
    t.smokeT -= dt;
    t.smokeAcc += TOAST_SMOKE_RATE * dt;
    toastSmokeEmitter.point.copy(_toastPos);
    while (t.smokeAcc >= 1) { toastSmoke.spawn(); t.smokeAcc -= 1; }
  }
  toastSmoke.update(dt);
}

const fpsEl = document.createElement('div');
fpsEl.style.cssText = 'position:fixed;left:12px;top:12px;font:12px monospace;color:#fff;background:rgba(0,0,0,.45);padding:4px 8px;border-radius:4px;z-index:5';
document.body.appendChild(fpsEl);
let fpsFrames = 0, fpsTime = 0;

function tick() {
  const raw = clock.getDelta();
  fpsFrames++; fpsTime += raw;
  if (fpsTime >= 0.5) { fpsEl.textContent = `${Math.round(fpsFrames / fpsTime)} FPS`; fpsFrames = 0; fpsTime = 0; }
  const dt = Math.min(raw, 0.1) * (params.paused ? 0 : params.speed);
  if (dt > 0) {
    loopT = (loopT + dt) % LOOP;
    mixer.update(dt);
    updateToasts();
    sparks.update(dt);
    smoke.update(dt);
    updateToastSmoke(dt);
    smoke.mesh.material.userData.uniforms.uTime.value += dt;
    beam.uniforms.uTime.value += dt;
    screen.update(dt);
  }
  controls.update();
  constrainCamera();
  composer.render();
  requestAnimationFrame(tick);
}

window.addEventListener('resize', () => {
  fitFov();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

init().catch((err) => {
  console.error(err);
  loaderEl.classList.add('error');
  document.querySelector('#loader p').textContent = 'Error cargando la escena: ' + err.message;
});

// Créditos
const creditsBtn = document.querySelector('#credits-btn');
const creditsEl = document.querySelector('#credits');
const creditsPanel = document.querySelector('#credits-panel');
const creditsLink = creditsPanel.querySelector('a');
creditsBtn.addEventListener('click', () => {
  const open = creditsEl.classList.toggle('open');
  creditsBtn.setAttribute('aria-expanded', String(open));
  creditsPanel.setAttribute('aria-hidden', String(!open));
  creditsLink.tabIndex = open ? 0 : -1;
});
