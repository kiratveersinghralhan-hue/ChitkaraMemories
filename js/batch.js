// Batch panel: Yearbook (profiles), Leaderboard, Time capsule.
import { YEARS, CAPSULE_UNLOCK } from "./config.js";
import { getUser, getProfiles, saveProfile, loadMyCapsule, saveCapsule, loadBatchCapsules } from "./store.js";

const bq = (s, r = document) => r.querySelector(s);
const besc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const bInitials = (n) => (n || "?").split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w)).slice(0, 2).map((s) => s[0].toUpperCase()).join("") || "?";
const bAvatar = (n, p, cls = "") => (p ? `<img class="avatar ${cls}" src="${besc(p)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar ${cls}">${besc(bInitials(n))}</span>`);

const B = { tab: "yearbook", uid: null, editing: false, query: "", capsule: null, capsuleLoaded: false, batchLetters: null, ctx: null };
const unlockAt = () => new Date(CAPSULE_UNLOCK + "T00:00:00").getTime();

export function initBatch(ctx) {
  B.ctx = ctx;
  bq("#batchTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-btab]");
    if (!b) return;
    B.tab = b.dataset.btab; B.uid = null; B.editing = false;
    render();
  });
  bq("#batchClose").addEventListener("click", closeBatch);
  bq("#batchBody").addEventListener("click", onClick);
  bq("#batchBody").addEventListener("input", (e) => {
    if (e.target.id === "ybSearch") {
      B.query = e.target.value;
      const pos = e.target.selectionStart;
      render();
      const el = bq("#ybSearch");
      if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) { /* ignore */ } }
    }
    if (e.target.id === "capText") bq("#capCount").textContent = `${e.target.value.length}/3000`;
  });
  bq("#batchBody").addEventListener("submit", onSubmit);
}
export function isBatchOpen() { return !bq("#batchPanel").hidden; }
export function openBatch(tab = "yearbook", uid = null) {
  B.tab = tab; B.uid = uid; B.editing = false;
  const me = getUser();
  if (B.capsuleFor !== (me && me.uid)) { B.capsuleFor = me && me.uid; B.capsuleLoaded = false; B.capsule = null; B.batchLetters = null; }
  bq("#batchPanel").hidden = false;
  render();
}
export function closeBatch() { bq("#batchPanel").hidden = true; }
export function refreshBatchView() { if (isBatchOpen() && !B.editing) render(); }

const bItems = () => B.ctx.getItems();
const bYearLabel = (id) => (YEARS.find((y) => y.id === id) || { label: id }).label;

function render() {
  bq("#batchTabs").innerHTML = [["yearbook", "Yearbook"], ["leaders", "Leaderboard"], ["capsule", "Time capsule"]]
    .map(([id, l]) => `<button class="a-tab ${B.tab === id ? "active" : ""}" data-btab="${id}">${l}</button>`).join("");
  const body = bq("#batchBody");
  if (B.tab === "leaders") body.innerHTML = renderLeaders();
  else if (B.tab === "capsule") { body.innerHTML = renderCapsule(); if (!B.capsuleLoaded) loadCapsuleData(); }
  else body.innerHTML = B.uid ? renderProfile(B.uid) : renderYearbook();
}

