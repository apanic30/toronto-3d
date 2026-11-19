import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Turns public/data/toronto.json into a handful of merged meshes.
// Coordinates: x = east, z = south (metres from the CN Tower), y = up.

const Y = {
  land: 1.0,
  green: 1.08,
  rail: 1.14,
  road: 1.2,
  tram: 1.26,
};

// Objects on this layer are drawn by the main camera but skipped by the lake's
// reflection pass (which only sees layer 0), keeping the reflection cheap.
export const DETAIL_LAYER = 1;
const detailOnly = (obj) => {
  obj.traverse((o) => o.layers.set(DETAIL_LAYER));
  return obj;
};

// ---------------------------------------------------------------- helpers

const ringFromFlat = (f) => {
  const pts = [];
  for (let i = 0; i < f.length; i += 2) pts.push(new THREE.Vector2(f[i], f[i + 1]));
  return pts;
};

const signedArea = (pts) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x - pts[i].x) * (pts[j].y + pts[i].y);
  return a / 2;
};

// Deterministic per-building pseudo random from its first coordinate.
const hash = (a, b) => {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
};

// Flat polygon (with holes) at height y, triangulated, facing up.
function flatPolygon(outerFlat, holesFlat, y, out) {
  let outer = ringFromFlat(outerFlat);
  if (outer.length < 3) return;
  if (signedArea(outer) < 0) outer.reverse();
  const holes = (holesFlat || []).map(ringFromFlat).filter((h) => h.length >= 3);
  for (const h of holes) if (signedArea(h) > 0) h.reverse();
  const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
  const all = outer.concat(...holes);
  for (const t of tris) {
    for (let k = 0; k < 3; k++) {
      const p = all[t[k]];
      out.push(p.x, y, p.y);
    }
  }
}

// Make every triangle in a flat position array face up (+y) so it isn't back-face culled.
function faceUp(pos) {
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], az = pos[i + 2];
    const bx = pos[i + 3], bz = pos[i + 5];
    const cx = pos[i + 6], cz = pos[i + 8];
    // y component of (b-a) x (c-a)
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (ny < 0) {
      for (let k = 0; k < 3; k++) {
        const t = pos[i + 3 + k];
        pos[i + 3 + k] = pos[i + 6 + k];
        pos[i + 6 + k] = t;
      }
    }
  }
  return pos;
}

