// UI wiring: filters, layouts, upload, lightbox, gallery, auth.
import { SITE, YEARS, EVENTS, ALLOWED_EMAIL_DOMAIN, MAX_FILES_PER_UPLOAD } from "./config.js";
import {
  isDemo, initStore, onItems, onAuth, onError, getUser, signIn, signOut,
  upload, toggleLike, removeMemory, canDelete, getFullUrl,
} from "./store.js";
import { createScene } from "./scene.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const yearOf = (id) => YEARS.find((y) => y.id === id) || { label: id, sub: "" };
const yearRank = Object.fromEntries(YEARS.map((y, i) => [y.id, i]));

const LAYOUTS = [
  { id: "galaxy", label: "Galaxy", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M12 4a8 8 0 0 1 8 8M12 20a8 8 0 0 1-8-8M16.5 7.5A6 6 0 0 0 7 9M7.5 16.5A6 6 0 0 0 17 15"/></svg>' },
  { id: "helix", label: "Helix", icon: '<svg viewBox="0 0 24 24"><path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12"/></svg>' },
  { id: "sphere", label: "Sphere", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>' },
  { id: "wall", label: "Wall", icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/></svg>' },
  { id: "timeline", label: "Timeline", icon: '<svg viewBox="0 0 24 24"><path d="M3 12h18"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>' },
];

const state = {
  items: [],
  year: "all",
  query: "",
  layout: "galaxy",
  list: [],
  currentId: null,
  files: [],
  uploading: false,
};

let scene = null;

// ───────────────────────── helpers ─────────────────────────
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function askConfirm(message, okLabel = "OK") {
  const box = $("#confirmBox");
  $("#confirmMsg").textContent = message;
  $("#confirmYes").textContent = okLabel;
  box.hidden = false;
  $("#confirmYes").focus();
  return new Promise((resolve) => {
    const done = (v) => {
      box.hidden = true;
      $("#confirmYes").onclick = $("#confirmNo").onclick = box.onclick = null;
      resolve(v);
    };
    $("#confirmYes").onclick = () => done(true);
    $("#confirmNo").onclick = () => done(false);
    box.onclick = (e) => { if (e.target === box) done(false); };
  });
}

function sortItems(items) {
  return [...items].sort((a, b) => (yearRank[a.year] ?? 99) - (yearRank[b.year] ?? 99) || a.createdAt - b.createdAt);
}

function matches(item) {
  if (state.year !== "all" && item.year !== state.year) return false;
  const q = state.query.trim().toLowerCase();
  if (!q) return true;
  const hay = [item.caption, item.event, item.uploaderName, yearOf(item.year).label, ...(item.people || [])].join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}

function initials(name) {
  return (name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}
function avatarHtml(name, photo) {
  return photo
    ? `<img class="avatar" src="${esc(photo)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="avatar">${esc(initials(name))}</span>`;
}
function timeAgo(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  if (d < 86400 * 30) return Math.floor(d / 86400) + "d ago";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// ───────────────────────── render ─────────────────────────
function renderChips() {
  const counts = {};
  state.items.forEach((i) => { counts[i.year] = (counts[i.year] || 0) + 1; });
  const all = [{ id: "all", label: "All years" }, ...YEARS];
  $("#yearChips").innerHTML = all.map((y) => {
    const n = y.id === "all" ? state.items.length : counts[y.id] || 0;
    return `<button class="chip ${state.year === y.id ? "active" : ""}" data-year="${y.id}">${esc(y.label)}<span class="count">${n}</span></button>`;
  }).join("");
}

function renderLayouts() {
  $("#layoutDock").innerHTML = LAYOUTS.map((l) =>
    `<button class="layout-btn ${state.layout === l.id ? "active" : ""}" data-layout="${l.id}" title="${l.label}" aria-pressed="${state.layout === l.id}">${l.icon}<span>${l.label}</span></button>`,
  ).join("");
}

function renderStats() {
  const uploaders = new Set(state.items.map((i) => i.uploaderUid));
  const people = new Set();
  state.items.forEach((i) => i.people.forEach((p) => people.add(p.trim().toLowerCase())));
  const likes = state.items.reduce((s, i) => s + i.likedBy.length, 0);
  $("#stats").innerHTML = `
    <div class="stat"><b>${state.items.length}</b><span>memories</span></div>
    <div class="stat"><b>${uploaders.size}</b><span>contributors</span></div>
    <div class="stat"><b>${people.size}</b><span>friends tagged</span></div>
    <div class="stat"><b>${likes}</b><span>hearts</span></div>`;
}

function renderAuth(user) {
  const area = $("#authArea");
  if (user) {
    area.innerHTML = `<button class="avatar-btn glass" id="userBtn" title="Signed in as ${esc(user.email)} — click to sign out">${avatarHtml(user.name, user.photo)}<span class="name">${esc(user.name.split(" ")[0])}</span></button>`;
  } else {
    area.innerHTML = `<button class="btn google-btn" id="signInBtn">
      <svg viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
      <span>Sign in<span class="label-long"> with college email</span></span></button>`;
  }
}

function renderGallery() {
  const body = $("#galleryBody");
  if (!body || $("#gallery").hidden) return;
  if (!state.list.length) {
    body.innerHTML = `<div class="g-empty">${state.items.length ? "Nothing matches that search." : "No memories yet — be the first to add one ✨"}</div>`;
    return;
  }
  const groups = YEARS.map((y) => ({ y, items: state.list.filter((i) => i.year === y.id) })).filter((g) => g.items.length);
  body.innerHTML = groups.map(({ y, items }) => `
    <div class="g-year"><h3>${esc(y.label)}</h3><span>${esc(y.sub)} · ${items.length}</span></div>
    <div class="g-grid">${items.map((i) => `<button class="g-item" data-id="${esc(i.id)}" title="${esc(i.caption)}"><img loading="lazy" src="${esc(i.thumb)}" alt="${esc(i.caption)}"></button>`).join("")}</div>
  `).join("");
}

function applyFilter() {
  state.list = sortItems(state.items).filter(matches);
  if (scene) scene.setFilter(matches);
  renderGallery();
}

// ───────────────────────── lightbox ─────────────────────────
function openMemory(id, { fly = true } = {}) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  state.currentId = id;
  $("#hoverTip").hidden = true;
  if (fly && scene) {
    scene.focus(id);
    setTimeout(() => showLightbox(), 420);
  } else showLightbox();
  history.replaceState(null, "", "#m=" + encodeURIComponent(id));
}

function showLightbox() {
  const item = state.items.find((i) => i.id === state.currentId);
  if (!item) { closeLightbox(); return; }
  const lb = $("#lightbox");
  const img = $("#lbImg");
  const dl = $("#lbDownload");
  if (img.dataset.id !== item.id) {
    img.dataset.id = item.id;
    img.src = item.thumb;
    dl.href = item.thumb;
    getFullUrl(item).then((src) => {
      if (state.currentId !== item.id) return;
      const full = new Image();
      full.onload = () => { if (state.currentId === item.id) img.src = src; };
      full.src = src;
      dl.href = src.includes("/upload/") ? src.replace("/upload/", "/upload/fl_attachment/") : src;
    });
  }
  img.alt = item.caption || "memory";
  const y = yearOf(item.year);
  $("#lbTags").innerHTML = `<span class="tag year">${esc(y.label)}</span>${item.event ? `<span class="tag">${esc(item.event)}</span>` : ""}`;
  $("#lbCaption").textContent = item.caption || "A memory";
  $("#lbPeople").innerHTML = item.people.map((p) => `<button class="person" data-person="${esc(p)}">@${esc(p)}</button>`).join("");
  $("#lbUploader").innerHTML = `${avatarHtml(item.uploaderName, item.uploaderPhoto)}<span>Added by <b>${esc(item.uploaderName)}</b><br>${timeAgo(item.createdAt)}</span>`;
  const user = getUser();
  const liked = !!user && item.likedBy.includes(user.uid);
  $("#lbLike").classList.toggle("liked", liked);
  $("#lbLikeCount").textContent = item.likedBy.length;
  $("#lbDelete").hidden = !canDelete(item);
  dl.setAttribute("download", (item.caption || "memory").replace(/[^\w\- ]+/g, "").slice(0, 40) + ".jpg");
  const idx = state.list.findIndex((i) => i.id === item.id);
  $("#lbCount").textContent = idx >= 0 ? `${idx + 1} of ${state.list.length}` : "";
  lb.hidden = false;
}

function closeLightbox() {
  $("#lightbox").hidden = true;
  state.currentId = null;
  if (scene) scene.release();
  history.replaceState(null, "", location.pathname + location.search);
}

function stepLightbox(dir) {
  if (!state.list.length) return;
  let idx = state.list.findIndex((i) => i.id === state.currentId);
  idx = (idx + dir + state.list.length) % state.list.length;
  const next = state.list[idx];
  state.currentId = next.id;
  if (scene) scene.focus(next.id);
  showLightbox();
  history.replaceState(null, "", "#m=" + encodeURIComponent(next.id));
}

// ───────────────────────── upload ─────────────────────────
function openUpload() {
  if (!getUser()) {
    toast(ALLOWED_EMAIL_DOMAIN ? `Sign in with your @${ALLOWED_EMAIL_DOMAIN} email to add memories` : "Sign in to add memories");
    signIn();
    return;
  }
  $("#uploadPanel").hidden = false;
}
function closeUpload() {
  if (state.uploading) return;
  $("#uploadPanel").hidden = true;
  state.files.forEach((f) => URL.revokeObjectURL(f.preview));
  state.files = [];
  $("#uploadForm").reset();
  renderPreviews();
}

function addFiles(list) {
  const imgs = [...list].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
  const room = MAX_FILES_PER_UPLOAD - state.files.length;
  if (imgs.length > room) toast(`Max ${MAX_FILES_PER_UPLOAD} photos at a time`);
  imgs.slice(0, Math.max(0, room)).forEach((file) => state.files.push({ file, preview: URL.createObjectURL(file), status: "" }));
  renderPreviews();
}

function renderPreviews() {
  $("#previews").innerHTML = state.files.map((f, i) => `
    <div class="preview ${f.status === "done" ? "done" : ""} ${f.status === "error" ? "err" : ""}">
      <img src="${f.preview}" alt="">
      ${state.uploading ? "" : `<button type="button" data-remove="${i}" aria-label="Remove">×</button>`}
      ${f.status && f.status !== "done" && f.status !== "error" ? `<span class="state">${esc(f.status)}</span>` : ""}
    </div>`).join("");
  const btn = $("#uploadSubmit");
  btn.disabled = !state.files.length || state.uploading;
  if (!state.uploading) btn.textContent = state.files.length > 1 ? `Add ${state.files.length} memories ✨` : "Add to the galaxy ✨";
}

async function submitUpload(e) {
  e.preventDefault();
  if (!state.files.length || state.uploading) return;
  const meta = {
    caption: $("#captionInput").value,
    year: $("#yearSelect").value,
    event: $("#eventSelect").value,
    people: $("#peopleInput").value.split(",").map((s) => s.trim()).filter(Boolean),
  };
  state.uploading = true;
  const btn = $("#uploadSubmit");
  let ok = 0;
  for (let i = 0; i < state.files.length; i++) {
    const f = state.files[i];
    if (f.status === "done") continue;
    btn.textContent = `Uploading ${i + 1} of ${state.files.length}…`;
    try {
      await upload(f.file, meta, (step) => { f.status = step; renderPreviews(); });
      f.status = "done"; ok++;
    } catch (err) {
      f.status = "error";
      toast(err.message || "Upload failed", 5000);
    }
    renderPreviews();
  }
  state.uploading = false;
  if (ok) {
    toast(ok === 1 ? "Memory added to the galaxy ✨" : `${ok} memories added ✨`);
    if (state.files.every((f) => f.status === "done")) {
      if (state.year !== "all" && state.year !== meta.year) setYear(meta.year);
      closeUpload();
    }
  }
  renderPreviews();
}

// ───────────────────────── actions ─────────────────────────
function setYear(y) {
  state.year = y;
  renderChips();
  applyFilter();
}
function setQuery(q) {
  state.query = q;
  if ($("#searchInput").value !== q) $("#searchInput").value = q;
  if ($("#gallerySearch").value !== q) $("#gallerySearch").value = q;
  applyFilter();
}
function setLayout(id) {
  state.layout = id;
  renderLayouts();
  if (scene) scene.setLayout(id);
}
function openGallery() { $("#gallery").hidden = false; renderGallery(); }
function closeGallery() { $("#gallery").hidden = true; }

function openFromHash() {
  const m = location.hash.match(/^#m=(.+)$/);
  if (!m || state.currentId) return;
  const id = decodeURIComponent(m[1]);
  if (state.items.some((i) => i.id === id)) setTimeout(() => openMemory(id), 900);
}

function bindEvents() {
  $("#yearChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-year]");
    if (b) setYear(b.dataset.year);
  });
  $("#layoutDock").addEventListener("click", (e) => {
    const b = e.target.closest("[data-layout]");
    if (b) setLayout(b.dataset.layout);
  });
  $("#searchInput").addEventListener("input", (e) => setQuery(e.target.value));
  $("#gallerySearch").addEventListener("input", (e) => setQuery(e.target.value));
  $("#brandLink").addEventListener("click", (e) => { e.preventDefault(); setQuery(""); setYear("all"); if (scene) scene.resetView(); });
  document.querySelectorAll("[data-open-gallery]").forEach((b) => b.addEventListener("click", openGallery));
  $("#uploadFab").addEventListener("click", openUpload);

  $("#authArea").addEventListener("click", async (e) => {
    if (e.target.closest("#signInBtn")) signIn();
    if (e.target.closest("#userBtn")) {
      const u = getUser();
      if (await askConfirm(`Signed in as ${u ? u.email : ""}. Sign out?`, "Sign out")) signOut();
    }
  });

  // overlays: close buttons + backdrop
  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => {
    const o = b.closest(".overlay, .drawer");
    if (o.id === "lightbox") closeLightbox();
    else if (o.id === "uploadPanel") closeUpload();
    else closeGallery();
  }));
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox" || e.target.classList.contains("lb-body")) closeLightbox(); });
  $("#uploadPanel").addEventListener("click", (e) => { if (e.target.id === "uploadPanel") closeUpload(); });

  $("#lbPrev").addEventListener("click", () => stepLightbox(-1));
  $("#lbNext").addEventListener("click", () => stepLightbox(1));
  $("#lbLike").addEventListener("click", async () => {
    const item = state.items.find((i) => i.id === state.currentId);
    if (!item) return;
    if (!getUser()) { toast("Sign in to send hearts"); signIn(); return; }
    try { await toggleLike(item); } catch (err) { toast(err.message); }
  });
  $("#lbShare").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link copied — send it to the group chat 🔗"); }
    catch (_) { toast(location.href, 6000); }
  });
  $("#lbDelete").addEventListener("click", async () => {
    const item = state.items.find((i) => i.id === state.currentId);
    if (!item || !(await askConfirm("Delete this memory for everyone?", "Delete"))) return;
    try { await removeMemory(item); closeLightbox(); toast("Memory deleted"); } catch (err) { toast(err.message); }
  });
  $("#lbPeople").addEventListener("click", (e) => {
    const p = e.target.closest("[data-person]");
    if (!p) return;
    closeLightbox();
    setYear("all");
    setQuery(p.dataset.person);
    toast(`Showing memories with ${p.dataset.person}`);
  });

  $("#galleryBody").addEventListener("click", (e) => {
    const b = e.target.closest("[data-id]");
    if (!b) return;
    if (window.innerWidth < 820) closeGallery();
    openMemory(b.dataset.id);
  });

  // upload form
  $("#fileInput").addEventListener("change", (e) => { addFiles(e.target.files); e.target.value = ""; });
  const dz = $("#dropzone");
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));
  $("#previews").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (!b) return;
    const [f] = state.files.splice(Number(b.dataset.remove), 1);
    URL.revokeObjectURL(f.preview);
    renderPreviews();
  });
  $("#uploadForm").addEventListener("submit", submitUpload);

  // keyboard
  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === "Escape") {
      if (!$("#confirmBox").hidden) $("#confirmNo").click();
      else if (!$("#lightbox").hidden) closeLightbox();
      else if (!$("#uploadPanel").hidden) closeUpload();
      else if (!$("#gallery").hidden) closeGallery();
      return;
    }
    if (!$("#lightbox").hidden) {
      if (e.key === "ArrowRight") stepLightbox(1);
      if (e.key === "ArrowLeft") stepLightbox(-1);
      return;
    }
    if (typing) return;
    if (e.key === "/") { e.preventDefault(); $("#searchInput").focus(); }
    const n = Number(e.key);
    if (n >= 1 && n <= LAYOUTS.length) setLayout(LAYOUTS[n - 1].id);
  });

  // swipe in lightbox (mobile)
  let sx = null;
  $("#lightbox").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $("#lightbox").addEventListener("touchend", (e) => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 60) stepLightbox(dx < 0 ? 1 : -1);
    sx = null;
  });
}

