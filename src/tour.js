import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

// Coordinates: metres from the CN Tower, x = east, z = south, y = up.
export const ROGERS_CENTRE_POS = new THREE.Vector3(-175, 0, 102);

export const STOPS = [
  {
    id: 'overview',
    name: 'Overview',
    cam: [-1750, 950, 2350],
    target: [250, 60, -350],
    info: 'Downtown Toronto from above Lake Ontario: the Financial District towers, the CN Tower and Rogers Centre on the waterfront, and the Toronto Islands to the south.',
  },
  {
    id: 'cn',
    name: 'CN Tower',
    label: [0, 562, 0],
    cam: [-430, 420, 560],
    target: [0, 290, 0],
    info: 'Completed in 1976 and standing 553.3 m tall, it was the world’s tallest free-standing structure for over three decades. The main pod sits at ~346 m and the SkyPod at 447 m.',
  },
  {
    id: 'rogers',
    name: 'Rogers Centre',
    label: [ROGERS_CENTRE_POS.x, 94, ROGERS_CENTRE_POS.z],
    cam: [-640, 300, 560],
    target: [ROGERS_CENTRE_POS.x, 30, ROGERS_CENTRE_POS.z],
    info: 'Opened in 1989 as SkyDome, home of the Toronto Blue Jays. It had the world’s first fully retractable motorized roof — four panels that open in about 20 minutes.',
  },
  {
    id: 'union',
    name: 'Union Station',
    label: [550, 40, -287],
    cam: [700, 560, 60],
    target: [545, 10, -300],
    info: 'Canada’s busiest transportation hub, opened in 1927. The rail corridor and the elevated Gardiner Expressway run just south of it.',
  },
  {
    id: 'financial',
    name: 'Financial District',
    label: [432, 305, -683],
    cam: [1150, 520, -80],
    target: [480, 170, -650],
    info: 'Around King & Bay: First Canadian Place (298 m), Scotia Plaza, Commerce Court and the black TD Centre towers by Mies van der Rohe.',
  },
  {
    id: 'harbour',
    name: 'Harbourfront',
    label: [336, 30, 394],
    cam: [250, 220, 1250],
    target: [300, 30, 300],
    info: 'The waterfront along Queens Quay: arts centre, marinas and ferry docks across the inner harbour to the islands.',
  },
  {
    id: 'islands',
    name: 'Toronto Islands',
    label: [700, 30, 2300],
    cam: [900, 70, 2650],
    target: [150, 230, -200],
    info: 'A chain of car-free islands sheltering the harbour — the classic place to see the skyline. Billy Bishop Airport sits on the westernmost island.',
  },
];

export function createLabels(scene, onSelect) {
  for (const stop of STOPS) {
    if (!stop.label) continue;
    const el = document.createElement('div');
    el.className = 'label';
    el.textContent = stop.name;
    el.addEventListener('click', () => onSelect(stop.id));
    const obj = new CSS2DObject(el);
    obj.position.set(...stop.label);
    scene.add(obj);
  }
}

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class CameraTour {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.anim = null;
  }

  flyTo(stop, duration) {
    const fromPos = this.camera.position.clone();
    const fromTarget = this.controls.target.clone();
    const toPos = new THREE.Vector3(...stop.cam);
    const toTarget = new THREE.Vector3(...stop.target);
    const dist = fromPos.distanceTo(toPos);
    // Arc up a little on long flights so we don't skim through towers.
    const lift = Math.min(dist * 0.25, 700);
    this.anim = {
      fromPos, fromTarget, toPos, toTarget, lift,
      start: performance.now(),
      duration: duration ?? THREE.MathUtils.clamp(1200 + dist * 0.5, 1600, 3200),
    };
    this.controls.enabled = false;
  }

  cancel() {
    if (this.anim) {
      this.anim = null;
      this.controls.enabled = true;
    }
  }

  update(now) {
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, (now - a.start) / a.duration);
    const k = ease(t);
    this.camera.position.lerpVectors(a.fromPos, a.toPos, k);
    this.camera.position.y += Math.sin(Math.PI * k) * a.lift;
    this.controls.target.lerpVectors(a.fromTarget, a.toTarget, k);
    if (t >= 1) {
      this.anim = null;
      this.controls.enabled = true;
    }
  }
}
