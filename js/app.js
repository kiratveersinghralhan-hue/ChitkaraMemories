// UI wiring: intro + login gate, filters, layouts, upload, lightbox, gallery, story mode, admin.
import { SITE, YEARS, EVENTS, ALLOWED_EMAIL_DOMAIN, MAX_FILES_PER_UPLOAD } from "./config.js";
import {
  isDemo, initStore, onItems, onAuth, onError, onBlocked, getUser, signIn, signOut,
  upload, toggleLike, removeMemory, canDelete, getFullUrl, logActivity, memoryRef, reportMemory,
} from "./store.js";
import { createScene } from "./scene.js";
import { initAdmin, openAdmin, closeAdmin, isAdminOpen, refreshAdminView } from "./admin.js";

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
const STORY_ICON = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const REPORT_REASONS = ["I'm in it and didn't agree to it", "Not from our batch", "Embarrassing or hurtful", "Inappropriate content", "Duplicate photo", "Something else"];
const STORY_STEP_MS = 4500;

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
let introDone = new Promise((r) => setTimeout(r, 1200));
let entered = false;

// ───────────────────────── helpers ─────────────────────────
let toastTimer;
function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

// In-page dialog. Returns null on cancel, or { choice, text } on OK.
function askDialog({ title, message = "", ok = "OK", danger = false, choices = null, input = null }) {
  const box = $("#dialogBox");
  $("#dialogTitle").textContent = title;
  $("#dialogMsg").textContent = message;
  $("#dialogMsg").hidden = !message;
  $("#dialogYes").textContent = ok;
  $("#dialogYes").classList.toggle("btn-danger-solid", danger);
  $("#dialogChoices").innerHTML = choices
    ? choices.map((c, i) => `<label class="choice"><input type="radio" name="dlgChoice" value="${esc(c)}" ${i === 0 ? "checked" : ""}><span>${esc(c)}</span></label>`).join("")
    : "";
  $("#dialogChoices").hidden = !choices;
  $("#dialogInputWrap").hidden = !input;
  $("#dialogInput").value = "";
  $("#dialogInput").placeholder = input || "";
  box.hidden = false;
  setTimeout(() => (input && !choices ? $("#dialogInput") : $("#dialogYes")).focus(), 30);
  return new Promise((resolve) => {
    const done = (v) => {
      box.hidden = true;
      $("#dialogForm").onsubmit = null;
      $("#dialogNo").onclick = null;
      box.onclick = null;
      resolve(v);
    };
    $("#dialogForm").onsubmit = (e) => {
      e.preventDefault();
      const picked = box.querySelector("input[name=dlgChoice]:checked");
      done({ choice: picked ? picked.value : "", text: $("#dialogInput").value.trim() });
    };
    $("#dialogNo").onclick = () => done(null);
    box.onclick = (e) => { if (e.target === box) done(null); };
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
  return (name || "?").split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w)).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}
