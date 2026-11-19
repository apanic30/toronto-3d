// One-time data pipeline: downloads public OpenStreetMap data for downtown
// Toronto from the Overpass API and converts it into a compact JSON file in
// local metre coordinates (public/data/toronto.json).
//
//   npm run fetch-data            (uses cached raw responses if present)
//   npm run fetch-data -- --fresh (re-download everything)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pc from 'polygon-clipping';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = path.join(ROOT, 'scripts', '.cache');
const OUT = path.join(ROOT, 'public', 'data', 'toronto.json');
const FRESH = process.argv.includes('--fresh');

// south, west, north, east
const BBOX = [43.6, -79.43, 43.67, -79.33];
const B = BBOX.join(',');

// Origin = CN Tower. x = east (m), z = south (m), y = up.
const LAT0 = 43.642566;
const LON0 = -79.387057;
const KX = Math.cos((LAT0 * Math.PI) / 180) * 111320;
const KZ = 110574;
const project = (lat, lon) => [(lon - LON0) * KX, -(lat - LAT0) * KZ];

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

const QUERIES = {
  buildings: `
    (way["building"](${B}); relation["building"](${B});
     way["building:part"](${B}); relation["building:part"](${B}););
    out geom;`,
  roads: `
    way["highway"~"^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|residential|unclassified|living_street|pedestrian)$"](${B});
    out geom;`,
  rail: `
    (way["railway"~"^(rail|tram|light_rail)$"](${B}););
    out geom;`,
  green: `
    (way["leisure"~"^(park|garden|golf_course|pitch|playground)$"](${B});
     relation["leisure"~"^(park|garden|golf_course)$"](${B});
     way["landuse"~"^(grass|recreation_ground|cemetery|meadow|village_green|forest)$"](${B});
     relation["landuse"~"^(grass|recreation_ground|forest)$"](${B});
     way["natural"~"^(wood|scrub|grassland|beach|sand)$"](${B});
     relation["natural"~"^(wood|scrub|beach)$"](${B}););
    out geom(${B});`,
  water: `
    (way["natural"="water"](${B}); relation["natural"="water"](${B});
     way["waterway"="riverbank"](${B});
     way["place"~"^(island|islet)$"](${B}); relation["place"~"^(island|islet)$"](${B});
     way["natural"="coastline"](${B}););
    out geom(${B});`,
  // Full (unclipped) geometry of the Lake Ontario shoreline ways near downtown.
  lake: `rel(1206310);way(r)(${B});out geom;`,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(name, body) {
  const file = path.join(CACHE, `${name}.json`);
  if (!FRESH && fs.existsSync(file)) {
    console.log(`  ${name}: cached`);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  const query = `[out:json][timeout:180];${body}`;
  let wait = 5000;
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    try {
      console.log(`  ${name}: requesting ${new URL(url).host} (attempt ${attempt + 1})`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'toronto-3d-viewer/1.0' },
        body: 'data=' + encodeURIComponent(query),
        signal: AbortSignal.timeout(240000),
      });
      const text = await res.text();
      if (!res.ok || !text.trimStart().startsWith('{')) throw new Error(`HTTP ${res.status}`);
      const json = JSON.parse(text);
      if (json.remark && /error|timed out/i.test(json.remark)) throw new Error(json.remark);
      fs.mkdirSync(CACHE, { recursive: true });
      fs.writeFileSync(file, text);
      console.log(`  ${name}: ${json.elements.length} elements`);
      return json;
    } catch (err) {
      console.log(`  ${name}: failed (${err.message}), retrying in ${wait / 1000}s`);
      await sleep(wait);
      wait = Math.min(wait * 2, 60000);
    }
  }
  throw new Error(`Could not download ${name}`);
}

// ---------------------------------------------------------------- geometry

const r1 = (v) => Math.round(v * 10) / 10;

function toRing(geom) {
  const pts = [];
  for (const g of geom) {
    if (!g) continue;
    const [x, z] = project(g.lat, g.lon);
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev[0] - x) < 0.05 && Math.abs(prev[1] - z) < 0.05) continue;
    pts.push([x, z]);
  }
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a[0] - b[0]) < 0.05 && Math.abs(a[1] - b[1]) < 0.05) pts.pop();
  }
  return pts;
}