// ── yearbook ──
function taggedIn(uid, name) {
  const n = (name || "").toLowerCase();
  return bItems().filter((i) => i.peopleUids.includes(uid) || i.people.some((p) => p.toLowerCase() === n));
}
function renderYearbook() {
  const me = getUser();
  const q = B.query.trim().toLowerCase();
  const list = [...getProfiles()].filter((p) => !q || `${p.name} ${p.nickname || ""}`.toLowerCase().includes(q))
    .sort((a, b) => (b.uid === (me && me.uid)) - (a.uid === (me && me.uid)) || a.name.localeCompare(b.name));
  return `
    <div class="a-toolbar">
      <input class="a-input" id="ybSearch" type="search" placeholder="Find a classmate" value="${besc(B.query)}">
      <span class="muted">${getProfiles().length} classmates</span>
      ${me ? `<button class="btn btn-sm btn-primary" data-ybme>Edit my page</button>` : ""}
    </div>
    <div class="yb-grid">${list.map((p) => {
      const n = taggedIn(p.uid, p.name).length;
      return `<button class="yb-card" data-ybuid="${besc(p.uid)}">
        ${bAvatar(p.name, p.photo, "yb-avatar")}
        <b>${besc(p.name)}</b>
        ${p.nickname ? `<em>“${besc(p.nickname)}”</em>` : ""}
        <p>${p.quote ? besc(p.quote) : `<span class="muted">No quote yet</span>`}</p>
        <small>${n} memor${n === 1 ? "y" : "ies"}</small>
      </button>`;
    }).join("") || `<div class="a-empty">No classmates yet.</div>`}</div>`;
}
function renderProfile(uid) {
  const p = getProfiles().find((x) => x.uid === uid);
  if (!p) return `<button class="a-back" data-ybback>← Yearbook</button><div class="a-empty">This person hasn't joined yet.</div>`;
  const me = getUser();
  const isMe = me && me.uid === uid;
  if (isMe && B.editing) return renderEdit(p);
  const tagged = taggedIn(uid, p.name);
  const uploads = bItems().filter((i) => i.uploaderUid === uid);
  const hearts = uploads.reduce((s, i) => s + i.likedBy.length, 0);
  const grid = (list) => list.length
    ? `<div class="a-mini-grid">${list.map((i) => `<button class="a-photo-img" data-ybmem="${besc(i.id)}" title="${besc(i.caption)}"><img src="${besc(i.thumb)}" alt="" draggable="false"></button>`).join("")}</div>`
    : `<p class="muted">Nothing yet.</p>`;
  return `
    <button class="a-back" data-ybback>← Yearbook</button>
    <section class="yb-hero">
      ${bAvatar(p.name, p.photo, "yb-big")}
      <div>
        <h2>${besc(p.name)}</h2>
        ${p.nickname ? `<p class="yb-nick">aka “${besc(p.nickname)}”</p>` : ""}
        ${p.quote ? `<blockquote>${besc(p.quote)}</blockquote>` : ""}
        ${p.mostLikely ? `<p class="yb-likely"><span>Most likely to</span> ${besc(p.mostLikely.replace(/^most likely to\s*/i, ""))}</p>` : ""}
        <div class="yb-stats"><span><b>${tagged.length}</b> tagged in</span><span><b>${uploads.length}</b> added</span><span><b>${hearts}</b> hearts</span></div>
        ${p.insta ? `<a class="a-link" href="https://instagram.com/${encodeURIComponent(p.insta)}" target="_blank" rel="noopener">@${besc(p.insta)}</a>` : ""}
      </div>
      ${isMe ? `<button class="btn btn-sm" data-ybedit>Edit my page</button>` : ""}
    </section>
    <section class="a-card"><h3>Memories with ${besc(p.name.split(" ")[0])}</h3>${grid(tagged)}</section>
    <section class="a-card"><h3>Added by ${besc(p.name.split(" ")[0])}</h3>${grid(uploads)}</section>`;
}
function renderEdit(p) {
  return `
    <button class="a-back" data-ybcancel>← Back</button>
    <form class="a-card yb-form" id="ybForm">
      <h3>Your yearbook page</h3>
      <div class="field"><label for="ybNick">Nickname</label><input id="ybNick" maxlength="40" value="${besc(p.nickname)}" placeholder="What the class calls you"></div>
      <div class="field"><label for="ybQuote">Your quote</label><input id="ybQuote" maxlength="200" value="${besc(p.quote)}" placeholder="One line the batch will remember you by"></div>
      <div class="field"><label for="ybLikely">Most likely to…</label><input id="ybLikely" maxlength="100" value="${besc(p.mostLikely)}" placeholder="…start a business from the canteen"></div>
      <div class="field"><label for="ybInsta">Instagram (optional)</label><input id="ybInsta" maxlength="40" value="${besc(p.insta)}" placeholder="username"></div>
      <div class="confirm-actions"><button type="button" class="btn" data-ybcancel>Cancel</button><button class="btn btn-primary" type="submit">Save</button></div>
    </form>`;
}

