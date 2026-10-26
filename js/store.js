// Data layer: Firebase (Auth + Firestore) with an in-browser demo fallback.
// Collections: memories, memoryFull, users, activity, reports, banned.
import {
  FIREBASE_CONFIG, ALLOWED_EMAIL_DOMAIN, ADMIN_EMAILS, CLOUDINARY, MAX_PHOTOS, YEARS,
} from "./config.js";

export const isDemo = !FIREBASE_CONFIG.apiKey;
const FB_VERSION = "10.12.2";

const subs = { items: new Set(), auth: new Set(), error: new Set(), blocked: new Set() };
const emit = (k, ...a) => subs[k].forEach((f) => f(...a));
export function onItems(fn) { subs.items.add(fn); }
export function onAuth(fn) { subs.auth.add(fn); }
export function onError(fn) { subs.error.add(fn); }
export function onBlocked(fn) { subs.blocked.add(fn); }

let currentUser = null;
let fb = null;
let unsubItems = null;
let demoItems = [];
let demoActivity = [];
let demoUsers = [];
let demoReports = [];
let demoBans = [];

export function getUser() { return currentUser; }
export function isAdminEmail(email) {
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes((email || "").toLowerCase());
}
export function emailAllowed(email) {
  if (isAdminEmail(email)) return true;
  if (!ALLOWED_EMAIL_DOMAIN) return true;
  return (email || "").toLowerCase().endsWith("@" + ALLOWED_EMAIL_DOMAIN.toLowerCase());
}
export function isAdmin() { return !!currentUser && currentUser.admin; }
export function canDelete(item) {
  return !!currentUser && (item.uploaderUid === currentUser.uid || currentUser.admin);
}
export function memoryRef(item) {
  return { memoryId: item.id, memoryCaption: item.caption || "", ownerUid: item.uploaderUid || "", ownerName: item.uploaderName || "" };
}

const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const toMs = (ts) => (ts && typeof ts.toMillis === "function" ? ts.toMillis() : typeof ts === "number" ? ts : Date.now());

export function deviceInfo() {
  const ua = navigator.userAgent || "";
  const os = /Android/i.test(ua) ? "Android" : /iPhone|iPad|iPod/i.test(ua) ? "iOS" : /Windows/i.test(ua) ? "Windows"
    : /Mac OS X/i.test(ua) ? "macOS" : /CrOS/i.test(ua) ? "ChromeOS" : /Linux/i.test(ua) ? "Linux" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung" : /Chrome\//.test(ua) ? "Chrome"
    : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const type = /Mobi|Android|iPhone/i.test(ua) ? "Phone" : /iPad|Tablet/i.test(ua) ? "Tablet" : "Computer";
  return `${type} · ${os} · ${br}`;
}

function sessionOnce(key) {
  try {
    if (sessionStorage.getItem(key)) return false;
    sessionStorage.setItem(key, "1");
    return true;
  } catch (_) { return true; }
}

function normalize(id, d) {
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
    uploaderEmail: d.uploaderEmail || "",
    uploaderPhoto: d.uploaderPhoto || "",
    likedBy: Array.isArray(d.likedBy) ? d.likedBy : [],
    createdAt: toMs(d.createdAt),
  };
}

function friendlyError(e) {
  const code = e && e.code ? e.code : "";
  if (code.includes("permission-denied")) return "Not allowed. Your account may not have access.";
  if (code.includes("unauthorized-domain")) return "This website's domain isn't authorised in Firebase Auth settings yet.";
  if (code.includes("popup-blocked")) return "Your browser blocked the sign-in popup. Allow popups and try again.";
  if (code.includes("network")) return "Network problem. Check your connection.";
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

  authM.onAuthStateChanged(auth, async (u) => {
    if (!u) {
      currentUser = null;
      stopItems();
      emit("auth", null);
      return;
    }
    // 1) Chitkara accounts only. Anyone else is removed from Firebase Auth and signed out.
    if (!emailAllowed(u.email) || !u.emailVerified) {
      const tried = u.email;
      try { await u.delete(); } catch (_) { /* ignore */ }
      try { await authM.signOut(auth); } catch (_) { /* ignore */ }
      emit("blocked", { kind: "domain", email: tried });
      return;
    }
    // 2) Banned accounts can't enter.
    try {
      const b = await fsM.getDoc(fsM.doc(db, "banned", u.uid));
      if (b.exists()) {
        await authM.signOut(auth);
        emit("blocked", { kind: "banned", email: u.email, reason: b.data().reason || "" });
        return;
      }
    } catch (e) { console.warn("ban check", e); }

    currentUser = {
      uid: u.uid,
      name: u.displayName || u.email.split("@")[0],
      email: u.email,
      photo: u.photoURL || "",
      admin: isAdminEmail(u.email),
    };
    const fresh = sessionOnce("cm-login-" + u.uid);
    touchProfile(fresh).catch((e) => console.warn("profile", e));
    if (fresh) logActivity("login");
    startItems();
    emit("auth", currentUser);
  });
}

