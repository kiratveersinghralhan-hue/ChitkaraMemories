// Data layer: Firebase (Auth + Firestore) with an in-browser demo fallback.
// Collections: memories (+ comments), memoryFull, users, profiles, members, allowlist,
//              activity, reports, banned, capsules.
import {
  FIREBASE_CONFIG, ALLOWED_EMAIL_DOMAIN, ADMIN_EMAILS, AUTO_APPROVE_SUFFIX, CLOUDINARY, MAX_PHOTOS, YEARS,
} from "./config.js";

export const isDemo = !FIREBASE_CONFIG.apiKey;
const FB_VERSION = "10.12.2";
export const REACTIONS = ["😂", "🔥", "💀", "🥹", "😍", "👏"];

const subs = { items: new Set(), auth: new Set(), error: new Set(), blocked: new Set(), pending: new Set(), profiles: new Set() };
const emit = (k, ...a) => subs[k].forEach((f) => f(...a));
export function onItems(fn) { subs.items.add(fn); }
export function onAuth(fn) { subs.auth.add(fn); }
export function onError(fn) { subs.error.add(fn); }
export function onBlocked(fn) { subs.blocked.add(fn); }
export function onPending(fn) { subs.pending.add(fn); }
export function onProfiles(fn) { subs.profiles.add(fn); }

let currentUser = null;
let pendingUser = null;
let fb = null;
let unsubItems = null;
let unsubProfiles = null;
let unsubMember = null;
let profiles = [];

// demo state
let demoItems = [];
let demoActivity = [];
let demoUsers = [];
let demoReports = [];
let demoBans = [];
let demoMembers = [];
let demoAllow = [];
let demoProfiles = [];
let demoCapsules = {};
const demoComments = {};
const demoCommentWatchers = {};

export function getUser() { return currentUser; }
export function getProfiles() { return profiles; }
export function isAdminEmail(email) {
  return ADMIN_EMAILS.map((e) => e.toLowerCase()).includes((email || "").toLowerCase());
}
export function emailAllowed(email) {
  if (isAdminEmail(email)) return true;
  if (!ALLOWED_EMAIL_DOMAIN) return true;
  return (email || "").toLowerCase().endsWith("@" + ALLOWED_EMAIL_DOMAIN.toLowerCase());
}
function autoApproved(email) {
  const e = (email || "").toLowerCase();
  return isAdminEmail(e) || (!!AUTO_APPROVE_SUFFIX && e.endsWith(AUTO_APPROVE_SUFFIX.toLowerCase()));
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
    album: d.album || "",
    people: Array.isArray(d.people) ? d.people : [],
    peopleUids: Array.isArray(d.peopleUids) ? d.peopleUids : [],
    uploaderUid: d.uploaderUid || "",
    uploaderName: d.uploaderName || "Someone",
    uploaderEmail: d.uploaderEmail || "",
    uploaderPhoto: d.uploaderPhoto || "",
    likedBy: Array.isArray(d.likedBy) ? d.likedBy : [],
    reactions: d.reactions && typeof d.reactions === "object" ? d.reactions : {},
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

// ───────────────────────── init + auth flow ─────────────────────────
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
    if (unsubMember) { unsubMember(); unsubMember = null; }
    if (!u) {
      currentUser = null;
      setPending(null);
      stopLive();
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

    // 3) Approved? (admin, auto-approved batch, pre-approved email, or approved request)
    const basic = { uid: u.uid, name: u.displayName || u.email.split("@")[0], email: u.email, photo: u.photoURL || "" };
    if (!autoApproved(u.email)) {
      let ok = false;
      try {
        const al = await fsM.getDoc(fsM.doc(db, "allowlist", u.email.toLowerCase()));
        ok = al.exists();
      } catch (_) { /* not on the list */ }
      if (!ok) {
        const mref = fsM.doc(db, "members", u.uid);
        let m = null;
        try { m = await fsM.getDoc(mref); } catch (e) { console.warn("member check", e); }
        const status = m && m.exists() ? m.data().status : "none";
        if (status === "denied") {
          await authM.signOut(auth);
          emit("blocked", { kind: "denied", email: u.email });
          return;
        }
        if (status !== "approved") {
          setPending({ ...basic, status, note: m && m.exists() ? m.data().note || "" : "" });
          // live: unlock as soon as an admin approves
          unsubMember = fsM.onSnapshot(mref, (s) => {
            const st = s.exists() ? s.data().status : "none";
            if (st === "approved") {
              if (unsubMember) { unsubMember(); unsubMember = null; }
              setPending(null);
              proceed(basic);
            } else if (st === "denied") {
              authM.signOut(auth);
              emit("blocked", { kind: "denied", email: u.email });
            } else if (pendingUser) {
              setPending({ ...pendingUser, status: st, note: s.exists() ? s.data().note || "" : "" });
            }
          }, () => {});
          return;
        }
      }
    }
    proceed(basic);
  });
}