// ── leaderboard ──
function renderLeaders() {
  const its = bItems();
  const profiles = getProfiles();
  const nameOf = (uid, fallback) => (profiles.find((p) => p.uid === uid) || {}).name || fallback;
  const tally = (fn) => { const m = new Map(); its.forEach((i) => fn(i, (k, n, label) => { const cur = m.get(k) || { n: 0, label }; cur.n += n; m.set(k, cur); })); return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.n - a.n).slice(0, 5); };
  const uploaders = tally((i, add) => add(i.uploaderUid, 1, nameOf(i.uploaderUid, i.uploaderName)));
  const hearts = tally((i, add) => add(i.uploaderUid, i.likedBy.length, nameOf(i.uploaderUid, i.uploaderName)));
  const tagged = tally((i, add) => i.people.forEach((p, k) => add(i.peopleUids[k] || p.toLowerCase(), 1, i.peopleUids[k] ? nameOf(i.peopleUids[k], p) : p)));
  const reacts = tally((i, add) => add(i.uploaderUid, Object.keys(i.reactions).length, nameOf(i.uploaderUid, i.uploaderName)));
  const topPhotos = [...its].sort((a, b) => (b.likedBy.length + Object.keys(b.reactions).length) - (a.likedBy.length + Object.keys(a.reactions).length)).slice(0, 6);
  const board = (title, sub, rows, unit) => `
    <section class="a-card lb-board"><h3>${title}</h3><p class="muted">${sub}</p>
      ${rows.filter((r) => r.n > 0).map((r, i) => `<div class="lb-row"><span class="lb-rank r${i + 1}">${i + 1}</span><span class="lb-name">${besc(r.label)}</span><b>${r.n}</b><small>${unit}</small></div>`).join("") || `<p class="muted">No one yet.</p>`}
    </section>`;
  return `
    <div class="lb-grid">
      ${board("Memory makers", "Most photos added", uploaders, "photos")}
      ${board("Crowd favourites", "Most hearts on their photos", hearts, "hearts")}
      ${board("Always in the frame", "Tagged in the most photos", tagged, "tags")}
      ${board("Reaction magnets", "Most emoji reactions", reacts, "reacts")}
    </div>
    <section class="a-card"><h3>Most loved photos</h3>
      ${topPhotos.length ? `<div class="a-mini-grid big">${topPhotos.map((i) => `<button class="a-photo-img" data-ybmem="${besc(i.id)}" title="${besc(i.caption)}"><img src="${besc(i.thumb)}" alt="" draggable="false"><span class="lb-badge">♥ ${i.likedBy.length}</span></button>`).join("")}</div>` : `<p class="muted">Nothing yet.</p>`}
    </section>`;
}

