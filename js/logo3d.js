// Small real-time 3D metallic "CU" logo for the top-left corner.
// Extruded letters built from shapes (no font file needed), chrome + iridescent finish,
// lit by a studio environment map so the metal actually reflects.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

function letterC() {
  const s = new THREE.Shape();
  const R = 1; const r = 0.6;
  const a0 = Math.PI * 0.27; const a1 = Math.PI * 1.73;
  s.absarc(0, 0, R, a0, a1, false);
  s.absarc(0, 0, r, a1, a0, true);
  return s;
}

function letterU() {
  const s = new THREE.Shape();
  const ro = 0.85; const ri = 0.47; const top = 1.0; const by = -0.15;
  s.moveTo(-ro, top);
  s.lineTo(-ro, by);
  s.absarc(0, by, ro, Math.PI, Math.PI * 2, false);
  s.lineTo(ro, top);
  s.lineTo(ri, top);
  s.lineTo(ri, by);
  s.absarc(0, by, ri, 0, Math.PI, true);
  s.lineTo(-ri, top);
  s.closePath();
  return s;
}

export function createMetalLogo(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 9.2);

  const extrude = { depth: 0.42, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.06, bevelSegments: 4, curveSegments: 40 };
  const metal = (color) => new THREE.MeshPhysicalMaterial({
    color, metalness: 1, roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.08,
    iridescence: 0.9, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 620],
  });

  const group = new THREE.Group();
  const cGeo = new THREE.ExtrudeGeometry(letterC(), extrude); cGeo.center();
  const uGeo = new THREE.ExtrudeGeometry(letterU(), extrude); uGeo.center();
  const c = new THREE.Mesh(cGeo, metal(0xffc2d4));
  const u = new THREE.Mesh(uGeo, metal(0xd2c6ff));
  c.position.x = -1.0;
  u.position.x = 1.02;
  group.add(c, u);

  // thin chrome ring behind the letters
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.35, 0.07, 24, 120),
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.12, clearcoat: 1 }),
  );
  ring.position.z = -0.35;
  group.add(ring);

  // coloured rim lights for the brand glow
  const pink = new THREE.PointLight(0xff4d6d, 30, 20); pink.position.set(-4, 2, 4);
  const cyan = new THREE.PointLight(0x2de2e6, 22, 20); cyan.position.set(4, -2, 3);
  scene.add(group, pink, cyan);

  let spin = 0;
  let hovering = false;
  container.addEventListener("pointerenter", () => { hovering = true; spin = Math.max(spin, Math.PI * 2); });
  container.addEventListener("pointerleave", () => { hovering = false; });

  function resize() {
    const w = container.clientWidth || 44; const h = container.clientHeight || 44;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener("visibilitychange", () => { running = !document.hidden; if (running) requestAnimationFrame(loop); });
  function loop() {
    if (!running) return;
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    if (spin > 0) { const step = Math.min(spin, dt * 7); spin -= step; group.rotation.y += step; }
    else if (!reduce) {
      const target = Math.sin(t * 0.7) * 0.55;
      const base = Math.round(group.rotation.y / (Math.PI * 2)) * Math.PI * 2;
      group.rotation.y += (base + target - group.rotation.y) * Math.min(1, dt * 2.5);
    }
    group.rotation.x = Math.sin(t * 0.9) * 0.12 + (hovering ? -0.08 : 0);
    pink.position.x = Math.cos(t * 0.8) * 4;
    cyan.position.y = Math.sin(t * 0.6) * 3;
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  container.classList.add("is-3d");
}