function avatarHtml(name, photo) {
  return photo ? `<img class="avatar" src="${esc(photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${esc(initials(name))}</span>`;
}
function timeAgo(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 60) return "just now";
  if (d < 3600) return Math.floor(d / 60) + "m ago";
  if (d < 86400) return Math.floor(d / 3600) + "h ago";
  if (d < 86400 * 30) return Math.floor(d / 86400) + "d ago";
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
const currentItem = () => state.items.find((i) => i.id === state.currentId);

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
  ).join("") + `<span class="dock-sep"></span><button class="layout-btn story-btn ${story.on ? "active" : ""}" id="storyBtn" title="Story mode (space)">${story.on ? STOP_ICON : STORY_ICON}<span>${story.on ? "Stop" : "Story"}</span></button>`;
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
  $("#adminBtn").hidden = !(user && user.admin);
  area.innerHTML = user
    ? `<button class="avatar-btn glass" id="userBtn" title="${esc(user.email)}">${avatarHtml(user.name, user.photo)}<span class="name">${esc(user.name.split(" ")[0])}</span></button>`
    : "";
}
function renderGallery() {
  const body = $("#galleryBody");
  if (!body || $("#gallery").hidden) return;
  if (!state.list.length) {
    body.innerHTML = `<div class="g-empty">${state.items.length ? "Nothing matches that search." : "No memories yet. Be the first to add one ✨"}</div>`;
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

// ───────────────────────── intro + gate ─────────────────────────
function setupIntroTitle() {
  const h = $("#introTitle");
  const words = SITE.title.split(" ");
  let i = 0;
  h.setAttribute("aria-label", SITE.title);
  h.innerHTML = words.map((w, wi) => `<span class="w ${wi === words.length - 1 ? "accent" : ""}">${[...w].map((ch) => `<span class="ch" style="--i:${i++}">${esc(ch)}</span>`).join("")}</span>`).join(" ");
}
async function showGate() {
  await introDone;
  if (getUser()) return;
  document.body.classList.add("locked");
  $("#intro").classList.remove("done");
  $("#introStatus").hidden = true;
  $("#gate").hidden = false;
  $("#gateSignInLabel").textContent = isDemo ? "Enter the demo" : "Sign in with your Chitkara email";
}
async function enter() {
  if (entered) return;
  entered = true;
  $("#gate").hidden = true;
  $("#introStatus").hidden = false;
  $("#introStatus").textContent = "Opening the galaxy…";
  await introDone;
  if (!getUser()) { entered = false; return; }
  $("#intro").classList.add("done");
  document.body.classList.remove("locked");
  if (scene) scene.reveal();
}
function leave() {
  entered = false;
  stopStory();
  $("#lightbox").hidden = true;
  $("#uploadPanel").hidden = true;
  closeGallery();
  closeAdmin();
  state.currentId = null;
  if (scene) scene.conceal();
  showGate();
}

function showBlocked({ kind, email, reason }) {
  if (kind === "banned") {
    $("#blockedTitle").textContent = "Your access has been removed";
    $("#blockedMsg").textContent = `The account ${email} was blocked by an admin${reason ? `: ${reason}` : ""}. If you think this is a mistake, talk to the batch admin.`;
    $("#blockedRetry").hidden = true;
  } else {
    $("#blockedTitle").textContent = "Chitkara accounts only";
    $("#blockedMsg").textContent = `You tried to sign in with ${email || "a non-Chitkara account"}. This site is only for our batch, so please sign in with your @${ALLOWED_EMAIL_DOMAIN} college email.`;
    $("#blockedRetry").hidden = false;
  }
  $("#blockedBox").hidden = false;
}

// ───────────────────────── lightbox ─────────────────────────
function openMemory(id, { fly = true } = {}) {
  const item = state.items.find((i) => i.id === id);
  if (!item) return;
  stopStory();
  state.currentId = id;
  $("#hoverTip").hidden = true;
  if (fly && scene && !isAdminOpen()) {
    scene.focus(id);
    setTimeout(() => showLightbox(), 420);
  } else showLightbox();
  try { history.replaceState(null, "", "#m=" + encodeURIComponent(id)); } catch (_) { /* ignore */ }
}

function showLightbox() {
  const item = currentItem();
  if (!item) { closeLightbox(); return; }
  const img = $("#lbImg");
  if (img.dataset.id !== item.id) {
    img.dataset.id = item.id;
    img.src = item.thumb;
    getFullUrl(item).then((src) => {
      if (state.currentId !== item.id) return;
      const full = new Image();
      full.onload = () => { if (state.currentId === item.id) img.src = src; };
      full.src = src;
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
  $("#lbReport").hidden = !!user && item.uploaderUid === user.uid;
  const idx = state.list.findIndex((i) => i.id === item.id);
  $("#lbCount").textContent = idx >= 0 ? `${idx + 1} of ${state.list.length}` : "";
  $("#lightbox").hidden = false;
}

function closeLightbox() {
  $("#lightbox").hidden = true;
  state.currentId = null;
  if (scene && !isAdminOpen()) scene.release();
  try { history.replaceState(null, "", location.pathname + location.search); } catch (_) { /* ignore */ }
}

function stepLightbox(dir) {
  if (!state.list.length) return;
  let idx = state.list.findIndex((i) => i.id === state.currentId);
  idx = (idx + dir + state.list.length) % state.list.length;
  const next = state.list[idx];
  state.currentId = next.id;
  if (scene && !isAdminOpen()) scene.focus(next.id);
  showLightbox();
  try { history.replaceState(null, "", "#m=" + encodeURIComponent(next.id)); } catch (_) { /* ignore */ }
}

function fileNameFor(item) {
  return ((item.caption || "chitkara-memory").replace(/[^\w\- ]+/g, "").trim().slice(0, 40) || "chitkara-memory") + ".jpg";
}
function triggerDownload(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
async function downloadCurrent() {
  const item = currentItem();
  if (!item) return;
  const btn = $("#lbDownload");
  btn.disabled = true;
  try {
    const src = await getFullUrl(item);
    logActivity("download", memoryRef(item));
    if (src.startsWith("data:")) triggerDownload(src, fileNameFor(item));
    else {
      try {
        const blob = await (await fetch(src)).blob();
        const u = URL.createObjectURL(blob);
        triggerDownload(u, fileNameFor(item));
        setTimeout(() => URL.revokeObjectURL(u), 5000);
      } catch (_) { window.open(src, "_blank", "noopener"); }
    }
    toast("Saved to your downloads");
  } catch (e) {
    toast("Download failed: " + e.message);
  } finally { btn.disabled = false; }
}
async function reportCurrent() {
  const item = currentItem();
  if (!item) return;
  const res = await askDialog({
    title: "Report this photo",
    message: "Only admins see reports. The person who posted it won't know it was you.",
    choices: REPORT_REASONS,
    input: "Anything else admins should know? (optional)",
    ok: "Send report",
  });
  if (!res) return;
  try { await reportMemory(item, res.choice, res.text); toast("Thanks. An admin will review it soon."); }
  catch (e) { toast(e.message); }
}

// ───────────────────────── story mode ─────────────────────────
const story = { on: false, timer: null, idx: 0 };
function startStory() {
  if (!state.list.length) { toast("No memories to play yet"); return; }
  closeLightbox();
  closeGallery();
  story.on = true;
  const cur = state.list.findIndex((i) => i.id === state.currentId);
  story.idx = cur >= 0 ? cur : 0;
  document.body.classList.add("story");
  renderLayouts();
  storyStep();
  story.timer = setInterval(() => { story.idx = (story.idx + 1) % state.list.length; storyStep(); }, STORY_STEP_MS);
}
function storyStep() {
  const it = state.list[story.idx];
  if (!it) { stopStory(); return; }
  if (scene) scene.focus(it.id);
  const card = $("#storyCard");
  card.hidden = false;
  card.classList.remove("in");
  void card.offsetWidth;
  card.classList.add("in");
  $("#storyYear").textContent = yearOf(it.year).label;
  $("#storyCaption").textContent = it.caption || "A memory";
  $("#storyMeta").textContent = `${it.people.length ? "with " + it.people.join(", ") + " · " : ""}added by ${it.uploaderName} · ${story.idx + 1} of ${state.list.length}`;
  const bar = $("#storyBar");
  bar.style.transition = "none";
  bar.style.width = "0%";
  void bar.offsetWidth;
  bar.style.transition = `width ${STORY_STEP_MS}ms linear`;
  bar.style.width = "100%";
}
function stopStory() {
  if (!story.on) return;
  story.on = false;
  clearInterval(story.timer);
  $("#storyCard").hidden = true;
  document.body.classList.remove("story");
  if (scene) scene.release();
  renderLayouts();
}

// ───────────────────────── upload ─────────────────────────
function openUpload() {
  if (!getUser()) { showGate(); return; }
  stopStory();
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
function setYear(y) { state.year = y; renderChips(); applyFilter(); }
function setQuery(q) {
  state.query = q;
  if ($("#searchInput").value !== q) $("#searchInput").value = q;
  if ($("#gallerySearch").value !== q) $("#gallerySearch").value = q;
  applyFilter();
}
function setLayout(id) { stopStory(); state.layout = id; renderLayouts(); if (scene) scene.setLayout(id); }
function openGallery() { stopStory(); $("#gallery").hidden = false; renderGallery(); }
function closeGallery() { $("#gallery").hidden = true; }

function openFromHash() {
  const m = location.hash.match(/^#m=(.+)$/);
  if (!m || state.currentId) return;
  const id = decodeURIComponent(m[1]);
  if (state.items.some((i) => i.id === id)) setTimeout(() => openMemory(id), 1400);
}

function bindEvents() {
  $("#gateSignIn").addEventListener("click", () => signIn(false));
  $("#gateAdmin").addEventListener("click", () => signIn(true));
  $("#blockedRetry").addEventListener("click", () => { $("#blockedBox").hidden = true; signIn(false); });
  $("#blockedClose").addEventListener("click", () => { $("#blockedBox").hidden = true; });

  $("#yearChips").addEventListener("click", (e) => { const b = e.target.closest("[data-year]"); if (b) setYear(b.dataset.year); });
  $("#layoutDock").addEventListener("click", (e) => {
    if (e.target.closest("#storyBtn")) { if (story.on) stopStory(); else startStory(); return; }
    const b = e.target.closest("[data-layout]");
    if (b) setLayout(b.dataset.layout);
  });
  $("#storyStop").addEventListener("click", stopStory);
  $("#searchInput").addEventListener("input", (e) => setQuery(e.target.value));
  $("#gallerySearch").addEventListener("input", (e) => setQuery(e.target.value));
  $("#brandLink").addEventListener("click", (e) => { e.preventDefault(); stopStory(); setQuery(""); setYear("all"); if (scene) scene.resetView(); });
  document.querySelectorAll("[data-open-gallery]").forEach((b) => b.addEventListener("click", openGallery));
  $("#uploadFab").addEventListener("click", openUpload);
  $("#adminBtn").addEventListener("click", () => { stopStory(); openAdmin(); });

  $("#authArea").addEventListener("click", async (e) => {
    if (!e.target.closest("#userBtn")) return;
    const u = getUser();
    const res = await askDialog({ title: "Sign out?", message: u ? `Signed in as ${u.email}` : "", ok: "Sign out" });
    if (res) signOut();
  });

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
    const item = currentItem();
    if (!item) return;
    try { await toggleLike(item); } catch (err) { toast(err.message); }
  });
  $("#lbShare").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link copied. Send it to the group chat 🔗"); }
    catch (_) { toast(location.href, 6000); }
  });
  $("#lbDownload").addEventListener("click", downloadCurrent);
  $("#lbReport").addEventListener("click", reportCurrent);
  $("#lbDelete").addEventListener("click", async () => {
    const item = currentItem();
    if (!item) return;
    const mine = getUser() && item.uploaderUid === getUser().uid;
    const res = await askDialog({
      title: "Delete this memory?",
      message: "It will be removed for everyone.",
      input: mine ? null : "Reason (saved in the activity log)",
      ok: "Delete",
      danger: true,
    });
    if (!res) return;
    try { await removeMemory(item, res.text); closeLightbox(); toast("Memory deleted"); refreshAdminView(); } catch (err) { toast(err.message); }
  });
  $("#lbPeople").addEventListener("click", (e) => {
    const p = e.target.closest("[data-person]");
    if (!p) return;
    closeLightbox();
    closeAdmin();
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

  // stop story when the user grabs the 3D view
  $("#stage").addEventListener("pointerdown", () => stopStory());

  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === "Escape") {
      if (!$("#dialogBox").hidden) $("#dialogNo").click();
      else if (!$("#blockedBox").hidden) $("#blockedBox").hidden = true;
      else if (!$("#lightbox").hidden) closeLightbox();
      else if (!$("#uploadPanel").hidden) closeUpload();
      else if (isAdminOpen()) closeAdmin();
      else if (!$("#gallery").hidden) closeGallery();
      else stopStory();
      return;
    }
    if (!$("#dialogBox").hidden || isAdminOpen() || !entered) return;
    if (!$("#lightbox").hidden) {
      if (e.key === "ArrowRight") stepLightbox(1);
      if (e.key === "ArrowLeft") stepLightbox(-1);
      return;
    }
    if (typing) return;
    if (e.key === "/") { e.preventDefault(); $("#searchInput").focus(); }
    if (e.key === " ") { e.preventDefault(); if (story.on) stopStory(); else startStory(); }
    const n = Number(e.key);
    if (n >= 1 && n <= LAYOUTS.length) setLayout(LAYOUTS[n - 1].id);
  });

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
  if (!item || !$("#lightbox").hidden || story.on || window.matchMedia("(hover: none)").matches) { tip.hidden = true; return; }
  tip.innerHTML = `<b>${esc(item.caption || "a memory")}</b><span>${esc(yearOf(item.year).label)} · by ${esc(item.uploaderName)}${item.likedBy.length ? ` · ♥ ${item.likedBy.length}` : ""}</span>`;
  tip.style.left = Math.min(x, window.innerWidth - 260) + "px";
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
  setupIntroTitle();
  renderChips();
  renderLayouts();
  bindEvents();
  initAdmin({ getItems: () => state.items, openMemory, toast, askDialog });

  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  try { await Promise.all([document.fonts.load('700 220px "Space Grotesk"'), document.fonts.load('700 32px "Caveat"')]); } catch (_) { /* ignore */ }
  document.body.classList.add("ready");

  try {
    scene = createScene($("#stage"), { years: YEARS, coreLabel: SITE.coreLabel, onSelect: (id) => openMemory(id), onHover: onHoverCard });
    introDone = scene.introDone;
  } catch (err) {
    console.error(err);
    $("#noWebgl").hidden = false;
    $("#layoutDock").hidden = true;
  }

  let firstItems = true;
  onItems((items) => {
    state.items = items;
    if (scene) scene.setItems(sortItems(items));
    renderChips();
    renderStats();
    applyFilter();
    if (state.currentId && !$("#lightbox").hidden) showLightbox();
    refreshAdminView();
    if (firstItems && items.length) { firstItems = false; openFromHash(); }
  });
  onAuth((u) => {
    renderAuth(u);
    if (u) enter();
    else if (entered) leave();
    else showGate();
    if (state.currentId && !$("#lightbox").hidden) showLightbox();
  });
  onBlocked(showBlocked);
  onError((m) => toast(m, 5000));

  try {
    await initStore();
  } catch (err) {
    console.error(err);
    $("#introStatus").textContent = "Couldn't connect to the database. Check js/config.js.";
    toast("Couldn't connect to Firebase. Check js/config.js", 8000);
  }
}

boot();