function geometryFromPositions(pos, extra = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  for (const [k, v] of Object.entries(extra)) g.setAttribute(k, new THREE.Float32BufferAttribute(v.data, v.size));
  if (!extra.normal) g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- facade textures

function facadeTexture(renderer, kind) {
  const W = 256, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const cols = 4, rows = 4;
  const cw = W / cols, rh = H / rows;
  let seed = kind.length * 97;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  if (kind === 'glass') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const v = 70 + rand() * 70;
        ctx.fillStyle = `rgb(${v * 0.9},${v * 0.97},${v})`;
        ctx.fillRect(k * cw + 2, r * rh + 3, cw - 4, rh - 6);
      }
    }
    // spandrel bands
    ctx.fillStyle = 'rgba(235,240,245,0.9)';
    for (let r = 0; r < rows; r++) ctx.fillRect(0, r * rh, W, 4);
  } else {
    // masonry / concrete with punched windows
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    for (let r = 0; r < rows; r++) {
      for (let k = 0; k < cols; k++) {
        const v = 40 + rand() * 45;
        ctx.fillStyle = `rgb(${v},${v + 6},${v + 14})`;
        const mx = kind === 'low' ? 14 : 9;
        ctx.fillRect(k * cw + mx, r * rh + 14, cw - mx * 2, rh - 26);
      }
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// ---------------------------------------------------------------- buildings

const GLASS_TINTS = ['#7f9db5', '#6f8ea8', '#8ba9bf', '#5d7488', '#9eb3c2', '#4a5a68', '#a7b8c4', '#71899b'];
const DARK_TOWER = '#2b3036'; // TD Centre-style black steel
const MID_TINTS = ['#c9c0b1', '#b8b2a7', '#d6cfc1', '#a9a49b', '#c2b6a2', '#9fa7ad', '#d9d4ca'];
const LOW_TINTS = ['#b0705a', '#a8826a', '#c7b79d', '#9b6a55', '#bdb3a3', '#8f8478', '#c4a68a', '#d3cbbb'];

function pickColour(b, kind, r) {
  if (b.c) {
    // OSM colours are often loud; blend them heavily toward a neutral facade tone.
    const col = new THREE.Color();
    col.setStyle(b.c, THREE.SRGBColorSpace);
    if (col.r + col.g + col.b > 0 || /^(#000|black)/i.test(b.c)) {
      const hsl = {};
      col.getHSL(hsl);
      col.setHSL(hsl.h, hsl.s * 0.35, THREE.MathUtils.clamp(hsl.l, 0.25, 0.75));
      return col.lerp(new THREE.Color(kind === 'glass' ? 0x7e93a5 : 0xb9b2a6), 0.45);
    }
  }
  if (kind === 'glass') return new THREE.Color(r < 0.08 ? DARK_TOWER : GLASS_TINTS[Math.floor(r * GLASS_TINTS.length)]);
  if (kind === 'mid') return new THREE.Color(MID_TINTS[Math.floor(r * MID_TINTS.length)]);
  return new THREE.Color(LOW_TINTS[Math.floor(r * LOW_TINTS.length)]);
}

function buildBuildings(list, renderer) {
  const buckets = {
    glass: { pos: [], nor: [], uv: [], col: [] },
    mid: { pos: [], nor: [], uv: [], col: [] },
    low: { pos: [], nor: [], uv: [], col: [] },
  };
  const roofs = { pos: [], col: [] };
  const FLOOR = 3.6; // metres per texture row
  const BAY = 3.2; // metres per texture column
  const tmp = new THREE.Color();

  for (const b of list) {
    const top = b.h;
    const bottom = b.m || 0;
    const kind = top >= 55 ? 'glass' : top >= 18 ? 'mid' : 'low';
    const r = hash(b.p[0], b.p[1]);
    const colour = pickColour(b, kind, r);
    const B = buckets[kind];

    const rings = [b.p, ...(b.x || [])];
    rings.forEach((flat, ri) => {
      const pts = ringFromFlat(flat);
      if (pts.length < 3) return;
      // Outer ring CCW in (x, z) seen from above -> walls face outward.
      const ccw = signedArea(pts) > 0;
      if ((ri === 0) !== ccw) pts.reverse();
      let u = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const c = pts[(i + 1) % pts.length];
        const dx = c.x - a.x, dz = c.y - a.y;
        const len = Math.hypot(dx, dz);
        if (len < 0.01) continue;
        const nx = dz / len, nz = -dx / len;
        // Snap texture columns to whole bays so windows don't get sliced.
        const u0 = u / BAY, u1 = (u + len) / BAY;
        const v0 = bottom / FLOOR, v1 = top / FLOOR;
        // two triangles: (a,bottom) (c,bottom) (c,top) / (a,bottom) (c,top) (a,top)
        const quad = [
          [a.x, bottom, a.y, u0, v0], [c.x, top, c.y, u1, v1], [c.x, bottom, c.y, u1, v0],
          [a.x, bottom, a.y, u0, v0], [a.x, top, a.y, u0, v1], [c.x, top, c.y, u1, v1],
        ];
        // Slight darkening near the ground (cheap ambient occlusion feel)
        for (const [x, y, z, uu, vv] of quad) {
          B.pos.push(x, y, z);
          B.nor.push(nx, 0, nz);
          B.uv.push(uu, vv);
          const ao = y <= bottom + 0.01 && bottom < 1 ? 0.72 : 1.0;
          B.col.push(colour.r * ao, colour.g * ao, colour.b * ao);
        }
        u += len;
      }
    });

    // Roof
    const before = roofs.pos.length;
    flatPolygon(b.p, b.x, top, roofs.pos);
    tmp.copy(colour).lerp(new THREE.Color(kind === 'glass' ? 0x8a9097 : 0x9a968f), 0.6);
    for (let i = before; i < roofs.pos.length; i += 3) roofs.col.push(tmp.r, tmp.g, tmp.b);
  }

  const group = new THREE.Group();
  group.name = 'buildings';

  const mats = {
    glass: new THREE.MeshStandardMaterial({
      vertexColors: true, map: facadeTexture(renderer, 'glass'), metalness: 0.55, roughness: 0.22, envMapIntensity: 1.6,
    }),
    mid: new THREE.MeshStandardMaterial({ vertexColors: true, map: facadeTexture(renderer, 'mid'), roughness: 0.78, metalness: 0.05 }),
    low: new THREE.MeshStandardMaterial({ vertexColors: true, map: facadeTexture(renderer, 'low'), roughness: 0.9 }),
  };

  for (const [kind, B] of Object.entries(buckets)) {
    if (!B.pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mats[kind]);
    m.castShadow = m.receiveShadow = true;
    if (kind === 'low') detailOnly(m);
    group.add(m);
  }

  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(faceUp(roofs.pos), 3));
  rg.setAttribute('color', new THREE.Float32BufferAttribute(roofs.col, 3));
  rg.computeVertexNormals();
  const roofMesh = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }));
  roofMesh.castShadow = roofMesh.receiveShadow = true;
  group.add(detailOnly(roofMesh));

  return group;
}

