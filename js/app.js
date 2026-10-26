// UI wiring: intro + access gate, filters, layouts, upload, lightbox (comments, reactions),
// gallery, story / farewell film, daily memory, nudges, batch panel, admin.
import { SITE, YEARS, EVENTS, ALLOWED_EMAIL_DOMAIN, MAX_FILES_PER_UPLOAD } from "./config.js";
import {
  isDemo, initStore, onItems, onAuth, onError, onBlocked, onPending, onProfiles, getUser, getProfiles, signIn, signOut,
  requestAccess, upload, toggleLike, setReaction, removeMemory, canDelete, getFullUrl, logActivity, memoryRef, reportMemory,
  watchComments, addComment, deleteComment, REACTIONS,
} from "./store.js";
import { createScene } from "./scene.js";
import { createMetalLogo } from "./logo3d.js";
import { initAdmin, openAdmin, closeAdmin, isAdminOpen, refreshAdminView } from "./admin.js";
import { initBatch, openBatch, closeBatch, isBatchOpen, refreshBatchView } from "./batch.js";
import { startMusic, stopMusic, enterFullscreen, exitFullscreen } from "./film.js";

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const yearOf = (id) => YEARS.find((y) => y.id === id) || { label: id, sub: "" };
const yearRank = Object.fromEntries(YEARS.map((y, i) => [y.id, i]));

const LAYOUTS = [
  { id: "galaxy", label: "Galaxy", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M12 4a8 8 0 0 1 8 8M12 20a8 8 0 0 1-8-8M16.5 7.5A6 6 0 0 0 7 9M7.5 16.5A6 6 0 0 0 17 15"/></svg>' },
  { id: "helix", label: "Helix", icon: '<svg viewBox="0 0 24 24"><path d="M7 3c0 6 10 6 10 12s-10 6-10 6M17 3c0 6-10 6-10 12"/></svg>' },
  { id: "sphere", label: "Sphere", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>' },
  { id: "albums", label: "Albums", icon: '<svg viewBox="0 0 24 24"><circle cx="7" cy="8" r="3"/><circle cx="17" cy="8" r="3"/><circle cx="12" cy="17" r="3"/></svg>' },
  { id: "wall", label: "Wall", icon: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="6" rx="1"/><rect x="14" y="14" width="7" height="6" rx="1"/></svg>' },
  { id: "timeline", label: "Timeline", icon: '<svg viewBox="0 0 24 24"><path d="M3 12h18"/><circle cx="6" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="18" cy="12" r="2"/></svg>' },
];
const STORY_ICON = '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>';
const STOP_ICON = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
const REPORT_REASONS = ["I'm in it and didn't agree to it", "Not from our batch", "Embarrassing or hurtful", "Inappropriate content", "Duplicate photo", "Something else"];
const STORY_STEP_MS = 4500;
const FILM_STEP_MS = 5200;

const state = {
  items: [],
  year: "all",
  query: "",
  layout: "galaxy",
  list: [],
  currentId: null,
  files: [],
  tags: [],
  uploading: false,
};
let scene = null;
let introDone = new Promise((r) => setTimeout(r, 1200));
let entered = false;
let unsubComments = null;
let installPrompt = null;

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
function askDialog({ title, message = "", ok = "OK", danger = false, choices = null, input = null, multiline = false }) {
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
  $("#dialogInputWrap").hidden = !input || multiline;
  $("#dialogArea").hidden = !input || !multiline;
  $("#dialogInput").value = "";
  $("#dialogArea").value = "";
  $("#dialogInput").placeholder = input || "";
  $("#dialogArea").placeholder = input || "";
  box.hidden = false;
  setTimeout(() => (input && !choices ? (multiline ? $("#dialogArea") : $("#dialogInput")) : $("#dialogYes")).focus(), 30);
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
      done({ choice: picked ? picked.value : "", text: (multiline ? $("#dialogArea") : $("#dialogInput")).value.trim() });
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
  const hay = [item.caption, item.event, item.album, item.uploaderName, yearOf(item.year).label, ...(item.people || [])].join(" ").toLowerCase();
  return q.split(/\s+/).every((w) => hay.includes(w));
}
function initials(name) {
  return (name || "?").split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w)).slice(0, 2).map((s) => s[0].toUpperCase()).join("") || "?";
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
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (_) { /* ignore */ } };

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
  $("#adminBtn").hidden = !(user && user.admin);
  $("#authArea").innerHTML = user
    ? `<button class="avatar-btn glass" id="userBtn" title="${esc(user.email)}">${avatarHtml(user.name, user.photo)}<span class="name">${esc(user.name.split(" ")[0])}</span></button>`
    : "";
}
function renderAlbumOptions() {
  const albums = [...new Set(state.items.map((i) => i.album).filter(Boolean))].sort();
  $("#albumList").innerHTML = albums.map((a) => `<option value="${esc(a)}"></option>`).join("");
}
function renderGallery() {
  const body = $("#galleryBody");
  if (!body || $("#gallery").hidden) return;
  if (!state.list.length) {
    body.innerHTML = `<div class="g-empty">${state.items.length ? "Nothing matches that search." : "No memories yet. Be the first to add one ✨"}</div>`;
    return;
  }
  const byAlbum = $("#galleryGroup").value === "album";
  const groups = byAlbum
    ? [...new Set(state.list.map((i) => i.album || ""))].sort((a, b) => (a === "") - (b === "") || a.localeCompare(b))
      .map((a) => ({ title: a || "Other moments", sub: "", items: state.list.filter((i) => (i.album || "") === a) }))
    : YEARS.map((y) => ({ title: y.label, sub: y.sub, items: state.list.filter((i) => i.year === y.id) })).filter((g) => g.items.length);
  body.innerHTML = groups.map(({ title, sub, items }) => `
    <div class="g-year"><h3>${esc(title)}</h3><span>${sub ? esc(sub) + " · " : ""}${items.length}</span></div>
    <div class="g-grid">${items.map((i) => `<button class="g-item" data-id="${esc(i.id)}" title="${esc(i.caption)}"><img loading="lazy" src="${esc(i.thumb)}" alt="${esc(i.caption)}" draggable="false"></button>`).join("")}</div>
  `).join("");
}
function applyFilter() {
  state.list = sortItems(state.items).filter(matches);
  if (scene) scene.setFilter(matches);
  renderGallery();
}

