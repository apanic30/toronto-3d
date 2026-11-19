import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { createSky, createLights, createWater } from './environment.js';
import { buildCity, DETAIL_LAYER } from './city.js';
import { createCNTower } from './landmarks/cnTower.js';
import { createRogersCentre } from './landmarks/rogersCentre.js';
import { STOPS, CameraTour, createLabels, ROGERS_CENTRE_POS } from './tour.js';

const app = document.getElementById('app');
const loaderFill = document.getElementById('loader-fill');
const loaderText = document.getElementById('loader-text');
const progress = (p, text) => {
  loaderFill.style.width = `${Math.round(p * 100)}%`;
  if (text) loaderText.textContent = text;
};

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.62;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The sun never moves, so the shadow map only needs rendering when the scene changes.
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
app.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
Object.assign(labelRenderer.domElement.style, { position: 'fixed', inset: '0', pointerEvents: 'none' });
app.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 2, 60000);
const overview = STOPS[0];
camera.position.set(...overview.cam);
camera.layers.enable(DETAIL_LAYER);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...overview.target);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.maxPolarAngle = Math.PI * 0.485; // stay above the ground
controls.minDistance = 60;
controls.maxDistance = 9000;
controls.screenSpacePanning = false;
controls.zoomToCursor = true;

// ---------------------------------------------------------------- scene
createSky(renderer, scene);
createLights(scene);
const water = createWater(scene);

const cn = createCNTower();
scene.add(cn);
const rogers = createRogersCentre();
rogers.position.copy(ROGERS_CENTRE_POS);
scene.add(rogers);

// ---------------------------------------------------------------- tour UI
const tour = new CameraTour(camera, controls);
const nav = document.getElementById('tour');
const info = document.getElementById('info');
const infoTitle = document.getElementById('info-title');
const infoBody = document.getElementById('info-body');

function select(id) {
  const stop = STOPS.find((s) => s.id === id);
  if (!stop) return;
  tour.flyTo(stop);
  for (const b of nav.querySelectorAll('button')) b.classList.toggle('active', b.dataset.id === id);
  infoTitle.textContent = stop.name;
  infoBody.textContent = stop.info;
  info.classList.remove('hidden');
}

for (const stop of STOPS) {
  const b = document.createElement('button');
  b.textContent = stop.name;
  b.dataset.id = stop.id;
  b.addEventListener('click', () => select(stop.id));
  nav.appendChild(b);
}
createLabels(scene, select);

// Grabbing the camera cancels any fly-to in progress.
renderer.domElement.addEventListener('pointerdown', () => {
  tour.cancel();
  for (const b of nav.querySelectorAll('button')) b.classList.remove('active');
});

// ---------------------------------------------------------------- load city
async function loadCity() {
  progress(0.1, 'Downloading city data…');
  const res = await fetch(`${import.meta.env.BASE_URL}data/toronto.json`);
  const total = Number(res.headers.get('content-length')) || 0;
  let text;
  if (res.body && total) {
    const reader = res.body.getReader();
    const chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      progress(0.1 + 0.5 * (got / total));
    }
    text = new TextDecoder().decode(await new Blob(chunks).arrayBuffer());
  } else {
    text = await res.text();
  }
  progress(0.65, 'Building the skyline…');
  await new Promise((r) => setTimeout(r, 30));
  const data = JSON.parse(text);
  const city = buildCity(data, renderer);
  scene.add(city);
  renderer.shadowMap.needsUpdate = true;
  progress(0.85, 'Preparing shaders…');
  // Compile GPU programs without blocking, so the first frame doesn't stall.
  await renderer.compileAsync(scene, camera);
  progress(1, 'Ready');
}

loadCity()
  .catch((err) => {
    console.error(err);
    loaderText.textContent = 'Could not load city data — run "npm run fetch-data".';
  })
  .finally(() => {
    setTimeout(() => {
      document.getElementById('loader').classList.add('done');
      select('overview');
    }, 250);
  });

if (import.meta.env.DEV) window.__three = { scene, renderer, camera, controls };

// ---------------------------------------------------------------- loop
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  tour.update(performance.now());
  controls.update();
  water.material.uniforms.time.value += dt * 0.6;
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
});