// ---------------------------------------------------------------- flat layers

function flatLayer(polys, y, material, name) {
  const pos = [];
  for (const p of polys) flatPolygon(p.p, p.x, y, pos);
  faceUp(pos);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nor = new Float32Array(pos.length);
  for (let i = 1; i < nor.length; i += 3) nor[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const m = new THREE.Mesh(g, material);
  m.receiveShadow = true;
  m.name = name;
  return m;
}

// Ribbon along a polyline with mitred joins. Returns triangle positions.
function ribbon(flat, width, y, out, uvOut) {
  const n = flat.length / 2;
  if (n < 2) return;
  const hw = width / 2;
  const left = [], right = [];
  let dist = 0;
  const dists = [];
  for (let i = 0; i < n; i++) {
    const x = flat[i * 2], z = flat[i * 2 + 1];
    const px = flat[Math.max(0, i - 1) * 2], pz = flat[Math.max(0, i - 1) * 2 + 1];
    const qx = flat[Math.min(n - 1, i + 1) * 2], qz = flat[Math.min(n - 1, i + 1) * 2 + 1];
    let d1x = x - px, d1z = z - pz, d2x = qx - x, d2z = qz - z;
    const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
    if (i > 0) dist += l1;
    dists.push(dist);
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    if (i === 0) { d1x = d2x; d1z = d2z; }
    if (i === n - 1) { d2x = d1x; d2z = d1z; }
    let tx = d1x + d2x, tz = d1z + d2z;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const dot = nx * -d1z + nz * d1x;
    const miter = hw / Math.max(0.35, dot);
    left.push([x + nx * miter, z + nz * miter]);
    right.push([x - nx * miter, z - nz * miter]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = left[i], b = right[i], c = left[i + 1], d = right[i + 1];
    const yy = typeof y === 'function' ? [y(i), y(i + 1)] : [y, y];
    out.push(a[0], yy[0], a[1], b[0], yy[0], b[1], c[0], yy[1], c[1]);
    out.push(b[0], yy[0], b[1], d[0], yy[1], d[1], c[0], yy[1], c[1]);
    if (uvOut) {
      const u0 = dists[i] / width, u1 = dists[i + 1] / width;
      uvOut.push(u0, 0, u0, 1, u1, 0, u0, 1, u1, 1, u1, 0);
    }
  }
}

function upNormals(count) {
  const nor = new Float32Array(count);
  for (let i = 1; i < count; i += 3) nor[i] = 1;
  return nor;
}

function buildRoads(roads) {
  const ground = [];
  const deck = []; // elevated decks (Gardiner etc.)
  const sides = [];
  const pillars = [];

  for (const r of roads) {
    if (!r.e) {
      ribbon(r.p, r.w, Y.road + (r.k.startsWith('motorway') || r.k.startsWith('trunk') ? 0.04 : 0), ground);
      continue;
    }
    // Elevated: ramp the ends down only if they connect to ground (approximated by keeping full height).
    const top = r.e + Y.road;
    ribbon(r.p, r.w, top, deck);
    // deck fascia (outer edges): a slightly wider ribbon underneath acts as the deck slab
    ribbon(r.p, r.w + 0.6, top - 1.6, sides);
    // pillars every ~32 m
    let carry = 0;
    for (let i = 0; i < r.p.length / 2 - 1; i++) {
      const ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
      const len = Math.hypot(bx - ax, bz - az);
      let s = carry;
      while (s < len) {
        const t = s / len;
        pillars.push([ax + (bx - ax) * t, az + (bz - az) * t, top - 1.6, Math.atan2(bz - az, bx - ax), r.w]);
        s += 32;
      }
      carry = s - len;
    }
  }

  const group = new THREE.Group();
  group.name = 'roads';
  const asphalt = new THREE.MeshStandardMaterial({
    color: 0x4a4d52, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(faceUp(ground), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(upNormals(ground.length), 3));
  const gm = new THREE.Mesh(g, asphalt);
  gm.receiveShadow = true;
  group.add(detailOnly(gm));

  if (deck.length) {
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x55585d, roughness: 0.9 });
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.Float32BufferAttribute(faceUp(deck), 3));
    dg.setAttribute('normal', new THREE.BufferAttribute(upNormals(deck.length), 3));
    const dm = new THREE.Mesh(dg, deckMat);
    dm.castShadow = dm.receiveShadow = true;
    group.add(dm);

    const slabMat = new THREE.MeshStandardMaterial({ color: 0x9d9a93, roughness: 0.9, side: THREE.DoubleSide });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(faceUp(sides), 3));
    sg.computeVertexNormals();
    const sm = new THREE.Mesh(sg, slabMat);
    sm.castShadow = true;
    group.add(sm);

    // Hammerhead pillars
    const parts = [];
    for (const [x, z, h, ang, w] of pillars) {
      const col = new THREE.BoxGeometry(2.2, h, 2.2);
      col.translate(0, h / 2, 0);
      const cap = new THREE.BoxGeometry(2.6, 1.4, Math.max(6, w - 3));
      cap.translate(0, h - 0.7, 0);
      const p = mergeGeometries([col, cap]);
      p.rotateY(-ang);
      p.translate(x, 0, z);
      parts.push(p);
    }
    if (parts.length) {
      const pm = new THREE.Mesh(mergeGeometries(parts), slabMat);
      pm.castShadow = true;
      group.add(pm);
    }
  }
  return group;
}