async function touchProfile(newSession) {
  const { fsM, db } = fb;
  const u = currentUser;
  const ref = fsM.doc(db, "users", u.uid);
  const snap = await fsM.getDoc(ref);
  if (!snap.exists()) {
    await fsM.setDoc(ref, {
      name: u.name.slice(0, 80), email: u.email, photo: u.photo, device: deviceInfo(),
      firstSeen: fsM.serverTimestamp(), lastSeen: fsM.serverTimestamp(), logins: 1,
    });
  } else {
    await fsM.updateDoc(ref, {
      name: u.name.slice(0, 80), photo: u.photo, device: deviceInfo(),
      lastSeen: fsM.serverTimestamp(), logins: fsM.increment(newSession ? 1 : 0),
    });
  }
}

function startItems() {
  if (isDemo) { emit("items", [...demoItems]); return; }
  stopItems();
  const { fsM, db } = fb;
  const q = fsM.query(fsM.collection(db, "memories"), fsM.orderBy("createdAt", "desc"), fsM.limit(MAX_PHOTOS));
  unsubItems = fsM.onSnapshot(
    q,
    (snap) => emit("items", snap.docs.map((d) => normalize(d.id, d.data()))),
    (err) => { console.error(err); emit("error", "Couldn't load memories: " + friendlyError(err)); },
  );
}
function stopItems() {
  if (unsubItems) { unsubItems(); unsubItems = null; }
  emit("items", []);
}