function setPending(p) { pendingUser = p; emit("pending", p); }
export function getPending() { return pendingUser; }

function proceed(basic) {
  currentUser = { ...basic, admin: !!basic.admin || isAdminEmail(basic.email) };
  const fresh = sessionOnce("cm-login-" + basic.uid);
  if (!isDemo) {
    touchProfile(fresh).catch((e) => console.warn("profile", e));
    ensurePublicProfile().catch((e) => console.warn("public profile", e));
  }
  if (fresh) logActivity("login");
  startLive();
  emit("auth", currentUser);
}

// A new person asks to join (shown on the "request access" screen).
export async function requestAccess(note) {
  const p = pendingUser;
  if (!p) throw new Error("Sign in first");
  const clean = (note || "").trim().slice(0, 200);
  if (isDemo) {
    demoMembers = demoMembers.filter((m) => m.uid !== p.uid);
    demoMembers.unshift({ uid: p.uid, email: p.email, name: p.name, photo: p.photo, note: clean, status: "pending", requestedAt: Date.now() });
    setPending({ ...p, status: "pending", note: clean });
    return;
  }
  const { fsM, db } = fb;
  try {
    await fsM.setDoc(fsM.doc(db, "members", p.uid), {
      status: "pending", email: p.email, name: p.name.slice(0, 80), photo: p.photo, note: clean,
      requestedAt: fsM.serverTimestamp(),
    });
  } catch (e) { throw new Error(friendlyError(e)); }
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

async function ensurePublicProfile() {
  const { fsM, db } = fb;
  const u = currentUser;
  const ref = fsM.doc(db, "profiles", u.uid);
  const snap = await fsM.getDoc(ref);
  if (!snap.exists()) {
    await fsM.setDoc(ref, { name: u.name.slice(0, 80), photo: u.photo, nickname: "", quote: "", mostLikely: "", insta: "", updatedAt: fsM.serverTimestamp() });
  }
}

function startLive() {
  if (isDemo) {
    profiles = [...demoProfiles];
    emit("profiles", profiles);
    emit("items", [...demoItems]);
    return;
  }
  stopLive();
  const { fsM, db } = fb;
  const q = fsM.query(fsM.collection(db, "memories"), fsM.orderBy("createdAt", "desc"), fsM.limit(MAX_PHOTOS));
  unsubItems = fsM.onSnapshot(
    q,
    (snap) => emit("items", snap.docs.map((d) => normalize(d.id, d.data()))),
    (err) => { console.error(err); emit("error", "Couldn't load memories: " + friendlyError(err)); },
  );
  unsubProfiles = fsM.onSnapshot(
    fsM.collection(db, "profiles"),
    (snap) => { profiles = snap.docs.map((d) => ({ uid: d.id, ...d.data(), updatedAt: toMs(d.data().updatedAt) })); emit("profiles", profiles); },
    (err) => console.warn("profiles", err),
  );
}
function stopLive() {
  if (unsubItems) { unsubItems(); unsubItems = null; }
  if (unsubProfiles) { unsubProfiles(); unsubProfiles = null; }
  profiles = [];
  emit("items", []);
  emit("profiles", []);
}

// asAdmin=false shows only Chitkara accounts in Google's chooser.
export async function signIn(asAdmin = false, demoAs = "admin") {
  if (isDemo) {
    if (demoAs === "stranger") {
      setPending({ uid: "demo-stranger", name: "New Student", email: "new.student@" + (ALLOWED_EMAIL_DOMAIN || "example.com"), photo: "", status: "none", note: "" });
      return;
    }
    const basic = { uid: "demo-me", name: "You (demo admin)", email: "you@" + (ALLOWED_EMAIL_DOMAIN || "example.com"), photo: "", admin: true };
    if (!demoUsers.some((x) => x.uid === "demo-me")) {
      demoUsers.unshift({ uid: "demo-me", name: basic.name, email: basic.email, photo: "", device: deviceInfo(), firstSeen: Date.now(), lastSeen: Date.now(), logins: 1 });
      demoProfiles.unshift({ uid: "demo-me", name: basic.name, photo: "", nickname: "", quote: "", mostLikely: "", insta: "", updatedAt: Date.now() });
    }
    setPending(null);
    proceed(basic);
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
  if (isDemo) { currentUser = null; setPending(null); stopLive(); emit("auth", null); return; }
  await fb.authM.signOut(fb.auth);
}

// ───────────────────────── activity log ─────────────────────────
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
    album: (meta.album || "").trim().slice(0, 40),
    people: (meta.people || []).slice(0, 20).map((p) => p.slice(0, 40)),
    peopleUids: (meta.peopleUids || []).slice(0, 20),
    uploaderUid: currentUser.uid,
    uploaderName: currentUser.name.slice(0, 60),
    uploaderEmail: currentUser.email,
    uploaderPhoto: currentUser.photo || "",
    likedBy: [],
  };

  if (isDemo) {
    const id = "local-" + rid();
    demoItems.unshift({ id, ...data, reactions: {}, createdAt: Date.now() });
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

// One emoji reaction per person per photo; tapping the same emoji again removes it.
export async function setReaction(item, emoji) {
  if (!currentUser) throw new Error("Sign in first");
  const uid = currentUser.uid;
  const next = item.reactions[uid] === emoji ? null : emoji;
  if (isDemo) {
    const it = demoItems.find((d) => d.id === item.id);
    if (it) { it.reactions = { ...it.reactions }; if (next) it.reactions[uid] = next; else delete it.reactions[uid]; }
    emit("items", [...demoItems]);
    return;
  }
  const { fsM, db } = fb;
  try {
    await fsM.updateDoc(fsM.doc(db, "memories", item.id), { [`reactions.${uid}`]: next || fsM.deleteField() });
  } catch (e) { throw new Error(friendlyError(e)); }
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

// ───────────────────────── comments ─────────────────────────
export function watchComments(itemId, cb) {
  if (isDemo) {
    (demoCommentWatchers[itemId] = demoCommentWatchers[itemId] || new Set()).add(cb);
    cb([...(demoComments[itemId] || [])]);
    return () => demoCommentWatchers[itemId].delete(cb);
  }
  const { fsM, db } = fb;
  const q = fsM.query(fsM.collection(db, "memories", itemId, "comments"), fsM.orderBy("at", "asc"), fsM.limit(200));
  return fsM.onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data(), at: toMs(d.data().at) }))), (e) => { console.warn(e); cb([]); });
}
const demoEmitComments = (id) => (demoCommentWatchers[id] || new Set()).forEach((f) => f([...(demoComments[id] || [])]));

