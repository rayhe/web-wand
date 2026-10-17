// wand3d.js — a live 3D model of the wand, using three.js.
//
// The model is built in the body frame from orientation.js (X = tip,
// Z = top/buttons), and the scene uses Z-up world coordinates, so a
// quaternion from OrientationFilter can be applied to it directly.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const TIP_DISTANCE = 0.92; // body-frame X of the tip, in model units
const TRAIL_MAX = 1500;

function cssColor(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return new THREE.Color(v || fallback);
}

/** Cylinder running along +X from x0 to x1. */
function segment(x0, x1, r0, r1, material) {
  const geo = new THREE.CylinderGeometry(r1, r0, x1 - x0, 28);
  geo.rotateZ(-Math.PI / 2); // cylinder axis Y -> X, r0 at x0
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.x = (x0 + x1) / 2;
  return mesh;
}

export function createWandView(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  container.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 50);
  camera.up.set(0, 0, 1);
  const home = { pos: new THREE.Vector3(-1.45, -0.55, 0.7), target: new THREE.Vector3(0.4, 0, 0.05) };
  camera.position.copy(home.pos);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(home.target);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.minDistance = 0.8;
  controls.maxDistance = 5;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x404050, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(-1, -2, 3);
  scene.add(sun);

  // Floor grid in the XY plane, plus an arrow showing "forward".
  const grid = new THREE.GridHelper(3, 12);
  grid.rotateX(Math.PI / 2);
  grid.position.z = -0.45;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);
  const forward = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -0.45), 0.6, 0x888888, 0.08, 0.05);
  scene.add(forward);

  // ---- The wand, along +X with the grip buttons on top (+Z). ----
  const wand = new THREE.Group();
  const handleMat = new THREE.MeshStandardMaterial({ color: 0x3b2a1e, roughness: 0.6 });
  const shaftMat = new THREE.MeshStandardMaterial({ color: 0x6b4a30, roughness: 0.5 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.5 });
  wand.add(segment(-0.24, -0.2, 0.03, 0.042, capMat)); // pommel
  wand.add(segment(-0.2, 0.12, 0.042, 0.036, handleMat)); // grip
  wand.add(segment(0.12, 0.16, 0.036, 0.03, capMat)); // collar
  wand.add(segment(0.16, TIP_DISTANCE - 0.01, 0.026, 0.009, shaftMat)); // shaft

  const tipMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 0.6 });
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), tipMat);
  tip.position.x = TIP_DISTANCE;
  wand.add(tip);

  // Four grip buttons on top of the handle, lit while pressed.
  const buttonOff = new THREE.Color(0x5b4a3c);
  const buttons = [0, 1, 2, 3].map((i) => {
    const mat = new THREE.MeshStandardMaterial({ color: buttonOff.clone(), emissive: 0x000000 });
    const pad = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.026, 0.012), mat);
    pad.position.set(0.06 - i * 0.07, 0, 0.042);
    wand.add(pad);
    return mat;
  });
  scene.add(wand);

  // ---- Tip path ----
  const trailPositions = new Float32Array(TRAIL_MAX * 3);
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeo.setDrawRange(0, 0);
  const trailMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.95 });
  scene.add(new THREE.Line(trailGeo, trailMat));
  let trailCount = 0;

  function applyTheme() {
    const accent = cssColor('--trail', '#7a4fd6');
    trailMat.color.copy(accent);
    grid.material.color = cssColor('--muted', '#888888');
    forward.setColor(cssColor('--muted', '#888888'));
    for (const m of buttons) if (m.emissive.getHex() !== 0) m.emissive.copy(cssColor('--gold', '#e2b75d'));
  }
  applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  let running = true;
  (function frame() {
    if (!running) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  })();

  return {
    /** q = [w, x, y, z], body -> world. */
    setOrientation(q) {
      wand.quaternion.set(q[1], q[2], q[3], q[0]);
    },
    /** Append a world-space tip position to the path. */
    addTrailPoint(p) {
      if (trailCount === TRAIL_MAX) {
        trailPositions.copyWithin(0, 3);
        trailCount--;
      }
      trailPositions.set(p, trailCount * 3);
      trailCount++;
      trailGeo.setDrawRange(0, trailCount);
      trailGeo.attributes.position.needsUpdate = true;
      trailGeo.computeBoundingSphere();
    },
    clearTrail() {
      trailCount = 0;
      trailGeo.setDrawRange(0, 0);
    },
    setButtons(pressed, all) {
      const on = cssColor(all ? '--gold' : '--accent', '#e2b75d');
      pressed.forEach((p, i) => {
        buttons[i].color.copy(p ? on : buttonOff);
        buttons[i].emissive.copy(p ? on : new THREE.Color(0));
        buttons[i].emissiveIntensity = p ? 0.6 : 0;
      });
    },
    setTipGlow(on) {
      tipMat.emissiveIntensity = on ? 1.6 : 0.6;
    },
    resetView() {
      camera.position.copy(home.pos);
      controls.target.copy(home.target);
    },
    dispose() {
      running = false;
      renderer.dispose();
    },
  };
}
