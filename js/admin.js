// Admin panel: overview, users, activity log, photos, reports. Only admins can load this data
// (Firestore rules block everyone else even if they open the panel some other way).
import { YEARS, SITE, EMAILJS, AUTO_APPROVE_SUFFIX } from "./config.js";
import {
  adminLoad, adminBan, adminUnban, adminDismissReport, removeMemory, getUser,
  adminSetMember, adminAllowEmails, adminUnallow, isDemo,
} from "./store.js";
import { renderShareTab, drawPoster, downloadPoster, siteUrl } from "./share.js";

const aq = (s, r = document) => r.querySelector(s);
const aesc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ACTION_META = {
  login: { label: "Signed in", cls: "a-login" },
  upload: { label: "Uploaded", cls: "a-upload" },
  download: { label: "Downloaded", cls: "a-download" },
  like: { label: "Liked", cls: "a-like" },
  unlike: { label: "Unliked", cls: "a-like" },
  delete: { label: "Deleted", cls: "a-delete" },
  report: { label: "Reported", cls: "a-report" },
  ban: { label: "Banned", cls: "a-delete" },
  unban: { label: "Unbanned", cls: "a-login" },
  comment: { label: "Commented", cls: "a-like" },
  profile: { label: "Edited yearbook", cls: "a-login" },
  capsule: { label: "Wrote capsule letter", cls: "a-login" },
  approve: { label: "Approved access", cls: "a-upload" },
  deny: { label: "Denied access", cls: "a-delete" },
  allow: { label: "Pre-approved emails", cls: "a-upload" },
};

const A = {
  tab: "overview",
  data: { users: [], activity: [], reports: [], bans: [], members: [], allowlist: [] },
  loaded: false,
  loading: false,
  userQuery: "",
  actType: "all",
  actQuery: "",
  focusUid: null,
  ctx: null,
};

export function initAdmin(ctx) {
  A.ctx = ctx;
  aq("#adminTabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    A.tab = b.dataset.tab;
    A.focusUid = null;
    renderAdmin();
  });
  aq("#adminRefresh").addEventListener("click", () => loadAdmin());
  aq("#adminClose").addEventListener("click", closeAdmin);
  aq("#adminBody").addEventListener("click", onBodyClick);
  aq("#adminBody").addEventListener("input", onBodyInput);
  aq("#adminBody").addEventListener("change", onBodyInput);
}

export function isAdminOpen() { return !aq("#adminPanel").hidden; }

export async function openAdmin() {
  const u = getUser();
  if (!u || !u.admin) { A.ctx.toast("Admins only"); return; }
  aq("#adminPanel").hidden = false;
  aq("#adminWho").textContent = u.email;
  renderAdmin();
  await loadAdmin();
}

export function closeAdmin() { aq("#adminPanel").hidden = true; }

export function refreshAdminView() { if (isAdminOpen()) renderAdmin(); }

async function loadAdmin() {
  A.loading = true;
  renderAdmin();
  try {
    A.data = await adminLoad();
    A.loaded = true;
  } catch (e) {
    console.error(e);
    A.ctx.toast("Couldn't load admin data: " + (e.message || e), 6000);
  }
  A.loading = false;
  renderAdmin();
}

// ───────────────────────── derived data ─────────────────────────
function items() { return A.ctx.getItems(); }
function bannedSet() { return new Set(A.data.bans.map((b) => b.uid)); }

function userRows() {
  const map = new Map();
  A.data.users.forEach((u) => map.set(u.uid, { ...u, uploads: 0, downloads: 0, downloadsOfTheirs: 0, likesGiven: 0, reports: 0 }));
  const ensure = (uid, name, email) => {
    if (!map.has(uid)) map.set(uid, { uid, name: name || "Unknown", email: email || "", photo: "", firstSeen: 0, lastSeen: 0, logins: 0, device: "", uploads: 0, downloads: 0, downloadsOfTheirs: 0, likesGiven: 0, reports: 0 });
    return map.get(uid);
  };
  items().forEach((it) => {
    ensure(it.uploaderUid, it.uploaderName, it.uploaderEmail).uploads++;
    it.likedBy.forEach((uid) => { if (map.has(uid)) map.get(uid).likesGiven++; });
  });
  A.data.activity.forEach((a) => {
    const u = ensure(a.uid, a.name, a.email);
    if (a.type === "download") {
      u.downloads++;
      if (a.ownerUid && map.has(a.ownerUid)) map.get(a.ownerUid).downloadsOfTheirs++;
    }
    if (a.type === "report") u.reports++;
    if (!u.lastSeen || a.at > u.lastSeen) u.lastSeen = a.at;
  });
  const banned = bannedSet();
  return [...map.values()].map((u) => ({ ...u, banned: banned.has(u.uid) })).sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
}