// ───────────────────────── intro, gate, access requests ─────────────────────────
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
  $("#pendingBox").hidden = true;
  $("#gate").hidden = false;
  $("#gateSignInLabel").textContent = isDemo ? "Enter the demo as admin" : "Sign in with your Chitkara email";
  $("#gateDemoStranger").hidden = !isDemo;
}
async function showPending(p) {
  await introDone;
  if (!p || getUser()) { $("#pendingBox").hidden = true; return; }
  document.body.classList.add("locked");
  $("#intro").classList.remove("done");
  $("#introStatus").hidden = true;
  $("#gate").hidden = true;
  const box = $("#pendingBox");
  box.hidden = false;
  $("#pendingAvatar").innerHTML = avatarHtml(p.name, p.photo);
  $("#pendingName").textContent = `Hi ${p.name.split(" ")[0]}`;
  $("#pendingEmail").textContent = p.email;
  const sent = p.status === "pending";
  $("#pendingForm").hidden = sent;
  $("#pendingSent").hidden = !sent;
  if (sent) $("#pendingNoteShown").textContent = p.note ? `Your note: “${p.note}”` : "";
}
async function enter() {
  if (entered) return;
  entered = true;
  $("#gate").hidden = true;
  $("#pendingBox").hidden = true;
  $("#introStatus").hidden = false;
  $("#introStatus").textContent = "Opening the galaxy…";
  await introDone;
  if (!getUser()) { entered = false; return; }
  $("#intro").classList.add("done");
  document.body.classList.remove("locked");
  if (scene) scene.reveal();
  setTimeout(maybeShowDaily, 2600);
  setTimeout(maybeNudge, 9000);
}
function leave() {
  entered = false;
  stopStory();
  $("#lightbox").hidden = true;
  $("#uploadPanel").hidden = true;
  $("#dailyCard").hidden = true;
  $("#nudgeCard").hidden = true;
  closeGallery();
  closeAdmin();
  closeBatch();
  state.currentId = null;
  if (scene) scene.conceal();
  showGate();
}

