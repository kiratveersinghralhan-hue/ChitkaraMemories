// Launch kit for admins: site link, ready-to-send WhatsApp message, QR code and a printable poster.
import { SITE } from "./config.js";

const QR_SRC = "https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js";
let qrLoading = null;

export const siteUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");

function loadQr() {
  if (window.qrcode) return Promise.resolve(window.qrcode);
  if (!qrLoading) {
    qrLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = QR_SRC;
      s.onload = () => (window.qrcode ? resolve(window.qrcode) : reject(new Error("QR library missing")));
      s.onerror = () => reject(new Error("Couldn't load the QR library"));
      document.head.appendChild(s);
    });
  }
  return qrLoading;
}

export function whatsappMessage() {
  return `📸✨ ${SITE.title} is live!\n\nOur batch's photos, floating in a 3D galaxy. Add your pics with the gang, tag friends, react, and write a letter for the time capsule 💌\n\n👉 ${siteUrl()}\n\nSign in with your Chitkara email. New faces get approved by the admin, so it stays just us.`;
}

export function renderShareTab() {
  const msg = whatsappMessage();
  return `
    <div class="share-grid">
      <section class="a-card">
        <h3>Site link</h3>
        <div class="share-row"><input class="a-input" id="shareUrl" readonly value="${siteUrl()}"><button class="btn btn-sm" data-copy="#shareUrl">Copy</button></div>
        <h3 class="mt">WhatsApp message</h3>
        <textarea class="a-input share-msg" id="shareMsg" rows="8">${msg.replace(/</g, "&lt;")}</textarea>
        <div class="a-actions">
          <button class="btn btn-sm" data-copy="#shareMsg">Copy message</button>
          <a class="btn btn-sm btn-wa" href="https://wa.me/?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Open in WhatsApp</a>
        </div>
      </section>
      <section class="a-card share-poster">
        <h3>QR poster</h3>
        <p class="muted">Print it for the classroom notice board, or post it on the class Instagram story.</p>
        <canvas id="posterCanvas" width="1080" height="1350"></canvas>
        <div class="a-actions"><button class="btn btn-sm btn-primary" data-poster>Download poster (PNG)</button></div>
      </section>
    </div>`;
}

export async function drawPoster() {
  const c = document.getElementById("posterCanvas");
  if (!c) return;
  const g = c.getContext("2d");
  const W = c.width; const H = c.height;
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#130b38"); bg.addColorStop(0.55, "#07061a"); bg.addColorStop(1, "#2a0c2c");
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  // stars
  for (let i = 0; i < 260; i++) {
    g.globalAlpha = 0.2 + ((i * 37) % 10) / 14;
    g.fillStyle = ["#fff", "#c4b5ff", "#8ef0ff", "#ffb3c4"][i % 4];
    g.beginPath(); g.arc((i * 211) % W, (i * 97 + i * i) % H, ((i * 7) % 3) * 0.9 + 0.6, 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
  const glow = g.createRadialGradient(W / 2, 330, 10, W / 2, 330, 300);
  glow.addColorStop(0, "rgba(255,90,150,.55)"); glow.addColorStop(1, "rgba(124,92,255,0)");
  g.fillStyle = glow; g.fillRect(0, 0, W, 700);
  // CU medallion
  const ring = g.createLinearGradient(W / 2 - 150, 180, W / 2 + 150, 480);
  ring.addColorStop(0, "#ff4d6d"); ring.addColorStop(1, "#7c5cff");
  g.strokeStyle = ring; g.lineWidth = 10;
  g.beginPath(); g.arc(W / 2, 330, 150, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
  g.font = '700 150px "Space Grotesk", sans-serif'; g.fillText("CU", W / 2, 340);
  // title
  g.font = '700 92px "Space Grotesk", sans-serif'; g.fillText("Chitkara", W / 2, 590);
  const tg = g.createLinearGradient(W / 2 - 300, 0, W / 2 + 300, 0);
  tg.addColorStop(0, "#ff4d6d"); tg.addColorStop(0.55, "#b44dff"); tg.addColorStop(1, "#7c5cff");
  g.fillStyle = tg; g.font = '700 128px "Caveat", cursive'; g.fillText("Memories", W / 2, 700);
  g.fillStyle = "rgba(255,255,255,.75)"; g.font = '500 34px "Space Grotesk", sans-serif';
  g.fillText(SITE.subtitle, W / 2, 790);
  // QR
  const box = 330; const bx = W / 2 - box / 2; const by = 850;
  g.fillStyle = "#fff";
  roundRect(g, bx - 24, by - 24, box + 48, box + 48, 28); g.fill();
  try {
    const qrcode = await loadQr();
    const qr = qrcode(0, "M");
    qr.addData(siteUrl());
    qr.make();
    const n = qr.getModuleCount();
    const cell = box / n;
    g.fillStyle = "#0b0820";
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) g.fillRect(bx + col * cell, by + r * cell, Math.ceil(cell), Math.ceil(cell));
  } catch (_) {
    g.fillStyle = "#0b0820"; g.font = '600 28px "Space Grotesk", sans-serif';
    g.fillText("Scan unavailable", W / 2, by + box / 2);
  }
  g.fillStyle = "#fff"; g.font = '700 46px "Space Grotesk", sans-serif';
  g.fillText("Scan & add your memories", W / 2, 1265);
  g.fillStyle = "rgba(255,255,255,.6)"; g.font = '500 28px "Space Grotesk", sans-serif';
  g.fillText("Sign in with your Chitkara email", W / 2, 1310);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

export function downloadPoster() {
  const c = document.getElementById("posterCanvas");
  if (!c) return;
  c.toBlob((blob) => {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u; a.download = "chitkara-memories-poster.png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  }, "image/png");
}