function downloadsByMemory() {
  const m = {};
  A.data.activity.forEach((a) => { if (a.type === "download" && a.memoryId) (m[a.memoryId] = m[a.memoryId] || []).push(a); });
  return m;
}

// ───────────────────────── formatting ─────────────────────────
function fmtTime(ms) {
  if (!ms) return "—";
  const d = new Date(ms);
  return d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
function ago(ms) {
  if (!ms) return "never";
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
function initialsOf(name) {
  return (name || "?").split(/\s+/).filter((w) => /^[\p{L}\d]/u.test(w)).slice(0, 2).map((s) => s[0].toUpperCase()).join("");
}
function avatar(name, photo) {
  return photo ? `<img class="avatar" src="${aesc(photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="avatar">${aesc(initialsOf(name))}</span>`;
}
function who(name, email, uid) {
  return `<button class="a-who" data-user="${aesc(uid)}">${avatar(name, "")}<span><b>${aesc(name)}</b><small>${aesc(email)}</small></span></button>`;
}
function actionPill(type) {
  const m = ACTION_META[type] || { label: type, cls: "" };
  return `<span class="a-pill ${m.cls}">${aesc(m.label)}</span>`;
}
function memoryCell(a) {
  if (!a.memoryId && a.type !== "ban" && a.type !== "unban") return "<span class='muted'>—</span>";
  if (a.type === "ban" || a.type === "unban") return `<span>${aesc(a.ownerName)}</span>${a.detail ? `<small class="muted"> · ${aesc(a.detail)}</small>` : ""}`;
  const it = items().find((i) => i.id === a.memoryId);
  const thumb = it ? `<img class="a-thumb" src="${aesc(it.thumb)}" alt="">` : `<span class="a-thumb a-gone" title="Deleted">×</span>`;
  return `<button class="a-mem" data-memory="${aesc(a.memoryId)}" ${it ? "" : "disabled"}>${thumb}<span><b>${aesc(a.memoryCaption || "Untitled")}</b><small>by ${aesc(a.ownerName || "?")}${a.detail ? " · " + aesc(a.detail) : ""}</small></span></button>`;
}
const yearLabel = (id) => (YEARS.find((y) => y.id === id) || { label: id }).label;

// ───────────────────────── render ─────────────────────────
function renderAdmin() {
  const reportsN = A.data.reports.length;
  const pendingN = A.data.members.filter((m) => m.status === "pending").length;
  const badge = (id) => (id === "reports" && reportsN ? reportsN : id === "access" && pendingN ? pendingN : 0);
  aq("#adminTabs").innerHTML = [
    ["overview", "Overview"], ["access", "Access"], ["users", "Users"], ["activity", "Activity"], ["photos", "Photos"], ["reports", "Reports"], ["share", "Share"],
  ].map(([id, label]) => `<button class="a-tab ${A.tab === id ? "active" : ""}" data-tab="${id}">${label}${badge(id) ? `<span class="a-badge">${badge(id)}</span>` : ""}</button>`).join("");

  const body = aq("#adminBody");
  if (!A.loaded && A.loading) { body.innerHTML = `<div class="a-empty">Loading everything…</div>`; return; }
  if (A.focusUid) { body.innerHTML = renderUserDetail(A.focusUid); return; }
  const map = { overview: renderOverview, access: renderAccess, users: renderUsers, activity: renderActivity, photos: renderPhotos, reports: renderReports, share: renderShareTab };
  body.innerHTML = (map[A.tab] || renderOverview)();
  if (A.tab === "share") drawPoster();
}

function renderOverview() {
  const its = items();
  const users = userRows();
  const dayAgo = Date.now() - 86400000;
  const act = A.data.activity;
  const activeToday = new Set(act.filter((a) => a.at > dayAgo).map((a) => a.uid)).size;
  const dlTotal = act.filter((a) => a.type === "download").length;
  const dlToday = act.filter((a) => a.type === "download" && a.at > dayAgo).length;
  const upToday = act.filter((a) => a.type === "upload" && a.at > dayAgo).length;
  const tiles = [
    ["Students", users.length, `${activeToday} active today`],
    ["Memories", its.length, `${upToday} added today`],
    ["Downloads", dlTotal, `${dlToday} today`],
    ["Access requests", A.data.members.filter((m) => m.status === "pending").length, "waiting for you"],
    ["Open reports", A.data.reports.length, A.data.reports.length ? "needs review" : "all clear"],
    ["Banned", A.data.bans.length, "accounts"],
  ];
  const topDl = Object.entries(downloadsByMemory()).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  return `
    <div class="a-tiles">${tiles.map(([l, n, s]) => `<div class="a-tile ${(l === "Open reports" || l === "Access requests") && n ? "warn" : ""}"><span>${l}</span><b>${n}</b><small>${s}</small></div>`).join("")}</div>
    <div class="a-cols">
      <section class="a-card"><h3>Latest activity</h3>${activityTable(act.slice(0, 12), true)}</section>
      <section class="a-card"><h3>Most downloaded</h3>${topDl.length ? topDl.map(([id, list]) => {
        const it = its.find((i) => i.id === id);
        return `<button class="a-mem a-row" data-memory="${aesc(id)}" ${it ? "" : "disabled"}>${it ? `<img class="a-thumb" src="${aesc(it.thumb)}" alt="">` : `<span class="a-thumb a-gone">×</span>`}<span><b>${aesc(list[0].memoryCaption || "Untitled")}</b><small>by ${aesc(list[0].ownerName)}</small></span><em>${list.length}×</em></button>`;
      }).join("") : `<p class="muted">No downloads yet.</p>`}</section>
    </div>`;
}

function renderAccess() {
  const pend = A.data.members.filter((m) => m.status === "pending").sort((a, b) => b.requestedAt - a.requestedAt);
  const decided = A.data.members.filter((m) => m.status !== "pending").sort((a, b) => (b.decidedAt || 0) - (a.decidedAt || 0));
  const rule = AUTO_APPROVE_SUFFIX
    ? `Emails ending in <b>${aesc(AUTO_APPROVE_SUFFIX)}</b> get in automatically. Everyone else must request access.`
    : `<b>Everyone</b> must request access, unless their email is pre-approved below.`;
  return `
    <section class="a-card access-rule">${rule} <span class="muted">Change this with AUTO_APPROVE_SUFFIX in config.js and firestore.rules.</span></section>
    <section class="a-card">
      <h3>Waiting for approval (${pend.length})</h3>
      ${pend.length ? `<div class="req-list">${pend.map((m) => `
        <div class="req">
          ${who(m.name || m.email, m.email, m.uid)}
          <div class="req-note">${m.note ? `“${aesc(m.note)}”` : `<span class="muted">No note</span>`}<small class="muted"> · asked ${ago(m.requestedAt)}</small></div>
          <div class="a-actions">
            <button class="btn btn-sm btn-primary" data-approve="${aesc(m.uid)}">Approve</button>
            <button class="btn btn-sm btn-danger" data-deny="${aesc(m.uid)}">Deny</button>
          </div>
        </div>`).join("")}</div>` : `<p class="muted">No one is waiting. New requests appear here with a badge.</p>`}
    </section>
    <section class="a-card">
      <h3>Pre-approve classmates by email</h3>
      <p class="muted">Paste emails (one per line, or separated by commas). They'll get in straight away when they sign in.</p>
      <textarea class="a-input share-msg" id="allowInput" rows="4" placeholder="name1234.bbadsbm26@chitkara.edu.in"></textarea>
      <div class="a-actions"><button class="btn btn-sm btn-primary" data-allow>Pre-approve</button></div>
      ${A.data.allowlist.length ? `<div class="allow-list">${A.data.allowlist.map((a) => `<span class="tchip">${aesc(a.email)}<button data-unallow="${aesc(a.email)}" aria-label="Remove">×</button></span>`).join("")}</div>` : ""}
    </section>
    <section class="a-card">
      <h3>Decided (${decided.length})</h3>
      ${decided.length ? `<div class="a-table-wrap"><table class="a-table"><thead><tr><th>Person</th><th>Status</th><th>Note</th><th>Decided</th><th></th></tr></thead><tbody>
        ${decided.map((m) => `<tr><td>${who(m.name || m.email, m.email, m.uid)}</td>
          <td><span class="a-pill ${m.status === "approved" ? "a-upload" : "a-delete"}">${m.status === "approved" ? "Approved" : "Denied"}</span></td>
          <td><small>${aesc(m.note || "—")}</small></td><td>${ago(m.decidedAt)}</td>
          <td>${m.status === "approved" ? `<button class="btn btn-sm btn-danger" data-deny="${aesc(m.uid)}">Remove access</button>` : `<button class="btn btn-sm" data-approve="${aesc(m.uid)}">Approve</button>`}</td></tr>`).join("")}
      </tbody></table></div>` : `<p class="muted">Nothing yet.</p>`}
    </section>`;
}

// Approval email: EmailJS when configured, otherwise the admin's own email app with the message written.
let emailjsLoading = null;
function loadEmailJs() {
  if (window.emailjs) return Promise.resolve(window.emailjs);
  if (!emailjsLoading) {
    emailjsLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@emailjs/browser@4.4.1/dist/email.min.js";
      s.onload = () => (window.emailjs ? resolve(window.emailjs) : reject(new Error("EmailJS missing")));
      s.onerror = () => reject(new Error("Couldn't load EmailJS"));
      document.head.appendChild(s);
    });
  }
  return emailjsLoading;
}
async function sendApprovalEmail(m) {
  const name = (m.name || "there").split(" ")[0];
  if (EMAILJS.publicKey && EMAILJS.serviceId && EMAILJS.templateId && !isDemo) {
    try {
      const ej = await loadEmailJs();
      ej.init({ publicKey: EMAILJS.publicKey });
      await ej.send(EMAILJS.serviceId, EMAILJS.templateId, { to_name: name, to_email: m.email, site_url: siteUrl(), site_name: SITE.title });
      return "sent";
    } catch (e) { console.warn("EmailJS", e); }
  }
  const subject = `You're in! ${SITE.title} access approved`;
  const body = `Hi ${name},\n\nYour request to join ${SITE.title} was approved 🎉\n\nOpen ${siteUrl()} and sign in with your Chitkara email (${m.email}).\n\nSee you in the galaxy ✨`;
  const href = `mailto:${encodeURIComponent(m.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  const a = document.createElement("a");
  a.href = href; a.target = "_blank"; a.rel = "noopener";
  document.body.appendChild(a); a.click(); a.remove();
  return "mailto";
}

function renderUsers() {
  const q = A.userQuery.trim().toLowerCase();
  const rows = userRows().filter((u) => !q || `${u.name} ${u.email}`.toLowerCase().includes(q));
  return `
    <div class="a-toolbar">
      <input class="a-input" id="aUserSearch" type="search" placeholder="Search name or email" value="${aesc(A.userQuery)}">
      <span class="muted">${rows.length} users</span>
    </div>
    <div class="a-table-wrap"><table class="a-table">
      <thead><tr><th>Student</th><th>Joined</th><th>Last active</th><th>Logins</th><th>Uploads</th><th>Downloads</th><th>Their photos downloaded</th><th>Likes</th><th>Device</th><th></th></tr></thead>
      <tbody>${rows.map((u) => `
        <tr class="${u.banned ? "is-banned" : ""}">
          <td>${who(u.name, u.email, u.uid)}${u.banned ? ` <span class="a-pill a-delete">Banned</span>` : ""}</td>
          <td>${fmtTime(u.firstSeen)}</td>
          <td>${ago(u.lastSeen)}</td>
          <td class="num">${u.logins || 0}</td>
          <td class="num">${u.uploads}</td>
          <td class="num">${u.downloads}</td>
          <td class="num">${u.downloadsOfTheirs}</td>
          <td class="num">${u.likesGiven}</td>
          <td><small>${aesc(u.device || "—")}</small></td>
          <td><button class="btn btn-sm" data-user="${aesc(u.uid)}">Details</button></td>
        </tr>`).join("") || `<tr><td colspan="10" class="a-empty">No users yet.</td></tr>`}
      </tbody></table></div>`;
}

function filteredActivity() {
  const q = A.actQuery.trim().toLowerCase();
  return A.data.activity.filter((a) => (A.actType === "all" || a.type === A.actType)
    && (!q || `${a.name} ${a.email} ${a.memoryCaption} ${a.ownerName} ${a.detail} ${a.device}`.toLowerCase().includes(q)));
}

function activityTable(list, compact = false) {
  if (!list.length) return `<div class="a-empty">Nothing here yet.</div>`;
  return `<div class="a-table-wrap"><table class="a-table">
    <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Photo</th>${compact ? "" : "<th>Device</th>"}</tr></thead>
    <tbody>${list.map((a) => `<tr>
      <td><span title="${aesc(new Date(a.at).toString())}">${fmtTime(a.at)}</span></td>
      <td>${who(a.name, a.email, a.uid)}</td>
      <td>${actionPill(a.type)}</td>
      <td>${memoryCell(a)}</td>
      ${compact ? "" : `<td><small>${aesc(a.device || "—")}</small></td>`}
    </tr>`).join("")}</tbody></table></div>`;
}

function renderActivity() {
  const list = filteredActivity();
  return `
    <div class="a-toolbar">
      <select class="a-input" id="aActType">
        <option value="all">All actions</option>
        ${Object.entries(ACTION_META).map(([k, v]) => `<option value="${k}" ${A.actType === k ? "selected" : ""}>${v.label}</option>`).join("")}
      </select>
      <input class="a-input" id="aActSearch" type="search" placeholder="Search person, photo, device" value="${aesc(A.actQuery)}">
      <span class="muted">${list.length} events</span>
      <button class="btn btn-sm" data-export>Export CSV</button>
    </div>
    ${activityTable(list.slice(0, 400))}
    <p class="muted a-foot">Shows the latest ${A.data.activity.length} events. Times are in your local time.</p>`;
}

function renderPhotos() {
  const dl = downloadsByMemory();
  const its = [...items()].sort((a, b) => b.createdAt - a.createdAt);
  if (!its.length) return `<div class="a-empty">No photos yet.</div>`;
  return `<div class="a-photos">${its.map((it) => {
    const d = dl[it.id] || [];
    return `<article class="a-photo">
      <button class="a-photo-img" data-memory="${aesc(it.id)}"><img src="${aesc(it.thumb)}" alt="${aesc(it.caption)}" loading="lazy"></button>
      <div class="a-photo-meta">
        <b>${aesc(it.caption || "Untitled")}</b>
        <small>${aesc(yearLabel(it.year))} · ${fmtTime(it.createdAt)}</small>
        <button class="a-link" data-user="${aesc(it.uploaderUid)}">by ${aesc(it.uploaderName)}</button>
        <small>♥ ${it.likedBy.length} · ↓ ${d.length}${d.length ? ` (${aesc([...new Set(d.map((x) => x.name.split(" ")[0]))].slice(0, 3).join(", "))}${d.length > 3 ? "…" : ""})` : ""}</small>
      </div>
      <button class="btn btn-sm btn-danger" data-delete="${aesc(it.id)}">Delete</button>
    </article>`;
  }).join("")}</div>`;
}

function renderReports() {
  if (!A.data.reports.length) return `<div class="a-empty">No reports. All clear.</div>`;
  return `<div class="a-reports">${A.data.reports.map((r) => {
    const it = items().find((i) => i.id === r.memoryId);
    return `<article class="a-card a-report">
      ${it ? `<button class="a-photo-img" data-memory="${aesc(it.id)}"><img src="${aesc(it.thumb)}" alt=""></button>` : `<div class="a-photo-img a-gone">Photo already deleted</div>`}
      <div class="a-report-body">
        <span class="a-pill a-report">${aesc(r.reason)}</span>
        <h4>${aesc(r.memoryCaption || "Untitled")} <small class="muted">by ${aesc(r.ownerName)}</small></h4>
        ${r.note ? `<p class="a-note">“${aesc(r.note)}”</p>` : ""}
        <p class="muted">Reported by ${who(r.reporterName, r.reporterEmail, r.reporterUid)} · ${ago(r.at)}</p>
        <div class="a-actions">
          ${it ? `<button class="btn btn-sm btn-danger" data-delete="${aesc(it.id)}" data-report="${aesc(r.id)}">Delete photo</button>` : ""}
          ${it ? `<button class="btn btn-sm" data-user="${aesc(it.uploaderUid)}">View uploader</button>` : ""}
          <button class="btn btn-sm" data-dismiss="${aesc(r.id)}">Dismiss</button>
        </div>
      </div>
    </article>`;
  }).join("")}</div>`;
}

function renderUserDetail(uid) {
  const u = userRows().find((x) => x.uid === uid);
  if (!u) return `<div class="a-empty">User not found.</div>`;
  const theirs = items().filter((i) => i.uploaderUid === uid);
  const acts = A.data.activity.filter((a) => a.uid === uid);
  const downloads = acts.filter((a) => a.type === "download");
  const ban = A.data.bans.find((b) => b.uid === uid);
  const isSelf = getUser() && getUser().uid === uid;
  return `
    <button class="a-back" data-back>← Back</button>
    <section class="a-card a-profile">
      ${avatar(u.name, u.photo)}
      <div class="a-profile-main">
        <h3>${aesc(u.name)} ${u.banned ? `<span class="a-pill a-delete">Banned</span>` : ""}</h3>
        <p>${aesc(u.email)}</p>
        <dl class="a-dl">
          <div><dt>Joined</dt><dd>${fmtTime(u.firstSeen)}</dd></div>
          <div><dt>Last active</dt><dd>${ago(u.lastSeen)}</dd></div>
          <div><dt>Logins</dt><dd>${u.logins || 0}</dd></div>
          <div><dt>Uploads</dt><dd>${u.uploads}</dd></div>
          <div><dt>Downloads</dt><dd>${u.downloads}</dd></div>
          <div><dt>Likes given</dt><dd>${u.likesGiven}</dd></div>
          <div><dt>Reports filed</dt><dd>${u.reports}</dd></div>
          <div><dt>Last device</dt><dd>${aesc(u.device || "—")}</dd></div>
        </dl>
        ${ban ? `<p class="a-note">Banned ${ago(ban.at)}${ban.reason ? `: “${aesc(ban.reason)}”` : ""}</p>` : ""}
      </div>
      <div class="a-actions">
        ${isSelf ? "" : u.banned
          ? `<button class="btn btn-sm" data-unban="${aesc(uid)}">Unban</button>`
          : `<button class="btn btn-sm btn-danger" data-ban="${aesc(uid)}">Ban user</button>`}
        ${theirs.length ? `<button class="btn btn-sm btn-danger" data-delete-all="${aesc(uid)}">Delete all ${theirs.length} photos</button>` : ""}
      </div>
    </section>
    <section class="a-card"><h3>Uploaded (${theirs.length})</h3>
      ${theirs.length ? `<div class="a-mini-grid">${theirs.map((it) => `<button class="a-photo-img" data-memory="${aesc(it.id)}" title="${aesc(it.caption)}"><img src="${aesc(it.thumb)}" alt=""></button>`).join("")}</div>` : `<p class="muted">No uploads.</p>`}
    </section>
    <section class="a-card"><h3>Downloaded (${downloads.length})</h3>${activityTable(downloads, true)}</section>
    <section class="a-card"><h3>Full activity (${acts.length})</h3>${activityTable(acts)}</section>`;
}

// ───────────────────────── events ─────────────────────────
function onBodyInput(e) {
  const t = e.target;
  if (t.id === "aUserSearch") { A.userQuery = t.value; rerenderKeepingFocus(t.id); }
  if (t.id === "aActSearch") { A.actQuery = t.value; rerenderKeepingFocus(t.id); }
  if (t.id === "aActType" && e.type === "change") { A.actType = t.value; renderAdmin(); }
}
function rerenderKeepingFocus(id) {
  const pos = aq("#" + id).selectionStart;
  renderAdmin();
  const el = aq("#" + id);
  if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch (_) { /* ignore */ } }
}

async function onBodyClick(e) {
  const t = e.target.closest("button");
  if (!t) return;
  const ds = t.dataset;
  if (ds.back !== undefined) { A.focusUid = null; renderAdmin(); return; }
  if (ds.user) { A.focusUid = ds.user; renderAdmin(); aq("#adminBody").scrollTop = 0; return; }
  if (ds.memory) { A.ctx.openMemory(ds.memory, { fly: false }); return; }
  if (ds.export !== undefined) { exportCsv(); return; }
  if (ds.copy) {
    const el = aq(ds.copy);
    try { await navigator.clipboard.writeText(el.value); A.ctx.toast("Copied"); } catch (_) { el.select(); A.ctx.toast("Press Ctrl+C to copy"); }
    return;
  }
  if (ds.poster !== undefined) { downloadPoster(); return; }
  if (ds.approve) {
    const m = A.data.members.find((x) => x.uid === ds.approve);
    if (!m) return;
    try {
      await adminSetMember(m, "approved");
      const how = await sendApprovalEmail(m);
      A.ctx.toast(how === "sent" ? `Approved. ${m.email} has been emailed.` : `Approved. Send the email that just opened to let them know.`, 5000);
      await loadAdmin();
    } catch (err) { A.ctx.toast(err.message); }
    return;
  }
  if (ds.deny) {
    const m = A.data.members.find((x) => x.uid === ds.deny);
    if (!m) return;
    const res = await A.ctx.askDialog({ title: m.status === "approved" ? "Remove access?" : "Deny this request?", message: `${m.email} won't be able to see or post anything.`, ok: m.status === "approved" ? "Remove access" : "Deny", danger: true });
    if (!res) return;
    try { await adminSetMember(m, "denied"); A.ctx.toast("Done"); await loadAdmin(); } catch (err) { A.ctx.toast(err.message); }
    return;
  }
  if (ds.allow !== undefined) {
    const emails = aq("#allowInput").value.split(/[\s,;]+/);
    try { const n = await adminAllowEmails(emails); A.ctx.toast(n ? `${n} email(s) pre-approved` : "No valid emails found"); if (n) await loadAdmin(); } catch (err) { A.ctx.toast(err.message); }
    return;
  }
  if (ds.unallow) {
    try { await adminUnallow(ds.unallow); await loadAdmin(); } catch (err) { A.ctx.toast(err.message); }
    return;
  }

  if (ds.delete) {
    const it = items().find((i) => i.id === ds.delete);
    if (!it) return;
    const res = await A.ctx.askDialog({ title: "Delete this photo?", message: `“${it.caption || "Untitled"}” by ${it.uploaderName} will be removed for everyone.`, input: "Reason (saved in the activity log)", ok: "Delete", danger: true });
    if (!res) return;
    try {
      await removeMemory(it, res.text);
      if (ds.report) await adminDismissReport({ id: ds.report });
      A.ctx.toast("Photo deleted");
      await loadAdmin();
    } catch (err) { A.ctx.toast(err.message); }
    return;
  }
  if (ds.deleteAll) {
    const list = items().filter((i) => i.uploaderUid === ds.deleteAll);
    const res = await A.ctx.askDialog({ title: `Delete all ${list.length} photos?`, message: "This can't be undone.", input: "Reason", ok: "Delete all", danger: true });
    if (!res) return;
    for (const it of list) { try { await removeMemory(it, res.text); } catch (err) { A.ctx.toast(err.message); break; } }
    A.ctx.toast("Photos deleted");
    await loadAdmin();
    return;
  }
  if (ds.ban) {
    const u = userRows().find((x) => x.uid === ds.ban);
    const res = await A.ctx.askDialog({ title: `Ban ${u ? u.name : "this user"}?`, message: "They will be locked out immediately: no viewing, uploading or downloading. You can unban later.", input: "Reason", ok: "Ban", danger: true });
    if (!res) return;
    try { await adminBan(u, res.text); A.ctx.toast("User banned"); await loadAdmin(); } catch (err) { A.ctx.toast(err.message); }
    return;
  }
  if (ds.unban) {
    const u = userRows().find((x) => x.uid === ds.unban);
    try { await adminUnban(u); A.ctx.toast("User unbanned"); await loadAdmin(); } catch (err) { A.ctx.toast(err.message); }
    return;
  }
  if (ds.dismiss) {
    try { await adminDismissReport({ id: ds.dismiss }); A.ctx.toast("Report dismissed"); await loadAdmin(); } catch (err) { A.ctx.toast(err.message); }
  }
}

function exportCsv() {
  const rows = [["time", "name", "email", "action", "photo", "photo_owner", "detail", "device"]];
  filteredActivity().forEach((a) => rows.push([new Date(a.at).toISOString(), a.name, a.email, a.type, a.memoryCaption, a.ownerName, a.detail, a.device]));
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `chitkara-memories-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