// ── time capsule ──
async function loadCapsuleData() {
  B.capsuleLoaded = true;
  B.capsule = await loadMyCapsule();
  if (Date.now() >= unlockAt()) {
    try { B.batchLetters = await loadBatchCapsules(); } catch (_) { B.batchLetters = []; }
  }
  if (isBatchOpen() && B.tab === "capsule") render();
}
function countdown() {
  const ms = unlockAt() - Date.now();
  if (ms <= 0) return null;
  const d = Math.floor(ms / 86400000);
  return { days: d, date: new Date(unlockAt()).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) };
}
function renderCapsule() {
  const cd = countdown();
  const c = B.capsule;
  if (!cd) {
    const letters = B.batchLetters;
    return `
      <section class="cap-hero"><h2>The capsule is open 💌</h2><p class="muted">Letters the batch wrote to each other.</p></section>
      ${c ? `<section class="a-card cap-letter mine"><h3>Your letter (${c.visibility === "batch" ? "to the batch" : "to yourself"})</h3><p>${besc(c.text).replace(/\n/g, "<br>")}</p></section>` : ""}
      ${letters === null ? `<div class="a-empty">Opening letters…</div>` : letters.length
        ? letters.map((l) => `<section class="a-card cap-letter"><div class="cap-from">${bAvatar(l.name, l.photo)}<b>${besc(l.name)}</b></div><p>${besc(l.text).replace(/\n/g, "<br>")}</p></section>`).join("")
        : `<div class="a-empty">No batch letters were written.</div>`}`;
  }
  return `
    <section class="cap-hero">
      <div class="cap-count"><b>${cd.days}</b><span>days to go</span></div>
      <div>
        <h2>Time capsule</h2>
        <p class="muted">Write a letter now. It stays sealed until <b>${cd.date}</b>. Nobody can read it before then.</p>
      </div>
    </section>
    <form class="a-card cap-form" id="capForm">
      <div class="field">
        <label for="capText">${c ? "Your sealed letter (you can still edit it)" : "Your letter"}</label>
        <textarea id="capText" maxlength="3000" rows="9" placeholder="Dear future me… / Dear batch…">${c ? besc(c.text) : ""}</textarea>
        <small class="muted" id="capCount">${c ? c.text.length : 0}/3000</small>
      </div>
      <div class="cap-vis">
        <label class="choice"><input type="radio" name="capVis" value="private" ${!c || c.visibility !== "batch" ? "checked" : ""}><span><b>To future me</b> · only you will ever read it</span></label>
        <label class="choice"><input type="radio" name="capVis" value="batch" ${c && c.visibility === "batch" ? "checked" : ""}><span><b>To the batch</b> · everyone reads it on unlock day (admins can see it earlier to keep it safe)</span></label>
      </div>
      <div class="confirm-actions"><button class="btn btn-primary" type="submit">${c ? "Update letter" : "Seal my letter"}</button></div>
    </form>`;
}

// ── events ──
function onClick(e) {
  const t = e.target.closest("button, [data-ybuid]");
  if (!t) return;
  const d = t.dataset;
  if (d.ybuid) { B.uid = d.ybuid; render(); bq("#batchBody").scrollTop = 0; }
  else if (d.ybback !== undefined) { B.uid = null; render(); }
  else if (d.ybme !== undefined) { const me = getUser(); B.uid = me.uid; B.editing = true; render(); }
  else if (d.ybedit !== undefined) { B.editing = true; render(); }
  else if (d.ybcancel !== undefined) { B.editing = false; render(); }
  else if (d.ybmem) { B.ctx.openMemory(d.ybmem, { fly: false }); }
}
async function onSubmit(e) {
  e.preventDefault();
  if (e.target.id === "ybForm") {
    try {
      await saveProfile({ nickname: bq("#ybNick").value, quote: bq("#ybQuote").value, mostLikely: bq("#ybLikely").value, insta: bq("#ybInsta").value });
      B.editing = false;
      B.ctx.toast("Yearbook page saved");
      render();
    } catch (err) { B.ctx.toast(err.message); }
  }
  if (e.target.id === "capForm") {
    const text = bq("#capText").value;
    if (!text.trim()) { B.ctx.toast("Write something first"); return; }
    const visibility = (bq("input[name=capVis]:checked") || {}).value || "private";
    try {
      await saveCapsule({ text, visibility });
      B.capsule = { text, visibility };
      B.ctx.toast("Letter sealed 💌");
      render();
    } catch (err) { B.ctx.toast(err.message); }
  }
}
