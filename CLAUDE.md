# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Ownership

Developed by Abraham Panicker. The project is stored in Abraham Panicker's GitHub repository.

Project memory lives in `memory/` (index: @memory/MEMORY.md, identity: @memory/user-identity.md).

## What this is

A browser-based 3D model of downtown Toronto: plain JavaScript + Three.js, served by Vite (no framework, no TypeScript). There is no test suite or linter; verify changes visually in the browser (`.claude/launch.json` defines the `toronto-3d` dev server on port 5173).

## Commands

```bash
npm run dev                    # dev server at http://localhost:5173
npm run build                  # static site -> dist/ (the >500 kB chunk warning is just three.js; ignore)
npm run fetch-data             # rebuild public/data/toronto.json from cached OSM downloads in scripts/.cache
npm run fetch-data -- --fresh  # re-download everything from Overpass
```

The public Overpass servers are frequently overloaded (HTTP 502 / HTML error bodies). `scripts/fetch-osm.mjs` retries across mirrors with backoff and caches each raw response per query, so re-running only processes. If a cached file isn't valid JSON, delete it and rerun.

## Architecture

**Two-stage pipeline.** `scripts/fetch-osm.mjs` (Node, runs offline from the app) downloads OSM data and writes one compact JSON (`public/data/toronto.json`, committed so the app never hits the network). The browser (`src/city.js`) only turns that JSON into meshes. Geometry decisions that need geography (excluding footprints, building land polygons, picking heights) belong in the script; rendering decisions belong in `city.js`.

**Coordinate system (shared by everything).** Metres from the CN Tower (lat 43.642566, lon -79.387057): `x` = east, `z` = **south**, `y` = up. Projection constants live in `fetch-osm.mjs`; landmark/camera positions in `src/tour.js` use the same frame. JSON polygons are flat `[x, z, x, z, ...]` arrays rounded to 0.1 m; building records are `{h, m?(min height), p, x?(holes), c?(colour), t?(material)}`.

**Land and water.** There is no water geometry in the data. `src/environment.js` draws one huge `Water` plane at y=0; the script builds `land` polygons (mainland closed to the north from the Lake Ontario shoreline relation 1206310, plus islands, minus slips/ponds via `polygon-clipping`) and `city.js` extrudes them as slabs at y≈1 so the lake shows through the gaps. Flat layers stack at small y offsets (see `Y` in `city.js`) plus `polygonOffset` to avoid z-fighting.

**Landmarks.** CN Tower and Rogers Centre are procedural (`src/landmarks/`). Their OSM footprints are removed in the script via `EXCLUDE_NAME` and `EXCLUDE_RADIUS` (OSM has unnamed `building:part`s for the stadium). If you move or resize a landmark, update both the exclusion in the script and `ROGERS_CENTRE_POS` / stops in `tour.js`.

**Buildings.** All ~26k footprints are merged into a few meshes by height band (`glass` ≥55 m, `mid` ≥18 m, `low`) plus one roof mesh. Colours are per-vertex; window patterns are procedural canvas textures with world-scaled UVs (`FLOOR`/`BAY`). Outlines covered by `building:part`s are dropped in the script.

## Gotchas learned the hard way

- **Winding/normals.** Because `z` points south, triangles that look CCW in (x,z) are back-facing from above. Flat geometry goes through `faceUp()` in `city.js`; wall normals and the CN Tower loft winding were each flipped once. If a surface looks see-through or lit from the wrong side, check this first.
- **Performance budget.** The `Water` reflection re-renders the scene every frame. Ground-level detail (low buildings, roofs, roads, rail, green, trees) is put on `DETAIL_LAYER` (layer 1): the main camera sees it, the reflection camera (layer 0 only) doesn't. New small or numerous objects should use `detailOnly()`.
- **Shadows are static.** `renderer.shadowMap.autoUpdate = false`; set `renderer.shadowMap.needsUpdate = true` after adding or moving anything that casts shadows.
- Startup uses `renderer.compileAsync`; most of the ~7 s load is GPU shader compilation, not data processing (~1 s).
- In dev, `window.__three` exposes `{ scene, renderer, camera, controls }` for debugging in the browser console. Note that `select('overview')` runs after load and will override a camera position set too early.
- Attribution "© OpenStreetMap contributors" must stay visible (ODbL).