export async function addComment(item, text) {
  if (!currentUser) throw new Error("Sign in first");
  const clean = text.trim().slice(0, 300);
  if (!clean) return;
  const c = { text: clean, uid: currentUser.uid, name: currentUser.name.slice(0, 80), photo: currentUser.photo || "" };
  if (isDemo) {
    (demoComments[item.id] = demoComments[item.id] || []).push({ id: rid(), ...c, at: Date.now() });
    demoEmitComments(item.id);
  } else {
    const { fsM, db } = fb;
    try { await fsM.addDoc(fsM.collection(db, "memories", item.id, "comments"), { ...c, at: fsM.serverTimestamp() }); }
    catch (e) { throw new Error(friendlyError(e)); }
  }
  logActivity("comment", { ...memoryRef(item), detail: clean.slice(0, 120) });
}

export async function deleteComment(item, comment) {
  if (isDemo) {
    demoComments[item.id] = (demoComments[item.id] || []).filter((c) => c.id !== comment.id);
    demoEmitComments(item.id);
    return;
  }
  const { fsM, db } = fb;
  try { await fsM.deleteDoc(fsM.doc(db, "memories", item.id, "comments", comment.id)); } catch (e) { throw new Error(friendlyError(e)); }
}

// ───────────────────────── profiles (yearbook) ─────────────────────────
export async function saveProfile(fields) {
  if (!currentUser) throw new Error("Sign in first");
  const clean = {
    name: currentUser.name.slice(0, 80),
    photo: currentUser.photo || "",
    nickname: (fields.nickname || "").trim().slice(0, 40),
    quote: (fields.quote || "").trim().slice(0, 200),
    mostLikely: (fields.mostLikely || "").trim().slice(0, 100),
    insta: (fields.insta || "").trim().replace(/^@/, "").slice(0, 40),
  };
  if (isDemo) {
    demoProfiles = demoProfiles.filter((p) => p.uid !== currentUser.uid);
    demoProfiles.unshift({ uid: currentUser.uid, ...clean, updatedAt: Date.now() });
    profiles = [...demoProfiles];
    emit("profiles", profiles);
  } else {
    const { fsM, db } = fb;
    try { await fsM.setDoc(fsM.doc(db, "profiles", currentUser.uid), { ...clean, updatedAt: fsM.serverTimestamp() }); }
    catch (e) { throw new Error(friendlyError(e)); }
  }
  logActivity("profile");
}