function onHoverCard(item, x, y) {
  const tip = $("#hoverTip");
  if (!item || !$("#lightbox").hidden || window.matchMedia("(hover: none)").matches) { tip.hidden = true; return; }
  tip.innerHTML = `<b>${esc(item.caption || "a memory")}</b><span>${esc(yearOf(item.year).label)} · by ${esc(item.uploaderName)}${item.likedBy.length ? ` · ♥ ${item.likedBy.length}` : ""}</span>`;
  const maxX = window.innerWidth - 260;
  tip.style.left = Math.min(x, maxX) + "px";
  tip.style.top = Math.min(y, window.innerHeight - 90) + "px";
  tip.hidden = false;
}

// ───────────────────────── boot ─────────────────────────
async function boot() {
  document.title = `${SITE.title} · ${SITE.coreLabel}`;
  $("#siteTitle").textContent = SITE.title;
  $("#siteSub").textContent = SITE.coreLabel;
  $("#yearSelect").innerHTML = YEARS.map((y) => `<option value="${y.id}">${esc(y.label)}</option>`).join("");
  $("#eventSelect").innerHTML = EVENTS.map((ev) => `<option>${esc(ev)}</option>`).join("");
  $("#dzLimit").textContent = `Up to ${MAX_FILES_PER_UPLOAD} at once · JPG, PNG, WebP`;
  $("#demoBanner").hidden = !isDemo;
  renderChips();
  renderLayouts();
  bindEvents();

  // wait for fonts so card captions render in the right typeface
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  try {
    await Promise.all([document.fonts.load('700 32px "Caveat"'), document.fonts.load('600 12px "Space Grotesk"')]);
  } catch (_) { /* ignore */ }

  try {
    scene = createScene($("#stage"), {
      years: YEARS,
      coreLabel: SITE.coreLabel,
      onSelect: (id) => openMemory(id),
      onHover: onHoverCard,
    });
  } catch (err) {
    console.error(err);
    $("#noWebgl").hidden = false;
    $("#layoutDock").hidden = true;
  }

  let first = true;
  onItems((items) => {
    state.items = items;
    if (scene) scene.setItems(sortItems(items));
    renderChips();
    renderStats();
    applyFilter();
    if (state.currentId && !$("#lightbox").hidden) showLightbox();
    if (first) {
      first = false;
      $("#loader").classList.add("done");
      openFromHash();
    }
  });
  onAuth((u) => {
    renderAuth(u);
    if (state.currentId && !$("#lightbox").hidden) showLightbox();
  });
  onError((m) => toast(m, 5000));

  try {
    await initStore();
  } catch (err) {
    console.error(err);
    $("#loaderHint").textContent = "Couldn't connect to the database. Check js/config.js.";
    toast("Couldn't connect to Firebase — check js/config.js", 8000);
    setTimeout(() => $("#loader").classList.add("done"), 1500);
  }
}

boot();
