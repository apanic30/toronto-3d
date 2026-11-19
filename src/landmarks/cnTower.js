import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Procedural CN Tower (553.3 m). Origin = centre of the base at ground level.
// Built from a lofted three-armed "Y" cross-section, a lathed main pod,
// the slim upper shaft, the SkyPod and the antenna mast.

const POD_Y = 335;

// Closed ring of points for the Y-shaped cross-section.
function yProfile(armLen, halfW, tipSegs = 6) {
  const pts = [];
  const concave = halfW / Math.sin(Math.PI / 3);
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + Math.PI / 2; // one arm points north (-z)
    const len = Math.max(armLen, concave * 0.6);
    for (let i = 0; i <= tipSegs; i++) {
      const t = a - Math.PI / 2 + (i / tipSegs) * Math.PI;
      pts.push([Math.cos(a) * len + Math.cos(t) * halfW, Math.sin(a) * len + Math.sin(t) * halfW]);
    }
    const c = a + Math.PI / 3;
    pts.push([Math.cos(c) * concave, Math.sin(c) * concave]);
  }
  return pts;
}

// Builds a side surface through a list of rings (same vertex count) at given heights.
function loft(rings, heights, capTop = true) {
  const n = rings[0].length;
  const pos = [];
  const idx = [];
  for (let r = 0; r < rings.length; r++) {
    for (const [x, z] of rings[r]) pos.push(x, heights[r], -z);
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let i = 0; i < n; i++) {
      const a = r * n + i;
      const b = r * n + ((i + 1) % n);
      const c = (r + 1) * n + i;
      const d = (r + 1) * n + ((i + 1) % n);
      idx.push(a, b, c, b, d, c);
    }
  }
  if (capTop) {
    const top = rings.length - 1;
    const centre = pos.length / 3;
    pos.push(0, heights[top], 0);
    for (let i = 0; i < n; i++) idx.push(top * n + i, top * n + ((i + 1) % n), centre);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}

function lathe(profile, segs = 64) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segs);
  return g;
}

export function createCNTower() {
  const group = new THREE.Group();
  group.name = 'CN Tower';

  const concrete = new THREE.MeshStandardMaterial({ color: 0xc4bfb4, roughness: 0.85, metalness: 0.0 });
  const darkConcrete = new THREE.MeshStandardMaterial({ color: 0xa9a59d, roughness: 0.85 });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x1d2a38, roughness: 0.08, metalness: 0.7, clearcoat: 1, envMapIntensity: 1.4,
  });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.55 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xbfc3c7, roughness: 0.4, metalness: 0.6 });

  // ---- Y-shaped lower shaft (ground -> main pod)
  const heights = [];
  const rings = [];
  const STEPS = 28;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const y = t * (POD_Y + 4);
    const taper = Math.pow(1 - t, 1.9);
    const armLen = 6 + 20 * taper; // ~26 m legs at the base (≈52 m footprint)
    const halfW = 3.6 + 2.8 * Math.pow(1 - t, 1.2);
    heights.push(y);
    rings.push(yProfile(armLen, halfW));
  }
  const shaft = new THREE.Mesh(loft(rings, heights), concrete);
  shaft.castShadow = shaft.receiveShadow = true;
  group.add(shaft);

  // Vertical elevator glass strips on the arms (thin dark ribbons)
  const stripGeo = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * 2 * Math.PI) / 3 + Math.PI / 2 + Math.PI / 3;
    const concave = 6.2 / Math.sin(Math.PI / 3);
    const g = new THREE.BoxGeometry(1.6, POD_Y - 20, 0.6);
    g.translate(0, (POD_Y - 20) / 2 + 10, 0);
    g.rotateY(-a + Math.PI / 2);
    g.translate(Math.cos(a) * (concave * 0.62), 0, -Math.sin(a) * (concave * 0.62));
    stripGeo.push(g);
  }
  const strips = new THREE.Mesh(mergeGeometries(stripGeo), glass);
  group.add(strips);

  // ---- Main pod (≈ 335–368 m)
  const podLower = lathe([
    [5.5, POD_Y - 8], [9, POD_Y - 3], [16, POD_Y + 2], [21, POD_Y + 6], [22.5, POD_Y + 9],
  ]);
  const podGlass = lathe([
    [22.5, POD_Y + 9], [23.2, POD_Y + 12], [23.2, POD_Y + 19], [22.6, POD_Y + 21],
  ]);
  const podUpper = lathe([
    [22.6, POD_Y + 21], [21.5, POD_Y + 23], [19, POD_Y + 25], [17.5, POD_Y + 27],
  ]);
  const podGlass2 = lathe([
    [17.5, POD_Y + 27], [17.8, POD_Y + 30], [17.4, POD_Y + 33],
  ]);
  const podRoof = lathe([
    [17.4, POD_Y + 33], [14, POD_Y + 35], [8, POD_Y + 36.5], [5, POD_Y + 37],
  ]);
  for (const [g, m] of [[podLower, white], [podGlass, glass], [podUpper, white], [podGlass2, glass], [podRoof, darkConcrete]]) {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  // EdgeWalk / outer ring
  const ring = new THREE.Mesh(new THREE.TorusGeometry(23.4, 0.45, 8, 96), steel);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = POD_Y + 9;
  group.add(ring);

  // ---- Upper shaft (hexagonal) to the SkyPod
  const upper = new THREE.Mesh(new THREE.CylinderGeometry(4.3, 5.4, 447 - (POD_Y + 37), 6), concrete);
  upper.position.y = (POD_Y + 37 + 447) / 2;
  upper.castShadow = true;
  group.add(upper);

  // ---- SkyPod (447 m)
  const skyPod = new THREE.Group();
  const spBody = new THREE.Mesh(lathe([[4.3, 442], [8.5, 445], [9, 447], [9, 452], [8, 454], [4.2, 456]], 40), white);
  const spGlass = new THREE.Mesh(new THREE.CylinderGeometry(9.1, 9.1, 3.2, 40, 1, true), glass);
  spGlass.position.y = 449.2;
  skyPod.add(spBody, spGlass);
  skyPod.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  group.add(skyPod);

  // ---- Antenna mast (≈ 456 -> 553 m), stepped
  const mastSegs = [
    [4.0, 3.2, 456, 470], [3.0, 2.4, 470, 492], [2.2, 1.6, 492, 515], [1.5, 1.0, 515, 536], [0.9, 0.35, 536, 553],
  ];
  for (const [r0, r1, y0, y1] of mastSegs) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, y1 - y0, 12), y0 > 500 ? steel : white);
    m.position.y = (y0 + y1) / 2;
    m.castShadow = true;
    group.add(m);
  }
  // Red aviation beacon
  const beacon = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 12, 8),
    new THREE.MeshStandardMaterial({ color: 0xff2a1a, emissive: 0xff2a1a, emissiveIntensity: 2.5 }),
  );
  beacon.position.y = 553.6;
  group.add(beacon);

  // ---- Base plinth / entrance pavilion
  const plinth = new THREE.Mesh(new THREE.CylinderGeometry(46, 48, 1.4, 48), new THREE.MeshStandardMaterial({ color: 0xcfcac0, roughness: 0.9 }));
  plinth.position.y = 0.7;
  plinth.receiveShadow = true;
  group.add(plinth);

  return group;
}
