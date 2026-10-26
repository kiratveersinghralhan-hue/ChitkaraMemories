// The 3D world: a starfield, a glowing core and polaroid memory cards
// that fly between five layouts (galaxy, helix, sphere, wall, timeline).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const TEX_W = 320;
const TEX_H = 384;
const CARD_W = 2.6;
const CARD_H = (CARD_W * TEX_H) / TEX_W;
const MAX_IN_3D = 260;
const SX = CARD_W + 0.55;
const SY = CARD_H + 0.6;

function radialTexture(inner, outer, size = 128) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

function textSprite(text, { size = 72, color = "#ffffff", glow = "rgba(124,92,255,.95)", height = 1.6, weight = 700 } = {}) {
  const c = document.createElement("canvas");
  const g = c.getContext("2d");
  const font = `${weight} ${size}px "Space Grotesk", system-ui, sans-serif`;
  g.font = font;
  c.width = Math.ceil(g.measureText(text).width + size * 1.2);
  c.height = Math.ceil(size * 1.7);
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.shadowColor = glow;
  g.shadowBlur = size * 0.45;
  g.fillStyle = color;
  g.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.scale.set((height * c.width) / c.height, height, 1);
  return s;
}

function drawCardFace(ctx, img, item, yearLabel) {
  const W = TEX_W; const H = TEX_H; const pad = 16; const pw = W - pad * 2; const ph = pw;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#fbf8f1";
  roundRectPath(ctx, 0, 0, W, H, 12);
  ctx.fill();
  ctx.save();
  roundRectPath(ctx, pad, pad, pw, ph, 4);
  ctx.clip();
  if (img) {
    const iw = img.naturalWidth || img.width; const ih = img.naturalHeight || img.height;
    const s = Math.max(pw / iw, ph / ih);
    ctx.drawImage(img, pad + (pw - iw * s) / 2, pad + (ph - ih * s) / 2, iw * s, ih * s);
  } else {
    const gr = ctx.createLinearGradient(0, pad, 0, pad + ph);
    gr.addColorStop(0, "#241c4f");
    gr.addColorStop(1, "#3a1f45");
    ctx.fillStyle = gr;
    ctx.fillRect(pad, pad, pw, ph);
    ctx.fillStyle = "rgba(255,255,255,.5)";
    ctx.font = '500 18px "Space Grotesk", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("developing…", W / 2, pad + ph / 2);
  }
  ctx.restore();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#2a2440";
  ctx.font = '700 32px "Caveat", cursive';
  ctx.fillText(fitText(ctx, item.caption || item.event || "a memory", pw - 8), W / 2, pad + ph + 30);
  ctx.fillStyle = "#9a93ad";
  ctx.font = '600 12px "Space Grotesk", sans-serif';
  const meta = `${yearLabel}${item.uploaderName ? "  ·  " + item.uploaderName : ""}`.toUpperCase();
  ctx.fillText(fitText(ctx, meta, pw), W / 2, H - 18);
}