function showBlocked({ kind, email, reason }) {
  $("#blockedRetry").hidden = false;
  if (kind === "banned") {
    $("#blockedTitle").textContent = "Your access has been removed";
    $("#blockedMsg").textContent = `The account ${email} was blocked by an admin${reason ? `: ${reason}` : ""}. If you think this is a mistake, talk to the batch admin.`;
    $("#blockedRetry").hidden = true;
  } else if (kind === "denied") {
    $("#blockedTitle").textContent = "Request not approved";
    $("#blockedMsg").textContent = `The admin didn't approve access for ${email}. This space is only for our class. If you think that's wrong, message the batch admin.`;
    $("#blockedRetry").hidden = true;
  } else {
    $("#blockedTitle").textContent = "Chitkara accounts only";
    $("#blockedMsg").textContent = `You tried to sign in with ${email || "a non-Chitkara account"}. This site is only for our class, so please sign in with your @${ALLOWED_EMAIL_DOMAIN} college email.`;
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
  $("#dailyCard").hidden = true;
  if (fly && scene && !isAdminOpen() && !isBatchOpen()) {
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
    $("#commentInput").value = "";
    if (unsubComments) unsubComments();
    $("#lbComments").innerHTML = `<p class="muted c-empty">Loading comments…</p>`;
    unsubComments = watchComments(item.id, (list) => renderComments(item, list));
  }
  img.alt = item.caption || "memory";
  const y = yearOf(item.year);
  $("#lbTags").innerHTML = `<span class="tag year">${esc(y.label)}</span>${item.event ? `<span class="tag">${esc(item.event)}</span>` : ""}${item.album ? `<button class="tag tag-album" data-album="${esc(item.album)}">📁 ${esc(item.album)}</button>` : ""}`;
  $("#lbCaption").textContent = item.caption || "A memory";
  const profiles = getProfiles();
  $("#lbPeople").innerHTML = item.people.map((p, k) => {
    const uid = item.peopleUids[k] && profiles.some((x) => x.uid === item.peopleUids[k]) ? item.peopleUids[k] : "";
    return uid
      ? `<button class="person linked" data-profile="${esc(uid)}">@${esc(p)}</button>`
      : `<button class="person" data-person="${esc(p)}">@${esc(p)}</button>`;
  }).join("");
  $("#lbUploader").innerHTML = `${avatarHtml(item.uploaderName, item.uploaderPhoto)}<span>Added by <button class="a-link" data-profile="${esc(item.uploaderUid)}">${esc(item.uploaderName)}</button><br>${timeAgo(item.createdAt)}</span>`;
  const user = getUser();
  const liked = !!user && item.likedBy.includes(user.uid);
  $("#lbLike").classList.toggle("liked", liked);
  $("#lbLikeCount").textContent = item.likedBy.length;
  const counts = {};
  Object.values(item.reactions).forEach((e) => { counts[e] = (counts[e] || 0) + 1; });
  const mine = user ? item.reactions[user.uid] : null;
  $("#lbReactions").innerHTML = REACTIONS.map((e) => `<button class="react ${mine === e ? "mine" : ""}" data-react="${e}" aria-label="React ${e}">${e}${counts[e] ? `<span>${counts[e]}</span>` : ""}</button>`).join("");
  $("#lbDelete").hidden = !canDelete(item);
  $("#lbReport").hidden = !!user && item.uploaderUid === user.uid;
  const idx = state.list.findIndex((i) => i.id === item.id);
  $("#lbCount").textContent = idx >= 0 ? `${idx + 1} of ${state.list.length}` : "";
  $("#lightbox").hidden = false;
}

function renderComments(item, list) {
  if (state.currentId !== item.id) return;
  const user = getUser();
  $("#lbCommentCount").textContent = list.length ? `(${list.length})` : "";
  $("#lbComments").innerHTML = list.length
    ? list.map((c) => `<div class="comment">${avatarHtml(c.name, c.photo)}<div><p><b>${esc(c.name.split(" ")[0])}</b> ${esc(c.text)}</p><small>${timeAgo(c.at)}${user && (c.uid === user.uid || user.admin) ? ` · <button class="c-del" data-cdel="${esc(c.id)}">Delete</button>` : ""}</small></div></div>`).join("")
    : `<p class="muted c-empty">No comments yet. Say something nice.</p>`;
  const box = $("#lbComments");
  box.scrollTop = box.scrollHeight;
  box._list = list;
}

function closeLightbox() {
  $("#lightbox").hidden = true;
  state.currentId = null;
  if (unsubComments) { unsubComments(); unsubComments = null; }
  $("#lbImg").dataset.id = "";
  if (scene && !isAdminOpen() && !isBatchOpen()) scene.release();
  try { history.replaceState(null, "", location.pathname + location.search); } catch (_) { /* ignore */ }
}

function stepLightbox(dir) {
  if (!state.list.length) return;
  let idx = state.list.findIndex((i) => i.id === state.currentId);
  idx = (idx + dir + state.list.length) % state.list.length;
  const next = state.list[idx];
  state.currentId = next.id;
  if (scene && !isAdminOpen() && !isBatchOpen()) scene.focus(next.id);
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
// Downloads carry a small "saved by" watermark so a leaked photo can be traced back.
async function watermarked(src, who) {
  const img = await new Promise((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = "anonymous";
    im.onload = () => resolve(im);
    im.onerror = reject;
    im.src = src;
  });
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const fs = Math.max(12, Math.round(c.width / 55));
  const label = `${SITE.title} · saved by ${who} · ${new Date().toLocaleDateString()}`;
  g.font = `600 ${fs}px "Space Grotesk", sans-serif`;
  const w = g.measureText(label).width;
  const pad = fs * 0.6;
  g.fillStyle = "rgba(0,0,0,.42)";
  g.fillRect(c.width - w - pad * 3, c.height - fs - pad * 3, w + pad * 2, fs + pad * 2);
  g.fillStyle = "rgba(255,255,255,.88)";
  g.textBaseline = "top";
  g.fillText(label, c.width - w - pad * 2, c.height - fs - pad * 2);
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.92));
}
async function downloadCurrent() {
  const item = currentItem();
  const user = getUser();
  if (!item || !user) return;
  const btn = $("#lbDownload");
  btn.disabled = true;
  try {
    const src = await getFullUrl(item);
    logActivity("download", memoryRef(item));
    let blob = null;
    try { blob = await watermarked(src, user.name); } catch (_) { blob = null; }
    if (blob) {
      const u = URL.createObjectURL(blob);
      triggerDownload(u, fileNameFor(item));
      setTimeout(() => URL.revokeObjectURL(u), 5000);
    } else window.open(src, "_blank", "noopener");
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

// ───────────────────────── story mode + farewell film ─────────────────────────
const story = { on: false, film: false, timer: null, idx: 0, lastYear: null };
function startStory({ film = false } = {}) {
  if (!state.list.length) { toast("No memories to play yet"); return; }
  closeLightbox();
  closeGallery();
  story.on = true;
  story.film = film;
  story.lastYear = null;
  const cur = state.list.findIndex((i) => i.id === state.currentId);
  story.idx = film ? 0 : (cur >= 0 ? cur : 0);
  document.body.classList.add("story");
  document.body.classList.toggle("film", film);
  $("#storyFilm").hidden = film;
  renderLayouts();
  storyStep();
}
function storyNext() {
  clearTimeout(story.timer);
  if (!story.on) return;
  story.idx += 1;
  if (story.idx >= state.list.length) {
    if (story.film) { finishFilm(); return; }
    story.idx = 0;
  }
  storyStep();
}
function storyStep() {
  const it = state.list[story.idx];
  if (!it) { stopStory(); return; }
  if (story.film && it.year !== story.lastYear) {
    story.lastYear = it.year;
    const y = yearOf(it.year);
    showFilmTitle(y.label, y.sub);
    $("#storyCard").hidden = true;
    story.timer = setTimeout(() => { hideFilmTitle(); showStoryCard(it); }, 2600);
    return;
  }
  story.lastYear = it.year;
  showStoryCard(it);
}
function showStoryCard(it) {
  if (!story.on) return;
  if (scene) scene.focus(it.id);
  const card = $("#storyCard");
  card.hidden = false;
  card.classList.remove("in");
  void card.offsetWidth;
  card.classList.add("in");
  $("#storyYear").textContent = yearOf(it.year).label;
  $("#storyCaption").textContent = it.caption || "A memory";
  $("#storyMeta").textContent = `${it.people.length ? "with " + it.people.join(", ") + " · " : ""}added by ${it.uploaderName} · ${story.idx + 1} of ${state.list.length}`;
  const ms = story.film ? FILM_STEP_MS : STORY_STEP_MS;
  const bar = $("#storyBar");
  bar.style.transition = "none";
  bar.style.width = "0%";
  void bar.offsetWidth;
  bar.style.transition = `width ${ms}ms linear`;
  bar.style.width = "100%";
  story.timer = setTimeout(storyNext, ms);
}
function showFilmTitle(title, sub) {
  $("#filmTitleText").textContent = title;
  $("#filmTitleSub").textContent = sub || "";
  const el = $("#filmTitle");
  el.hidden = false;
  el.classList.remove("in");
  void el.offsetWidth;
  el.classList.add("in");
}
function hideFilmTitle() { $("#filmTitle").hidden = true; }
function finishFilm() {
  showFilmTitle(SITE.title, "Thank you for the memories 💛");
  $("#storyCard").hidden = true;
  if (scene) scene.resetView();
  story.timer = setTimeout(stopStory, 5000);
}
function stopStory() {
  if (!story.on) return;
  story.on = false;
  clearTimeout(story.timer);
  $("#storyCard").hidden = true;
  hideFilmTitle();
  document.body.classList.remove("story", "film");
  if (story.film) { stopMusic(); exitFullscreen(); }
  story.film = false;
  if (scene) scene.release();
  renderLayouts();
}
async function startFilm() {
  const res = await askDialog({
    title: "Play the farewell film",
    message: "Goes fullscreen and plays every memory in order, with a title card for each year. Great on a projector.",
    choices: ["Built-in soundtrack", "Pick a song from my device", "No music"],
    ok: "Play",
  });
  if (!res) return;
  if (res.choice.startsWith("Pick")) {
    const file = await pickAudio();
    if (!file) return;
    startMusic({ file });
  } else if (res.choice.startsWith("Built")) startMusic({ synth: true });
  stopStory();
  enterFullscreen();
  startStory({ film: true });
}
function pickAudio() {
  return new Promise((resolve) => {
    const input = $("#musicInput");
    input.value = "";
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
    setTimeout(() => { if (!input.files.length) resolve(null); }, 120000);
  });
}

// ───────────────────────── daily memory + nudge ─────────────────────────
function maybeShowDaily() {
  if (!entered || !state.items.length || story.on) return;
  const today = new Date();
  const key = "cm-daily-" + today.toDateString();
  if (lsGet(key)) return;
  const sameDay = state.items.filter((i) => {
    const d = new Date(i.createdAt);
    return d.getDate() === today.getDate() && d.getMonth() === today.getMonth() && d.getFullYear() < today.getFullYear();
  });
  let item; let label;
  if (sameDay.length) {
    item = sameDay[0];
    const yrs = today.getFullYear() - new Date(item.createdAt).getFullYear();
    label = `On this day · ${yrs} year${yrs > 1 ? "s" : ""} ago`;
  } else {
    const seed = Number(`${today.getFullYear()}${today.getMonth()}${today.getDate()}`);
    item = state.items[seed % state.items.length];
    label = "Memory of the day";
  }
  $("#dailyLabel").textContent = label;
  $("#dailyThumb").src = item.thumb;
  $("#dailyCaption").textContent = item.caption || "A memory";
  $("#dailyCard").dataset.id = item.id;
  $("#dailyCard").hidden = false;
  lsSet(key, "1");
}
function maybeNudge() {
  const user = getUser();
  if (!entered || !user || story.on || !$("#uploadPanel").hidden) return;
  if (state.items.some((i) => i.uploaderUid === user.uid)) return;
  if (lsGet("cm-nudged-" + user.uid)) return;
  $("#nudgeCard").hidden = false;
  lsSet("cm-nudged-" + user.uid, "1");
}

// ───────────────────────── upload (with linked friend tags) ─────────────────────────
function openUpload() {
  if (!getUser()) { showGate(); return; }
  stopStory();
  $("#nudgeCard").hidden = true;
  renderAlbumOptions();
  $("#uploadPanel").hidden = false;
}
function closeUpload() {
  if (state.uploading) return;
  $("#uploadPanel").hidden = true;
  state.files.forEach((f) => URL.revokeObjectURL(f.preview));
  state.files = [];
  state.tags = [];
  renderTags();
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
function renderTags() {
  $("#tagChips").innerHTML = state.tags.map((t, i) => `<span class="tchip ${t.uid ? "linked" : ""}">${t.uid ? "●" : ""} ${esc(t.name)}<button type="button" data-untag="${i}" aria-label="Remove ${esc(t.name)}">×</button></span>`).join("");
}
function addTag(t) {
  if (!t.name.trim() || state.tags.length >= 20) return;
  if (state.tags.some((x) => (t.uid && x.uid === t.uid) || x.name.toLowerCase() === t.name.toLowerCase())) return;
  state.tags.push({ name: t.name.trim().slice(0, 40), uid: t.uid || "" });
  renderTags();
}
function renderSuggest() {
  const q = $("#peopleInput").value.trim().toLowerCase();
  const box = $("#tagSuggest");
  if (!q) { box.hidden = true; return; }
  const me = getUser();
  const list = getProfiles()
    .filter((p) => p.uid !== (me && me.uid) && `${p.name} ${p.nickname || ""}`.toLowerCase().includes(q) && !state.tags.some((t) => t.uid === p.uid))
    .slice(0, 6);
  box.innerHTML = list.map((p) => `<button type="button" class="sugg" data-tuid="${esc(p.uid)}" data-tname="${esc(p.name)}">${avatarHtml(p.name, p.photo)}<span>${esc(p.name)}${p.nickname ? ` <small>“${esc(p.nickname)}”</small>` : ""}</span></button>`).join("")
    + `<button type="button" class="sugg plain" data-tname="${esc($("#peopleInput").value.trim())}">Tag “${esc($("#peopleInput").value.trim())}” (not on the site yet)</button>`;
  box.hidden = false;
}
async function submitUpload(e) {
  e.preventDefault();
  if (!state.files.length || state.uploading) return;
  const pending = $("#peopleInput").value.trim();
  if (pending) { addTag({ name: pending }); $("#peopleInput").value = ""; }
  const meta = {
    caption: $("#captionInput").value,
    year: $("#yearSelect").value,
    event: $("#eventSelect").value,
    album: $("#albumInput").value,
    people: state.tags.map((t) => t.name),
    peopleUids: state.tags.map((t) => t.uid),
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
  $("#gateDemoStranger").addEventListener("click", () => signIn(false, "stranger"));
  $("#gateAdmin").addEventListener("click", () => signIn(true));
  $("#pendingForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#pendingSend");
    btn.disabled = true;
    try { await requestAccess($("#pendingNote").value); toast("Request sent to the admin"); }
    catch (err) { toast(err.message); }
    btn.disabled = false;
  });
  $("#pendingSignOut").addEventListener("click", () => signOut());
  $("#blockedRetry").addEventListener("click", () => { $("#blockedBox").hidden = true; signIn(false); });
  $("#blockedClose").addEventListener("click", () => { $("#blockedBox").hidden = true; });

  $("#yearChips").addEventListener("click", (e) => { const b = e.target.closest("[data-year]"); if (b) setYear(b.dataset.year); });
  $("#layoutDock").addEventListener("click", (e) => {
    if (e.target.closest("#storyBtn")) { if (story.on) stopStory(); else startStory(); return; }
    const b = e.target.closest("[data-layout]");
    if (b) setLayout(b.dataset.layout);
  });
  $("#storyStop").addEventListener("click", stopStory);
  $("#storyFilm").addEventListener("click", startFilm);
  $("#filmExit").addEventListener("click", stopStory);
  $("#searchInput").addEventListener("input", (e) => setQuery(e.target.value));
  $("#gallerySearch").addEventListener("input", (e) => setQuery(e.target.value));
  $("#galleryGroup").addEventListener("change", renderGallery);
  $("#brandLink").addEventListener("click", (e) => { e.preventDefault(); stopStory(); setQuery(""); setYear("all"); if (scene) scene.resetView(); });
  document.querySelectorAll("[data-open-gallery]").forEach((b) => b.addEventListener("click", openGallery));
  $("#uploadFab").addEventListener("click", openUpload);
  $("#adminBtn").addEventListener("click", () => { stopStory(); openAdmin(); });
  $("#batchBtn").addEventListener("click", () => { stopStory(); openBatch("yearbook"); });
  $("#installBtn").addEventListener("click", async () => {
    if (installPrompt) { installPrompt.prompt(); try { await installPrompt.userChoice; } catch (_) { /* ignore */ } installPrompt = null; $("#installBtn").hidden = true; }
  });

  $("#dailyCard").addEventListener("click", (e) => {
    if (e.target.closest("#dailyClose")) { $("#dailyCard").hidden = true; return; }
    openMemory($("#dailyCard").dataset.id);
  });
  $("#nudgeCard").addEventListener("click", (e) => {
    if (e.target.closest("#nudgeClose")) { $("#nudgeCard").hidden = true; return; }
    if (e.target.closest("#nudgeGo")) openUpload();
  });

  $("#authArea").addEventListener("click", async (e) => {
    if (!e.target.closest("#userBtn")) return;
    const u = getUser();
    const res = await askDialog({ title: u ? u.name : "Account", message: u ? `Signed in as ${u.email}` : "", choices: ["My yearbook page", "Sign out"], ok: "Go" });
    if (!res) return;
    if (res.choice === "Sign out") signOut();
    else openBatch("yearbook", u.uid);
  });

  document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => {
    const o = b.closest(".overlay, .drawer");
    if (o.id === "lightbox") closeLightbox();
    else if (o.id === "uploadPanel") closeUpload();
    else closeGallery();
  }));
  $("#lightbox").addEventListener("click", (e) => { if (e.target.id === "lightbox" || e.target.classList.contains("lb-body")) closeLightbox(); });
  $("#uploadPanel").addEventListener("click", (e) => { if (e.target.id === "uploadPanel") closeUpload(); });

  // no casual right-click / long-press saving: downloads go through the tracked, watermarked button
  ["#lbImg", "#galleryBody", "#stage"].forEach((sel) => $(sel).addEventListener("contextmenu", (e) => e.preventDefault()));
  $("#lbImg").addEventListener("dragstart", (e) => e.preventDefault());

  $("#lbPrev").addEventListener("click", () => stepLightbox(-1));
  $("#lbNext").addEventListener("click", () => stepLightbox(1));
  $("#lbLike").addEventListener("click", async () => {
    const item = currentItem();
    if (!item) return;
    try { await toggleLike(item); } catch (err) { toast(err.message); }
  });
  $("#lbReactions").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-react]");
    const item = currentItem();
    if (!b || !item) return;
    try { await setReaction(item, b.dataset.react); } catch (err) { toast(err.message); }
  });
  $("#commentForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const item = currentItem();
    const input = $("#commentInput");
    if (!item || !input.value.trim()) return;
    const text = input.value;
    input.value = "";
    try { await addComment(item, text); } catch (err) { toast(err.message); input.value = text; }
  });
  $("#lbComments").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-cdel]");
    const item = currentItem();
    if (!b || !item) return;
    const c = ($("#lbComments")._list || []).find((x) => x.id === b.dataset.cdel);
    if (c) { try { await deleteComment(item, c); } catch (err) { toast(err.message); } }
  });
  $("#lbShare").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(location.href); toast("Link copied. Only approved classmates can open it 🔗"); }
    catch (_) { toast(location.href, 6000); }
  });
  $("#lbDownload").addEventListener("click", downloadCurrent);
  $("#lbReport").addEventListener("click", reportCurrent);
  $("#lbDelete").addEventListener("click", async () => {
    const item = currentItem();
    if (!item) return;
    const mine = getUser() && item.uploaderUid === getUser().uid;
    const res = await askDialog({ title: "Delete this memory?", message: "It will be removed for everyone.", input: mine ? null : "Reason (saved in the activity log)", ok: "Delete", danger: true });
    if (!res) return;
    try { await removeMemory(item, res.text); closeLightbox(); toast("Memory deleted"); refreshAdminView(); } catch (err) { toast(err.message); }
  });
  const peopleClick = (e) => {
    const prof = e.target.closest("[data-profile]");
    if (prof) { closeLightbox(); openBatch("yearbook", prof.dataset.profile); return; }
    const p = e.target.closest("[data-person]");
    const alb = e.target.closest("[data-album]");
    if (!p && !alb) return;
    const q = p ? p.dataset.person : alb.dataset.album;
    closeLightbox();
    closeAdmin();
    setYear("all");
    setQuery(q);
    if (alb) setLayout("albums");
    toast(p ? `Showing memories with ${q}` : `Album: ${q}`);
  };
  $("#lbPeople").addEventListener("click", peopleClick);
  $("#lbTags").addEventListener("click", peopleClick);
  $("#lbUploader").addEventListener("click", peopleClick);
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
  $("#peopleInput").addEventListener("input", renderSuggest);
  $("#peopleInput").addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === ",") && $("#peopleInput").value.trim()) {
      e.preventDefault();
      const first = $("#tagSuggest").querySelector(".sugg");
      if (first && first.dataset.tuid) addTag({ name: first.dataset.tname, uid: first.dataset.tuid });
      else addTag({ name: $("#peopleInput").value });
      $("#peopleInput").value = "";
      $("#tagSuggest").hidden = true;
    } else if (e.key === "Backspace" && !$("#peopleInput").value && state.tags.length) {
      state.tags.pop(); renderTags();
    }
  });
  $("#tagSuggest").addEventListener("mousedown", (e) => e.preventDefault());
  $("#tagSuggest").addEventListener("click", (e) => {
    const b = e.target.closest(".sugg");
    if (!b) return;
    addTag({ name: b.dataset.tname, uid: b.dataset.tuid || "" });
    $("#peopleInput").value = "";
    $("#tagSuggest").hidden = true;
    $("#peopleInput").focus();
  });
  $("#peopleInput").addEventListener("blur", () => setTimeout(() => { $("#tagSuggest").hidden = true; }, 150));
  $("#tagChips").addEventListener("click", (e) => {
    const b = e.target.closest("[data-untag]");
    if (!b) return;
    state.tags.splice(Number(b.dataset.untag), 1);
    renderTags();
  });
  $("#uploadForm").addEventListener("submit", submitUpload);

  $("#stage").addEventListener("pointerdown", () => { if (!story.film) stopStory(); });

  document.addEventListener("keydown", (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === "Escape") {
      if (!$("#dialogBox").hidden) $("#dialogNo").click();
      else if (!$("#blockedBox").hidden) $("#blockedBox").hidden = true;
      else if (!$("#lightbox").hidden) closeLightbox();
      else if (!$("#uploadPanel").hidden) closeUpload();
      else if (isAdminOpen()) closeAdmin();
      else if (isBatchOpen()) closeBatch();
      else if (!$("#gallery").hidden) closeGallery();
      else stopStory();
      return;
    }
    if (!$("#dialogBox").hidden || isAdminOpen() || isBatchOpen() || !entered) return;
    if (!$("#lightbox").hidden) {
      if (typing) return;
      if (e.key === "ArrowRight") stepLightbox(1);
      if (e.key === "ArrowLeft") stepLightbox(-1);
      return;
    }
    if (typing) return;
    if (story.on && e.key === "ArrowRight") { storyNext(); return; }
    if (e.key === "/") { e.preventDefault(); $("#searchInput").focus(); }
    if (e.key === " ") { e.preventDefault(); if (story.on) stopStory(); else startStory(); }
    const n = Number(e.key);
    if (n >= 1 && n <= LAYOUTS.length) setLayout(LAYOUTS[n - 1].id);
  });

  let sx = null;
  $("#lightbox").addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; }, { passive: true });
  $("#lightbox").addEventListener("touchend", (e) => {
    if (sx == null || e.target.closest(".lb-info")) { sx = null; return; }
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 60) stepLightbox(dx < 0 ? 1 : -1);
    sx = null;
  });

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("#installBtn").hidden = false;
  });
}