// ───────────────────────── auth ─────────────────────────
// asAdmin=false shows only Chitkara accounts in Google's chooser.
export async function signIn(asAdmin = false) {
  if (isDemo) {
    currentUser = { uid: "demo-me", name: "You (demo admin)", email: "you@" + (ALLOWED_EMAIL_DOMAIN || "example.com"), photo: "", admin: true };
    if (!demoUsers.some((x) => x.uid === "demo-me")) {
      demoUsers.unshift({ uid: "demo-me", name: currentUser.name, email: currentUser.email, photo: "", device: deviceInfo(), firstSeen: Date.now(), lastSeen: Date.now(), logins: 1 });
    }
    logActivity("login");
    emit("auth", currentUser);
    startItems();
    return;
  }
  const { auth, authM } = fb;
  const provider = new authM.GoogleAuthProvider();
  const params = { prompt: "select_account" };
  if (ALLOWED_EMAIL_DOMAIN && !asAdmin) params.hd = ALLOWED_EMAIL_DOMAIN;
  provider.setCustomParameters(params);
  try {
    await authM.signInWithPopup(auth, provider);
  } catch (e) {
    if (!["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(e.code)) emit("error", friendlyError(e));
  }
}

export async function signOut() {
  if (isDemo) { currentUser = null; emit("auth", null); return; }
  await fb.authM.signOut(fb.auth);
}

// ───────────────────────── activity log ─────────────────────────
// Every login, upload, download, like, report and delete is recorded for admins.
export function logActivity(type, extra = {}) {
  if (!currentUser) return;
  const entry = {
    type,
    uid: currentUser.uid,
    email: currentUser.email,
    name: currentUser.name.slice(0, 80),
    device: deviceInfo(),
    memoryId: extra.memoryId || "",
    memoryCaption: (extra.memoryCaption || "").slice(0, 120),
    ownerUid: extra.ownerUid || "",
    ownerName: (extra.ownerName || "").slice(0, 80),
    detail: (extra.detail || "").slice(0, 200),
  };
  if (isDemo) { demoActivity.unshift({ id: rid(), ...entry, at: Date.now() }); return; }
  const { fsM, db } = fb;
  fsM.addDoc(fsM.collection(db, "activity"), { ...entry, at: fsM.serverTimestamp() })
    .catch((e) => console.warn("activity log failed", e));
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

// ───────────────────────── memories ─────────────────────────
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
    if (!res.ok) throw new Error("Photo upload failed. Check the Cloudinary name and unsigned preset in config.js");
    const j = await res.json();
    url = j.secure_url;
    thumb = url.replace("/upload/", "/upload/c_limit,w_640,q_auto/");
    w = j.width; h = j.height;
  } else {
    // Free: a small thumbnail lives in the memory doc (loaded for the galaxy),
    // the full photo lives in memoryFull/{id} and only loads when someone opens it.
    let big = await compressImage(file, 1400, 0.8, "dataurl");
    if (big.data.length > 950000) big = await compressImage(file, 1100, 0.7, "dataurl");
    if (big.data.length > 950000) big = await compressImage(file, 900, 0.62, "dataurl");
    let small = await compressImage(file, 400, 0.7, "dataurl");
    if (small.data.length > 110000) small = await compressImage(file, 320, 0.6, "dataurl");
    url = big.data; thumb = small.data; w = big.w; h = big.h;
  }
  const inlineFull = url.startsWith("data:");

  const data = {
    url, thumb, w, h,
    caption: (meta.caption || "").trim().slice(0, 120),
    year: meta.year,
    event: meta.event || "",
    people: (meta.people || []).slice(0, 20).map((p) => p.slice(0, 40)),
    uploaderUid: currentUser.uid,
    uploaderName: currentUser.name.slice(0, 60),
    uploaderEmail: currentUser.email,
    uploaderPhoto: currentUser.photo || "",
    likedBy: [],
  };

  if (isDemo) {
    const id = "local-" + rid();
    demoItems.unshift({ id, ...data, createdAt: Date.now() });
    emit("items", [...demoItems]);
    logActivity("upload", { memoryId: id, memoryCaption: data.caption, ownerUid: currentUser.uid, ownerName: currentUser.name });
    return;
  }
  onStep("Saving…");
  const { fsM, db } = fb;
  const ref = fsM.doc(fsM.collection(db, "memories"));
  try {
    const batch = fsM.writeBatch(db);
    if (inlineFull) {
      batch.set(fsM.doc(db, "memoryFull", ref.id), { data: url, uploaderUid: currentUser.uid });
      data.url = "";
    }
    batch.set(ref, { ...data, createdAt: fsM.serverTimestamp() });
    await batch.commit();
  } catch (e) { throw new Error(friendlyError(e)); }
  logActivity("upload", { memoryId: ref.id, memoryCaption: data.caption, ownerUid: currentUser.uid, ownerName: currentUser.name });
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
    emit("items", [...demoItems]);
  } else {
    const { fsM, db } = fb;
    try {
      await fsM.updateDoc(fsM.doc(db, "memories", item.id), { likedBy: liked ? fsM.arrayRemove(uid) : fsM.arrayUnion(uid) });
    } catch (e) { throw new Error(friendlyError(e)); }
  }
  logActivity(liked ? "unlike" : "like", memoryRef(item));
}

export async function removeMemory(item, reason = "") {
  const detail = currentUser && item.uploaderUid !== currentUser.uid ? `Removed by admin${reason ? ": " + reason : ""}` : reason;
  if (isDemo) {
    demoItems = demoItems.filter((d) => d.id !== item.id);
    emit("items", [...demoItems]);
  } else {
    const { fsM, db } = fb;
    try {
      const batch = fsM.writeBatch(db);
      batch.delete(fsM.doc(db, "memories", item.id));
      if (!item.url) batch.delete(fsM.doc(db, "memoryFull", item.id));
      await batch.commit();
    } catch (e) { throw new Error(friendlyError(e)); }
  }
  logActivity("delete", { ...memoryRef(item), detail });
}