const flat = (ring) => ring.flatMap(([x, z]) => [r1(x), r1(z)]);

function area(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

function centroid(ring) {
  let x = 0, z = 0;
  for (const p of ring) { x += p[0]; z += p[1]; }
  return [x / ring.length, z / ring.length];
}

function pointInRing([px, pz], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Join relation member ways (which may be split) into closed rings.
function stitch(ways) {
  const segs = ways.map((w) => w.filter(Boolean)).filter((w) => w.length > 1);
  const rings = [];
  const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  while (segs.length) {
    let cur = segs.shift();
    let changed = true;
    while (key(cur[0]) !== key(cur[cur.length - 1]) && changed) {
      changed = false;
      for (let i = 0; i < segs.length; i++) {
        const s = segs[i];
        const end = key(cur[cur.length - 1]);
        if (key(s[0]) === end) cur = cur.concat(s.slice(1));
        else if (key(s[s.length - 1]) === end) cur = cur.concat(s.slice().reverse().slice(1));
        else if (key(s[s.length - 1]) === key(cur[0])) cur = s.concat(cur.slice(1));
        else if (key(s[0]) === key(cur[0])) cur = s.slice().reverse().concat(cur.slice(1));
        else continue;
        segs.splice(i, 1);
        changed = true;
        break;
      }
    }
    rings.push(cur);
  }
  return rings;
}

// Returns [{outer: ring, holes: [ring]}] for a way or multipolygon relation.
function polygonsOf(el) {
  if (el.type === 'way') {
    if (!el.geometry) return [];
    const ring = toRing(el.geometry);
    return ring.length >= 3 ? [{ outer: ring, holes: [] }] : [];
  }
  const outers = stitch(el.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry))
    .map(toRing).filter((r) => r.length >= 3);
  const inners = stitch(el.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => m.geometry))
    .map(toRing).filter((r) => r.length >= 3);
  return outers.map((outer) => ({
    outer,
    holes: inners.filter((h) => pointInRing(h[0], outer)),
  }));
}

