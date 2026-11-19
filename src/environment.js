import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';

// Late-afternoon sun from the south-west, so the skyline is lit as seen from the lake.
const SUN_ELEVATION = 24; // degrees
const SUN_AZIMUTH = 228; // degrees clockwise from north

export const FOG_COLOR = new THREE.Color(0xb9cad8);

export function sunDirection() {
  const el = THREE.MathUtils.degToRad(SUN_ELEVATION);
  const az = THREE.MathUtils.degToRad(SUN_AZIMUTH);
  // x = east, z = south
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}

export function createSky(renderer, scene) {
  const sky = new Sky();
  sky.scale.setScalar(450000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4.5;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.82;
  u.sunPosition.value.copy(sunDirection());
  scene.add(sky);

  // Image-based lighting from the same sky for reflections on glass/water.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new Sky();
  envSky.scale.setScalar(450000);
  for (const k of Object.keys(u)) envSky.material.uniforms[k].value = u[k].value;
  envScene.add(envSky);
  scene.environment = pmrem.fromScene(envScene, 0, 1, 500000).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  scene.fog = new THREE.Fog(FOG_COLOR, 3500, 16000);
  return sky;
}

export function createLights(scene) {
  const dir = sunDirection();
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.0);
  sun.position.copy(dir).multiplyScalar(4000);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  const S = 1900;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 100, far: 9000 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.6;
  scene.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x6b6a5c, 0.9);
  scene.add(hemi);
  return { sun, hemi };
}

// Tileable normal map generated from integer-frequency sine waves (no image assets needed).
function makeWaterNormals(size = 256) {
  const waves = [];
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 28; i++) {
    const fx = Math.round((rand() * 2 - 1) * (2 + i * 0.9));
    const fy = Math.round((rand() * 2 - 1) * (2 + i * 0.9));
    if (!fx && !fy) continue;
    waves.push({ fx, fy, a: 1 / (1 + Math.hypot(fx, fy) * 0.6), p: rand() * Math.PI * 2 });
  }
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(((w.fx * x + w.fy * y) / size) * Math.PI * 2 + w.p);
      h[y * size + x] = v;
    }
  }
  const data = new Uint8Array(size * size * 4);
  const s = 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + ((x - 1 + size) % size)], r = h[y * size + ((x + 1) % size)];
      const d = h[((y - 1 + size) % size) * size + x], u = h[((y + 1) % size) * size + x];
      const n = new THREE.Vector3((l - r) * s, (d - u) * s, 1).normalize();
      const i = (y * size + x) * 4;
      data[i] = (n.x * 0.5 + 0.5) * 255;
      data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function createWater(scene, size = 60000) {
  const water = new Water(new THREE.PlaneGeometry(size, size), {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: makeWaterNormals(),
    sunDirection: sunDirection(),
    sunColor: 0xb8ad9c,
    waterColor: 0x1b4057,
    distortionScale: 1.2,
    fog: true,
    alpha: 1.0,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0;
  water.material.uniforms.size.value = 0.6;
  water.receiveShadow = true;
  scene.add(water);
  return water;
}