// ───────────────────────── time capsule ─────────────────────────
export async function loadMyCapsule() {
  if (!currentUser) return null;
  if (isDemo) return demoCapsules[currentUser.uid] || null;
  const { fsM, db } = fb;
  try {
    const s = await fsM.getDoc(fsM.doc(db, "capsules", currentUser.uid));
    return s.exists() ? { ...s.data(), updatedAt: toMs(s.data().updatedAt) } : null;
  } catch (_) { return null; }
}
export async function saveCapsule({ text, visibility }) {
  if (!currentUser) throw new Error("Sign in first");
  const c = { text: text.trim().slice(0, 3000), visibility: visibility === "batch" ? "batch" : "private", name: currentUser.name.slice(0, 80), photo: currentUser.photo || "" };
  if (isDemo) demoCapsules[currentUser.uid] = { ...c, uid: currentUser.uid, updatedAt: Date.now() };
  else {
    const { fsM, db } = fb;
    try { await fsM.setDoc(fsM.doc(db, "capsules", currentUser.uid), { ...c, updatedAt: fsM.serverTimestamp() }); }
    catch (e) { throw new Error(friendlyError(e)); }
  }
  logActivity("capsule", { detail: c.visibility });
}
export async function loadBatchCapsules() {
  if (isDemo) return Object.entries(demoCapsules).filter(([, c]) => c.visibility === "batch").map(([uid, c]) => ({ uid, ...c }));
  const { fsM, db } = fb;
  const s = await fsM.getDocs(fsM.query(fsM.collection(db, "capsules"), fsM.where("visibility", "==", "batch")));
  return s.docs.map((d) => ({ uid: d.id, ...d.data(), updatedAt: toMs(d.data().updatedAt) }));
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
      members: demoMembers.map((m) => ({ ...m })),
      allowlist: demoAllow.map((a) => ({ ...a })),
    };
  }
  const { fsM, db } = fb;
  const [us, act, rep, ban, mem, al] = await Promise.all([
    fsM.getDocs(fsM.collection(db, "users")),
    fsM.getDocs(fsM.query(fsM.collection(db, "activity"), fsM.orderBy("at", "desc"), fsM.limit(activityLimit))),
    fsM.getDocs(fsM.query(fsM.collection(db, "reports"), fsM.orderBy("at", "desc"), fsM.limit(200))),
    fsM.getDocs(fsM.collection(db, "banned")),
    fsM.getDocs(fsM.collection(db, "members")),
    fsM.getDocs(fsM.collection(db, "allowlist")),
  ]);
  const ms = (x, k) => toMs(x[k]);
  return {
    users: us.docs.map((d) => { const x = d.data(); return { uid: d.id, ...x, firstSeen: ms(x, "firstSeen"), lastSeen: ms(x, "lastSeen") }; }),
    activity: act.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, at: ms(x, "at") }; }),
    reports: rep.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, at: ms(x, "at") }; }),
    bans: ban.docs.map((d) => { const x = d.data(); return { uid: d.id, ...x, at: ms(x, "at") }; }),
    members: mem.docs.map((d) => { const x = d.data(); return { uid: d.id, ...x, requestedAt: ms(x, "requestedAt"), decidedAt: x.decidedAt ? ms(x, "decidedAt") : 0 }; }),
    allowlist: al.docs.map((d) => { const x = d.data(); return { email: d.id, ...x, at: ms(x, "at") }; }),
  };
}