export async function reportMemory(item, reason, note) {
  if (!currentUser) throw new Error("Sign in first");
  const r = {
    ...memoryRef(item),
    reason: (reason || "Other").slice(0, 60),
    note: (note || "").slice(0, 300),
    reporterUid: currentUser.uid,
    reporterName: currentUser.name.slice(0, 80),
    reporterEmail: currentUser.email,
  };
  if (isDemo) demoReports.unshift({ id: rid(), ...r, at: Date.now() });
  else {
    const { fsM, db } = fb;
    try { await fsM.addDoc(fsM.collection(db, "reports"), { ...r, at: fsM.serverTimestamp() }); } catch (e) { throw new Error(friendlyError(e)); }
  }
  logActivity("report", { ...memoryRef(item), detail: reason });
}

// ───────────────────────── admin ─────────────────────────
export async function adminLoad({ activityLimit = 600 } = {}) {
  if (!isAdmin()) throw new Error("Admins only");
  if (isDemo) {
    return {
      users: demoUsers.map((u) => ({ ...u })),
      activity: demoActivity.map((a) => ({ ...a })),
      reports: demoReports.map((r) => ({ ...r })),
      bans: demoBans.map((b) => ({ ...b })),
    };
  }
  const { fsM, db } = fb;
  const [us, act, rep, ban] = await Promise.all([
    fsM.getDocs(fsM.collection(db, "users")),
    fsM.getDocs(fsM.query(fsM.collection(db, "activity"), fsM.orderBy("at", "desc"), fsM.limit(activityLimit))),
    fsM.getDocs(fsM.query(fsM.collection(db, "reports"), fsM.orderBy("at", "desc"), fsM.limit(200))),
    fsM.getDocs(fsM.collection(db, "banned")),
  ]);
  return {
    users: us.docs.map((d) => { const x = d.data(); return { uid: d.id, ...x, firstSeen: toMs(x.firstSeen), lastSeen: toMs(x.lastSeen) }; }),
    activity: act.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, at: toMs(x.at) }; }),
    reports: rep.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, at: toMs(x.at) }; }),
    bans: ban.docs.map((d) => { const x = d.data(); return { uid: d.id, ...x, at: toMs(x.at) }; }),
  };
}

export async function adminBan(user, reason = "") {
  if (!isAdmin()) throw new Error("Admins only");
  const b = { email: user.email || "", name: user.name || "", reason: reason.slice(0, 200), by: currentUser.email };
  if (isDemo) demoBans.unshift({ uid: user.uid, ...b, at: Date.now() });
  else {
    const { fsM, db } = fb;
    await fsM.setDoc(fsM.doc(db, "banned", user.uid), { ...b, at: fsM.serverTimestamp() });
  }
  logActivity("ban", { ownerUid: user.uid, ownerName: user.name, detail: reason });
}

export async function adminUnban(user) {
  if (!isAdmin()) throw new Error("Admins only");
  if (isDemo) demoBans = demoBans.filter((b) => b.uid !== user.uid);
  else await fb.fsM.deleteDoc(fb.fsM.doc(fb.db, "banned", user.uid));
  logActivity("unban", { ownerUid: user.uid, ownerName: user.name });
}