function makeBackTexture(label) {
  const c = document.createElement("canvas");
  c.width = TEX_W; c.height = TEX_H;
  const g = c.getContext("2d");
  const gr = g.createLinearGradient(0, 0, TEX_W, TEX_H);
  gr.addColorStop(0, "#1c1546");
  gr.addColorStop(1, "#3b1236");
  roundRectPath(g, 0, 0, TEX_W, TEX_H, 12);
  g.fillStyle = gr; g.fill();
  roundRectPath(g, 14, 14, TEX_W - 28, TEX_H - 28, 8);
  g.strokeStyle = "rgba(255,255,255,.16)"; g.lineWidth = 2; g.stroke();
  const cx = TEX_W / 2; const cy = TEX_H / 2 - 22;
  const ring = g.createLinearGradient(cx - 60, cy - 60, cx + 60, cy + 60);
  ring.addColorStop(0, "#ff4d6d"); ring.addColorStop(1, "#7c5cff");
  g.beginPath(); g.arc(cx, cy, 58, 0, Math.PI * 2); g.strokeStyle = ring; g.lineWidth = 5; g.stroke();
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = '700 50px "Space Grotesk", sans-serif'; g.fillText("CU", cx, cy + 2);
  g.font = '600 15px "Space Grotesk", sans-serif'; g.fillStyle = "rgba(255,255,255,.75)";
  g.fillText("M E M O R I E S", cx, cy + 96);
  g.font = '500 12px "Space Grotesk", sans-serif'; g.fillStyle = "rgba(255,255,255,.45)";
  g.fillText(label.toUpperCase(), cx, cy + 122);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Small image loader queue so hundreds of photos don't all download at once.
const imgQueue = [];
let imgActive = 0;
function queueImage(src, cb) { imgQueue.push({ src, cb }); pumpImages(); }
function pumpImages() {
  while (imgActive < 6 && imgQueue.length) {
    const { src, cb } = imgQueue.shift();
    imgActive++;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => { imgActive--; cb(img); pumpImages(); };
    img.onerror = () => { imgActive--; pumpImages(); };
    img.src = src;
  }
}

// Sample points from the "CU" monogram (drawn on a canvas) plus a ring around it.
function buildLogoTargets(letterCount = 1500, ringCount = 560) {
  const W = 512; const H = 256;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.font = '700 220px "Space Grotesk", "Arial Black", system-ui, sans-serif';
  g.fillText("CU", W / 2, H / 2 + 10);
  const data = g.getImageData(0, 0, W, H).data;
  const raw = [];
  for (let y = 0; y < H; y += 2) {
    for (let x = 0; x < W; x += 2) {
      if (data[(y * W + x) * 4 + 3] > 140) raw.push([x, y]);
    }
  }
  const scale = 8.2 / W;
  const out = [];
  if (raw.length) {
    for (let i = 0; i < letterCount; i++) {
      const [px, py] = raw[(Math.random() * raw.length) | 0];
      out.push({
        x: (px - W / 2 + (Math.random() - 0.5) * 2) * scale,
        y: -(py - H / 2 + (Math.random() - 0.5) * 2) * scale,
        z: (Math.random() - 0.5) * 0.8,
        ring: false,
      });
    }
  }
  for (let i = 0; i < ringCount; i++) {
    const a = (i / ringCount) * Math.PI * 2 + Math.random() * 0.01;
    const r = 3.95 + (Math.random() - 0.5) * 0.28;
    out.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: (Math.random() - 0.5) * 0.35, ring: true, angle: a });
  }
  return out;
}

