# Downtown Toronto · 3D

A browser-based 3D model of downtown Toronto built with [Three.js](https://threejs.org) and Vite.
Hand-modelled CN Tower and Rogers Centre; ~26,000 other buildings, roads, the elevated Gardiner,
rail corridor, parks, shoreline and the Toronto Islands come from OpenStreetMap.

## Run

```bash
npm install
npm run dev        # open http://localhost:5173
```

## Controls

Drag to orbit · scroll to zoom · right-drag to pan. Use the bottom bar (or click a label) to fly to a landmark.

## Data

`public/data/toronto.json` is pre-generated, so the app works offline. To regenerate it from OpenStreetMap:

```bash
npm run fetch-data            # uses cached raw downloads in scripts/.cache
npm run fetch-data -- --fresh # re-download everything
```

`npm run build` produces a static site in `dist/` that can be hosted anywhere.

Map data © OpenStreetMap contributors (ODbL).
