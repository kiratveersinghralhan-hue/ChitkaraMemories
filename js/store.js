// Data layer: Firebase (Auth + Firestore) with an in-browser demo fallback.
import {
  FIREBASE_CONFIG, ALLOWED_EMAIL_DOMAIN, ADMIN_EMAILS, CLOUDINARY, MAX_PHOTOS, YEARS,
} from "./config.js";

export const isDemo = !FIREBASE_CONFIG.apiKey;
const FB_VERSION = "10.12.2";

const itemSubs = new Set();
const authSubs = new Set();
const errSubs = new Set();
let currentUser = null;
let fb = null;
let demoItems = [];

export function onItems(fn) { itemSubs.add(fn); }
export function onAuth(fn) { authSubs.add(fn); fn(currentUser); }
export function onError(fn) { errSubs.add(fn); }
const emitItems = (items) => itemSubs.forEach((f) => f(items));
const emitAuth = () => authSubs.forEach((f) => f(currentUser));
const emitError = (m) => errSubs.forEach((f) => f(m));

export function getUser() { return currentUser; }
export function emailAllowed(email) {
  if (!ALLOWED_EMAIL_DOMAIN) return true;
  return (email || "").toLowerCase().endsWith("@" + ALLOWED_EMAIL_DOMAIN.toLowerCase());
}
export function isAdmin(u = currentUser) {
  return !!u && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes((u.email || "").toLowerCase());
}
export function canDelete(item) {
  return !!currentUser && (item.uploaderUid === currentUser.uid || isAdmin());
}

function normalize(id, d) {
  const ts = d.createdAt && typeof d.createdAt.toMillis === "function" ? d.createdAt.toMillis() : Date.now();
  return {
    id,
    url: d.url || "",
    thumb: d.thumb || d.url || "",
    w: d.w || 0,
    h: d.h || 0,
    caption: d.caption || "",
    year: d.year || YEARS[0].id,
    event: d.event || "",
    people: Array.isArray(d.people) ? d.people : [],
    uploaderUid: d.uploaderUid || "",
    uploaderName: d.uploaderName || "Someone",
    uploaderPhoto: d.uploaderPhoto || "",
    likedBy: Array.isArray(d.likedBy) ? d.likedBy : [],
    createdAt: ts,
  };
}

function friendlyError(e) {
  const code = e && e.code ? e.code : "";
  if (code.includes("permission-denied")) return "Not allowed — are you signed in with your college email?";
  if (code.includes("unauthorized-domain")) return "This website's domain isn't authorised in Firebase Auth settings yet.";
  if (code.includes("popup-blocked")) return "Your browser blocked the sign-in popup. Allow popups and try again.";
  if (code.includes("network")) return "Network problem — check your connection.";
  return (e && e.message) || "Something went wrong.";
}

// ───────────────────────── init ─────────────────────────
export async function initStore() {
  if (isDemo) { demoInit(); return; }
  const base = `https://www.gstatic.com/firebasejs/${FB_VERSION}`;
  const [appM, authM, fsM] = await Promise.all([
    import(`${base}/firebase-app.js`),
    import(`${base}/firebase-auth.js`),
    import(`${base}/firebase-firestore.js`),
  ]);
  const app = appM.initializeApp(FIREBASE_CONFIG);
  const auth = authM.getAuth(app);
  const db = fsM.getFirestore(app);
  fb = { auth, db, authM, fsM };

  authM.onAuthStateChanged(auth, (u) => {
    if (u && !emailAllowed(u.email)) {
      authM.signOut(auth);
      emitError(`Please sign in with your @${ALLOWED_EMAIL_DOMAIN} email.`);
      currentUser = null;
    } else {
      currentUser = u ? { uid: u.uid, name: u.displayName || u.email.split("@")[0], email: u.email, photo: u.photoURL || "" } : null;
    }
    emitAuth();
  });

  const q = fsM.query(fsM.collection(db, "memories"), fsM.orderBy("createdAt", "desc"), fsM.limit(MAX_PHOTOS));
  fsM.onSnapshot(
    q,
    (snap) => emitItems(snap.docs.map((d) => normalize(d.id, d.data()))),
    (err) => { console.error(err); emitError("Couldn't load memories: " + friendlyError(err)); emitItems([]); },
  );
}

