// Farewell film helpers: fullscreen + music (a song from the device, or a gentle built-in soundtrack).
let audioEl = null;
let ctx = null;
let master = null;
let synthTimer = null;

export function enterFullscreen() {
  const el = document.documentElement;
  try { const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen && el.webkitRequestFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (_) { /* optional */ }
}
export function exitFullscreen() {
  try { if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {}); } catch (_) { /* ignore */ }
}

export function startMusic({ file = null, synth = false } = {}) {
  stopMusic();
  if (file) {
    audioEl = new Audio(URL.createObjectURL(file));
    audioEl.loop = true;
    audioEl.volume = 0;
    audioEl.play().catch(() => {});
    fade(audioEl, 0.9, 1800);
    return;
  }
  if (synth) startSynth();
}

export function stopMusic() {
  if (audioEl) {
    const a = audioEl;
    audioEl = null;
    fade(a, 0, 900, () => { a.pause(); URL.revokeObjectURL(a.src); });
  }
  if (master && ctx) {
    const c = ctx; const m = master;
    m.gain.cancelScheduledValues(c.currentTime);
    m.gain.setTargetAtTime(0, c.currentTime, 0.4);
    setTimeout(() => { try { c.close(); } catch (_) { /* ignore */ } }, 2500);
    ctx = null; master = null;
  }
  clearInterval(synthTimer);
  synthTimer = null;
}

function fade(a, to, ms, done) {
  const from = a.volume; const t0 = performance.now();
  (function step(now) {
    const k = Math.min(1, (now - t0) / ms);
    a.volume = from + (to - from) * k;
    if (k < 1) requestAnimationFrame(step); else if (done) done();
  })(t0);
}

// Soft generative soundtrack: warm pad chords + a slow bell arpeggio, all made in the browser.
function startSynth() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  master.gain.setTargetAtTime(0.32, ctx.currentTime, 1.2);

  // simple reverb from a generated impulse
  const verb = ctx.createConvolver();
  const len = ctx.sampleRate * 3.2;
  const imp = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = imp.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  verb.buffer = imp;
  const wet = ctx.createGain(); wet.gain.value = 0.55;
  const dry = ctx.createGain(); dry.gain.value = 0.6;
  verb.connect(wet).connect(master);
  dry.connect(master);
  master.connect(ctx.destination);
  const bus = ctx.createGain();
  bus.connect(dry); bus.connect(verb);

  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // C maj7 → A min7 → F maj7 → G sus/G
  const chords = [[48, 55, 59, 64], [45, 52, 55, 60], [41, 48, 52, 57], [43, 50, 55, 62]];
  const BAR = 4.0;
  let bar = 0;

  function pad(notes, t) {
    notes.forEach((m) => {
      [-6, 6].forEach((det) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = hz(m);
        o.detune.value = det;
        const f = ctx.createBiquadFilter();
        f.type = "lowpass"; f.frequency.value = 900; f.Q.value = 0.4;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.028, t + 1.2);
        g.gain.setTargetAtTime(0, t + BAR - 0.6, 0.6);
        o.connect(f).connect(g).connect(bus);
        o.start(t); o.stop(t + BAR + 2.5);
      });
    });
  }
  function bells(notes, t) {
    const seq = [notes[1] + 12, notes[2] + 12, notes[3] + 12, notes[2] + 24];
    seq.forEach((m, i) => {
      const tt = t + i * (BAR / 4) + 0.1;
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = hz(m);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, tt);
      g.gain.linearRampToValueAtTime(0.06, tt + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0008, tt + 2.2);
      o.connect(g).connect(bus);
      o.start(tt); o.stop(tt + 2.4);
    });
  }
  function schedule() {
    if (!ctx) return;
    while (bar * BAR < ctx.currentTime + BAR * 2) {
      const t = 0.15 + bar * BAR;
      const ch = chords[bar % chords.length];
      pad(ch, t);
      if (bar >= 2) bells(ch, t);
      bar++;
    }
  }
  schedule();
  synthTimer = setInterval(schedule, 1000);
}