export async function adminSetMember(member, status) {
  if (!isAdmin()) throw new Error("Admins only");
  if (isDemo) {
    const m = demoMembers.find((x) => x.uid === member.uid);
    if (m) { m.status = status; m.decidedAt = Date.now(); m.decidedBy = currentUser.email; }
    if (status === "approved" && member.uid === "demo-stranger" && pendingUser) { /* demo: no live unlock */ }
  } else {
    const { fsM, db } = fb;
    await fsM.updateDoc(fsM.doc(db, "members", member.uid), { status, decidedAt: fsM.serverTimestamp(), decidedBy: currentUser.email });
  }
  logActivity(status === "approved" ? "approve" : "deny", { ownerUid: member.uid, ownerName: member.name || member.email, detail: member.email });
}

export async function adminAllowEmails(emails) {
  if (!isAdmin()) throw new Error("Admins only");
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)))].slice(0, 400);
  if (!list.length) return 0;
  if (isDemo) {
    list.forEach((email) => { if (!demoAllow.some((a) => a.email === email)) demoAllow.unshift({ email, by: currentUser.email, at: Date.now() }); });
  } else {
    const { fsM, db } = fb;
    for (let i = 0; i < list.length; i += 400) {
      const batch = fsM.writeBatch(db);
      list.slice(i, i + 400).forEach((email) => batch.set(fsM.doc(db, "allowlist", email), { by: currentUser.email, at: fsM.serverTimestamp() }));
      await batch.commit();
    }
  }
  logActivity("allow", { detail: `${list.length} email(s) pre-approved` });
  return list.length;
}