export async function adminDismissReport(report) {
  if (!isAdmin()) throw new Error("Admins only");
  if (isDemo) demoReports = demoReports.filter((r) => r.id !== report.id);
  else await fb.fsM.deleteDoc(fb.fsM.doc(fb.db, "reports", report.id));
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
const DEMO_DEVICES = ["Phone · Android · Chrome", "Phone · iOS · Safari", "Computer · Windows · Chrome", "Computer · macOS · Safari"];

function demoPhoto(i, emoji) {
  const S = 640;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d");
  const [a, b, glow] = DEMO_PALETTES[i % DEMO_PALETTES.length];
  const sky = g.createLinearGradient(0, 0, 0, S);
  sky.addColorStop(0, a); sky.addColorStop(1, b);
  g.fillStyle = sky; g.fillRect(0, 0, S, S);
  const sx = 120 + ((i * 97) % 400); const sy = 130 + ((i * 53) % 120);
  const sun = g.createRadialGradient(sx, sy, 10, sx, sy, 140);
  sun.addColorStop(0, glow); sun.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = sun; g.fillRect(0, 0, S, S);
  for (let k = 0; k < 14; k++) {
    g.globalAlpha = 0.08 + ((k * 13 + i) % 10) / 60;
    g.fillStyle = "#fff";
    g.beginPath();
    g.arc((k * 151 + i * 37) % S, (k * 89 + i * 61) % (S * 0.6), 10 + ((k * 7 + i) % 30), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
  for (let layer = 0; layer < 3; layer++) {
    g.fillStyle = `rgba(20,10,40,${0.18 + layer * 0.16})`;
    g.beginPath(); g.moveTo(0, S);
    for (let x = 0; x <= S; x += 20) {
      const y = S * (0.62 + layer * 0.1) + Math.sin(x / (70 + layer * 30) + i + layer) * (26 - layer * 6);
      g.lineTo(x, y);
    }
    g.lineTo(S, S); g.closePath(); g.fill();
  }
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
  const day = 86400000;
  demoUsers = DEMO_NAMES.map((n, k) => ({
    uid: "u-" + n, name: n + " " + ["Sharma", "Kaur", "Gupta", "Sandhu", "Verma", "Gill"][k % 6],
    email: `${n.toLowerCase()}.${2400 + k * 7}@chitkara.edu.in`, photo: "",
    device: DEMO_DEVICES[k % DEMO_DEVICES.length],
    firstSeen: now - (40 - k) * day, lastSeen: now - (k * 3.3 + 0.2) * 3600000, logins: 3 + ((k * 7) % 19),
  }));
  demoItems = DEMO_SCENES.map(([year, caption, event, emoji], i) => {
    const img = demoPhoto(i, emoji);
    const u = demoUsers[(i * 5) % demoUsers.length];
    const people = [DEMO_NAMES[(i * 3 + 1) % DEMO_NAMES.length], DEMO_NAMES[(i * 7 + 2) % DEMO_NAMES.length]];
    const likes = (i * 7) % 11;
    return {
      id: "demo-" + i, url: img, thumb: img, w: 640, h: 640,
      caption, year, event, people: [...new Set(people)],
      uploaderUid: u.uid, uploaderName: u.name.split(" ")[0], uploaderEmail: u.email, uploaderPhoto: "",
      likedBy: Array.from({ length: likes }, (_, k) => "u-" + DEMO_NAMES[(i + k) % DEMO_NAMES.length]),
      createdAt: now - (DEMO_SCENES.length - i) * day * 9,
    };
  });
  // activity log
  const acts = [];
  demoItems.forEach((it, i) => {
    const u = demoUsers.find((x) => x.uid === it.uploaderUid);
    acts.push({ id: rid(), type: "upload", uid: u.uid, email: u.email, name: u.name, device: u.device, ...memoryRef(it), detail: "", at: it.createdAt });
    for (let k = 0; k < (i % 4); k++) {
      const d = demoUsers[(i * 3 + k * 5) % demoUsers.length];
      acts.push({ id: rid(), type: "download", uid: d.uid, email: d.email, name: d.name, device: d.device, ...memoryRef(it), detail: "", at: now - ((i * 13 + k * 7) % 200) * 3600000 });
    }
    if (i % 3 === 0) {
      const d = demoUsers[(i + 4) % demoUsers.length];
      acts.push({ id: rid(), type: "like", uid: d.uid, email: d.email, name: d.name, device: d.device, ...memoryRef(it), detail: "", at: now - ((i * 17) % 300) * 3600000 });
    }
  });
  demoUsers.forEach((u, k) => acts.push({ id: rid(), type: "login", uid: u.uid, email: u.email, name: u.name, device: u.device, memoryId: "", memoryCaption: "", ownerUid: "", ownerName: "", detail: "", at: u.lastSeen }));
  const rep = demoItems[13];
  const reporter = demoUsers[3];
  demoReports = [{ id: rid(), ...memoryRef(rep), reason: "Posted without my consent", note: "I'm in this one and didn't want it public, please remove", reporterUid: reporter.uid, reporterName: reporter.name, reporterEmail: reporter.email, at: now - 2 * 3600000 }];
  acts.push({ id: rid(), type: "report", uid: reporter.uid, email: reporter.email, name: reporter.name, device: reporter.device, ...memoryRef(rep), detail: "Posted without my consent", at: now - 2 * 3600000 });
  demoBans = [{ uid: demoUsers[11].uid, email: demoUsers[11].email, name: demoUsers[11].name, reason: "Spam uploads", by: "admin", at: now - 5 * day }];
  demoActivity = acts.sort((a, b) => b.at - a.at);
  emit("auth", null);
}