// ───────────────────────── auth ─────────────────────────
export async function signIn() {
  if (isDemo) {
    currentUser = { uid: "demo-me", name: "You (demo)", email: "you@" + (ALLOWED_EMAIL_DOMAIN || "example.com"), photo: "" };
    emitAuth();
    return;
  }
  const { auth, authM } = fb;
  const provider = new authM.GoogleAuthProvider();
  const params = { prompt: "select_account" };
  if (ALLOWED_EMAIL_DOMAIN) params.hd = ALLOWED_EMAIL_DOMAIN;
  provider.setCustomParameters(params);
  try {
    await authM.signInWithPopup(auth, provider);
  } catch (e) {
    if (!["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(e.code)) emitError(friendlyError(e));
  }
}

export async function signOut() {
  if (isDemo) { currentUser = null; emitAuth(); return; }
  await fb.authM.signOut(fb.auth);
}

// ───────────────────────── images ─────────────────────────
async function loadBitmap(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch (_) { /* fall through */ }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Can't read "${file.name}". iPhone HEIC photos: set Camera → Formats → Most Compatible, or convert to JPG.`));
    img.src = URL.createObjectURL(file);
  });
}

async function compressImage(file, maxDim, quality, kind) {
  const src = await loadBitmap(file);
  const s = Math.min(1, maxDim / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * s));
  const h = Math.max(1, Math.round(src.height * s));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(src, 0, 0, w, h);
  if (kind === "blob") {
    const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", quality));
    return { data: blob, w, h };
  }
  return { data: c.toDataURL("image/jpeg", quality), w, h };
}

