import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural Rogers Centre (closed roof). Origin = centre of the stadium at
// ground level. The roof is ~205 m across and ~86 m high; the four roof
// panels read as a stepped, ribbed dome whose seams run east-west.

const R = 120; // outer wall radius (OSM footprint ≈ 250 m across)
const WALL_H = 46;
const ROOF_TOP = 86;

export function createRogersCentre() {
  const group = new THREE.Group();
  group.name = 'Rogers Centre';

  const wallMat = new THREE.MeshStandardMaterial({ color: 0xe9e7e1, roughness: 0.7 });
  const ribMat = new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.6 });
  const darkMat = new THREE.MeshPhysicalMaterial({ color: 0x27323e, roughness: 0.15, metalness: 0.6, clearcoat: 0.8 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0xf1f1ee, roughness: 0.45, metalness: 0.15 });
  const seamMat = new THREE.MeshStandardMaterial({ color: 0x9da3a8, roughness: 0.5, metalness: 0.5 });

  // ---- Drum wall
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R + 2, WALL_H, 96, 1, true), wallMat);
  wall.position.y = WALL_H / 2;
  wall.castShadow = wall.receiveShadow = true;
  group.add(wall);

  // Two dark window bands around the concourses
  for (const [y, h] of [[12, 4], [30, 5]]) {
    const band = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.4, R + 0.4, h, 96, 1, true), darkMat);
    band.position.y = y;
    group.add(band);
  }

  // Hotel glazing on the north side (Renaissance hotel)
  const hotel = new THREE.Mesh(
    new THREE.CylinderGeometry(R + 0.8, R + 0.8, 26, 32, 1, true, Math.PI - 0.55, 1.1),
    darkMat,
  );
  hotel.position.y = 26;
  group.add(hotel);

  // Vertical pilasters (ribs) around the façade
  const ribs = [];
  const N_RIBS = 64;
  for (let i = 0; i < N_RIBS; i++) {
    const a = (i / N_RIBS) * Math.PI * 2;
    const g = new THREE.BoxGeometry(2.2, WALL_H + 1, 3);
    g.translate(0, (WALL_H + 1) / 2, R + 1.2);
    g.rotateY(a);
    ribs.push(g);
  }
  const ribMesh = new THREE.Mesh(mergeGeometries(ribs), ribMat);
  ribMesh.castShadow = true;
  group.add(ribMesh);

  // Parapet ring on top of the wall
  const parapet = new THREE.Mesh(new THREE.TorusGeometry(R, 1.6, 8, 96), ribMat);
  parapet.rotation.x = Math.PI / 2;
  parapet.position.y = WALL_H;
  group.add(parapet);

  // ---- Roof: shallow spherical cap
  const capH = ROOF_TOP - WALL_H;
  const sphereR = (R * R + capH * capH) / (2 * capH);
  const theta = Math.asin(R / sphereR);
  const roof = new THREE.Mesh(new THREE.SphereGeometry(sphereR, 128, 48, 0, Math.PI * 2, 0, theta), roofMat);
  roof.position.y = ROOF_TOP - sphereR;
  roof.castShadow = roof.receiveShadow = true;
  group.add(roof);

  // Panel seams: arches across the dome (east–west), giving the segmented look
  const seams = [];
  const roofY = (x, z) => ROOF_TOP - sphereR + Math.sqrt(Math.max(0, sphereR * sphereR - x * x - z * z));
  const seamZs = [-62, -20, 22, 64];
  for (const z0 of seamZs) {
    const half = Math.sqrt(Math.max(0, R * R - z0 * z0));
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const x = -half + (i / 40) * 2 * half;
      pts.push(new THREE.Vector3(x, roofY(x, z0) + 0.9, z0));
    }
    seams.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 1.3, 6, false));
  }
  // Fine ribs on each panel
  for (let z0 = -100; z0 <= 100; z0 += 7) {
    if (seamZs.some((s) => Math.abs(s - z0) < 3)) continue;
    const half = Math.sqrt(Math.max(0, (R - 2) * (R - 2) - z0 * z0));
    if (half < 10) continue;
    const pts = [];
    for (let i = 0; i <= 24; i++) {
      const x = -half + (i / 24) * 2 * half;
      pts.push(new THREE.Vector3(x, roofY(x, z0) + 0.25, z0));
    }
    seams.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.35, 4, false));
  }
  const seamMesh = new THREE.Mesh(mergeGeometries(seams), seamMat);
  group.add(seamMesh);

  // Track ring where the panels ride
  const track = new THREE.Mesh(new THREE.TorusGeometry(R - 1, 1.2, 6, 96), seamMat);
  track.rotation.x = Math.PI / 2;
  track.position.y = WALL_H + 1.6;
  group.add(track);

  // Plaza around the stadium
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(R + 18, 96),
    new THREE.MeshStandardMaterial({ color: 0xc9c4ba, roughness: 0.95 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.35;
  plaza.receiveShadow = true;
  group.add(plaza);

  return group;
}