export async function adminUnallow(email) {
  if (!isAdmin()) throw new Error("Admins only");
  if (isDemo) demoAllow = demoAllow.filter((a) => a.email !== email);
  else await fb.fsM.deleteDoc(fb.fsM.doc(fb.db, "allowlist", email));
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
  ["y1", "Orientation day", "Campus", "🎒", ""], ["y1", "First canteen chai", "Canteen", "☕", ""],
  ["y1", "Freshers night", "Fest", "🎉", "Freshers 2026"], ["y1", "First presentation nerves", "Classroom", "📊", ""],
  ["y1", "Library 'study' session", "Classroom", "📚", ""], ["y1", "Rainy day on campus", "Campus", "🌧️", ""],
  ["y1", "Group project gang", "Classroom", "💡", ""],
  ["y2", "Hackathon all-nighter", "Hackathon", "💻", "Breakout '26"], ["y2", "Trip to the hills", "Trip", "🏔️", "Kasauli trip"],
  ["y2", "Fest prep chaos", "Fest", "🎨", ""], ["y2", "Birthday bumps", "Birthday", "🎂", ""],
  ["y2", "Cricket vs section B", "Sports", "🏏", ""], ["y2", "Startup pitch day", "Classroom", "🚀", "Breakout '26"],
  ["y2", "Maggi at 2am", "Canteen", "🍜", "Kasauli trip"], ["y2", "Road trip playlist", "Trip", "🚌", "Kasauli trip"],
  ["y3", "Internship summer", "Random", "💼", ""], ["y3", "Last fest together", "Fest", "🎶", ""],
  ["y3", "Case study champs", "Classroom", "🏆", "Breakout '26"], ["y3", "Sunset on the lawns", "Campus", "🌅", ""],
  ["y3", "Final project submitted", "Classroom", "✅", ""], ["y3", "Industrial visit", "Trip", "🏭", ""],
  ["fw", "Farewell fits", "Farewell", "✨", "Farewell night"], ["fw", "Group photo (finally)", "Farewell", "📸", "Farewell night"],
  ["fw", "Signing tees", "Farewell", "🖊️", "Farewell night"], ["fw", "Last class ever", "Classroom", "🎓", ""],
  ["fw", "See you soon", "Farewell", "💛", "Farewell night"],
];
const DEMO_NAMES = ["Aman", "Simran", "Harsh", "Jasleen", "Rohit", "Navneet", "Karan", "Ishita", "Gurleen", "Arjun", "Mehak", "Tanish"];
const DEMO_PALETTES = [
  ["#ff9a8b", "#ff6a88", "#ff99ac"], ["#4facfe", "#00f2fe", "#c2f5ff"], ["#a18cd1", "#fbc2eb", "#fff1f9"],
  ["#f6d365", "#fda085", "#fff3d6"], ["#43e97b", "#38f9d7", "#d6fff4"], ["#30cfd0", "#330867", "#9be7ff"],
  ["#fa709a", "#fee140", "#fff6cc"], ["#667eea", "#764ba2", "#e2d9ff"], ["#ff758c", "#ff7eb3", "#ffe0ec"],
];
const DEMO_DEVICES = ["Phone · Android · Chrome", "Phone · iOS · Safari", "Computer · Windows · Chrome", "Computer · macOS · Safari"];
const DEMO_QUOTES = [
  ["Will open a café called Proxy", "Most likely to start a startup in the canteen"],
  ["Deadlines are just suggestions", "Most likely to submit at 11:59pm"],
  ["Here for the vibes and the attendance", "Most likely to become a CEO"],
  ["Powered by chai", "Most likely to know everyone on campus"],
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
  const surnames = ["Sharma", "Kaur", "Gupta", "Sandhu", "Verma", "Gill"];
  demoUsers = DEMO_NAMES.map((n, k) => ({
    uid: "u-" + n, name: n + " " + surnames[k % 6],
    email: `${n.toLowerCase()}${2400 + k * 7}.bbadsbm26@chitkara.edu.in`, photo: "",
    device: DEMO_DEVICES[k % DEMO_DEVICES.length],
    firstSeen: now - (40 - k) * day, lastSeen: now - (k * 3.3 + 0.2) * 3600000, logins: 3 + ((k * 7) % 19),
  }));
  demoProfiles = demoUsers.map((u, k) => {
    const [quote, mostLikely] = DEMO_QUOTES[k % DEMO_QUOTES.length];
    return { uid: u.uid, name: u.name, photo: "", nickname: k % 3 === 0 ? ["Chai King", "Topper", "DJ"][k % 3] : "", quote: k % 2 ? quote : "", mostLikely: k % 2 ? mostLikely : "", insta: k % 4 === 0 ? u.name.split(" ")[0].toLowerCase() + ".clicks" : "", updatedAt: u.firstSeen };
  });
  const emojis = REACTIONS;
  demoItems = DEMO_SCENES.map(([year, caption, event, emoji, album], i) => {
    const img = demoPhoto(i, emoji);
    const u = demoUsers[(i * 5) % demoUsers.length];
    const tagged = [demoUsers[(i * 3 + 1) % demoUsers.length], demoUsers[(i * 7 + 2) % demoUsers.length]].filter((x, k, arr) => arr.indexOf(x) === k);
    const likes = (i * 7) % 11;
    const reactions = {};
    for (let k = 0; k < (i % 5); k++) reactions[demoUsers[(i + k * 2) % demoUsers.length].uid] = emojis[(i + k) % emojis.length];
    return {
      id: "demo-" + i, url: img, thumb: img, w: 640, h: 640,
      caption, year, event, album,
      people: tagged.map((t) => t.name), peopleUids: tagged.map((t) => t.uid),
      uploaderUid: u.uid, uploaderName: u.name.split(" ")[0], uploaderEmail: u.email, uploaderPhoto: "",
      likedBy: Array.from({ length: likes }, (_, k) => demoUsers[(i + k) % demoUsers.length].uid),
      reactions,
      createdAt: now - (DEMO_SCENES.length - i) * day * 9,
    };
  });
  // one memory from exactly a year ago, for "On this day"
  demoItems[2].createdAt = now - 365 * day;
  demoComments["demo-13"] = [
    { id: rid(), text: "who ate the last maggi 😭", uid: "u-Harsh", name: "Harsh Gupta", photo: "", at: now - 5 * 3600000 },
    { id: rid(), text: "not me 👀", uid: "u-Karan", name: "Karan Gupta", photo: "", at: now - 4 * 3600000 },
  ];
  demoComments["demo-7"] = [{ id: rid(), text: "best night of the year fr", uid: "u-Simran", name: "Simran Kaur", photo: "", at: now - 20 * 3600000 }];
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
  demoUsers.forEach((u) => acts.push({ id: rid(), type: "login", uid: u.uid, email: u.email, name: u.name, device: u.device, memoryId: "", memoryCaption: "", ownerUid: "", ownerName: "", detail: "", at: u.lastSeen }));
  const rep = demoItems[13];
  const reporter = demoUsers[3];
  demoReports = [{ id: rid(), ...memoryRef(rep), reason: "I'm in it and didn't agree to it", note: "please remove this one", reporterUid: reporter.uid, reporterName: reporter.name, reporterEmail: reporter.email, at: now - 2 * 3600000 }];
  acts.push({ id: rid(), type: "report", uid: reporter.uid, email: reporter.email, name: reporter.name, device: reporter.device, ...memoryRef(rep), detail: rep.caption, at: now - 2 * 3600000 });
  demoBans = [{ uid: demoUsers[11].uid, email: demoUsers[11].email, name: demoUsers[11].name, reason: "Spam uploads", by: "admin", at: now - 5 * day }];
  demoMembers = [
    { uid: "u-req1", email: "riya2211.bcom25@chitkara.edu.in", name: "Riya Mehta", photo: "", note: "Riya from BCom, friends with Simran", status: "pending", requestedAt: now - 40 * 60000 },
    { uid: "u-req2", email: "dev.btech24@chitkara.edu.in", name: "Dev Arora", photo: "", note: "", status: "pending", requestedAt: now - 3 * 3600000 },
    { uid: "u-req3", email: "sahil88.bba25@chitkara.edu.in", name: "Sahil Bedi", photo: "", note: "BBA, want to see the pics", status: "denied", requestedAt: now - 2 * day, decidedAt: now - day },
  ];
  demoAllow = [{ email: "late.joiner.bbadsbm26@chitkara.edu.in", by: "admin", at: now - 3 * day }];
  demoCapsules = {
    "u-Simran": { text: "Hey batch, if you're reading this we made it. Remember the Kasauli bus breaking down?", visibility: "batch", name: "Simran Kaur", photo: "", updatedAt: now - 3 * day },
  };
  demoActivity = acts.sort((a, b) => b.at - a.at);
  emit("auth", null);
}