export function createScene(container, { years = [], coreLabel = "", onSelect = () => {}, onHover = () => {} } = {}) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  container.appendChild(renderer.domElement);
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a0820, 0.012);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 700);
  const INTRO_POS = new THREE.Vector3(0, 0.2, 17);
  camera.position.set(0, 0.6, 24);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enabled = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.45;
  controls.minDistance = 4;
  controls.maxDistance = 120;
  controls.enablePan = false;
  controls.rotateSpeed = 0.7;

  // ── background: stars + drifting dust ──
  const dotTex = radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)", 64);
  const palette = ["#ffffff", "#c4b5ff", "#8ef0ff", "#ffb3c4"].map((c) => new THREE.Color(c));
  function starField(n, rMin, rMax, size, opacity) {
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const r = rMin + Math.random() * (rMax - rMin);
      const u = Math.random() * 2 - 1; const th = Math.random() * Math.PI * 2; const s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(th); pos[i * 3 + 1] = r * u; pos[i * 3 + 2] = r * s * Math.sin(th);
      const c = palette[(Math.random() * palette.length) | 0];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({
      size, map: dotTex, vertexColors: true, transparent: true, opacity,
      depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
    }));
  }
  const stars = starField(4200, 110, 300, 1.5, 0.95);
  const dust = starField(1000, 6, 80, 0.32, 0.75);
  scene.add(stars, dust);

  // ── lights (only the 3D logo uses lit materials) ──
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const lightA = new THREE.PointLight(0xff4d6d, 140, 60); lightA.position.set(7, 5, 10);
  const lightB = new THREE.PointLight(0x7c5cff, 140, 60); lightB.position.set(-8, -4, 8);
  const lightC = new THREE.PointLight(0x2de2e6, 80, 60); lightC.position.set(0, 7, -6);
  scene.add(lightA, lightB, lightC);

  // ── 3D shard logo: ~2,000 pieces fly in and assemble into the CU medallion ──
  const core = new THREE.Group();
  scene.add(core);
  const logo = new THREE.Group();
  core.add(logo);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radialTexture("rgba(255,110,160,0.9)", "rgba(124,92,255,0)"),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
  }));
  glow.scale.set(13, 13, 1);
  core.add(glow);

  const targets = buildLogoTargets();
  const N = targets.length;
  const shardGeo = new THREE.TetrahedronGeometry(0.095, 0);
  const shardMat = new THREE.MeshStandardMaterial({
    metalness: 0.45, roughness: 0.28, flatShading: true, emissive: 0x24103a, emissiveIntensity: 0.9,
  });
  const shards = new THREE.InstancedMesh(shardGeo, shardMat, N);
  shards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  shards.frustumCulled = false;
  const cPink = new THREE.Color("#ff4d6d"); const cMag = new THREE.Color("#c04dff");
  const cViolet = new THREE.Color("#7c5cff"); const cCyan = new THREE.Color("#2de2e6");
  const tmpC = new THREE.Color();
  const pieces = targets.map((p, i) => {
    if (p.ring) {
      const k = p.angle / (Math.PI * 2);
      tmpC.copy(cCyan).lerp(cViolet, Math.abs(k - 0.5) * 2);
    } else {
      const k = THREE.MathUtils.clamp((p.x + 2.7) / 5.4, 0, 1);
      if (k < 0.5) tmpC.copy(cPink).lerp(cMag, k * 2); else tmpC.copy(cMag).lerp(cViolet, (k - 0.5) * 2);
    }
    shards.setColorAt(i, tmpC);
    const dir = new THREE.Vector3().randomDirection();
    const dist = 26 + Math.random() * 40;
    const delay = p.ring
      ? 1.0 + (p.angle / (Math.PI * 2)) * 0.9 + Math.random() * 0.2
      : 0.1 + ((p.x + 2.7) / 5.4) * 0.9 + Math.random() * 0.35;
    return {
      t: new THREE.Vector3(p.x, p.y, p.z),
      s: dir.multiplyScalar(dist),
      delay,
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(14),
      rest: new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28),
      size: (p.ring ? 0.55 : 0.75) + Math.random() * 0.8,
      phase: Math.random() * 6.28,
    };
  });
  shards.instanceColor.needsUpdate = true;
  logo.add(shards);

  const ringA = new THREE.Mesh(new THREE.TorusGeometry(5.0, 0.02, 8, 200), new THREE.MeshBasicMaterial({ color: 0x2de2e6, transparent: true, opacity: 0.7 }));
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(5.7, 0.015, 8, 200), new THREE.MeshBasicMaterial({ color: 0xff4d6d, transparent: true, opacity: 0.55 }));
  ringA.rotation.x = Math.PI / 2.4; ringB.rotation.x = Math.PI / 1.7; ringB.rotation.y = 0.5;
  ringA.scale.setScalar(0.001); ringB.scale.setScalar(0.001);
  core.add(ringA, ringB);

  // a one-off shockwave when the logo locks together
  const shock = new THREE.Mesh(new THREE.RingGeometry(3.9, 4.15, 120),
    new THREE.MeshBasicMaterial({ color: 0xffb3d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  logo.add(shock);

  const coreText = textSprite(coreLabel, { size: 64, height: 1.0 });
  coreText.position.y = -5.4;
  coreText.material.opacity = 0;
  core.add(coreText);
  let coreTargetScale = 1;

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const INTRO_ASSEMBLE = 3.4;
  const PIECE_DUR = 1.5;
  let introClock = reduceMotion ? INTRO_ASSEMBLE + 2 : 0;
  let resolveIntro;
  const introDone = new Promise((r) => { resolveIntro = r; });
  let introResolved = false;
  const shardDummy = new THREE.Object3D();
  const easeInOut = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

  function updateLogo(dt, t) {
    introClock += dt;
    const ic = introClock;
    for (let i = 0; i < N; i++) {
      const p = pieces[i];
      const raw = THREE.MathUtils.clamp((ic - p.delay) / PIECE_DUR, 0, 1);
      const e = easeInOut(raw);
      const swirl = (1 - e) * 2.4;
      let x = p.s.x + (p.t.x - p.s.x) * e;
      let y = p.s.y + (p.t.y - p.s.y) * e;
      let z = p.s.z + (p.t.z - p.s.z) * e;
      const cs = Math.cos(swirl); const sn = Math.sin(swirl);
      const rx = x * cs - z * sn; const rz = x * sn + z * cs;
      x = rx; z = rz;
      if (raw >= 1) z += Math.sin(t * 1.4 + p.phase) * 0.035;
      shardDummy.position.set(x, y, z);
      const k = 1 - e;
      shardDummy.rotation.set(
        p.rest.x + p.spin.x * k + Math.sin(t * 0.8 + p.phase) * 0.15,
        p.rest.y + p.spin.y * k,
        p.rest.z + p.spin.z * k,
      );
      shardDummy.scale.setScalar(p.size * (0.25 + 0.75 * e));
      shardDummy.updateMatrix();
      shards.setMatrixAt(i, shardDummy.matrix);
    }
    shards.instanceMatrix.needsUpdate = true;

    // lock-in moment: glow burst, shockwave, rings, label
    const after = ic - INTRO_ASSEMBLE;
    const burst = after > 0 ? Math.exp(-after * 2.6) : 0;
    const settled = THREE.MathUtils.clamp((ic - 1.2) / 2.2, 0, 1);
    glow.material.opacity = settled * (0.55 + Math.sin(t * 1.7) * 0.12) + burst * 0.6;
    const gs = 13 + burst * 10;
    glow.scale.set(gs, gs, 1);
    if (after > 0 && after < 1.4) {
      const k = after / 1.4;
      shock.scale.setScalar(1 + k * 2.6);
      shock.material.opacity = (1 - k) * 0.9;
    } else shock.material.opacity = 0;
    const ringK = THREE.MathUtils.clamp((ic - (INTRO_ASSEMBLE - 0.4)) / 0.9, 0, 1);
    const rs = Math.max(0.001, 1 - Math.pow(1 - ringK, 3));
    ringA.scale.setScalar(rs); ringB.scale.setScalar(rs);
    coreText.material.opacity = THREE.MathUtils.clamp((ic - INTRO_ASSEMBLE) / 0.8, 0, 1);
    if (!introResolved && ic > INTRO_ASSEMBLE + 0.35) { introResolved = true; resolveIntro(); }
  }

  // ── year labels for the timeline layout ──
  const yearSprites = years.map((y) => {
    const s = textSprite(y.label, { size: 80, height: 1.6, glow: "rgba(255,77,109,.9)" });
    s.material.opacity = 0;
    scene.add(s);
    return { id: y.id, sprite: s, targetOpacity: 0 };
  });

  // ── cards ──
  const cardGroup = new THREE.Group();
  scene.add(cardGroup);
  const cardGeo = new THREE.PlaneGeometry(CARD_W, CARD_H);
  const backMat = new THREE.MeshBasicMaterial({ map: makeBackTexture(coreLabel), alphaTest: 0.5 });
  const cards = new Map();
  const yearIndex = Object.fromEntries(years.map((y, i) => [y.id, i]));
  const yearLabelOf = (id) => (years.find((y) => y.id === id) || { label: "" }).label;

  let allItems = [];
  let filterFn = () => true;
  let layout = "galaxy";
  let pickables = [];
  let hovered = null;
  let camAnim = null;
  let focused = false;

  function makeCard(item) {
    const canvas = document.createElement("canvas");
    canvas.width = TEX_W; canvas.height = TEX_H;
    const ctx = canvas.getContext("2d");
    drawCardFace(ctx, null, item, yearLabelOf(item.year));
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = maxAniso;
    const frontMat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5 });
    const front = new THREE.Mesh(cardGeo, frontMat);
    const back = new THREE.Mesh(cardGeo, backMat);
    back.rotation.y = Math.PI;
    front.userData.id = item.id; back.userData.id = item.id;
    const inner = new THREE.Group(); inner.add(front, back);
    const root = new THREE.Group(); root.add(inner);
    root.scale.setScalar(0.001);
    root.position.set((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 80, -80 - Math.random() * 60);
    cardGroup.add(root);
    const card = {
      item, root, inner, front, back, tex, frontMat,
      target: { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), scale: 0.001 },
      phase: Math.random() * Math.PI * 2, shown: false,
    };
    queueImage(item.thumb || item.url, (img) => {
      if (!cards.has(item.id)) return;
      drawCardFace(ctx, img, card.item, yearLabelOf(card.item.year));
      tex.needsUpdate = true;
    });
    return card;
  }

  function disposeCard(card) {
    cardGroup.remove(card.root);
    card.tex.dispose();
    card.frontMat.dispose();
  }

  const dummy = new THREE.Object3D();
  function setTarget(card, x, y, z, look) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, 0, 0);
    if (look) dummy.lookAt(look[0], look[1], look[2]);
    card.target.pos.copy(dummy.position);
    card.target.quat.copy(dummy.quaternion);
    card.target.scale = 1;
  }

  // Returns the recommended camera framing for the layout.
  function computeLayout(vis) {
    const n = vis.length;
    const aspect = renderer.domElement.clientWidth / Math.max(1, renderer.domElement.clientHeight) || 1.6;
    const fitDist = (w, h) => Math.max(h * 1.08, (w * 1.08) / aspect);

    if (layout === "galaxy") {
      vis.forEach((c, i) => {
        const a = i * 2.39996; const r = 6 + 1.6 * Math.sqrt(i + 1);
        const x = Math.cos(a) * r; const z = Math.sin(a) * r; const y = Math.sin(i * 0.9) * 0.9 + r * 0.04;
        setTarget(c, x, y, z, [x * 2, y + r * 0.45, z * 2]);
      });
      const R = 6 + 1.6 * Math.sqrt(n + 1);
      const d = Math.max(24, R * 2.1);
      return { pos: new THREE.Vector3(0, d * 0.45, d), target: new THREE.Vector3(0, 0, 0), auto: true, core: 1 };
    }
    if (layout === "helix") {
      const step = 0.55; const H = n * step;
      vis.forEach((c, i) => {
        const a = i * 0.45 + (i % 2) * Math.PI; const r = 8.5;
        const x = Math.cos(a) * r; const z = Math.sin(a) * r; const y = H / 2 - i * step;
        setTarget(c, x, y, z, [x * 2, y, z * 2]);
      });
      const d = Math.max(28, Math.min(70, H * 0.55 + 18));
      return { pos: new THREE.Vector3(0, H * 0.12, d), target: new THREE.Vector3(0, 0, 0), auto: true, core: 1 };
    }
    if (layout === "sphere") {
      const R = Math.max(8.5, Math.sqrt(n) * 1.6);
      vis.forEach((c, i) => {
        const k = i + 0.5; const phi = Math.acos(1 - (2 * k) / n); const th = Math.PI * (1 + Math.sqrt(5)) * k;
        const x = R * Math.cos(th) * Math.sin(phi); const y = R * Math.cos(phi); const z = R * Math.sin(th) * Math.sin(phi);
        setTarget(c, x, y, z, [x * 2, y * 2, z * 2]);
      });
      const d = Math.max(24, R * 2.7);
      return { pos: new THREE.Vector3(0, R * 0.5, d), target: new THREE.Vector3(0, 0, 0), auto: true, core: 1.4 };
    }
    if (layout === "wall") {
      const cols = Math.max(1, Math.ceil(Math.sqrt(n * 1.7)));
      const rows = Math.max(1, Math.ceil(n / cols));
      const R = Math.max(26, (cols * SX) / 2);
      vis.forEach((c, i) => {
        const col = i % cols; const row = Math.floor(i / cols);
        const xFlat = (col - (cols - 1) / 2) * SX; const y = ((rows - 1) / 2 - row) * SY;
        const th = xFlat / R;
        const x = R * Math.sin(th); const z = R * (1 - Math.cos(th));
        setTarget(c, x, y, z, [0, y, R]);
      });
      const d = fitDist(cols * SX, rows * SY);
      return { pos: new THREE.Vector3(0, 0, d), target: new THREE.Vector3(0, 0, 0), auto: false, core: 0 };
    }
    // timeline: one column block per year
    const groups = years.map(() => []);
    vis.forEach((c) => { const yi = yearIndex[c.item.year] ?? 0; groups[yi].push(c); });
    const perRow = 2; const gap = perRow * SX + 2.6; const top = 0;
    let maxRows = 1;
    groups.forEach((g, yi) => {
      const cx = (yi - (years.length - 1) / 2) * gap;
      g.forEach((c, k) => {
        const col = k % perRow; const row = Math.floor(k / perRow);
        maxRows = Math.max(maxRows, row + 1);
        setTarget(c, cx + (col - (perRow - 1) / 2) * SX, top - row * SY, 0, null);
      });
    });
    yearSprites.forEach((ys, yi) => ys.sprite.position.set((yi - (years.length - 1) / 2) * gap, top + SY * 0.5 + 1.2, 0));
    const h = maxRows * SY + 3.5; const w = years.length * gap;
    const cy = top + 2 - h / 2;
    const d = Math.min(fitDist(w, h), Math.max(30, fitDist(w, 18)));
    return { pos: new THREE.Vector3(0, cy, d), target: new THREE.Vector3(0, cy, 0), auto: false, core: 0, topY: top };
  }

  let lastFrame = null;
  let revealed = false;
  function relayout(moveCamera) {
    if (!revealed) {
      cards.forEach((c) => { c.target.scale = 0.001; });
      pickables = [];
      coreTargetScale = 1;
      yearSprites.forEach((ys) => { ys.targetOpacity = 0; });
      return;
    }
    const sorted = allItems.filter(filterFn).slice(0, MAX_IN_3D);
    const visIds = new Set(sorted.map((i) => i.id));
    const vis = sorted.map((i) => cards.get(i.id)).filter(Boolean);
    cards.forEach((c) => { if (!visIds.has(c.item.id)) c.target.scale = 0.001; });
    const frame = computeLayout(vis);
    lastFrame = frame;
    pickables = [];
    vis.forEach((c) => pickables.push(c.front, c.back));
    coreTargetScale = frame.core;
    yearSprites.forEach((ys) => { ys.targetOpacity = layout === "timeline" ? 1 : 0; });
    if (!focused) controls.autoRotate = frame.auto;
    controls.maxDistance = Math.max(120, frame.pos.distanceTo(frame.target) * 1.4);
    if (moveCamera) camAnim = { pos: frame.pos.clone(), target: frame.target.clone() };
  }

  // ── public API ──
  function setItems(items) {
    allItems = items;
    const ids = new Set(items.map((i) => i.id));
    cards.forEach((c, id) => { if (!ids.has(id)) { disposeCard(c); cards.delete(id); } });
    items.forEach((it) => {
      const existing = cards.get(it.id);
      if (existing) existing.item = it;
      else cards.set(it.id, makeCard(it));
    });
    relayout(false);
  }
  // Enter the galaxy (after sign-in): cards fly in, camera pulls back.
  function reveal() {
    if (revealed) return;
    revealed = true;
    focused = false;
    controls.enabled = true;
    relayout(true);
  }
  // Back to the logo-only intro view (signed out).
  function conceal() {
    revealed = false;
    focused = false;
    controls.enabled = false;
    controls.autoRotate = false;
    relayout(false);
    camAnim = { pos: INTRO_POS.clone(), target: new THREE.Vector3(0, 0, 0) };
  }
  function setFilter(fn) { filterFn = fn; relayout(false); }
  function setLayout(name) { layout = name; focused = false; relayout(true); }
  function focus(id) {
    const c = cards.get(id);
    if (!c) return;
    focused = true;
    controls.autoRotate = false;
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(c.target.quat);
    camAnim = { pos: c.target.pos.clone().addScaledVector(normal, 6.2), target: c.target.pos.clone(), fast: true };
  }
  function release() {
    if (!focused) return;
    focused = false;
    if (lastFrame) {
      controls.autoRotate = lastFrame.auto;
      camAnim = { pos: lastFrame.pos.clone(), target: lastFrame.target.clone() };
    }
  }
  function resetView() { focused = false; relayout(true); }

  // ── interaction ──
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pendingMove = null;
  let downAt = null;
  function pick(e) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? cards.get(hit.object.userData.id) : null;
  }
  const el = renderer.domElement;
  el.addEventListener("pointermove", (e) => { pendingMove = e; });
  el.addEventListener("pointerdown", (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  el.addEventListener("pointerup", (e) => {
    if (!downAt) return;
    const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    downAt = null;
    if (moved > 6) return;
    const c = pick(e);
    if (c) onSelect(c.item.id);
  });
  el.addEventListener("pointerleave", () => { hovered = null; el.style.cursor = ""; onHover(null); });
  controls.addEventListener("start", () => { camAnim = null; });

  function resize() {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  // ── loop ──
  const clock = new THREE.Clock();
  const tmpV = new THREE.Vector3();
  function tick() {
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    const k = 1 - Math.exp(-dt * 3.4);

    if (pendingMove) {
      const c = pick(pendingMove);
      if (c !== hovered) {
        hovered = c;
        el.style.cursor = c ? "pointer" : "";
      }
      onHover(c ? c.item : null, pendingMove.clientX, pendingMove.clientY);
      pendingMove = null;
    }

    cards.forEach((c) => {
      c.root.position.lerp(c.target.pos, k);
      c.root.quaternion.slerp(c.target.quat, k);
      const s = c.target.scale * (c === hovered ? 1.16 : 1);
      c.root.scale.lerp(tmpV.set(s, s, s), Math.min(1, k * 1.5));
      c.root.visible = c.root.scale.x > 0.02;
      c.inner.position.y = Math.sin(t * 0.9 + c.phase) * 0.12;
      c.inner.rotation.z = Math.sin(t * 0.6 + c.phase) * 0.025;
    });

    const cs = THREE.MathUtils.lerp(core.scale.x, Math.max(0.001, coreTargetScale), k);
    core.scale.setScalar(cs);
    core.visible = cs > 0.02;
    updateLogo(dt, t);
    // the logo always turns to face the camera (with a gentle sway) so "CU" never reads backwards
    logo.rotation.y = Math.atan2(camera.position.x, camera.position.z) + Math.sin(t * 0.45) * 0.28;
    logo.rotation.x = -Math.atan2(camera.position.y, Math.hypot(camera.position.x, camera.position.z)) * 0.6;
    ringA.rotation.z += dt * 0.3; ringB.rotation.z -= dt * 0.22;
    if (!revealed && !camAnim) camera.position.lerp(INTRO_POS, k * 0.35);
    stars.rotation.y += dt * 0.004;
    dust.rotation.y -= dt * 0.012;
    dust.rotation.x = Math.sin(t * 0.05) * 0.1;

    yearSprites.forEach((ys) => {
      ys.sprite.material.opacity = THREE.MathUtils.lerp(ys.sprite.material.opacity, ys.targetOpacity, k);
      ys.sprite.visible = ys.sprite.material.opacity > 0.02;
    });

    if (camAnim) {
      const ck = camAnim.fast ? Math.min(1, k * 1.6) : k * 0.75;
      camera.position.lerp(camAnim.pos, ck);
      controls.target.lerp(camAnim.target, ck);
      if (camera.position.distanceTo(camAnim.pos) < 0.05) camAnim = null;
    }
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return { setItems, setFilter, setLayout, focus, release, resetView, reveal, conceal, introDone };
}