function parseHeight(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^([\d.]+)\s*(m|ft|')?/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === 'ft' || m[2] === "'") n *= 0.3048;
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------- layers

// Footprints replaced by hand-made landmark models.
const EXCLUDE_NAME = /^(CN Tower|Rogers Centre|SkyDome)$/i;
const EXCLUDE_RADIUS = [
  { c: [0, 0], r: 45 }, // CN Tower base
  { c: [-175, 102], r: 126 }, // Rogers Centre stadium (OSM has unnamed parts)
];

function buildBuildings(json) {
  const parts = [];
  const shells = [];
  for (const el of json.elements) {
    const t = el.tags || {};
    if (EXCLUDE_NAME.test(t.name || '')) continue;
    if (t['building'] === 'roof' && !t.height) continue;
    const isPart = t['building:part'] && t['building:part'] !== 'no';
    if (!isPart && (!t.building || t.building === 'no')) continue;
    if (t.location === 'underground' || t.layer && +t.layer < 0) continue;

    const levels = parseFloat(t['building:levels']);
    const minLevels = parseFloat(t['building:min_level']);
    let h = parseHeight(t.height) ?? (Number.isFinite(levels) ? levels * 3.4 + 1 : null);
    let mh = parseHeight(t.min_height) ?? (Number.isFinite(minLevels) ? minLevels * 3.4 : 0);
    const tagged = h != null;
    if (h == null) h = t.building === 'house' || t.building === 'garage' || t.building === 'shed' ? 8 : 11;
    if (t.building === 'roof') mh = Math.max(mh, h - 1);
    if (mh >= h) continue;

    for (const poly of polygonsOf(el)) {
      if (Math.abs(area(poly.outer)) < 8) continue;
      const c = centroid(poly.outer);
      if (EXCLUDE_RADIUS.some((e) => Math.hypot(c[0] - e.c[0], c[1] - e.c[1]) < e.r)) continue;
      const rec = { poly, c, h, mh, tagged, part: isPart, mat: t['building:material'] || t['building:facade:material'] || '', colour: t['building:colour'] || '' };
      (isPart ? parts : shells).push(rec);
    }
  }

  // Drop building outlines that are covered by building:part pieces.
  const CELL = 50;
  const grid = new Map();
  for (const p of parts) {
    const k = `${Math.floor(p.c[0] / CELL)},${Math.floor(p.c[1] / CELL)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const kept = [];
  for (const s of shells) {
    let xs = Infinity, xe = -Infinity, zs = Infinity, ze = -Infinity;
    for (const [x, z] of s.poly.outer) { xs = Math.min(xs, x); xe = Math.max(xe, x); zs = Math.min(zs, z); ze = Math.max(ze, z); }
    let covered = false;
    for (let gx = Math.floor(xs / CELL); gx <= Math.floor(xe / CELL) && !covered; gx++) {
      for (let gz = Math.floor(zs / CELL); gz <= Math.floor(ze / CELL) && !covered; gz++) {
        for (const p of grid.get(`${gx},${gz}`) || []) {
          if (pointInRing(p.c, s.poly.outer)) { covered = true; break; }
        }
      }
    }
    if (!covered) kept.push(s);
  }

  return [...kept, ...parts].map((b) => {
    const o = { h: r1(b.h), p: flat(b.poly.outer) };
    if (b.mh > 0) o.m = r1(b.mh);
    if (b.poly.holes.length) o.x = b.poly.holes.map(flat);
    if (b.colour) o.c = b.colour;
    if (b.mat) o.t = b.mat;
    return o;
  });
}

const ROAD_WIDTH = {
  motorway: 22, trunk: 18, primary: 15, secondary: 13, tertiary: 11,
  motorway_link: 8, trunk_link: 8, primary_link: 8, secondary_link: 8,
  residential: 8, unclassified: 8, living_street: 6, pedestrian: 7,
};

function buildRoads(json) {
  const out = [];
  for (const el of json.elements) {
    const t = el.tags || {};
    if (!el.geometry || t.tunnel === 'yes' || t.tunnel === 'building_passage' || t.covered === 'yes') continue;
    if (t.area === 'yes') continue;
    const pts = el.geometry.map((g) => project(g.lat, g.lon));
    if (pts.length < 2) continue;
    let w = ROAD_WIDTH[t.highway] || 8;
    const lanes = parseInt(t.lanes, 10);
    if (Number.isFinite(lanes) && lanes > 0) w = Math.max(w * 0.6, Math.min(lanes * 3.4, 30));
    const layer = parseInt(t.layer, 10) || 0;
    const bridge = t.bridge && t.bridge !== 'no';
    const gardiner = /Gardiner/i.test(t.name || '');
    // The Gardiner runs ~12m above the street through downtown.
    let e = 0;
    if (bridge) e = gardiner ? 13 : Math.max(1, layer) * 6;
    out.push({ k: t.highway, w: r1(w), e, g: gardiner ? 1 : 0, p: pts.flatMap(([x, z]) => [r1(x), r1(z)]) });
  }
  return out;
}

function buildRail(json) {
  const out = [];
  for (const el of json.elements) {
    const t = el.tags || {};
    if (!el.geometry || t.tunnel === 'yes') continue;
    const pts = el.geometry.map((g) => project(g.lat, g.lon));
    if (pts.length < 2) continue;
    const bridge = t.bridge && t.bridge !== 'no';
    out.push({
      k: t.railway === 'rail' ? 'rail' : 'tram',
      e: bridge ? Math.max(1, parseInt(t.layer, 10) || 1) * 5 : 0,
      p: pts.flatMap(([x, z]) => [r1(x), r1(z)]),
    });
  }
  return out;
}

function polysOut(polys) {
  return polys
    .filter((p) => Math.abs(area(p.outer)) > 30)
    .map((p) => (p.holes.length ? { p: flat(p.outer), x: p.holes.map(flat) } : { p: flat(p.outer) }));
}

function buildGreen(json) {
  const out = [];
  for (const el of json.elements) {
    const t = el.tags || {};
    const kind = t.natural === 'beach' || t.natural === 'sand' ? 'sand'
      : t.leisure === 'pitch' ? 'pitch'
      : t.natural === 'wood' || t.landuse === 'forest' ? 'wood' : 'grass';
    for (const p of polysOut(polygonsOf(el))) out.push({ k: kind, ...p });
  }
  return out;
}

// Land = (mainland north of the Lake Ontario shoreline + islands) minus smaller
// water bodies (slips, ponds, channels). The global lake plane shows through.
const VIEW = 30000; // land extends this far (m) so the horizon isn't empty
function buildLand(waterJson, lakeJson) {
  const lakeRel = waterJson.elements.find((e) => e.type === 'relation' && e.id === 1206310);
  const roles = new Map(lakeRel.members.map((m) => [m.ref, m.role]));
  const lakeWays = lakeJson.elements.filter((e) => e.type === 'way' && e.geometry);
  const outerChains = stitch(lakeWays.filter((w) => roles.get(w.id) !== 'inner').map((w) => w.geometry)).map(toRing);
  const innerRings = stitch(lakeWays.filter((w) => roles.get(w.id) === 'inner').map((w) => w.geometry))
    .filter((g) => g.length > 3 && g[0].lat === g[g.length - 1].lat && g[0].lon === g[g.length - 1].lon)
    .map(toRing);

  // Mainland shoreline = longest open chain; orient west -> east and close it to the north.
  outerChains.sort((a, b) => b.length - a.length);
  let shore = outerChains[0];
  if (shore[0][0] > shore[shore.length - 1][0]) shore = shore.slice().reverse();
  const first = shore[0], last = shore[shore.length - 1];
  console.log(`  shoreline: ${shore.length} pts from (${first.map(Math.round)}) to (${last.map(Math.round)}); ${outerChains.length} chains, ${innerRings.length} lake islands`);
  const mainland = [[-VIEW, first[1]], ...shore, [VIEW, last[1]], [VIEW, -VIEW], [-VIEW, -VIEW]];

  const toPc = (ring) => [ring.map(([x, z]) => [x, z]).concat([ring[0]])];
  let land = [toPc(mainland)];
  const islands = [];
  for (const el of waterJson.elements) {
    const t = el.tags || {};
    if (t.place === 'island' || t.place === 'islet') for (const p of polygonsOf(el)) islands.push(toPc(p.outer));
  }
  for (const r of innerRings) if (r.length >= 3) islands.push(toPc(r));
  land = pc.union(...land, ...islands);

  // Cut out other closed water bodies (skip ones clipped by the bbox query).
  const holes = [];
  for (const el of waterJson.elements) {
    const t = el.tags || {};
    if (el.id === 1206310 || t.place || t.natural === 'coastline') continue;
    if (t.natural !== 'water' && t.waterway !== 'riverbank') continue;
    const geoms = el.type === 'way' ? [el.geometry] : el.members.map((m) => m.geometry || []);
    if (geoms.some((g) => g && g.some((p) => p == null))) continue;
    for (const p of polygonsOf(el)) if (Math.abs(area(p.outer)) > 150) holes.push(toPc(p.outer));
  }
  if (holes.length) land = pc.difference(land, ...holes);

  const round = (ring) => ring.slice(0, -1).flatMap(([x, z]) => [r1(x), r1(z)]);
  return land.map((poly) => {
    const o = { p: round(poly[0]) };
    if (poly.length > 1) o.x = poly.slice(1).map(round);
    return o;
  });
}

// ---------------------------------------------------------------- main

console.log('Downloading OpenStreetMap data…');
const raw = {};
for (const [name, q] of Object.entries(QUERIES)) raw[name] = await overpass(name, q);

console.log('Processing…');
const buildings = buildBuildings(raw.buildings);
const roads = buildRoads(raw.roads);
const rail = buildRail(raw.rail);
const green = buildGreen(raw.green);
const land = buildLand(raw.water, raw.lake);

const [s, w, n, e] = BBOX;
const [minX, maxZ] = project(s, w);
const [maxX, minZ] = project(n, e);

const data = {
  origin: { lat: LAT0, lon: LON0 },
  bounds: { minX: r1(minX), maxX: r1(maxX), minZ: r1(minZ), maxZ: r1(maxZ) },
  buildings, roads, rail, green, land,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
const mb = (fs.statSync(OUT).size / 1e6).toFixed(1);
console.log(`Wrote ${path.relative(ROOT, OUT)} (${mb} MB): ${buildings.length} buildings, ${roads.length} roads, ${rail.length} rail, ${green.length} green, ${land.length} land`);