function buildRail(rail) {
  const ballast = [];
  const tram = [];
  const elevated = [];
  for (const r of rail) {
    if (r.k === 'tram') ribbon(r.p, 1.6, Y.tram + r.e, tram);
    else if (r.e) ribbon(r.p, 4.5, Y.rail + r.e, elevated);
    else ribbon(r.p, 4.5, Y.rail, ballast);
  }
  const group = new THREE.Group();
  group.name = 'rail';
  const mk = (pos, mat) => {
    if (!pos.length) return;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(faceUp(pos), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(upNormals(pos.length), 3));
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    group.add(m);
  };
  mk(ballast, new THREE.MeshStandardMaterial({ color: 0x7a716a, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  mk(elevated, new THREE.MeshStandardMaterial({ color: 0x7a716a, roughness: 1 }));
  mk(tram, new THREE.MeshStandardMaterial({ color: 0x3a3a3c, roughness: 0.6, metalness: 0.4, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  return group;
}

const GREEN_COLOURS = { grass: 0x7d9a5c, wood: 0x5d7a45, pitch: 0x6f9d55, sand: 0xd9c9a3 };

function buildGreen(green) {
  const group = new THREE.Group();
  group.name = 'green';
  const byKind = {};
  for (const g of green) (byKind[g.k] ||= []).push(g);
  let i = 0;
  for (const [k, polys] of Object.entries(byKind)) {
    const mat = new THREE.MeshStandardMaterial({
      color: GREEN_COLOURS[k] ?? GREEN_COLOURS.grass, roughness: 1,
      polygonOffset: true, polygonOffsetFactor: -0.5 - i * 0.1, polygonOffsetUnits: -1 - i,
    });
    group.add(flatLayer(polys, Y.green + i * 0.01, mat, k));
    i++;
  }
  return group;
}

// Trees scattered in wooded/park areas as instanced low-poly crowns.
function buildTrees(green) {
  const pts = [];
  for (const g of green) {
    if (g.k !== 'wood' && g.k !== 'grass') continue;
    const ring = ringFromFlat(g.p);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of ring) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.y); maxZ = Math.max(maxZ, p.y); }
    const areaBox = (maxX - minX) * (maxZ - minZ);
    const density = g.k === 'wood' ? 1 / 160 : 1 / 520;
    const n = Math.min(1500, Math.floor(areaBox * density));
    for (let i = 0; i < n; i++) {
      const x = minX + hash(i, minX) * (maxX - minX);
      const z = minZ + hash(minZ, i * 1.7) * (maxZ - minZ);
      if (inside(x, z, ring) && !(g.x || []).some((h) => inside(x, z, ringFromFlat(h)))) pts.push([x, z, hash(x, z)]);
    }
  }
  const crown = new THREE.IcosahedronGeometry(1, 0);
  crown.scale(1, 1.15, 1);
  const mesh = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ color: 0x4f6b38, roughness: 0.95, flatShading: true }), pts.length);
  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  pts.forEach(([x, z, r], i) => {
    const s = 3.2 + r * 3.2;
    m.makeScale(s, s, s);
    m.setPosition(x, Y.green + s * 1.1 + 1.2, z);
    mesh.setMatrixAt(i, m);
    c.setHSL(0.24 + r * 0.06, 0.38, 0.26 + r * 0.1);
    mesh.setColorAt(i, c);
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function inside(x, z, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if (a.y > z !== b.y > z && x < ((b.x - a.x) * (z - a.y)) / (b.y - a.y) + a.x) ins = !ins;
  }
  return ins;
}

// ---------------------------------------------------------------- land

// Land masses (mainland + islands) as slabs rising out of the lake with a seawall edge.
function buildLand(land) {
  const top = [];
  const walls = [];
  for (const poly of land) {
    flatPolygon(poly.p, poly.x, Y.land, top);
    for (const flat of [poly.p, ...(poly.x || [])]) {
      const pts = ringFromFlat(flat);
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        walls.push(a.x, -2, a.y, b.x, -2, b.y, b.x, Y.land, b.y);
        walls.push(a.x, -2, a.y, b.x, Y.land, b.y, a.x, Y.land, a.y);
      }
    }
  }
  const group = new THREE.Group();
  group.name = 'land';
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.Float32BufferAttribute(faceUp(top), 3));
  tg.setAttribute('normal', new THREE.BufferAttribute(upNormals(top.length), 3));
  const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ color: 0x8e8b82, roughness: 1 }));
  tm.receiveShadow = true;
  group.add(tm);
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(walls, 3));
  wg.computeVertexNormals();
  group.add(new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x8c877c, roughness: 1, side: THREE.DoubleSide })));
  return group;
}

// ---------------------------------------------------------------- entry

export function buildCity(data, renderer) {
  const city = new THREE.Group();
  city.name = 'city';
  if (data.land?.length) city.add(buildLand(data.land));
  city.add(detailOnly(buildGreen(data.green || [])));
  city.add(detailOnly(buildTrees(data.green || [])));
  city.add(detailOnly(buildRail(data.rail || [])));
  city.add(buildRoads(data.roads || []));
  city.add(buildBuildings(data.buildings || [], renderer));
  return city;
}