function onHoverCard(item, x, y) {
  const tip = $("#hoverTip");
  if (!item || !$("#lightbox").hidden || story.on || window.matchMedia("(hover: none)").matches) { tip.hidden = true; return; }
  tip.innerHTML = `<b>${esc(item.caption || "a memory")}</b><span>${esc(yearOf(item.year).label)}${item.album ? " · " + esc(item.album) : ""} · by ${esc(item.uploaderName)}${item.likedBy.length ? ` · ♥ ${item.likedBy.length}` : ""}</span>`;
  tip.style.left = Math.min(x, window.innerWidth - 260) + "px";
  tip.style.top = Math.min(y, window.innerHeight - 90) + "px";
  tip.hidden = false;
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || isDemo) return;
  if (!/^https:$/.test(location.protocol) && location.hostname !== "localhost") return;
  navigator.serviceWorker.register("sw.js").catch(() => { /* optional */ });
}

// ───────────────────────── boot ─────────────────────────
async function boot() {
  document.body.classList.add("locked");
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
  initBatch({ getItems: () => state.items, openMemory, toast, askDialog });
  registerServiceWorker();

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
  try { createMetalLogo($("#brandMark")); } catch (err) { console.warn("3D logo unavailable", err); }

  let firstItems = true;
  onItems((items) => {
    state.items = items;
    if (scene) scene.setItems(sortItems(items));
    renderChips();
    renderStats();
    applyFilter();
    if (state.currentId && !$("#lightbox").hidden) showLightbox();
    refreshAdminView();
    refreshBatchView();
    if (firstItems && items.length) { firstItems = false; openFromHash(); }
  });
  onProfiles(() => { refreshBatchView(); if (state.currentId && !$("#lightbox").hidden) showLightbox(); });
  onAuth((u) => {
    renderAuth(u);
    if (u) enter();
    else if (entered) leave();
    else showGate();
    if (state.currentId && !$("#lightbox").hidden) showLightbox();
  });
  onPending((p) => { if (p) showPending(p); else if (!getUser()) showGate(); });
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