// ───────────────────────── writes ─────────────────────────
export async function upload(file, meta, onStep = () => {}) {
  if (!currentUser) throw new Error("Sign in first");
  let url; let thumb; let w; let h;
  onStep("Preparing…");

  if (!isDemo && CLOUDINARY.cloudName && CLOUDINARY.uploadPreset) {
    const big = await compressImage(file, 2200, 0.86, "blob");
    onStep("Uploading…");
    const fd = new FormData();
    fd.append("file", big.data, "memory.jpg");
    fd.append("upload_preset", CLOUDINARY.uploadPreset);
    const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY.cloudName}/image/upload`, { method: "POST", body: fd });
    if (!res.ok) throw new Error("Photo upload failed — check the Cloudinary name / unsigned preset in config.js");
    const j = await res.json();
    url = j.secure_url;
    thumb = url.replace("/upload/", "/upload/c_limit,w_640,q_auto/");
    w = j.width; h = j.height;
  } else {
    // Free fallback: a small thumbnail lives in the memory doc (loaded for the galaxy),
    // the full photo lives in memoryFull/{id} and only loads when someone opens it.
    let big = await compressImage(file, 1400, 0.8, "dataurl");
    if (big.data.length > 950000) big = await compressImage(file, 1100, 0.7, "dataurl");
    if (big.data.length > 950000) big = await compressImage(file, 900, 0.62, "dataurl");
    let small = await compressImage(file, 400, 0.7, "dataurl");
    if (small.data.length > 110000) small = await compressImage(file, 320, 0.6, "dataurl");
    url = big.data; thumb = small.data; w = big.w; h = big.h;
  }
  const inlineFull = url.startsWith("data:");

  const doc = {
    url, thumb, w, h,
    caption: (meta.caption || "").trim().slice(0, 120),
    year: meta.year,
    event: meta.event || "",
    people: (meta.people || []).slice(0, 20).map((p) => p.slice(0, 40)),
    uploaderUid: currentUser.uid,
    uploaderName: currentUser.name.slice(0, 60),
    uploaderPhoto: currentUser.photo || "",
    likedBy: [],
  };

  if (isDemo) {
    demoItems.unshift({ id: "local-" + Date.now() + Math.random().toString(36).slice(2, 6), ...doc, createdAt: Date.now() });
    emitItems([...demoItems]);
    return;
  }
  onStep("Saving…");
  const { fsM, db } = fb;
  try {
    const ref = fsM.doc(fsM.collection(db, "memories"));
    const batch = fsM.writeBatch(db);
    if (inlineFull) {
      batch.set(fsM.doc(db, "memoryFull", ref.id), { data: url, uploaderUid: currentUser.uid });
      doc.url = "";
    }
    batch.set(ref, { ...doc, createdAt: fsM.serverTimestamp() });
    await batch.commit();
  } catch (e) { throw new Error(friendlyError(e)); }
}

// Full-size photo URL (fetched on demand when stored inside Firestore).
const fullCache = new Map();
export async function getFullUrl(item) {
  if (item.url) return item.url;
  if (isDemo || !fb) return item.thumb;
  if (fullCache.has(item.id)) return fullCache.get(item.id);
  try {
    const snap = await fb.fsM.getDoc(fb.fsM.doc(fb.db, "memoryFull", item.id));
    const data = snap.exists() ? snap.data().data : item.thumb;
    fullCache.set(item.id, data);
    return data;
  } catch (_) { return item.thumb; }
}

export async function toggleLike(item) {
  if (!currentUser) throw new Error("Sign in to like memories");
  const uid = currentUser.uid;
  const liked = item.likedBy.includes(uid);
  if (isDemo) {
    const it = demoItems.find((d) => d.id === item.id);
    if (it) it.likedBy = liked ? it.likedBy.filter((x) => x !== uid) : [...it.likedBy, uid];
    emitItems([...demoItems]);
    return;
  }
  const { fsM, db } = fb;
  try {
    await fsM.updateDoc(fsM.doc(db, "memories", item.id), { likedBy: liked ? fsM.arrayRemove(uid) : fsM.arrayUnion(uid) });
  } catch (e) { throw new Error(friendlyError(e)); }
}

export async function removeMemory(item) {
  if (isDemo) { demoItems = demoItems.filter((d) => d.id !== item.id); emitItems([...demoItems]); return; }
  const { fsM, db } = fb;
  try {
    const batch = fsM.writeBatch(db);
    batch.delete(fsM.doc(db, "memories", item.id));
    if (!item.url) batch.delete(fsM.doc(db, "memoryFull", item.id));
    await batch.commit();
  } catch (e) { throw new Error(friendlyError(e)); }
}

// ───────────────────────── demo data ─────────────────────────
const DEMO_SCENES = [
  ["y1", "Orientation day", "Campus", "🎒"], ["y1", "First canteen chai", "Canteen", "☕"],
  ["y1", "Freshers night", "Fest", "🎉"], ["y1", "First presentation nerves", "Classroom", "📊"],
  ["y1", "Library 'study' session", "Classroom", "📚"], ["y1", "Rainy day on campus", "Campus", "🌧️"],
  ["y1", "Group project gang", "Classroom", "💡"],
  ["y2", "Hackathon all-nighter", "Hackathon", "💻"], ["y2", "Trip to the hills", "Trip", "🏔️"],
  ["y2", "Fest prep chaos", "Fest", "🎨"], ["y2", "Birthday bumps", "Birthday", "🎂"],
  ["y2", "Cricket vs section B", "Sports", "🏏"], ["y2", "Startup pitch day", "Classroom", "🚀"],
  ["y2", "Maggi at 2am", "Canteen", "🍜"], ["y2", "Road trip playlist", "Trip", "🚌"],
  ["y3", "Internship summer", "Random", "💼"], ["y3", "Last fest together", "Fest", "🎶"],
  ["y3", "Case study champs", "Classroom", "🏆"], ["y3", "Sunset on the lawns", "Campus", "🌅"],
  ["y3", "Final project submitted", "Classroom", "✅"], ["y3", "Industrial visit", "Trip", "🏭"],
  ["fw", "Farewell fits", "Farewell", "✨"], ["fw", "Group photo (finally)", "Farewell", "📸"],
  ["fw", "Signing tees", "Farewell", "🖊️"], ["fw", "Last class ever", "Classroom", "🎓"],
  ["fw", "See you soon", "Farewell", "💛"],
];
const DEMO_NAMES = ["Aman", "Simran", "Harsh", "Jasleen", "Rohit", "Navneet", "Karan", "Ishita", "Gurleen", "Arjun", "Mehak", "Tanish"];
const DEMO_PALETTES = [
  ["#ff9a8b", "#ff6a88", "#ff99ac"], ["#4facfe", "#00f2fe", "#c2f5ff"], ["#a18cd1", "#fbc2eb", "#fff1f9"],
  ["#f6d365", "#fda085", "#fff3d6"], ["#43e97b", "#38f9d7", "#d6fff4"], ["#30cfd0", "#330867", "#9be7ff"],
  ["#fa709a", "#fee140", "#fff6cc"], ["#667eea", "#764ba2", "#e2d9ff"], ["#ff758c", "#ff7eb3", "#ffe0ec"],
];

function demoPhoto(i, emoji) {
  const S = 640;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d");
  const [a, b, glow] = DEMO_PALETTES[i % DEMO_PALETTES.length];
  const sky = g.createLinearGradient(0, 0, 0, S);
  sky.addColorStop(0, a); sky.addColorStop(1, b);
  g.fillStyle = sky; g.fillRect(0, 0, S, S);
  // sun
  const sx = 120 + ((i * 97) % 400); const sy = 130 + ((i * 53) % 120);
  const sun = g.createRadialGradient(sx, sy, 10, sx, sy, 140);
  sun.addColorStop(0, glow); sun.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = sun; g.fillRect(0, 0, S, S);
  // bokeh
  for (let k = 0; k < 14; k++) {
    g.globalAlpha = 0.08 + ((k * 13 + i) % 10) / 60;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc((k * 151 + i * 37) % S, (k * 89 + i * 61) % (S * 0.6), 10 + ((k * 7 + i) % 30), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  // hills
  for (let layer = 0; layer < 3; layer++) {
    g.fillStyle = `rgba(20,10,40,${0.18 + layer * 0.16})`;
    g.beginPath(); g.moveTo(0, S);
    for (let x = 0; x <= S; x += 20) {
      const y = S * (0.62 + layer * 0.1) + Math.sin(x / (70 + layer * 30) + i + layer) * (26 - layer * 6);
      g.lineTo(x, y);
    }
    g.lineTo(S, S); g.closePath(); g.fill();
  }
  // little crowd of friends
  const n = 3 + (i % 4);
  for (let p = 0; p < n; p++) {
    const px = S / 2 + (p - (n - 1) / 2) * 62; const py = S * 0.86;
    g.fillStyle = "rgba(10,6,25,.78)";
    g.beginPath(); g.arc(px, py - 92, 20, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.moveTo(px - 26, py); g.quadraticCurveTo(px, py - 140, px + 26, py); g.fill();
  }
  g.font = "120px serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(emoji, S / 2, S * 0.38);
  return c.toDataURL("image/jpeg", 0.82);
}

function demoInit() {
  const now = Date.now();
  demoItems = DEMO_SCENES.map(([year, caption, event, emoji], i) => {
    const img = demoPhoto(i, emoji);
    const who = DEMO_NAMES[(i * 5) % DEMO_NAMES.length];
    const people = [DEMO_NAMES[(i * 3 + 1) % DEMO_NAMES.length], DEMO_NAMES[(i * 7 + 2) % DEMO_NAMES.length]];
    const likes = (i * 7) % 11;
    return {
      id: "demo-" + i, url: img, thumb: img, w: 640, h: 640,
      caption, year, event, people: [...new Set(people)],
      uploaderUid: "u-" + who, uploaderName: who, uploaderPhoto: "",
      likedBy: Array.from({ length: likes }, (_, k) => "fan-" + k),
      createdAt: now - (DEMO_SCENES.length - i) * 86400000 * 9,
    };
  });
  emitAuth();
  setTimeout(() => emitItems([...demoItems]), 50);
}
