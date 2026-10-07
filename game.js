'use strict';
/* =======================================================================
   WESTVALE ZOMBIES : PIRATES OF THE RED MOON
   A 2.5D Call-of-Duty-Zombies-style survival game. Single file, no assets.
   Canvas 2D + Web Audio, everything procedural.
   ======================================================================= */

// ------------------------------------------------------------------ basics
const cv = document.getElementById('c');
let ctx = cv.getContext('2d');
const TAU = Math.PI * 2;
const FONT = '"Avenir Next Condensed", "Futura", "Arial Black", Impact, "Helvetica Neue", sans-serif';
const KFONT = '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';
const rand = (a, b) => a + Math.random() * (b - a);
const irand = (a, b) => Math.floor(rand(a, b + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const easeOutBack = t => { const c1 = 1.70158, c3 = c1 + 1, f = t - 1; return 1 + c3 * f * f * f + c1 * f * f; };
const fmt = n => Math.round(n).toLocaleString('en-US');

let W = 0, H = 0, DPR = 1, Z = 1, UI = 1;
let safeTop = 0, safeBot = 0, safeL = 0, safeR = 0;
let isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints || 0) > 0;
let usingTouch = isTouchDevice && !matchMedia('(pointer: fine)').matches;

let state = 'menu';    // menu | play | over
let paused = false;
let gt = 0;            // global clock (seconds)

function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
function unstore(k) { try { localStorage.removeItem(k); } catch (e) {} }
let bestRound = parseInt(store('westvale.bestRound') || '0', 10) || 0;
let muted = store('westvale.muted') === '1';

// ------------------------------------------------------------------ settings (persisted)
const SETTINGS_KEY = 'westvale.settings.v1';
const settings = Object.assign({
  master: 0.8, music: 0.6, sfx: 1.0, shake: true, stick: 1,   // stick: 0 small, 1 medium, 2 large
  aimAssist: true, character: 'goza', gunMode: 'default', gunHue: 285
}, (() => { try { return JSON.parse(store(SETTINGS_KEY) || '{}') || {}; } catch (e) { return {}; } })());
function saveSettings() { store(SETTINGS_KEY, JSON.stringify(settings)); applyAudioSettings(); }
const stickR = () => [44, 56, 70][settings.stick] * UI;

// ------------------------------------------------------------------ input
const keys = Object.create(null);
const pressed = new Set();
const mouse = { x: 0, y: 0, l: false, r: false, lPressed: false, rPressed: false, seen: false };
const input = {
  mx: 0, my: 0,             // movement vector (-1..1)
  aim: 0, aimActive: false, // aim angle (world)
  fire: false, firePressed: false, autoSemi: false,
  heavy: false, heavyPressed: false,
  reload: false, swap: false, use: false, useHeld: false, melee: false,
  slot: -1
};
// Scroll-wheel swaps are queued here (debounced) - NOT stored in input.swap, which is rebuilt every frame.
let wheelQueued = false, lastWheel = 0;

const inMenus = () => state !== 'play' || paused;

addEventListener('keydown', e => {
  if (!keys[e.code]) pressed.add(e.code);
  keys[e.code] = true;
  usingTouch = false;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
  initAudio();
  if (inMenus() && !e.repeat) uiKey(e.code);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.l = mouse.r = false; if (state === 'play' && !paused) pauseGame(); });

// ---- touch: twin sticks + buttons
const touch = {
  left: { id: null, ox: 0, oy: 0, x: 0, y: 0 },
  right: { id: null, ox: 0, oy: 0, x: 0, y: 0 },
  buttons: [],      // filled by layoutTouch()
  held: new Map()   // pointerId -> button id
};

function stickVec(s, max) {
  if (s.id === null) return { x: 0, y: 0, m: 0 };
  let dx = s.x - s.ox, dy = s.y - s.oy;
  const m = Math.hypot(dx, dy);
  if (m > max) { dx = dx / m * max; dy = dy / m * max; }
  return { x: dx / max, y: dy / max, m: Math.min(1, m / max) };
}

function buttonAt(x, y) {
  for (const b of touch.buttons) if (b.visible() && Math.hypot(x - b.x, y - b.y) < b.r * 1.2) return b;
  return null;
}
function releaseAllTouches() {
  touch.left.id = touch.right.id = null;
  for (const b of touch.buttons) { b.down = false; if (b.onRelease) b.onRelease(); }
  touch.held.clear();
}

cv.addEventListener('contextmenu', e => e.preventDefault());

cv.addEventListener('pointerdown', e => {
  initAudio();
  if (e.pointerType === 'mouse') {
    usingTouch = false;
    mouse.x = e.clientX; mouse.y = e.clientY; mouse.seen = true;
    if (inMenus()) { if (e.button === 0) uiDown(e.clientX, e.clientY); return; }
    if (e.button === 0) { mouse.l = true; mouse.lPressed = true; }
    if (e.button === 2) { mouse.r = true; mouse.rPressed = true; }
    return;
  }
  e.preventDefault();
  usingTouch = true;
  try { cv.setPointerCapture(e.pointerId); } catch (err) {}
  if (inMenus()) { uiDown(e.clientX, e.clientY); return; }
  const b = buttonAt(e.clientX, e.clientY);
  if (b) { touch.held.set(e.pointerId, b.id); b.down = true; b.onPress && b.onPress(); return; }
  const s = e.clientX < W * 0.45 ? touch.left : touch.right;
  if (s.id === null) { s.id = e.pointerId; s.ox = s.x = e.clientX; s.oy = s.y = e.clientY; }
}, { passive: false });

cv.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') { mouse.x = e.clientX; mouse.y = e.clientY; mouse.seen = true; if (inMenus()) uiMove(e.clientX, e.clientY); return; }
  e.preventDefault();
  if (inMenus()) { uiMove(e.clientX, e.clientY); return; }
  const max = stickR();
  for (const s of [touch.left, touch.right]) {
    if (s.id === e.pointerId) {
      s.x = e.clientX; s.y = e.clientY;
      // floating stick: drag the origin along if pulled far
      const dx = s.x - s.ox, dy = s.y - s.oy, m = Math.hypot(dx, dy);
      if (m > max * 1.5) { s.ox = s.x - dx / m * max * 1.5; s.oy = s.y - dy / m * max * 1.5; }
    }
  }
}, { passive: false });

function pointerEnd(e) {
  uiUp();
  if (e.pointerType === 'mouse') {
    if (e.button === 0) mouse.l = false;
    if (e.button === 2) mouse.r = false;
    return;
  }
  for (const s of [touch.left, touch.right]) if (s.id === e.pointerId) s.id = null;
  const bid = touch.held.get(e.pointerId);
  if (bid) {
    touch.held.delete(e.pointerId);
    const b = touch.buttons.find(x => x.id === bid);
    if (b) { b.down = false; b.onRelease && b.onRelease(); }
  }
}
cv.addEventListener('pointerup', pointerEnd);
cv.addEventListener('pointercancel', pointerEnd);
document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
addEventListener('wheel', e => {
  if (state !== 'play' || paused || Math.abs(e.deltaY) < 4) return;
  const now = performance.now();
  if (now - lastWheel > 260) { wheelQueued = true; lastWheel = now; }
}, { passive: true });

// Touch button "virtual keys"
const vkeys = { use: false, reload: false, swap: false, melee: false, heavy: false };
const vpress = new Set();

/** Collapses keyboard / mouse / touch into one `input` snapshot per frame. */
function readInput(player, toWorld) {
  input.firePressed = false; input.heavyPressed = false;
  input.reload = false; input.use = false; input.melee = false; input.slot = -1; input.swap = false;
  const wheel = wheelQueued; wheelQueued = false;

  if (usingTouch) {
    const max = stickR();
    const L = stickVec(touch.left, max), R = stickVec(touch.right, max);
    input.mx = L.m > 0.12 ? L.x : 0; input.my = L.m > 0.12 ? L.y : 0;
    if (R.m > 0.2) { input.aim = Math.atan2(R.y, R.x); input.aimActive = true; }
    else if (L.m > 0.2 && !input.fire) { input.aim = Math.atan2(L.y, L.x); input.aimActive = false; }
    const wasFire = input.fire;
    input.fire = R.m > 0.45;
    input.firePressed = input.fire && !wasFire;
    input.autoSemi = true;
    input.heavy = vkeys.heavy;
    input.heavyPressed = vpress.has('heavy');
    input.reload = vpress.has('reload');
    input.swap = vpress.has('swap') || wheel;
    input.use = vpress.has('use');
    input.useHeld = vkeys.use;
    input.melee = vpress.has('melee');
  } else {
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) my -= 1;
    if (keys.KeyS || keys.ArrowDown) my += 1;
    if (keys.KeyA || keys.ArrowLeft) mx -= 1;
    if (keys.KeyD || keys.ArrowRight) mx += 1;
    const m = Math.hypot(mx, my) || 1;
    input.mx = mx / m; input.my = my / m;
    if (player && mouse.seen) {
      const wpt = toWorld(mouse.x, mouse.y);
      input.aim = Math.atan2(wpt.y - (player.y - 24), wpt.x - player.x);
      input.aimActive = true;
    }
    input.fire = mouse.l;
    input.firePressed = mouse.lPressed;
    input.autoSemi = false;
    input.heavy = mouse.r;
    input.heavyPressed = mouse.rPressed;
    input.reload = pressed.has('KeyR');
    input.swap = pressed.has('KeyQ') || pressed.has('Tab') || wheel;
    input.use = pressed.has('KeyF') || pressed.has('KeyE');
    input.useHeld = !!(keys.KeyF || keys.KeyE);
    input.melee = pressed.has('KeyV');
    if (pressed.has('Digit1')) input.slot = 0;
    if (pressed.has('Digit2')) input.slot = 1;
    if (pressed.has('Digit3')) input.slot = 2;
  }
  mouse.lPressed = false; mouse.rPressed = false;
  vpress.clear();
}

// ------------------------------------------------------------------ audio
const AC = window.AudioContext || window.webkitAudioContext;
let ac = null, master = null, sfxBus = null, musicBus = null, noiseBuf = null, drone = null;

function initAudio() {
  if (!AC) return;
  if (!ac) {
    try {
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.ratio.value = 5;
      master = ac.createGain(); master.gain.value = muted ? 0 : settings.master;
      sfxBus = ac.createGain(); sfxBus.gain.value = settings.sfx;
      musicBus = ac.createGain(); musicBus.gain.value = settings.music;
      sfxBus.connect(master); musicBus.connect(master);
      master.connect(comp); comp.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const s = ac.createBufferSource(); s.buffer = ac.createBuffer(1, 1, 22050); s.connect(ac.destination); s.start(0);
    } catch (e) { ac = null; return; }
  }
  if (ac.state === 'suspended') ac.resume();
}
addEventListener('touchend', initAudio, { passive: true });

function setMuted(m) {
  muted = m; store('westvale.muted', m ? '1' : '0');
  applyAudioSettings();
}
function applyAudioSettings() {
  if (!ac) return;
  master.gain.setTargetAtTime(muted ? 0 : settings.master, ac.currentTime, 0.03);
  sfxBus.gain.setTargetAtTime(settings.sfx, ac.currentTime, 0.03);
  musicBus.gain.setTargetAtTime(settings.music, ac.currentTime, 0.03);
}

function tone(f0, f1, dur, type, gain, delay, dest) {
  if (!ac || muted) return;
  const t = ac.currentTime + (delay || 0);
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type || 'sine';
  o.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || sfxBus);
  o.start(t); o.stop(t + dur + 0.03);
}

function noise(dur, type, f0, f1, gain, q, delay, dest) {
  if (!ac || muted) return;
  const t = ac.currentTime + (delay || 0);
  const s = ac.createBufferSource(); s.buffer = noiseBuf;
  const f = ac.createBiquadFilter(); f.type = type || 'bandpass'; f.Q.value = q || 1;
  f.frequency.setValueAtTime(f0, t);
  if (f1 && f1 !== f0) f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest || sfxBus);
  s.start(t, Math.random() * 1.2); s.stop(t + dur + 0.03);
}

function melody(notes, step, type, gain, base) {
  notes.forEach((n, i) => { if (n !== null) tone((base || 440) * Math.pow(2, n / 12), 0, step * 1.6, type || 'square', gain || 0.08, i * step); });
}

const SFX = {
  revolver() { noise(0.4, 'lowpass', 3500, 250, 0.9); tone(170, 45, 0.3, 'sine', 0.6); tone(2400, 1800, 0.12, 'triangle', 0.08); },
  kuro() { noise(0.12, 'bandpass', 1900, 900, 0.55, 0.8); tone(210, 70, 0.08, 'square', 0.12); },
  vector() { noise(0.07, 'highpass', 2600, 2000, 0.4); tone(420, 160, 0.05, 'square', 0.08); },
  raijin() { noise(1.0, 'lowpass', 7000, 150, 1.0, 0.7); noise(0.08, 'highpass', 5000, 5000, 0.8); tone(85, 28, 0.9, 'sawtooth', 0.45); for (let i = 0; i < 3; i++) noise(0.06, 'bandpass', 3000, 900, 0.4, 2, 0.12 + i * 0.07); },
  sweeper() { noise(0.5, 'lowpass', 2600, 140, 1.0); tone(120, 38, 0.35, 'sine', 0.7); },
  giga() { noise(0.08, 'bandpass', 1500, 700, 0.5, 0.9); tone(160, 60, 0.06, 'square', 0.1); },
  ronin() { noise(0.16, 'bandpass', 2800, 1200, 0.6); tone(900, 150, 0.12, 'square', 0.12); tone(3000, 2000, 0.1, 'triangle', 0.06); },
  katsu() { noise(0.7, 'bandpass', 300, 2400, 0.7, 1.2); tone(90, 300, 0.4, 'sawtooth', 0.15); },
  chronos() { tone(950, 280, 0.22, 'sine', 0.3); tone(1430, 420, 0.22, 'sine', 0.18); tone(60, 40, 0.2, 'triangle', 0.3); },
  blade() { noise(0.2, 'bandpass', 1400, 6000, 0.5, 1.5); tone(2200, 3200, 0.15, 'triangle', 0.06); },
  lunge() { noise(0.35, 'bandpass', 800, 6000, 0.7, 1.2); tone(300, 1500, 0.3, 'sawtooth', 0.12); },
  knife() { noise(0.12, 'bandpass', 2000, 4000, 0.35, 1.2); },
  dry() { tone(2200, 0, 0.03, 'square', 0.08); tone(1600, 0, 0.03, 'square', 0.05, 0.05); },
  click() { noise(0.03, 'highpass', 4000, 4000, 0.35); tone(1800, 1200, 0.04, 'square', 0.06); },
  magOut() { tone(300, 120, 0.12, 'triangle', 0.25); noise(0.08, 'bandpass', 900, 500, 0.3); },
  magIn() { noise(0.04, 'highpass', 3000, 3000, 0.5); tone(1200, 800, 0.05, 'square', 0.12); },
  rack() { noise(0.05, 'bandpass', 2500, 1500, 0.4); noise(0.05, 'bandpass', 2000, 1200, 0.45, 1, 0.09); tone(700, 500, 0.05, 'square', 0.08, 0.09); },
  hit() { noise(0.05, 'bandpass', 1100, 600, 0.22, 1.2); },
  head() { noise(0.06, 'bandpass', 2500, 900, 0.3, 1.5); tone(1500, 900, 0.06, 'square', 0.05); },
  splat() { noise(0.22, 'lowpass', 900, 150, 0.45); tone(140, 50, 0.15, 'sine', 0.2); },
  boom() { noise(0.9, 'lowpass', 2200, 90, 1.0); tone(110, 26, 0.8, 'sine', 0.85); },
  buy() { tone(1318, 0, 0.1, 'square', 0.1); tone(1760, 0, 0.18, 'square', 0.1, 0.08); noise(0.1, 'highpass', 6000, 6000, 0.15, 1, 0.08); },
  deny() { tone(180, 0, 0.12, 'square', 0.14); tone(140, 0, 0.18, 'square', 0.14, 0.13); },
  door() { noise(0.6, 'lowpass', 700, 100, 0.8); tone(95, 45, 0.5, 'sine', 0.5); tone(280, 520, 0.4, 'sawtooth', 0.04, 0.05); },
  hurt() { tone(320, 110, 0.25, 'sawtooth', 0.3); noise(0.25, 'lowpass', 1500, 200, 0.5); },
  board() { noise(0.12, 'bandpass', 650, 300, 0.6, 2); tone(160, 90, 0.1, 'square', 0.12); },
  hammer() { tone(220, 120, 0.06, 'square', 0.2); noise(0.06, 'bandpass', 1200, 800, 0.4, 2); },
  pickup() { melody([0, 4, 7, 12, 16], 0.06, 'square', 0.08, 660); },
  powerSpawn() { melody([12, 7, 12, 19], 0.08, 'triangle', 0.07, 880); },
  maxAmmo() { melody([0, 0, 7, 12, 12, 19], 0.07, 'square', 0.1, 440); noise(0.5, 'bandpass', 800, 4000, 0.3); },
  insta() { tone(70, 50, 1.2, 'sawtooth', 0.35); melody([0, -1, -5, -6], 0.15, 'sawtooth', 0.09, 220); },
  nuke() { noise(1.8, 'lowpass', 5000, 60, 1.0, 0.6); tone(60, 22, 1.6, 'sawtooth', 0.6); tone(1800, 200, 1.4, 'sine', 0.1); },
  roundStart() { [0, 3, 7, -12].forEach((s, i) => tone(110 * Math.pow(2, s / 12), 0, 2.6, 'sawtooth', 0.07, i * 0.02)); noise(2.2, 'lowpass', 400, 80, 0.3); tone(523, 0, 1.5, 'triangle', 0.1, 0.3); },
  roundEnd() { melody([0, 3, 7, 10, 12, 15], 0.18, 'triangle', 0.09, 330); tone(55, 41, 2.5, 'sawtooth', 0.15); },
  perk(id) {
    const m = { zap: [0, 4, 7, 4, 12, 7, 16], tuff: [0, 0, 5, 5, 7, 12, 12], flash: [12, 7, 12, 16, 19, 24, 19] }[id] || [0, 7, 12];
    melody(m, 0.11, id === 'tuff' ? 'sawtooth' : 'square', 0.08, id === 'zap' ? 392 : id === 'tuff' ? 196 : 523);
  },
  slurp() { noise(0.5, 'bandpass', 500, 1500, 0.4, 3); tone(200, 80, 0.4, 'sine', 0.2, 0.5); },
  boxOpen() { noise(0.4, 'lowpass', 900, 200, 0.5); melody([12, 16, 19, 24, 19, 16, 12, 16, 19, 24, 28, 24, 19, 16, 19, 24], 0.18, 'triangle', 0.05, 880); },
  boxDone() { melody([24, 19, 24, 31], 0.08, 'square', 0.08, 440); },
  groan(vol) {
    if (!ac || muted || vol < 0.03) return;
    const t = ac.currentTime, f = rand(70, 120);
    const o = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain(), flt = ac.createBiquadFilter(), g = ac.createGain();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * rand(0.7, 0.9), t + 0.9);
    lfo.frequency.value = rand(5, 9); lg.gain.value = f * 0.08; lfo.connect(lg); lg.connect(o.frequency);
    flt.type = 'bandpass'; flt.frequency.value = rand(500, 900); flt.Q.value = 3;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16 * vol, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(flt); flt.connect(g); g.connect(sfxBus);
    o.start(t); lfo.start(t); o.stop(t + 1.05); lfo.stop(t + 1.05);
  },
  attack() { noise(0.15, 'bandpass', 500, 300, 0.4, 2); tone(130, 70, 0.2, 'sawtooth', 0.15); },
  flashbang() { noise(0.6, 'highpass', 6000, 2000, 0.6); tone(4000, 3800, 0.8, 'sine', 0.05); },
  implode() { tone(200, 900, 0.12, 'sine', 0.12); },
  freeze() { tone(1200, 600, 0.4, 'sine', 0.12); tone(1800, 900, 0.4, 'sine', 0.08, 0.05); },
  unfreeze() { noise(0.4, 'bandpass', 1500, 400, 0.6, 2); tone(500, 60, 0.4, 'sawtooth', 0.3); },
  overheat() { noise(0.8, 'highpass', 3000, 1000, 0.4); tone(900, 300, 0.6, 'square', 0.08); },
  down() { tone(400, 60, 1.5, 'sawtooth', 0.3); noise(1.2, 'lowpass', 1000, 100, 0.5); },
  revive() { melody([0, 4, 7, 12, 16, 19], 0.07, 'square', 0.09, 523); }
};

function startDrone() {
  if (!ac || drone) return;
  const t = ac.currentTime;
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 3);
  const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
  const o1 = ac.createOscillator(), o2 = ac.createOscillator(), lfo = ac.createOscillator(), lg = ac.createGain();
  o1.type = 'sawtooth'; o1.frequency.value = 55; o2.type = 'sawtooth'; o2.frequency.value = 82.6;
  lfo.frequency.value = 0.08; lg.gain.value = 120; lfo.connect(lg); lg.connect(f.frequency);
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(musicBus);
  o1.start(); o2.start(); lfo.start();
  drone = { g, nodes: [o1, o2, lfo] };
}
function stopDrone() {
  if (!drone || !ac) return;
  const d = drone; drone = null;
  d.g.gain.setTargetAtTime(0.0001, ac.currentTime, 0.4);
  setTimeout(() => d.nodes.forEach(n => { try { n.stop(); } catch (e) {} }), 2000);
}

// =======================================================================
// MAP : "WESTVALE HIGH SCHOOL PIRATES"
// 62 x 48 tiles. Every non-floor tile is a solid block with height (2.5D).
// =======================================================================
const T = 40, WH = 70, MW = 62, MH = 48;
const VOID = 0, FLOOR = 1, WALL = 2, WIN = 3, DOOR = 4, PROP = 5, RAIL = 6;
const FK = { CONC: 1, HALL: 2, CLASS: 3, CAFE: 4, GYM: 5, LAB: 6, ROOF: 7 };
const FLOOR_NAMES = { 1: 'FRONT LOBBY', 2: 'MAIN HALLWAY', 3: 'CLASSROOMS', 4: 'CAFETERIA', 5: 'GYMNASIUM', 6: 'SCIENCE WING', 7: 'ROOFTOP OVERLOOK' };
const PK = { DESK: 1, TDESK: 2, CTABLE: 3, BLEACH: 4, PLANTER: 5, STATUE: 6, LABT: 7, VENT: 8, BENCH: 9, MACHINE: 10, BOX: 11, TCASE: 12 };
const PROP_H = { 1: 12, 2: 14, 3: 11, 4: 20, 5: 14, 6: 0, 7: 15, 8: 16, 9: 9, 10: 0, 11: 0 };

let tile, fkind, zone, propK, doorOf;
let windows = [], doors = [], wallbuys = [], perks = [], box = null, decor = [];
let floorCanvas = null, strips = [], minimap = null;
const activeZones = new Set([1]);

const idx = (x, y) => y * MW + x;
function tAt(x, y) { return (x < 0 || y < 0 || x >= MW || y >= MH) ? VOID : tile[idx(x, y)]; }
const wallish = t => t === WALL || t === WIN || t === DOOR;
const solidFor = t => t !== FLOOR;                       // player
const zombieWalk = t => t === FLOOR || t === WIN;        // zombies can climb through windows
const blocksBullet = t => t === WALL || t === DOOR || t === VOID;
function heightAt(x, y) {
  const t = tAt(x, y);
  if (wallish(t)) return WH;
  if (t === RAIL) return 10;
  if (t === PROP) return (PROP_HA[propK[idx(x, y)]] || 0) * AP;
  return 0;
}

function buildMap() {
  tile = new Uint8Array(MW * MH); fkind = new Uint8Array(MW * MH); zone = new Uint8Array(MW * MH);
  propK = new Uint8Array(MW * MH); doorOf = new Int8Array(MW * MH).fill(-1);
  windows = []; doors = []; wallbuys = []; perks = []; decor = [];
  activeZones.clear(); activeZones.add(1);

  const fill = (x0, y0, x1, y1, t) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tile[idx(x, y)] = t; };
  const floor = (x0, y0, x1, y1, k, z) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = idx(x, y); tile[i] = FLOOR; fkind[i] = k; zone[i] = z; } };
  const prop = (x0, y0, x1, y1, k) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { tile[idx(x, y)] = PROP; propK[idx(x, y)] = k; } };

  fill(1, 1, 60, 46, WALL);
  // rooftop corner opens onto the sky
  fill(44, 0, 61, 1, VOID); fill(60, 0, 61, 14, VOID);
  fill(44, 2, 59, 2, RAIL); fill(59, 2, 59, 13, RAIL);

  floor(19, 35, 42, 45, FK.CONC, 1);                                   // Zone 1 courtyard
  floor(4, 29, 57, 33, FK.HALL, 2);                                    // Zone 2 hallway
  floor(21, 19, 30, 27, FK.CLASS, 2); floor(33, 19, 42, 27, FK.CLASS, 2);
  floor(25, 28, 26, 28, FK.HALL, 2); floor(37, 28, 38, 28, FK.HALL, 2);
  floor(3, 17, 18, 27, FK.CAFE, 3); floor(3, 3, 18, 15, FK.GYM, 3); floor(9, 16, 12, 16, FK.GYM, 3); // Zone 3
  floor(45, 15, 58, 27, FK.LAB, 4); floor(45, 3, 58, 13, FK.ROOF, 4); floor(50, 14, 52, 14, FK.LAB, 4); // Zone 4

  // ---- doors (bought with points)
  const door = (x0, y0, x1, y1, z, cost, k, label) => {
    const d = { id: doors.length, tiles: [], zone: z, cost, open: false, label, anim: 0 };
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = idx(x, y); tile[i] = DOOR; fkind[i] = k; zone[i] = z; doorOf[i] = d.id; d.tiles.push([x, y]);
    }
    d.cx = ((x0 + x1 + 1) / 2) * T; d.cy = ((y0 + y1 + 1) / 2) * T;
    doors.push(d);
  };
  door(29, 34, 32, 34, 2, 750, FK.HALL, 'MAIN HALLWAY');
  door(6, 28, 8, 28, 3, 1250, FK.CAFE, 'GYM & CAFETERIA');
  door(53, 28, 55, 28, 4, 1500, FK.LAB, 'SCIENCE WING & ROOF');

  // ---- props
  prop(30, 37, 31, 38, PK.STATUE);
  // lobby trophy cases
  prop(19, 37, 19, 38, PK.TCASE); prop(42, 37, 42, 38, PK.TCASE);
  prop(21, 44, 23, 44, PK.TCASE); prop(38, 44, 40, 44, PK.TCASE);
  for (const x of [22, 24, 26, 28]) for (const y of [22, 24, 26]) prop(x, y, x, y, PK.DESK);
  for (const x of [34, 36, 38, 40]) for (const y of [22, 24, 26]) prop(x, y, x, y, PK.DESK);
  prop(28, 20, 29, 20, PK.TDESK); prop(34, 20, 35, 20, PK.TDESK);
  for (const y of [19, 22, 25]) { prop(5, y, 8, y, PK.CTABLE); prop(11, y, 14, y, PK.CTABLE); }
  prop(3, 4, 4, 8, PK.BLEACH); prop(3, 12, 4, 14, PK.BLEACH);
  for (const y of [18, 21, 24]) for (const x of [47, 51, 55]) prop(x, y, x + 1, y, PK.LABT);
  prop(47, 5, 48, 6, PK.VENT); prop(54, 9, 55, 10, PK.VENT);

  // ---- machines + mystery box (solid props drawn as tall entities)
  const perkDefs = {
    zap: { name: 'ZAPREVIVE', cost: 1500, body: '#ffd21a', trim: '#111', glow: '#fff36b', desc: 'Faster heal & self-revive' },
    tuff: { name: 'TUFF COLA', cost: 2500, body: '#7b2fd0', trim: '#ffffff', glow: '#d9a8ff', desc: '+100 max health' },
    flash: { name: 'FLASHSLUSH', cost: 3000, body: '#2a7fff', trim: '#d9e3ef', glow: '#9fe6ff', desc: 'Reload x2, move +25%' }
  };
  for (const [id, x, y] of [['zap', 41, 20], ['tuff', 18, 19], ['flash', 18, 4]]) {
    prop(x, y, x, y, PK.MACHINE);
    perks.push(Object.assign({ id, tx: x, ty: y, x: (x + 0.5) * T, y: (y + 1) * T }, perkDefs[id]));
  }
  prop(22, 20, 23, 20, PK.BOX);
  box = { tx: 22, ty: 20, x: 23 * T, y: 21 * T, cost: 950, state: 'idle', t: 0, weapon: null, show: null, lid: 0, uses: 0 };

  // ---- zombie windows (boarded barriers)
  for (const [x, y] of [[23, 46], [38, 46], [18, 42], [43, 42], [24, 18], [38, 18], [3, 31], [58, 31], [8, 34], [50, 34],
    [2, 22], [2, 10], [5, 2], [16, 2], [44, 20], [59, 22], [49, 2], [55, 2], [59, 8]]) {
    tile[idx(x, y)] = WIN;
    let inX = 0, inY = 0;
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) if (tAt(x + dx, y + dy) === FLOOR) { inX = dx; inY = dy; break; }
    const z = zone[idx(x + inX, y + inY)];
    zone[idx(x, y)] = z;
    windows.push({ x, y, cx: (x + 0.5) * T, cy: (y + 0.5) * T, inX, inY, zone: z, boards: 6, breacher: null, shake: 0 });
  }

  // ---- wall-buys (chalk outlines on walls)
  for (const [w, x, y, price] of [['revolver', 26, 34, 500], ['vector', 15, 28, 1200], ['kuro', 45, 28, 1400], ['sweeper', 5, 16, 1500], ['ronin', 47, 14, 1700]]) {
    wallbuys.push({ w, tx: x, ty: y, x: (x + 0.5) * T, y: (y + 1) * T + 6, price });
  }

  // ---- wall-front decorations (multi-tile pieces know their start x0 + span)
  const dec = (x0, span, y, k, extra) => { for (let i = 0; i < span; i++) decor.push(Object.assign({ x: x0 + i, y, x0, span, k, i, first: i === 0, last: i === span - 1 }, extra || {})); };
  // front lobby (matches the Westvale lobby mockup)
  dec(19, 2, 34, 'sign', { text: 'WESTVALE' }); dec(39, 1, 34, 'sign', { text: 'HIGH' }); dec(40, 1, 34, 'sign', { text: '1987' });
  dec(21, 2, 34, 'banner'); dec(23, 2, 34, 'board');
  dec(35, 1, 34, 'extinguisher'); dec(36, 1, 34, 'poster_club'); dec(37, 1, 34, 'poster_school');
  // main hallway
  dec(11, 2, 28, 'banner'); dec(17, 2, 28, 'board'); dec(41, 1, 28, 'extinguisher'); dec(48, 2, 28, 'board'); dec(51, 1, 28, 'poster_school');
  // classrooms, gym, cafeteria, science
  dec(21, 10, 18, 'chalk'); dec(33, 10, 18, 'chalk');
  dec(5, 12, 2, 'gymbanner');
  dec(13, 4, 16, 'menu');
  dec(54, 1, 14, 'periodic'); dec(56, 1, 14, 'periodic'); dec(46, 1, 14, 'extinguisher');
}

// =======================================================================
// PRE-RENDERING (floor canvas, wall strips, minimap)
// =======================================================================
function pirateSkull(g, cx, cy, s, col) {
  // crossed swords
  g.lineCap = 'round';
  for (const sgn of [-1, 1]) {
    g.strokeStyle = '#000'; g.lineWidth = 7 * s;
    g.beginPath(); g.moveTo(cx - 30 * s * sgn, cy + 26 * s); g.lineTo(cx + 30 * s * sgn, cy - 26 * s); g.stroke();
    g.strokeStyle = '#e8edf5'; g.lineWidth = 3.5 * s; g.stroke();
  }
  // skull
  g.beginPath(); g.arc(cx, cy - 4 * s, 17 * s, Math.PI * 0.85, Math.PI * 0.15); g.lineTo(cx + 9 * s, cy + 16 * s); g.lineTo(cx - 9 * s, cy + 16 * s); g.closePath();
  g.fillStyle = col || '#fff'; g.fill(); g.lineWidth = 3 * s; g.strokeStyle = '#000'; g.stroke();
  // bandana
  g.beginPath(); g.arc(cx, cy - 4 * s, 17.5 * s, Math.PI * 1.05, Math.PI * 1.95); g.lineTo(cx + 16 * s, cy - 8 * s); g.lineTo(cx - 16 * s, cy - 8 * s); g.closePath();
  g.fillStyle = '#c4283a'; g.fill(); g.stroke();
  g.fillStyle = '#000';
  g.beginPath(); g.arc(cx - 6.5 * s, cy, 4.5 * s, 0, TAU); g.arc(cx + 6.5 * s, cy, 4.5 * s, 0, TAU); g.fill();
  g.beginPath(); g.moveTo(cx, cy + 5 * s); g.lineTo(cx - 2.5 * s, cy + 9 * s); g.lineTo(cx + 2.5 * s, cy + 9 * s); g.fill();
}

function outlineText(g, str, x, y, size, fill, stroke, lw) {
  g.font = 'italic 900 ' + size + 'px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.lineWidth = lw || size * 0.22; g.strokeStyle = stroke || '#000'; g.strokeText(str, x, y);
  g.fillStyle = fill; g.fillText(str, x, y);
}

function renderMinimap() {
  if (!minimap) { minimap = document.createElement('canvas'); minimap.width = MW * 3; minimap.height = MH * 3; }
  const g = minimap.getContext('2d');
  g.clearRect(0, 0, minimap.width, minimap.height);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const t = tAt(x, y), z = zone[idx(x, y)];
    if (t === FLOOR || t === PROP) g.fillStyle = activeZones.has(z) ? (t === PROP ? '#8a7f8f' : '#d9d0d6') : '#3c3044';
    else if (t === DOOR) g.fillStyle = '#ff2a55';
    else if (t === WIN) g.fillStyle = '#9dff3c';
    else if (t === WALL) g.fillStyle = 'rgba(20,0,30,0.85)';
    else continue;
    g.fillRect(x * 3, y * 3, 3, 3);
  }
  for (const p of perks) { g.fillStyle = p.body; g.fillRect(p.tx * 3 - 1, p.ty * 3 - 1, 5, 5); }
  g.fillStyle = '#ffd21a'; g.fillRect(box.tx * 3, box.ty * 3 - 1, 6, 5);
}

/** Opens a door: tiles become floor, the zone goes live, art + pathing refresh. */
function openDoor(d) {
  d.open = true;
  for (const [x, y] of d.tiles) tile[idx(x, y)] = FLOOR;
  activeZones.add(d.zone);
  const rows = new Set();
  for (const [, y] of d.tiles) { rows.add(y - 1); rows.add(y); rows.add(y + 1); }
  rows.forEach(r => { if (r >= 0 && r < MH) renderStrip(r); });
  repaintFloorTiles(d.tiles);
  renderMinimap();
}

// =======================================================================
// PIXEL-ART RENDERER (school art, 16 art-pixels per tile, crisp integer rects)
// Style reference: Westvale lobby mockup - grey tile floors, brick bands,
// red lockers, pirate banners, trophy cases, Capt. Westvale statue.
// =======================================================================
const A = 16;                    // art pixels per tile
const AP = T / A;                // world units per art pixel (2.5)
const WHA = Math.round(WH / AP); // wall height in art pixels
const PADA = WHA + 2;
const PAD = PADA * AP;

function pR(g, x, y, w, h, c) { g.fillStyle = c; g.fillRect(x, y, w, h); }

// ---- 3x5 bitmap font --------------------------------------------------------
const FONT3 = {
  A: '.#.#.#####.##.#',
  B: '##.#.###.#.###.',
  C: '.###..#..#...##',
  D: '##.#.##.##.###.',
  E: '####..##.#..###',
  F: '####..##.#..#..',
  G: '.###..#.##.#.##',
  H: '#.##.#####.##.#',
  I: '###.#..#..#.###',
  J: '..#..#..##.#.#.',
  K: '#.##.###.#.##.#',
  L: '#..#..#..#..###',
  M: '#.########.##.#',
  N: '##.#.##.##.##.#',
  O: '.#.#.##.##.#.#.',
  P: '##.#.###.#..#..',
  Q: '.#.#.##.###..##',
  R: '##.#.###.#.##.#',
  S: '.###...#...###.',
  T: '###.#..#..#..#.',
  U: '#.##.##.##.####',
  V: '#.##.##.##.#.#.',
  W: '#.##.########.#',
  X: '#.##.#.#.#.##.#',
  Y: '#.##.#.#..#..#.',
  Z: '###..#.#.#..###',
  '0': '####.##.##.####',
  '1': '.#.##..#..#.###',
  '2': '##...#.#.#..###',
  '3': '##...#.#...###.',
  '4': '#.##.####..#..#',
  '5': '####..##...###.',
  '6': '.###..####.####',
  '7': '###..#.#..#..#.',
  '8': '####.#####.####',
  '9': '####.####..###.',
  '.': '.............#.',
  '!': '.#..#..#.....#.',
  '$': '.####..#..####.',
  '-': '......###......',
  ':': '....#.....#....',
  "'": '.#..#..........',
  ' ': '...............'
};

function ptextW(str, sc) { return (str.length * 4 - 1) * (sc || 1); }
/** Crisp pixel text. outline: colour of a 1px (x scale) outline. */
function ptext(g, str, x, y, col, sc, outline) {
  sc = sc || 1;
  str = String(str).toUpperCase();
  const draw = (ox, oy, c) => {
    g.fillStyle = c;
    for (let i = 0; i < str.length; i++) {
      const gl = FONT3[str[i]] || FONT3[' '];
      for (let p = 0; p < 15; p++) if (gl[p] === '#') g.fillRect(x + ox + (i * 4 + p % 3) * sc, y + oy + Math.floor(p / 3) * sc, sc, sc);
    }
  };
  if (outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]]) draw(dx * sc, dy * sc, outline);
  draw(0, 0, col);
  return ptextW(str, sc);
}

/** Filled pixel circle (crisp). */
function pcircle(g, cx, cy, r, col) {
  g.fillStyle = col;
  for (let dy = -r; dy <= r; dy++) {
    const w = Math.floor(Math.sqrt(r * r - dy * dy + r * 0.8));
    g.fillRect(cx - w, cy + dy, w * 2 + 1, 1);
  }
}
/** Draw a string bitmap (rows of chars) with a palette; '.' is transparent. */
function pbitmap(g, x, y, rows, pal, flip) {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let c = 0; c < row.length; c++) {
      const ch = row[flip ? row.length - 1 - c : c];
      if (ch === '.' || !pal[ch]) continue;
      g.fillStyle = pal[ch]; g.fillRect(x + c, y + r, 1, 1);
    }
  }
}
const SKULL = ['.kkkkk.', 'kwwwwwk', 'wkkwkkw', 'wkkwkkw', 'kwwkwwk', '.kwwwk.', '.kwkwk.'];
const SKULL_PAL = { k: '#111018', w: '#f4f4f8' };
const TRICORN = ['....kk....', '..kkhhkk..', '.khhhhhhk.', 'khhhhhhhhk', 'kkkkkkkkkk'];
const TRI_PAL = { k: '#111018', h: '#22212c' };
function pskull(g, x, y, hat) {
  if (hat) pbitmap(g, x - 1, y - 4, TRICORN, TRI_PAL);
  pbitmap(g, x + 1, y, SKULL, SKULL_PAL);
}
function pswords(g, cx, cy, s) {
  for (let i = -s; i <= s; i++) {
    pR(g, cx + i, cy + i, 1, 1, '#e8edf5'); pR(g, cx + i, cy - i, 1, 1, '#e8edf5');
  }
  pR(g, cx - s - 1, cy + s, 2, 2, '#ffd21a'); pR(g, cx + s, cy + s, 2, 2, '#ffd21a');
}

function seeded(x, y, s) { const n = Math.sin(x * 127.1 + y * 311.7 + (s || 0) * 74.7) * 43758.5453; return n - Math.floor(n); }

// ---- floors -------------------------------------------------------------
function paintFloorTile(g, x, y) {
  const i = idx(x, y), k = fkind[i], X = x * A, Y = y * A, t = tile[i];
  if (t === VOID || t === WALL || t === WIN || t === RAIL) return;
  if (t === DOOR && !doors[doorOf[i]].open) return;
  const v = seeded(x, y);
  switch (k) {
    case FK.CONC: case FK.HALL: {
      const base = k === FK.HALL ? (v > 0.8 ? '#c4c4cb' : '#cdcdd3') : (v > 0.78 ? '#bdbdc5' : '#c7c7ce');
      pR(g, X, Y, A, A, base);
      pR(g, X, Y, A - 1, 1, '#dadae0'); pR(g, X, Y, 1, A - 1, '#d4d4da');
      pR(g, X, Y + A - 1, A, 1, '#9b9ba6'); pR(g, X + A - 1, Y, 1, A, '#9b9ba6');
      if (seeded(x, y, 3) > 0.82) { // hairline crack
        let cx = X + 3 + Math.floor(seeded(x, y, 4) * 8), cy = Y + 3 + Math.floor(seeded(x, y, 5) * 6);
        for (let n = 0; n < 6; n++) { pR(g, cx, cy, 1, 1, '#8e8e99'); cx += seeded(n, x) > 0.5 ? 1 : 0; cy += 1; }
      }
      if (k === FK.HALL && y === 31) { pR(g, X, Y + 6, A, 1, '#f4f4f8'); pR(g, X, Y + 7, A, 2, '#c4142c'); pR(g, X, Y + 9, A, 1, '#f4f4f8'); }
      break;
    }
    case FK.CLASS:
      pR(g, X, Y, A, A, '#4c5272');
      for (let n = 0; n < 12; n++) pR(g, X + Math.floor(seeded(x + n, y) * 16), Y + Math.floor(seeded(x, y + n) * 16), 1, 1, n % 2 ? '#5a6084' : '#43486a');
      break;
    case FK.CAFE:
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        pR(g, X + a * 8, Y + b * 8, 8, 8, (x * 2 + a + y * 2 + b) % 2 ? '#c4283a' : '#efe7df');
      }
      pR(g, X, Y + A - 1, A, 1, 'rgba(0,0,0,0.12)');
      break;
    case FK.GYM:
      for (let p = 0; p < 4; p++) {
        pR(g, X, Y + p * 4, A, 4, ['#c98a4b', '#c28244', '#cf9455', '#c68848'][(y * 4 + p) % 4]);
        pR(g, X, Y + p * 4 + 3, A, 1, '#a96f37');
        const j = Math.floor(seeded(x, y * 4 + p) * 16);
        pR(g, X + j, Y + p * 4, 1, 3, '#a96f37');
      }
      break;
    case FK.LAB:
      pR(g, X, Y, A, A, '#dde5ea');
      pR(g, X, Y + 7, A, 1, '#aebdc8'); pR(g, X + 7, Y, 1, A, '#aebdc8'); pR(g, X, Y + 15, A, 1, '#aebdc8'); pR(g, X + 15, Y, 1, A, '#aebdc8');
      break;
    case FK.ROOF:
      pR(g, X, Y, A, A, '#4a4453');
      for (let n = 0; n < 14; n++) pR(g, X + Math.floor(seeded(x + n, y, 2) * 16), Y + Math.floor(seeded(x, y + n, 9) * 16), 1, 1, n % 2 ? '#5d5768' : '#3a3542');
      break;
  }
}
function paintFloorShadow(g, x, y) {
  const t = tAt(x, y);
  if (t !== FLOOR && t !== PROP) return;
  const X = x * A, Y = y * A;
  if (heightAt(x, y - 1) >= WH) { pR(g, X, Y, A, 3, 'rgba(25,0,35,0.28)'); pR(g, X, Y + 3, A, 2, 'rgba(25,0,35,0.12)'); }
  if (heightAt(x - 1, y) >= WH) pR(g, X, Y, 2, A, 'rgba(25,0,35,0.16)');
  if (heightAt(x + 1, y) >= WH) pR(g, X + A - 2, Y, 2, A, 'rgba(25,0,35,0.1)');
}

function paintEmblem(g, cx, cy) {
  // "WESTVALE HIGH PIRATES" crest (floor mural behind the statue)
  pcircle(g, cx, cy, 24, '#111018');
  pcircle(g, cx, cy, 23, '#f4f4f8');
  pcircle(g, cx, cy, 21, '#c4142c');
  pcircle(g, cx, cy, 17, '#a50f22');
  pswords(g, cx, cy + 3, 9);
  pskull(g, cx - 4, cy - 1, true);
  // ribbons
  for (const [ry, label, w] of [[cy - 27, 'WESTVALE HIGH', 60], [cy + 20, 'PIRATES', 40]]) {
    pR(g, cx - w / 2 - 1, ry - 1, w + 2, 9, '#111018');
    pR(g, cx - w / 2, ry, w, 7, '#f4f4f8');
    pR(g, cx - w / 2 - 4, ry + 2, 4, 5, '#d8d4d0'); pR(g, cx + w / 2, ry + 2, 4, 5, '#d8d4d0');
    ptext(g, label, cx - ptextW(label) / 2, ry + 1, '#c4142c');
  }
}

function renderFloor() {
  if (!floorCanvas) { floorCanvas = document.createElement('canvas'); floorCanvas.width = MW * A; floorCanvas.height = MH * A; }
  const g = floorCanvas.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, MW * A, MH * A);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) paintFloorTile(g, x, y);
  // lobby crest + painted floor lettering
  paintEmblem(g, 31 * A, 40 * A + 15);
  const txt1 = 'WESTVALE PIRATES';
  ptext(g, txt1, Math.round(30.5 * A - ptextW(txt1, 2) / 2), 43 * A + 6, '#f4f4f8', 2, '#c4142c');
  // gym court
  pR(g, 5 * A, 4 * A, 11 * A, 1, '#f4f4f8'); pR(g, 5 * A, 15 * A - 1, 11 * A, 1, '#f4f4f8');
  pR(g, 5 * A, 4 * A, 1, 11 * A, '#f4f4f8'); pR(g, 16 * A - 1, 4 * A, 1, 11 * A, '#f4f4f8');
  pR(g, 5 * A, Math.round(9.5 * A), 11 * A, 1, '#f4f4f8');
  pcircle(g, Math.round(10.5 * A), Math.round(9.5 * A), 20, '#f4f4f8');
  pcircle(g, Math.round(10.5 * A), Math.round(9.5 * A), 18, '#c4142c');
  pskull(g, Math.round(10.5 * A) - 4, Math.round(9.5 * A) - 3, true);
  ptext(g, 'PIRATES', Math.round(10.5 * A - ptextW('PIRATES', 2) / 2), 12 * A + 4, '#f4f4f8', 2, '#c4142c');
  ptext(g, 'NO RUNNING', Math.round(10.5 * A - ptextW('NO RUNNING') / 2), 26 * A + 6, '#c4142c', 1, '#f4f4f8');
  // science-wing hazard stripe
  for (let x = 45; x < 59; x++) for (let n = 0; n < 8; n++) pR(g, x * A + n * 2, 15 * A, 2, 2, n % 2 ? '#111018' : '#ffd21a');
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) paintFloorShadow(g, x, y);
}

function repaintFloorTiles(list) {
  const g = floorCanvas.getContext('2d');
  for (const [x, y] of list) { paintFloorTile(g, x, y); paintFloorShadow(g, x, y); paintFloorShadow(g, x, y + 1); }
}

// ---- walls --------------------------------------------------------------
function frontStyle(x, r) {
  const s = tAt(x, r + 1);
  if (s === VOID) return 'brick';
  if (s !== FLOOR && s !== PROP) return 'brick';
  const k = fkind[idx(x, r + 1)];
  if (k === FK.CONC || k === FK.HALL) return 'locker';
  if (k === FK.ROOF) return 'brick';
  return 'plaster';
}
function brickBand(g, X, Y, h) {
  pR(g, X, Y, A, h, '#b8202e');
  for (let row = 0; row * 3 < h; row++) {
    pR(g, X, Y + row * 3 + 2, A, 1, '#7d1424');
    const off = row % 2 ? 0 : 4;
    for (let c = off; c < A; c += 8) pR(g, X + c, Y + row * 3, 1, 2, '#7d1424');
    if ((row + X / A) % 3 === 0) pR(g, X + ((row * 5) % 12) + 1, Y + row * 3, 3, 1, '#cf3542');
  }
}
function lockerPair(g, X, Y, h) {
  for (let n = 0; n < 2; n++) {
    const lx = X + n * 8;
    pR(g, lx, Y, 8, h, '#c81f2c');
    pR(g, lx, Y, 1, h, '#e4505c'); pR(g, lx + 6, Y, 1, h, '#8a1420'); pR(g, lx + 7, Y, 1, h, '#3a0610');
    for (let v = 0; v < 3; v++) pR(g, lx + 2, Y + 2 + v * 2, 4, 1, '#7e0f18');
    pR(g, lx + 5, Y + Math.floor(h * 0.5), 1, 2, '#f2d6d8');
    pR(g, lx + 1, Y + h - 2, 6, 1, '#a51a26');
  }
}

/** Multi-tile wall decorations, drawn in absolute art coords and clipped to one tile's front. */
function paintDecor(g, d, X, Y, h) {
  const x0 = d.x0 * A;
  switch (d.k) {
    case 'sign': {
      const w = ptextW(d.text) + 6, sx = Math.round(x0 + (d.span * A - w) / 2);
      pR(g, sx - 1, Y + 1, w + 2, 9, '#111018'); pR(g, sx, Y + 2, w, 7, '#f4f4f8');
      ptext(g, d.text, sx + 3, Y + 3, '#b8202e');
      break;
    }
    case 'banner': { // HOME OF THE PIRATES
      const bx = x0 + 2, bw = d.span * A - 4, top = Y + 2, bh = h - 4;
      pR(g, bx - 2, top, bw + 4, 2, '#5a3a1a'); pR(g, bx - 3, top, 2, 2, '#ffd21a'); pR(g, bx + bw + 1, top, 2, 2, '#ffd21a');
      pR(g, bx - 1, top + 2, bw + 2, bh - 6, '#111018');
      pR(g, bx, top + 2, bw, bh - 7, '#c4142c');
      for (let i = 0; i < bw / 2; i++) { pR(g, bx + i, top + bh - 5 + Math.floor(i / 3), 1, 1, '#c4142c'); pR(g, bx + bw - 1 - i, top + bh - 5 + Math.floor(i / 3), 1, 1, '#c4142c'); }
      pR(g, bx + 1, top + 3, bw - 2, 1, '#e8d8a8');
      ptext(g, 'HOME OF', bx + Math.round((bw - ptextW('HOME OF')) / 2), top + 5, '#f4f4f8');
      pswords(g, bx + bw / 2, top + 17, 6);
      pskull(g, bx + bw / 2 - 4, top + 13, false);
      ptext(g, 'PIRATES', bx + Math.round((bw - ptextW('PIRATES')) / 2), top + 23, '#f4f4f8');
      break;
    }
    case 'board': { // bulletin board with flyers
      const bx = x0 + 2, bw = d.span * A - 4, top = Y + 10, bh = h - 14;
      pR(g, bx - 1, top - 1, bw + 2, bh + 2, '#111018'); pR(g, bx, top, bw, bh, '#8a5a2b'); pR(g, bx + 1, top + 1, bw - 2, bh - 2, '#b8844a');
      for (let n = 0; n < 10; n++) pR(g, bx + 1 + Math.floor(seeded(n, d.x0) * (bw - 2)), top + 1 + Math.floor(seeded(d.x0, n) * (bh - 2)), 1, 1, '#9a6a36');
      pR(g, bx + 2, top + 2, 9, 7, '#f4f4f8'); ptext(g, 'AV', bx + 3, top + 3, '#2a3a8a');
      pR(g, bx + 12, top + 2, 8, 9, '#b07ae8'); pR(g, bx + 14, top + 5, 4, 3, '#f4f4f8');
      pR(g, bx + 21, top + 2, 7, 9, '#fff3c4'); pR(g, bx + 22, top + 4, 5, 1, '#c4142c'); pR(g, bx + 22, top + 6, 4, 1, '#c4142c');
      pR(g, bx + 4, top + 1, 1, 1, '#c4142c'); pR(g, bx + 15, top + 1, 1, 1, '#ffd21a'); pR(g, bx + 24, top + 1, 1, 1, '#2a8aff');
      break;
    }
    case 'extinguisher': {
      const ex = x0 + 6;
      pR(g, ex - 1, Y + 11, 6, 13, '#111018'); pR(g, ex, Y + 12, 4, 11, '#d01a24'); pR(g, ex, Y + 12, 1, 11, '#ef5560');
      pR(g, ex + 1, Y + 9, 2, 3, '#2a2a2a'); pR(g, ex + 3, Y + 9, 3, 1, '#2a2a2a'); pR(g, ex + 5, Y + 10, 1, 6, '#2a2a2a');
      pR(g, ex, Y + 15, 4, 3, '#f4f4f8');
      break;
    }
    case 'poster_club': {
      const px = x0 + 2;
      pR(g, px - 1, Y + 9, 14, 17, '#111018'); pR(g, px, Y + 10, 12, 15, '#f4f4f8');
      pR(g, px + 1, Y + 11, 10, 3, '#2a3a8a'); ptext(g, 'PC', px + 3, Y + 15, '#2a3a8a');
      pR(g, px + 3, Y + 20, 6, 4, '#4a4f5a'); pR(g, px + 4, Y + 21, 4, 2, '#7ae8ff');
      break;
    }
    case 'poster_school': {
      const px = x0 + 2;
      pR(g, px - 1, Y + 9, 14, 17, '#111018'); pR(g, px, Y + 10, 12, 15, '#fff3c4');
      pR(g, px + 1, Y + 11, 10, 3, '#c4142c');
      pR(g, px + 2, Y + 16, 3, 5, '#7a4ad0'); pR(g, px + 6, Y + 16, 4, 5, '#4a4f5a');
      break;
    }
    case 'chalk': {
      pR(g, X, Y + 9, A, h - 13, '#7a5530');
      pR(g, X + (d.first ? 1 : 0), Y + 10, A - (d.first ? 1 : 0) - (d.last ? 1 : 0), h - 15, '#24503a');
      if (seeded(d.x0 + X, 1) > 0.4) { pR(g, X + 3, Y + 13, 7, 1, '#d8e8d8'); pR(g, X + 3, Y + 16, 5, 1, '#d8e8d8'); }
      else { pcircle(g, X + 8, Y + 16, 2, '#d8e8d8'); pcircle(g, X + 8, Y + 16, 1, '#24503a'); }
      break;
    }
    case 'menu': {
      pR(g, X + 1, Y + 10, A - 2, 12, '#111018');
      pR(g, X + 3, Y + 12, 8, 1, ['#ff5a6e', '#ffd21a', '#7ae8ff', '#9dff3c'][d.i % 4]); pR(g, X + 3, Y + 15, 6, 1, '#f4f4f8'); pR(g, X + 11, Y + 12, 2, 1, '#f4f4f8');
      break;
    }
    case 'gymbanner': {
      pR(g, X, Y + 6, A, 11, d.i % 2 ? '#c4142c' : '#f4f4f8');
      pR(g, X, Y + 5, A, 1, '#111018'); pR(g, X, Y + 17, A, 1, '#111018');
      const label = 'WESTVALE PIRATES';
      ptext(g, label, x0 + Math.round((d.span * A - ptextW(label)) / 2), Y + 9, '#ffd21a', 1, '#111018');
      break;
    }
    case 'periodic': {
      pR(g, X + 1, Y + 9, A - 2, 13, '#111018'); pR(g, X + 2, Y + 10, A - 4, 11, '#f4f4f8');
      const cols = ['#ff5a6e', '#7ae8ff', '#ffd21a', '#9dff3c', '#c77dff'];
      for (let r = 0; r < 4; r++) for (let c = 0; c < 5; c++) pR(g, X + 3 + c * 2, Y + 11 + r * 2, 1, 1, cols[(r + c) % 5]);
      break;
    }
  }
}

function paintWallTile(g, x, r, y0, t) {
  const X = x * A, ty = r * A - WHA - y0, fy = ty + A;
  const north = tAt(x, r - 1), south = tAt(x, r + 1);
  const hasFront = !wallish(south);
  const mass = wallish(north) && wallish(south);
  // top face
  if (t === DOOR) pR(g, X, ty, A, A, '#a51a26');
  else if (mass) {
    pR(g, X, ty, A, A, '#5a1824');
    for (let n = 0; n < 4; n++) { pR(g, X, ty + n * 4 + 3, A, 1, '#45111b'); pR(g, X + ((n * 6 + x * 3) % 14), ty + n * 4, 2, 1, '#6e2230'); }
  } else {
    pR(g, X, ty, A, A, '#d8d2ce'); pR(g, X + 1, ty + 1, A - 2, A - 2, '#e6e1dd');
    pR(g, X, ty + A - 3, A, 1, '#c4142c');
  }
  if (t === WIN && wallish(south)) { pR(g, X + 3, ty + 3, 10, 10, '#e6e1dd'); pR(g, X + 4, ty + 4, 8, 8, '#140a18'); }
  // front face
  if (hasFront) {
    const st = frontStyle(x, r);
    if (t === DOOR) {
      pR(g, X, fy, A, WHA, '#f4f4f8');
      pR(g, X + 1, fy + 1, A - 2, WHA - 2, '#c81f2c');
      pR(g, X + 1, fy + 1, 1, WHA - 2, '#e4505c');
      pR(g, X + 4, fy + 4, 8, 6, '#111018'); pR(g, X + 5, fy + 5, 6, 4, '#2a3550'); pR(g, X + 5, fy + 5, 2, 1, '#7a8ab0');
      pR(g, X + (x % 2 ? 2 : 12), fy + 15, 2, 3, '#ffd21a');
      pR(g, X + 2, fy + WHA - 4, A - 4, 1, '#8a1420');
    } else if (st === 'brick') {
      brickBand(g, X, fy, WHA); pR(g, X, fy, A, 1, '#f2ece6');
    } else if (st === 'locker') {
      brickBand(g, X, fy, 9); pR(g, X, fy, A, 1, '#f2ece6');
      pR(g, X, fy + 9, A, 1, '#5a0a14');
      const hasDecor = decor.some(d => d.x === x && d.y === r && d.k !== 'sign');
      if (hasDecor || t === WIN) pR(g, X, fy + 10, A, WHA - 12, '#e2ddd8');
      else lockerPair(g, X, fy + 10, WHA - 12);
      pR(g, X, fy + WHA - 2, A, 2, '#5a0a14');
    } else {
      pR(g, X, fy, A, WHA, '#e6e1dc');
      pR(g, X, fy, A, 1, '#f4f4f8');
      pR(g, X, fy + WHA - 7, A, 5, '#c4142c'); pR(g, X, fy + WHA - 8, A, 1, '#8a1420');
      pR(g, X, fy + WHA - 2, A, 2, '#5a0a14');
    }
    for (const d of decor) if (d.x === x && d.y === r) {
      g.save(); g.beginPath(); g.rect(X, fy, A, WHA); g.clip(); paintDecor(g, d, X, fy, WHA); g.restore();
    }
    const wb = wallbuys.find(b => b.tx === x && b.ty === r);
    if (wb) g.drawImage(chalkSprite(wb.w), X - 4, fy + 11);
    if (t === WIN) {
      pR(g, X + 2, fy + 8, 12, WHA - 12, '#e8e1dc'); pR(g, X + 3, fy + 9, 10, WHA - 14, '#140a18');
    }
  }
  // ink outlines on outer edges
  const nW = wallish(tAt(x - 1, r)), nE = wallish(tAt(x + 1, r));
  if (!wallish(north)) pR(g, X, ty, A, 1, '#111018');
  const sideH = hasFront ? A + WHA : A;
  if (!nW) pR(g, X, ty, 1, sideH, '#111018');
  if (!nE) pR(g, X + A - 1, ty, 1, sideH, '#111018');
  if (hasFront) { pR(g, X, fy, A, 1, '#111018'); pR(g, X, fy + WHA - 1, A, 1, '#111018'); }
}

// ---- props ----------------------------------------------------------------
const PROP_HA = { 1: 5, 2: 6, 3: 5, 4: 9, 5: 6, 6: 0, 7: 6, 8: 7, 9: 4, 10: 0, 11: 0, 12: 15 };
function pblock(g, x, r, y0, h, top, front, k) {
  const X = x * A, ty = r * A - h - y0, fy = ty + A;
  const same = (dx, dy) => tAt(x + dx, r + dy) === PROP && propK[idx(x + dx, r + dy)] === k;
  const hasFront = !same(0, 1);
  pR(g, X, ty, A, A, top);
  if (hasFront) pR(g, X, fy, A, h, front);
  if (!same(0, -1)) pR(g, X, ty, A, 1, '#111018');
  if (!same(-1, 0)) pR(g, X, ty, 1, hasFront ? A + h : A, '#111018');
  if (!same(1, 0)) pR(g, X + A - 1, ty, 1, hasFront ? A + h : A, '#111018');
  if (hasFront) { pR(g, X, fy, A, 1, '#111018'); pR(g, X, fy + h - 1, A, 1, '#111018'); }
  return { X, ty, fy, hasFront, same };
}
function paintPropTile(g, x, r, y0) {
  const k = propK[idx(x, r)], h = PROP_HA[k];
  if (!h) return;
  switch (k) {
    case PK.DESK: { const b = pblock(g, x, r, y0, h, '#d9a066', '#8a5a2b', k); pR(g, b.X + 3, b.ty + 4, 5, 4, '#f4f4f8'); pR(g, b.X + 10, b.ty + 6, 3, 1, '#ffd21a'); break; }
    case PK.TDESK: { const b = pblock(g, x, r, y0, h, '#8a4f2a', '#5a301a', k); if (!b.same(-1, 0)) { pR(g, b.X + 5, b.ty + 5, 3, 3, '#d01a24'); pR(g, b.X + 6, b.ty + 4, 1, 1, '#3a8a3a'); } break; }
    case PK.CTABLE: { const b = pblock(g, x, r, y0, h, '#f2f0ee', '#8a8f9a', k); pR(g, b.X, b.ty + 12, A, 1, '#c4142c'); if ((x + r) % 2) { pR(g, b.X + 5, b.ty + 4, 5, 4, '#ffd21a'); pR(g, b.X + 6, b.ty + 5, 3, 2, '#d08a2a'); } break; }
    case PK.BLEACH: { const b = pblock(g, x, r, y0, h, '#b9bec9', '#6b7180', k); for (let n = 0; n < 4; n++) pR(g, b.X + 1, b.ty + n * 4 + 1, A - 2, 2, n % 2 ? '#c4142c' : '#ece6e1'); break; }
    case PK.LABT: { const b = pblock(g, x, r, y0, h, '#2b2f3a', '#1a1d25', k); if (seeded(x, r) > 0.5) { pR(g, b.X + 6, b.ty + 4, 4, 6, '#111018'); pR(g, b.X + 7, b.ty + 6, 2, 3, '#7ae8ff'); } else { pR(g, b.X + 4, b.ty + 5, 8, 5, '#c9d2e3'); } break; }
    case PK.VENT: { const b = pblock(g, x, r, y0, h, '#8b93a3', '#5e6574', k); pR(g, b.X + 3, b.ty + 3, 10, 1, '#5e6574'); pR(g, b.X + 3, b.ty + 6, 10, 1, '#5e6574'); pR(g, b.X + 3, b.ty + 9, 10, 1, '#5e6574'); break; }
    case PK.TCASE: {
      // trophy case: wood frame, glass front, gold + silver cups
      const b = pblock(g, x, r, y0, h, '#7a4a24', '#5a3418', k);
      pR(g, b.X + 1, b.ty + 2, A - 2, A - 4, '#9a6232');
      if (b.hasFront) {
        pR(g, b.X + 2, b.fy + 2, A - 4, h - 4, '#a8d0e0');
        pR(g, b.X + 3, b.fy + 3, 1, 4, '#e8f6ff'); pR(g, b.X + 4, b.fy + 3, 1, 2, '#e8f6ff');
        const gold = seeded(x, r) > 0.35;
        const c = gold ? '#ffd21a' : '#d8dde6', d2 = gold ? '#c99a10' : '#9aa3b2';
        pR(g, b.X + 6, b.fy + 4, 5, 3, c); pR(g, b.X + 5, b.fy + 4, 1, 2, c); pR(g, b.X + 11, b.fy + 4, 1, 2, c);
        pR(g, b.X + 8, b.fy + 7, 1, 2, d2); pR(g, b.X + 6, b.fy + 9, 5, 2, d2);
        pR(g, b.X + 2, b.fy + h - 3, A - 4, 1, '#5a3418');
      }
      break;
    }
  }
}

function paintRailTile(g, x, r, y0) {
  const X = x * A, ty = r * A - 4 - y0;
  const horiz = [-1, 1].some(dx => tAt(x + dx, r) === RAIL || tAt(x + dx, r) === WIN);
  if (horiz) { pR(g, X, ty + 8, A, 3, '#111018'); pR(g, X, ty + 9, A, 1, '#c9d2e3'); pR(g, X + 7, ty + 8, 2, 8, '#111018'); pR(g, X + 7, ty + 9, 1, 6, '#9aa3b2'); }
  else { pR(g, X + 7, ty, 3, A, '#111018'); pR(g, X + 8, ty, 1, A, '#c9d2e3'); }
}

function renderStrip(r) {
  let c = strips[r];
  if (!c) { c = strips[r] = document.createElement('canvas'); c.width = MW * A; c.height = A + PADA; }
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.clearRect(0, 0, c.width, c.height);
  const y0 = r * A - PADA;
  for (let x = 0; x < MW; x++) {
    const t = tAt(x, r);
    if (t === FLOOR || t === VOID) continue;
    if (t === PROP) paintPropTile(g, x, r, y0);
    else if (t === RAIL) paintRailTile(g, x, r, y0);
    else paintWallTile(g, x, r, y0, t);
  }
  // school name painted across the big central roof
  if (r >= 2 && r <= 17) {
    g.save(); g.beginPath(); g.rect(19 * A, PADA - WHA, 26 * A, A); g.clip();
    g.translate(0, -(r * A - PADA) - WHA);
    ptext(g, 'WESTVALE', Math.round(31.5 * A - ptextW('WESTVALE', 5) / 2), 4 * A, '#f4efe9', 5, '#111018');
    ptext(g, 'HIGH SCHOOL', Math.round(31.5 * A - ptextW('HIGH SCHOOL', 3) / 2), 8 * A + 4, '#ff2a55', 3, '#111018');
    pskull(g, Math.round(31.5 * A) - 4, 12 * A, true);
    g.restore();
  }
}
function renderAllStrips() { for (let r = 0; r < MH; r++) renderStrip(r); }

// ---- baked sprites (vector art rendered once at art resolution, alpha hardened) --------------
/** Render fn (drawing in its own pixel coords) into a w x h art canvas, then make alpha 0/255 so edges stay crisp. */
function bake(w, h, fn) {
  const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h));
  const g = c.getContext('2d');
  fn(g);
  try {
    const im = g.getImageData(0, 0, c.width, c.height), d = im.data;
    for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= 110 ? 255 : 0;
    g.putImageData(im, 0, 0);
  } catch (e) {}
  return c;
}
/** Run a vector draw routine (which uses the global ctx) into a baked art sprite. */
function bakeVector(w, h, setup, fn) {
  return bake(w, h, g => {
    const saved = ctx; ctx = g;
    g.setTransform(1, 0, 0, 1, 0, 0); setup(g);
    baking = true;
    try { fn(); } finally { baking = false; ctx = saved; }
  });
}
let baking = false;
const _chalk = {};
function chalkSprite(id) {
  if (_chalk[id]) return _chalk[id];
  return (_chalk[id] = bakeVector(24, 12, g => { g.translate(2, 6); g.scale(0.36, 0.36); }, () => drawGun(ctx, id, { chalk: true, lw: 2.6 })));
}

// ---- statue: Capt. Westvale with anchor (hand-placed pixels) ----------------
let statueArt = null;
function buildStatue() {
  const W2 = 40, H2 = 70;
  statueArt = document.createElement('canvas'); statueArt.width = W2; statueArt.height = H2;
  const g = statueArt.getContext('2d');
  const K = '#111018', s1 = '#c4c8d0', s2 = '#9aa0a8', s3 = '#6e7480';
  // pedestal (bottom)
  pR(g, 4, 50, 32, 20, K); pR(g, 5, 51, 30, 4, '#e6e6ec'); pR(g, 5, 55, 30, 14, '#c9c9d2'); pR(g, 27, 55, 8, 14, '#a9a9b4');
  pR(g, 8, 58, 24, 8, '#b5b5c0'); pR(g, 8, 58, 24, 1, '#9a9aa6');
  // boots + legs
  pR(g, 14, 44, 5, 7, K); pR(g, 21, 44, 5, 7, K); pR(g, 15, 45, 3, 5, s3); pR(g, 22, 45, 3, 5, s3);
  pR(g, 14, 37, 12, 8, K); pR(g, 15, 38, 4, 7, s2); pR(g, 21, 38, 4, 7, s2);
  // red cape (behind body, flowing right)
  pR(g, 22, 22, 13, 20, K); pR(g, 23, 23, 11, 18, '#c4142c'); pR(g, 30, 25, 4, 15, '#8a0d1f'); pR(g, 33, 28, 3, 10, K);
  // coat
  pR(g, 12, 22, 16, 17, K); pR(g, 13, 23, 14, 15, s2); pR(g, 13, 23, 4, 15, s1); pR(g, 19, 23, 2, 15, s3);
  pR(g, 13, 32, 14, 2, '#4a4f5a'); pR(g, 19, 32, 2, 2, '#ffd21a');
  // left arm down to the anchor
  pR(g, 8, 24, 5, 12, K); pR(g, 9, 25, 3, 10, s2);
  // anchor
  pR(g, 5, 26, 3, 24, K); pR(g, 6, 27, 1, 22, '#4a4f5a');
  pR(g, 3, 29, 7, 3, K); pR(g, 4, 30, 5, 1, '#4a4f5a');
  pR(g, 4, 23, 5, 4, K); pR(g, 5, 24, 3, 2, '#4a4f5a'); pR(g, 6, 24, 1, 1, K);
  for (let i = 0; i < 5; i++) { pR(g, 1 + i, 45 + Math.floor(i / 2), 2, 2, K); pR(g, 9 - i, 45 + Math.floor(i / 2), 2, 2, K); }
  pR(g, 0, 43, 2, 3, K); pR(g, 10, 43, 2, 3, K);
  // right arm raised with cutlass
  pR(g, 26, 14, 5, 10, K); pR(g, 27, 15, 3, 8, s2);
  pR(g, 26, 11, 6, 4, K); pR(g, 27, 12, 4, 2, '#ffd21a');
  for (let i = 0; i < 10; i++) { pR(g, 29 + Math.floor(i * 0.5), 10 - i, 3, 2, K); pR(g, 30 + Math.floor(i * 0.5), 10 - i, 1, 1, '#e8edf5'); }
  // head + tricorn
  pR(g, 14, 12, 12, 11, K); pR(g, 15, 13, 10, 9, s1); pR(g, 21, 13, 4, 9, s2);
  pR(g, 17, 16, 2, 2, s3); pR(g, 22, 16, 2, 2, s3); pR(g, 18, 20, 5, 1, s3);
  pR(g, 11, 9, 18, 5, K); pR(g, 12, 10, 16, 3, '#22212c'); pR(g, 15, 6, 10, 4, K); pR(g, 16, 7, 8, 3, '#22212c');
  pbitmap(g, 17, 7, ['.www.', 'wkwkw', '.www.'], { w: '#f4f4f8', k: '#111018' });
}

// ---- pixel Goza (hand-made 16x28 sprite: front / back / side, 4-frame walk) ----------
const GOZA_PX = {"PAL": {"k": "#111018", "h": "#1c1c26", "H": "#3c3c52", "r": "#c4142c", "R": "#8a0d1f", "s": "#eab890", "S": "#c98e66", "w": "#f4f4f8", "b": "#22212c", "B": "#3a3848", "m": "#d4142f", "p": "#6a34b0", "P": "#4a2280", "v": "#8a4ad0", "e": "#000000"}, "FRONT": ["....k..k...k....", "...khk.khk.khk..", "..khhhkhhhkhhhk.", ".khhhhhhhhhhhhhk", "khhHhhhhhhhHhhhk", "khhhhhhhhhhhhhhk", "krrrrrrrrrrrrrrk", "kRrrrrrrrrrrrrRk", "khsssssssssssshk", "khseesssssseeshk", "khsewsssssseswhk", ".kssssssssssssk.", ".kSsssseessssSk.", "..kSSSSSSSSSSk..", ".kbbbbbbbbbbbbk.", "kbbBbbbbbbbbBbbk", "kbBbbmbbbbmbbBbk", "kbBbbmmmmmmbbBbk", "kwbbbmkmmkmbbbwk", "kvbbbbmmmmbbbbvk", "ksbbbbbbbbbbbbsk", "kkrrrrrrrrrrrrkk", ".kPPPPPPPPPPPPk."], "BACK": ["....k..k...k....", "...khk.khk.khk..", "..khhhkhhhkhhhk.", ".khhhhhhhhhhhhhk", "khhHhhhhhhhHhhhk", "khhhhhhhhhhhhhhk", "krrrrrrrrrrrrrrk", "kRrrrrrrrrrrrrRk", "khhhhhhrrhhhhhhk", "khhhhhrRRrhhhhhk", "khhHhhrhhrhhhhhk", ".khhhhrhhrhhhhk.", ".khhhhhhhhhhhhk.", "..kSSSSSSSSSSk..", ".kbbbbbbbbbbbbk.", "kbbBbbbbbbbbBbbk", "kbBbbmbbbbmbbBbk", "kbBbbmmmmmmbbBbk", "kwbbbmkmmkmbbbwk", "kvbbbbmmmmbbbbvk", "ksbbbbbbbbbbbbsk", "kkrrrrrrrrrrrrkk", ".kPPPPPPPPPPPPk."], "SIDE": [".....k..k..k....", "....khk.khkkhk..", "...khhhkhhhhhhk.", "..khhhhhhhhhhhhk", ".khhhHhhhhhhhhhk", "khhhhhhhhhhhhhk.", "rrkrrrrrrrrrrrk.", "rRkRrrrrrrrrrrk.", ".rkhhhhhhssssk..", "..khhhhhsssesk..", "..khhhhsssssssk.", "...khhsssssssk..", "...khSsssseesk..", "....kSSSSSSSk...", "...kbbbbbbbbk...", "..kbbbbbbbbbbk..", "..kbbBbbbbbbmbk.", "..kbbBbbbmmmbk..", "..kbbBwbbbbbbk..", "..kbbBvbbbbbbk..", "..kbbbsbbbbbbk..", "..kkrrrrrrrrkk..", "...kPPPPPPPPk..."], "LEGS_F": [["...kppppkppppk..", "...kppppkppppk..", "...kPPPPkPPPPk..", "..kwwwwwkwwwwwk.", "..kkkkkkkkkkkkk."], ["...kppppkppppk..", "...kppppkPPPPk..", "..kwwwwwkPPPPk..", "..kkkkkkkwwwwwk.", "........kkkkkkk."], ["...kppppkppppk..", "...kppppkppppk..", "...kPPPPkPPPPk..", "..kwwwwwkwwwwwk.", "..kkkkkkkkkkkkk."], ["...kppppkppppk..", "...kPPPPkppppk..", "...kPPPPkwwwwwk.", "..kwwwwwkkkkkkk.", "..kkkkkkk......."]], "LEGS_S": [["....kppppppk....", "....kppppppk....", "....kPPPPPPk....", "....kwwwwwwwk...", "....kkkkkkkkk..."], ["...kpppkppppk...", "..kpppk.kppppk..", "..kPPPk..kPPPPk.", ".kwwwwk..kwwwwwk", ".kkkkk....kkkkkk"], ["....kppppppk....", "....kppppppk....", "....kPPPPPPk....", "....kwwwwwwwk...", "....kkkkkkkkk..."], ["...kppppkpppk...", "..kppppk.kpppk..", ".kPPPPk..kPPPk..", "kwwwwwk..kwwwwk.", "kkkkkk....kkkkk."]]};
const gozaFrames = {};
function buildGoza() {
  const D = GOZA_PX;
  for (const [dir, body, legs] of [['down', D.FRONT, D.LEGS_F], ['up', D.BACK, D.LEGS_F], ['side', D.SIDE, D.LEGS_S]]) {
    gozaFrames[dir] = legs.map(l => {
      const c = document.createElement('canvas'); c.width = 16; c.height = 28;
      pbitmap(c.getContext('2d'), 0, 0, body.concat(l), D.PAL);
      return c;
    });
  }
}

// =======================================================================
// FX POOLS (shared by weapons, zombies, power-ups)
// =======================================================================
let parts = [], tracers = [], rings = [], texts = [], slashes = [], trails = [], shocks = [], fields = [], projectiles = [], clouds = [];
function part(x, y, vx, vy, life, size, color, kind, extra) {
  if (parts.length > 700) parts.shift();
  const p = { x, y, vx, vy, life, max: life, size, color, kind: kind || 'dot', z: 0, vz: 0, rot: rand(0, TAU), vr: rand(-8, 8) };
  if (extra) Object.assign(p, extra);
  parts.push(p);
  return p;
}
function ring(x, y, r0, r1, life, color, width, opts) { rings.push(Object.assign({ x, y, r0, r1, life, max: life, color, width: width || 4 }, opts || {})); }
function worldText(x, y, str, color, size, life, opts) { texts.push(Object.assign({ x, y, str, color, size, life: life || 0.8, max: life || 0.8, vy: -50, rot: rand(-0.15, 0.15) }, opts || {})); }
function tracer(x1, y1, x2, y2, color, w, life, style) { tracers.push({ x1, y1, x2, y2, color, w, life, max: life, style: style || 'line', seed: Math.random() * 1000 }); }
function cloud(x, y, r, color, life, vx, vy) { if (clouds.length > 120) clouds.shift(); clouds.push({ x, y, r, color, life, max: life, vx: vx || 0, vy: vy || -10 }); }

// =======================================================================
// WEAPON DEFINITIONS
// =======================================================================
const WEAP = {
  revolver: { name: 'AURA-REVOLVER .44', kind: 'ray', dmg: 120, mag: 6, reserve: 36, rpm: 180, auto: false, reload: 2.0, spread: 0.015, pierce: 2, range: 1100, kb: 340, tracer: '#f2f6ff', tw: 3.5, hs: 1.6, muzzle: 33, shake: 5, trait: 'Heavy knockback. Reload = 360° flashbang.' },
  kuro: { name: 'KURO-80 "BLACKOUT"', kind: 'ray', dmg: 52, mag: 30, reserve: 240, rpm: 650, burstRpm: 1200, auto: true, reload: 2.2, spread: 0.045, pierce: 1, range: 1300, kb: 30, tracer: '#3aa0ff', tw: 3, hs: 1.5, muzzle: 35, shake: 2, trait: 'Hyper-burst opener. Hits implode foes inward.' },
  vector: { name: 'NEON VECTOR-9', kind: 'ray', dmg: 32, mag: 33, reserve: 264, rpm: 1110, auto: true, reload: 1.8, spread: 0.08, pierce: 1, range: 900, kb: 15, tracer: '#ff2bd6', tw: 2.5, hs: 1.5, muzzle: 27, shake: 1.5, trait: 'Sustained fire: +25% speed, neon floor trail.' },
  raijin: { name: 'RAIJIN 50-CAL', kind: 'ray', dmg: 1100, mag: 5, reserve: 30, rpm: 48, auto: false, reload: 3.0, spread: 0, pierce: 8, range: 2400, kb: 220, tracer: '#ffe14d', tw: 7, hs: 2, muzzle: 53, shake: 16, trait: 'Pierces 8. Leaves a lingering shock arc.' },
  sweeper: { name: 'BRIMSTONE SWEEPER', kind: 'pellet', pellets: 8, dmg: 55, mag: 12, reserve: 72, rpm: 300, auto: false, reload: 2.6, spread: 0.32, pierce: 1, range: 520, kb: 110, tracer: '#ff8a1f', hs: 1.2, muzzle: 31, shake: 8, trait: 'Close kills explode into fiery dust.' },
  giga: { name: 'GIGA-HAMMER 100', kind: 'ray', dmg: 60, mag: 0, reserve: 500, rpm: 950, auto: true, reload: 0, noReload: true, spread: 0.07, pierce: 2, range: 1300, kb: 45, tracer: '#ffcc33', tw: 2.5, hs: 1.3, muzzle: 35, shake: 2, trait: 'Belt-fed, no reload. Overheats after 7s.' },
  ronin: { name: 'RONIN DMR', kind: 'ray', dmg: 160, mag: 20, reserve: 120, rpm: 420, auto: false, reload: 2.4, spread: 0.008, pierce: 3, range: 1800, kb: 90, tracer: '#ffffff', tw: 3, hs: 2, muzzle: 41, shake: 4, trait: '3 headshots in a row: +3 rounds & shockwave.' },
  katsu: { name: 'KATSU-RPG "SUPERNOVA"', kind: 'rocket', dmg: 900, mag: 1, reserve: 12, rpm: 15, auto: false, reload: 3.0, muzzle: 43, shake: 8, trait: 'Rockets split into 3 seeking bomblets.' },
  blade: { name: 'DRAGONSLAYER BLADE', kind: 'melee', dmg: 320, rpm: 140, mag: 0, reserve: 0, noReload: true, muzzle: 50, trait: 'Right-click / LUNGE: 6m invulnerable dash.' },
  chronos: { name: 'CHRONOS CANNON', kind: 'chronos', dmg: 320, mag: 24, reserve: 96, rpm: 800, burst: 3, burstDelay: 0.6, auto: true, reload: 2.6, muzzle: 35, shake: 3, trait: 'Freezes time 3s, then all damage detonates.' }
};
const BOX_POOL = [['revolver', 1], ['kuro', 1], ['vector', 1], ['raijin', 0.8], ['sweeper', 1], ['giga', 0.8], ['ronin', 1], ['katsu', 0.8], ['blade', 0.8], ['chronos', 0.45]];

// =======================================================================
// GUN ART (side-view silhouettes, pointing +x, grip at origin)
// part: [type, ...geometry, fill, flags]  flags: 'm' magazine, 's' slide
// =======================================================================
const GUN_ART = {
  revolver: [['p', [[-2, 0], [4, 0], [2, 12], [-6, 12]], '#7a2c1c'], ['p', [[-5, -4], [10, -4], [10, 2], [2, 3], [-5, 0]], '#c9ced8'], ['c', 6, -1, 4.5, '#9aa3b2', 'm'], ['r', 10, -5, 23, 5, '#eef2f8'], ['r', 10, -7, 23, 2, '#aab3c2'], ['r', -7, -7, 4, 3, '#555', 's'], ['r', 30, -9, 2, 2, '#ff2a55']],
  kuro: [['p', [[-19, -3], [-4, -4], [-4, 3], [-17, 7]], '#1c1c22'], ['r', -4, -5, 23, 8, '#26262e'], ['h', -3, -4, 20, 6], ['r', 18, -3, 17, 3, '#111'], ['r', 16, -5, 10, 7, '#333340'], ['p', [[4, 3], [10, 3], [13, 14], [7, 15]], '#202028', 'm'], ['p', [[-2, 3], [2, 3], [0, 11], [-4, 11]], '#18181e'], ['r', 6, -7, 6, 2, '#3aa0ff', 's']],
  vector: [['r', -17, -4, 11, 3, '#1a1020'], ['p', [[-6, -5], [16, -5], [18, 1], [6, 4], [-6, 2]], '#2a1830'], ['r', -2, -3, 14, 2, '#ff2bd6'], ['r', 16, -3, 11, 3, '#111'], ['r', 4, 4, 5, 12, '#ff2bd6', 'm'], ['p', [[-4, 2], [0, 2], [-2, 10], [-6, 10]], '#1a1020'], ['r', 8, -7, 5, 2, '#ff7ae8', 's']],
  raijin: [['p', [[-23, -3], [-6, -4], [-6, 4], [-21, 8]], '#3a3f2a'], ['r', -6, -5, 25, 8, '#4b5236'], ['r', 18, -3, 31, 3, '#1a1a1a'], ['r', 47, -5, 6, 7, '#222'], ['r', 0, -12, 16, 5, '#111'], ['c', 16, -9.5, 2.5, '#ffe14d'], ['r', 4, 3, 7, 7, '#2a2a2a', 'm'], ['p', [[-2, 3], [2, 3], [0, 11], [-4, 11]], '#2a2a1e'], ['r', -4, -8, 4, 3, '#ffe14d', 's']],
  sweeper: [['p', [[-17, -3], [-4, -4], [-4, 4], [-15, 7]], '#3a2a22'], ['r', -4, -5, 21, 9, '#2c2a30'], ['r', 16, -4, 15, 5, '#151515'], ['c', 6, 9, 6.5, '#ff8a1f', 'm'], ['r', 0, -5, 14, 2, '#ff8a1f'], ['r', 16, 1, 11, 3, '#444', 's'], ['p', [[-2, 4], [2, 4], [0, 11], [-4, 11]], '#2a1a12']],
  giga: [['r', -12, -7, 24, 12, '#3a3424'], ['r', 12, -5, 23, 2, '#2a2a2a'], ['r', 12, -2, 23, 2, '#2a2a2a'], ['r', 12, 1, 23, 2, '#2a2a2a'], ['r', 26, -6, 3, 10, '#ffcc33'], ['r', -5, -11, 11, 3, '#222'], ['r', -7, 5, 11, 8, '#ffcc33', 'm'], ['p', [[-12, 3], [-8, 3], [-10, 11], [-14, 11]], '#1e1a10'], ['r', 0, -7, 4, 2, '#ffcc33', 's']],
  ronin: [['p', [[-21, -3], [-6, -4], [-6, 4], [-19, 7]], '#e9e9ee'], ['r', -6, -5, 27, 8, '#d7d8de'], ['r', -2, -1, 19, 2, '#e0132f'], ['r', 20, -3, 21, 3, '#222'], ['r', 2, -11, 12, 4, '#222'], ['r', 6, 3, 6, 10, '#333', 'm'], ['p', [[-3, 3], [1, 3], [-1, 11], [-5, 11]], '#2a2a30'], ['r', 10, -7, 5, 2, '#e0132f', 's']],
  katsu: [['r', -18, -5, 4, 10, '#2a3a22'], ['r', -14, -3, 40, 6, '#3c5a2e'], ['p', [[26, -6], [34, -6], [43, 0], [34, 6], [26, 6], [28, 0]], '#55ff3a', 'm'], ['r', 0, -8, 4, 5, '#222'], ['p', [[-4, 3], [0, 3], [-2, 11], [-6, 11]], '#1e2a18'], ['p', [[10, 3], [14, 3], [12, 10], [8, 10]], '#1e2a18'], ['r', -10, -1, 30, 1.5, '#55ff3a', 's']],
  blade: [['r', -12, -2.5, 14, 5, '#1a1a2e'], ['r', -10, -2.5, 2, 5, '#e0132f'], ['r', -5, -2.5, 2, 5, '#e0132f'], ['r', 2, -6, 3, 12, '#ffd21a'], ['p', [[5, -2.5], [44, -3.5], [51, 0], [44, 2.5], [5, 2.5]], '#c8f7ff'], ['l', 8, -1, 46, -1.5, '#3ad8ff', 1.2]],
  chronos: [['p', [[-9, -6], [14, -6], [18, 0], [14, 6], [-9, 4]], '#3b1a6e'], ['r', 16, -2.5, 19, 5, '#2a1048'], ['o', 21, 0, 5.5, '#b04cff'], ['o', 27, 0, 5.5, '#d58cff'], ['o', 33, 0, 5.5, '#b04cff'], ['c', 4, 0, 4, '#e9c4ff'], ['r', -5, 4, 8, 7, '#b04cff', 'm'], ['p', [[-7, 3], [-3, 3], [-5, 11], [-9, 11]], '#22103a'], ['r', 6, -8, 5, 2, '#ff2bd6', 's']]
};

// ---- custom gun color: re-hue every part, keep its light/dark shading
const _tint = new Map();
function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function gunTint(col, hue) {
  if (hue == null || typeof col !== 'string' || col[0] !== '#') return col;
  const key = col + hue;
  if (_tint.has(key)) return _tint.get(key);
  const [r, g, b] = hexToRgb(col);
  const [, s0, l0] = rgbToHsl(r, g, b);
  // dark metal stays dark but picks up the hue; light parts become the bright version of the color
  const l = clamp(0.16 + l0 * 0.62, 0.14, 0.78), sat = clamp(0.45 + s0 * 0.5, 0.45, 0.95);
  const out = 'hsl(' + Math.round(hue) + ',' + Math.round(sat * 100) + '%,' + Math.round(l * 100) + '%)';
  _tint.set(key, out);
  return out;
}
const gunHue = () => settings.gunMode === 'custom' ? settings.gunHue : null;

/** Draws a gun. o: {chalk, lw, mag:{dx,dy,rot,a}, slide, glow, hue} */
function drawGun(g, id, o) {
  o = o || {};
  const art = GUN_ART[id];
  if (!art) return;
  const lw = o.lw || 1.4;
  const hue = o.chalk ? null : (o.hue !== undefined ? o.hue : gunHue());
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const pt of art) {
    const flags = typeof pt[pt.length - 1] === 'string' && pt[pt.length - 1].length === 1 ? pt[pt.length - 1] : '';
    g.save();
    if (flags === 'm' && o.mag) { g.translate(o.mag.dx, o.mag.dy); g.rotate(o.mag.rot || 0); g.globalAlpha *= o.mag.a == null ? 1 : o.mag.a; }
    if (flags === 's' && o.slide) g.translate(o.slide, 0);
    g.beginPath();
    let fill;
    switch (pt[0]) {
      case 'p': g.moveTo(pt[1][0][0], pt[1][0][1]); for (const q of pt[1]) g.lineTo(q[0], q[1]); g.closePath(); fill = pt[2]; break;
      case 'r': g.rect(pt[1], pt[2], pt[3], pt[4]); fill = pt[5]; break;
      case 'c': g.arc(pt[1], pt[2], pt[3], 0, TAU); fill = pt[4]; break;
      case 'o': g.arc(pt[1], pt[2], pt[3], 0, TAU); g.strokeStyle = o.chalk ? '#fff' : '#000'; g.lineWidth = lw * 2.4; g.stroke(); if (!o.chalk) { g.strokeStyle = gunTint(pt[4], hue); g.lineWidth = lw * 1.2; g.stroke(); } g.restore(); continue;
      case 'l': if (!o.chalk) { g.moveTo(pt[1], pt[2]); g.lineTo(pt[3], pt[4]); g.strokeStyle = gunTint(pt[5], hue); g.lineWidth = pt[6]; g.stroke(); } g.restore(); continue;
      case 'h':
        if (!o.chalk) {
          g.rect(pt[1], pt[2], pt[3], pt[4]); g.clip();
          g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 0.7; g.beginPath();
          for (let k = -pt[4]; k < pt[3]; k += 2.5) { g.moveTo(pt[1] + k, pt[2] + pt[4]); g.lineTo(pt[1] + k + pt[4], pt[2]); }
          g.stroke();
        }
        g.restore(); continue;
    }
    if (o.chalk) { g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = lw; g.stroke(); }
    else { g.fillStyle = gunTint(fill, hue); g.fill(); g.strokeStyle = '#000'; g.lineWidth = lw; g.stroke(); }
    g.restore();
  }
}

// =======================================================================
// FIRING
// =======================================================================
function curW() { return P.weapons[P.cur]; }

function castRay(ox, oy, ang, maxD) {
  const dx = Math.cos(ang), dy = Math.sin(ang);
  let x = Math.floor(ox / T), y = Math.floor(oy / T);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
  const tdx = Math.abs(T / (dx || 1e-9)), tdy = Math.abs(T / (dy || 1e-9));
  let tmx = dx > 0 ? ((x + 1) * T - ox) / dx : dx < 0 ? (ox - x * T) / -dx : Infinity;
  let tmy = dy > 0 ? ((y + 1) * T - oy) / dy : dy < 0 ? (oy - y * T) / -dy : Infinity;
  let d = 0;
  for (let i = 0; i < 200 && d < maxD; i++) {
    if (tmx < tmy) { x += sx; d = tmx; tmx += tdx; } else { y += sy; d = tmy; tmy += tdy; }
    if (blocksBullet(tAt(x, y))) return Math.min(d, maxD);
  }
  return maxD;
}

function muzzlePos(len) {
  const d = WEAP[curW().id];
  const L = (len != null ? len : d.muzzle) * 0.89 + 10;
  return { x: P.x + Math.cos(P.aim) * L, y: P.y - 24 + Math.sin(P.aim) * L };
}

function startReload() {
  const w = curW(), d = WEAP[w.id];
  if (d.noReload || P.reloading || w.mag >= d.mag || w.reserve <= 0 || P.downed > 0) return;
  P.reloading = true; P.reloadT = 0; P.reloadPhase = 0; P.magClicked = false;
  P.reloadDur = d.reload * (P.perks.has('flash') ? 0.5 : 1);
  SFX.click();
  if (w.id === 'revolver') revolverFlashbang();
}

function updateReload(dt) {
  if (!P.reloading) return;
  const w = curW(), d = WEAP[w.id];
  P.reloadT += dt;
  const f = P.reloadT / P.reloadDur;
  const ph = Math.min(3, Math.floor(f * 4));
  if (ph !== P.reloadPhase) {
    P.reloadPhase = ph;
    if (ph === 1) { SFX.magOut(); part(P.x + rand(-6, 6), P.y - 26, rand(-30, 30), -40, 3, 5, '#2a2a2a', 'mag', { vz: 90 }); }
    if (ph === 3) SFX.rack();
  }
  if (!P.magClicked && f >= 0.72) { P.magClicked = true; SFX.magIn(); hudFlash('CLICK!'); }
  if (f >= 1) {
    const take = Math.min(d.mag - w.mag, w.reserve);
    w.mag += take; w.reserve -= take;
    P.reloading = false;
  }
}

function updateWeapon(dt) {
  const w = curW(), d = WEAP[w.id];
  P.cool -= dt;
  P.knifeCool -= dt;
  P.fireBuf = Math.max(0, (P.fireBuf || 0) - dt);
  if (input.firePressed) P.fireBuf = 0.25;
  if (P.overheat > 0) { P.overheat -= dt; if (P.overheat <= 0) P.heat = 0; }
  if (w.id !== 'giga' || !input.fire) { P.spin = Math.max(0, P.spin - dt * 2); P.heat = Math.max(0, P.heat - dt * 1.5); }
  if (!input.fire) { P.arShots = 0; P.sustain = 0; }
  if (P.swapT > 0) { P.swapT -= dt; return; }
  if (P.downed > 0 && w.id !== 'revolver' && d.kind !== 'ray') return;

  if (input.melee && P.knifeCool <= 0 && d.kind !== 'melee') knife();

  if (d.kind === 'melee') { updateBlade(dt, d); return; }
  if (P.reloading) { updateReload(dt); return; }
  if (input.reload) { startReload(); return; }

  let want = (input.fire || P.fireBuf > 0) && (d.auto || P.fireBuf > 0 || input.autoSemi);
  if (d.kind === 'chronos' && P.burstLeft > 0) want = true;
  if (w.id === 'giga') {
    if (input.fire && P.overheat <= 0) P.spin = Math.min(1, P.spin + dt / 0.35);
    if (P.spin < 1 || P.overheat > 0) want = false;
  }
  if (!want || P.cool > 0) return;

  const ammo = d.noReload ? w.reserve : w.mag;
  if (ammo <= 0) {
    if (input.firePressed || input.autoSemi) SFX.dry();
    P.cool = 0.3; P.burstLeft = 0;
    if (!d.noReload) startReload();
    return;
  }
  if (d.noReload) w.reserve--; else w.mag--;
  P.fireBuf = 0;

  // rate of fire
  if (w.id === 'kuro') { P.arShots++; P.cool = P.arShots <= 2 ? 60 / d.burstRpm : 60 / d.rpm; }
  else if (d.kind === 'chronos') {
    if (P.burstLeft <= 0) P.burstLeft = d.burst;
    P.burstLeft--;
    P.cool = P.burstLeft > 0 ? 60 / d.rpm : d.burstDelay;
  } else P.cool = 60 / d.rpm;

  fireShot(w, d);
  if (!d.noReload && w.mag === 0 && w.reserve > 0) setTimeout(() => { if (state === 'play' && curW() === w) startReload(); }, 250);
}

function fireShot(w, d) {
  const ang = P.aim + rand(-d.spread || 0, d.spread || 0) * (P.moving ? 1.3 : 1);
  const m = muzzlePos();
  P.kick = 1;
  cam.shake = Math.max(cam.shake, d.shake || 2);
  (SFX[w.id] || SFX.kuro)();
  // muzzle flash
  ring(m.x, m.y, 2, 16, 0.07, '#fff6b0', 6, { star: true, ang });
  if (d.kind === 'ray' || d.kind === 'pellet') part(P.x, P.y - 26, Math.cos(P.aim + 1.6) * 120, Math.sin(P.aim + 1.6) * 120, 1.6, 3, '#e8b84a', 'shell', { vz: 120 });

  if (d.kind === 'ray') fireRay(ang, d, w, m);
  else if (d.kind === 'pellet') {
    for (let i = 0; i < d.pellets; i++) fireRay(P.aim + rand(-d.spread, d.spread), d, w, m, true);
    for (let i = 0; i < 4; i++) cloud(m.x + Math.cos(P.aim) * i * 8, m.y + Math.sin(P.aim) * i * 8, rand(8, 14), '#6b6470', 0.6, Math.cos(P.aim) * 60, -20);
    worldText(m.x, m.y - 14, 'BLAM!', '#ff8a1f', 18, 0.45);
  } else if (d.kind === 'rocket') {
    projectiles.push({ kind: 'rocket', x: m.x, y: m.y, vx: Math.cos(ang) * 560, vy: Math.sin(ang) * 560, t: 0, ang });
    for (let i = 0; i < 6; i++) cloud(m.x - Math.cos(ang) * 50, m.y - Math.sin(ang) * 50, rand(10, 18), '#8a8f9a', 0.8, -Math.cos(ang) * 120 + rand(-30, 30), -Math.sin(ang) * 120 + rand(-30, 30));
  } else if (d.kind === 'chronos') {
    projectiles.push({ kind: 'chrono', x: m.x, y: m.y, vx: Math.cos(ang) * 720, vy: Math.sin(ang) * 720, t: 0, ang, dmg: d.dmg });
  }
  if (w.id === 'giga' && gt - P.rataT > 0.28) { P.rataT = gt; worldText(m.x + rand(-20, 20), m.y - 26, pick(['RATATATA', 'RATATA!', 'BRRRT']), '#ffcc33', 17, 0.5); }
  if (w.id === 'giga') { P.heat += 60 / d.rpm; if (P.heat >= 7) { P.overheat = 2.5; SFX.overheat(); worldText(P.x, P.y - 60, 'OVERHEAT!', '#ff5a3a', 22, 1); for (let i = 0; i < 10; i++) cloud(m.x, m.y, rand(6, 12), '#cfd6e0', 1, rand(-20, 20), -50); } }
  if (w.id === 'raijin') { screenFx.invert = 0.08; }
}

/** Zombie body = vertical capsule from the feet to the top of the head. */
function zTop(z) { return z.look && z.look.kind === 'boomer' ? 72 : 60; }
function zDist(z, x, y) { const cy = clamp(y, z.y - zTop(z) + 8, z.y - 6); return Math.hypot(x - z.x, y - cy); }
/** Closest approach of a ray to a zombie body: { along, perp, head }. */
function zRay(z, ox, oy, c, s) {
  let best = null;
  const top = zTop(z);
  for (let k = 0; k <= 8; k++) {
    const py = z.y - 6 - (top - 14) * k / 8;
    const dx = z.x - ox, dy = py - oy;
    const along = dx * c + dy * s, perp = Math.abs(-dx * s + dy * c);
    if (!best || perp < best.perp) best = { along, perp, head: k >= 7 };
  }
  return best;
}
function fireRay(ang, d, w, m, pellet) {
  const ox = P.x, oy = P.y - 24;
  const c = Math.cos(ang), s = Math.sin(ang);
  // walls are tested on the floor plane (feet level) so zombies hugging a wall still get hit
  const wallD = castRay(ox, P.y - 4, ang, d.range);
  const hits = [];
  for (const z of zombies) {
    if (z.dead) continue;
    const q = zRay(z, ox, oy, c, s);
    if (q.along < -z.r || q.along > wallD + z.r + 10) continue;
    if (q.perp < z.r + 6 + (pellet ? 3 : 0)) hits.push({ z, along: Math.max(0, q.along), perp: q.perp, head: q.head });
  }
  hits.sort((a, b) => a.along - b.along);
  let end = wallD, anyHead = false, hitCount = 0;
  for (const h of hits) {
    if (hitCount >= (d.pierce || 1)) break;
    hitCount++;
    const head = !pellet && h.head && h.perp < h.z.r;
    if (head) anyHead = true;
    let dmg = d.dmg * (head ? d.hs || 1 : 1);
    if (pellet) dmg *= clamp(1.25 - h.along / d.range, 0.35, 1);
    const hx = ox + c * h.along, hy = oy + s * h.along;
    damageZombie(h.z, dmg, { ang, kb: d.kb, head, src: w.id, hx, hy, dist: h.along, points: true });
    rayTrait(w.id, h.z, hx, hy, ang);
    end = h.along;
  }
  const ex = ox + c * end, ey = oy + s * end;
  // tracer
  if (w.id === 'raijin') {
    tracer(m.x, m.y, ex, ey, '#ffe14d', 7, 0.22, 'lightning');
    shocks.push({ x1: m.x, y1: m.y, x2: ex, y2: ey, life: 1.5, max: 1.5, tick: 0 });
  } else if (pellet) {
    tracer(m.x, m.y, ex, ey, '#ff8a1f', 2, 0.07);
    part(m.x, m.y, c * 1400, s * 1400, Math.min(0.2, end / 1400), 3.2, '#ff8a1f', 'pellet');
  } else if (w.id === 'ronin') {
    tracer(m.x, m.y, ex, ey, '#ffffff', 3, 0.14, 'blade');
  } else if (w.id === 'vector' || w.id === 'giga') {
    tracer(m.x, m.y, ex, ey, d.tracer, d.tw, 0.08, 'needle');
  } else {
    tracer(m.x, m.y, ex, ey, d.tracer, d.tw || 3, 0.1);
  }
  if (hitCount === 0 && end < d.range - 1) {
    for (let i = 0; i < 4; i++) part(ex, ey + 12, rand(-120, 120), rand(-120, 120), 0.25, 2, '#ffe9a8', 'spark');
    cloud(ex, ey + 10, 6, '#9a9099', 0.4);
  }
  if (w.id === 'ronin') {
    if (anyHead) {
      P.roninStreak++;
      if (P.roninStreak % 3 === 0) {
        w.mag = Math.min(d.mag, w.mag + 3);
        worldText(ex, ey - 30, 'ZANSHIN! +3', '#ff2a55', 20, 0.9);
        ring(ex, ey, 6, 140, 0.4, '#ff2a55', 8);
        aoe(ex, ey + 12, 140, 260, 'ronin', 220);
      }
    } else P.roninStreak = 0;
  }
}

function rayTrait(id, z, hx, hy, ang) {
  if (id === 'kuro' && gt - P.implodeT > 0.06) {
    P.implodeT = gt;
    ring(hx, hy, 60, 4, 0.18, '#3aa0ff', 3);
    for (const o of zombies) {
      if (o === z || o.dead) continue;
      const dd = dist(o.x, o.y - 12, hx, hy);
      if (dd < 70 && dd > 1) { o.kbx += (hx - o.x) / dd * 240; o.kby += (hy + 12 - o.y) / dd * 240; }
    }
  } else if (id === 'revolver') {
    ring(hx, hy, 4, 46, 0.25, '#ff2a55', 5);
  }
}

/** Area damage helper. */
function aoe(x, y, r, dmg, src, kb, noFalloff) {
  for (const z of zombies) {
    if (z.dead) continue;
    const dd = dist(x, y, z.x, z.y);
    if (dd > r + z.r) continue;
    const f = noFalloff ? 1 : clamp(1.15 - dd / r, 0.35, 1);
    const a = Math.atan2(z.y - y, z.x - x);
    damageZombie(z, dmg * f, { ang: a, kb: kb || 0, src, hx: z.x, hy: z.y - 26, points: true, splash: true });
  }
}

function explode(x, y, r, dmg, col, src) {
  aoe(x, y, r, dmg, src, 380);
  ring(x, y, 10, r, 0.35, col, 10, { hatch: true });
  ring(x, y, r * 0.3, r * 1.3, 0.5, '#fff', 4);
  for (let i = 0; i < 10; i++) { const a = rand(0, TAU), sp = rand(40, 160); cloud(x + Math.cos(a) * r * 0.4, y + Math.sin(a) * r * 0.4, rand(14, 26), i % 3 ? '#2b3a26' : col, rand(0.6, 1.1), Math.cos(a) * sp, Math.sin(a) * sp - 30); }
  for (let i = 0; i < 18; i++) { const a = rand(0, TAU), sp = rand(150, 420); part(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.6), 3, i % 2 ? col : '#fff', 'spark'); }
  worldText(x, y - 30, pick(['BOOM!', 'KABOOM!', 'DOKAAN!']), col, 34, 0.8);
  cam.shake = Math.max(cam.shake, 14);
  SFX.boom();
  paintScorch(x, y, r * 0.5);
}

function revolverFlashbang() {
  SFX.flashbang();
  ring(P.x, P.y - 26, 10, 230, 0.4, '#ffffff', 10);
  ring(P.x, P.y - 26, 10, 200, 0.5, '#ff2a55', 4);
  screenFx.white = Math.max(screenFx.white, 0.35);
  for (const z of zombies) if (!z.dead && dist(z.x, z.y, P.x, P.y) < 230) { z.stun = Math.max(z.stun, 1.6); }
  worldText(P.x, P.y - 70, 'FLASH!', '#fff', 24, 0.7);
}

function knife() {
  P.knifeCool = 0.6; P.swingT = 0.2; P.swingDir = P.aim;
  SFX.knife();
  slashes.push({ x: P.x, y: P.y - 26, ang: P.aim, r: 52, life: 0.2, max: 0.2, col: '#ffffff', w: 1.0 });
  let hit = false;
  for (const z of zombies) {
    if (z.dead) continue;
    const dd = dist(P.x, P.y, z.x, z.y);
    if (dd < 58 + z.r && Math.abs(angDiff(P.aim, Math.atan2(z.y - P.y, z.x - P.x))) < 1.1) {
      damageZombie(z, 160, { ang: P.aim, kb: 260, src: 'knife', hx: z.x, hy: z.y - 26, points: true });
      hit = true;
    }
  }
  if (hit) cam.shake = Math.max(cam.shake, 4);
}

function updateBlade(dt, d) {
  P.lungeCool -= dt;
  if (P.lungeT > 0) return; // lunge movement handled in player update
  if ((P.fireBuf > 0 || input.fire) && P.cool <= 0) {
    P.cool = 60 / d.rpm; P.fireBuf = 0; P.swingT = 0.22; P.swingDir = P.aim; P.swingSide = -(P.swingSide || 1);
    SFX.blade();
    slashes.push({ x: P.x, y: P.y - 26, ang: P.aim, r: 100, life: 0.45, max: 0.45, col: '#3ad8ff', w: 1.6, side: P.swingSide });
    for (const z of zombies) {
      if (z.dead) continue;
      const dd = dist(P.x, P.y, z.x, z.y);
      if (dd < 100 + z.r && Math.abs(angDiff(P.aim, Math.atan2(z.y - P.y, z.x - P.x))) < 1.15) {
        damageZombie(z, d.dmg, { ang: P.aim, kb: 200, src: 'blade', hx: z.x, hy: z.y - 26, points: true });
      }
    }
  }
  if ((input.heavyPressed) && P.lungeCool <= 0) {
    P.lungeT = 0.22; P.lungeDir = P.aim; P.lungeCool = 1.1; P.lungeHit = new Set();
    P.lungeFrom = { x: P.x, y: P.y };
    SFX.lunge();
    worldText(P.x, P.y - 60, 'RYUUSEN!', '#3ad8ff', 22, 0.6);
  }
}

/** Called every frame while lunging: damage everything we pass through. */
function lungeHits() {
  for (const z of zombies) {
    if (z.dead || P.lungeHit.has(z)) continue;
    if (dist(P.x, P.y, z.x, z.y) < 46 + z.r) {
      P.lungeHit.add(z);
      damageZombie(z, 650, { ang: P.lungeDir, kb: 300, src: 'blade', hx: z.x, hy: z.y - 26, points: true });
      part(z.x, z.y - 26, rand(-60, 60), rand(-60, 60), 0.3, 3, '#3ad8ff', 'spark');
    }
  }
}

// ---- projectiles -------------------------------------------------------
function clusterTargets(x, y, n) {
  const cands = zombies.filter(z => !z.dead && dist(x, y, z.x, z.y) < 750);
  for (const z of cands) { z._dens = 0; for (const o of cands) if (dist(z.x, z.y, o.x, o.y) < 110) z._dens++; }
  cands.sort((a, b) => b._dens - a._dens);
  const out = [];
  for (const z of cands) { if (out.every(o => dist(o.x, o.y, z.x, z.y) > 90)) out.push(z); if (out.length >= n) break; }
  return out;
}

function updateProjectiles(dt) {
  for (const p of projectiles) {
    p.t += dt;
    if (p.kind === 'sub' && p.target && !p.target.dead) {
      const a = Math.atan2(p.target.y - 12 - p.y, p.target.x - p.x);
      const cur = Math.atan2(p.vy, p.vx);
      const na = cur + clamp(angDiff(cur, a), -6 * dt, 6 * dt);
      const sp = Math.hypot(p.vx, p.vy) + 400 * dt;
      p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.kind === 'rocket' || p.kind === 'sub') {
      if (Math.random() < 0.8) cloud(p.x, p.y, rand(5, 9), '#9aa0ad', 0.6, rand(-15, 15) + Math.sin(p.t * 30) * 30, rand(-15, 15));
      if (Math.random() < 0.6) part(p.x, p.y, rand(-40, 40), rand(-40, 40), 0.2, 3, '#55ff3a', 'spark');
    }
    if (p.kind === 'rocket' && p.t > 0.22 && !p.dead) {
      p.dead = true;
      const targets = clusterTargets(p.x, p.y, 3);
      ring(p.x, p.y, 4, 40, 0.2, '#55ff3a', 4);
      worldText(p.x, p.y - 20, 'SPLIT!', '#55ff3a', 16, 0.5);
      for (let i = 0; i < 3; i++) {
        const a = p.ang + (i - 1) * 0.45;
        projectiles.push({ kind: 'sub', x: p.x, y: p.y, vx: Math.cos(a) * 380, vy: Math.sin(a) * 380, t: 0, target: targets[i] || targets[0] || null });
      }
      continue;
    }
    // collisions
    const tx = Math.floor(p.x / T), ty = Math.floor((p.y + 22) / T);
    let boom = blocksBullet(tAt(tx, ty)) || p.t > 3;
    let hitZ = null;
    if (!boom) for (const z of zombies) { if (!z.dead && !(p.kind === 'chrono' && z.frozen > 0 && p.passed && p.passed.has(z)) && zDist(z, p.x, p.y) < z.r + 8) { hitZ = z; boom = true; break; } }
    if (boom) {
      p.dead = true;
      if (p.kind === 'rocket') explode(p.x, p.y + 12, 130, WEAP.katsu.dmg, '#55ff3a', 'katsu');
      else if (p.kind === 'sub') explode(p.x, p.y + 12, 90, 480, '#55ff3a', 'katsu');
      else if (p.kind === 'chrono') timeField(p.x, p.y + 12, p.dmg, hitZ);
    }
  }
  projectiles = projectiles.filter(p => !p.dead);
}

function timeField(x, y, dmg, direct) {
  fields.push({ x, y, r: 80, life: 3, max: 3 });
  SFX.freeze();
  ring(x, y, 4, 80, 0.3, '#d58cff', 6);
  worldText(x, y - 40, 'TOKI-YO TOMARE!', '#d58cff', 16, 0.8);
  for (const z of zombies) {
    if (z.dead) continue;
    if (z === direct || dist(x, y, z.x, z.y) < 80 + z.r) {
      if (!(z.frozen > 0)) { z.frozen = 3; z.frozenDmg = 0; }
      z.frozenDmg += z === direct ? dmg : dmg * 0.6;
      addPoints(10);
    }
  }
}

// =======================================================================
// GAME STATE
// =======================================================================
const cam = { x: 0, y: 0, shake: 0, lookX: 0, lookY: 0 };
const screenFx = { invert: 0, white: 0, yellow: 0, red: 0, gold: 0, purple: 0 };
let banners = [], cashPops = [], hudMsgs = [], corpses = [], powerups = [];
let zombies = [];
let P = null;
const R = { n: 0, total: 0, spawned: 0, killed: 0, spawnT: 0, phase: 'break', breakT: 0, drops: 0 };
let overT = 0, zoneMsg = { text: '', t: 0 }, prompt = null, groanT = 0, spawnHold = 0;

function newPlayer() {
  return {
    x: 30.5 * T, y: 44 * T, r: 12, hp: 100, maxHp: 100, aim: -Math.PI / 2, face: 1,
    weapons: [{ id: 'revolver', mag: 6, reserve: 36 }], cur: 0,
    reloading: false, reloadT: 0, reloadDur: 1, reloadPhase: 0, magClicked: false,
    cool: 0, arShots: 0, burstLeft: 0, spin: 0, heat: 0, overheat: 0, rataT: 0, implodeT: 0, roninStreak: 0,
    sustain: 0, trailT: 0, kick: 0, swapT: 0, knifeCool: 0, swingT: 0, swingDir: 0, swingSide: 1,
    lungeT: 0, lungeDir: 0, lungeCool: 0, lungeHit: null, inv: 0,
    perks: new Set(), points: 500, kills: 0, headshots: 0, downs: 0,
    lastHurt: -99, downed: 0, instaT: 0, walkT: 0, moving: false, rebuildT: 0, zoneName: 'COURTYARD'
  };
}

function addPoints(n) {
  P.points += n;
  const last = cashPops[cashPops.length - 1];
  if (last && last.t < 0.08 && last.v > 0 === n > 0) last.v += n;
  else cashPops.push({ v: n, t: 0 });
}
function showBanner(text, sub, color, life, opts) { if (banners.length >= 3) banners.shift(); banners.push(Object.assign({ text, sub, color, life: life || 2.2, max: life || 2.2 }, opts || {})); }
function hudFlash(text) { hudMsgs.push({ text, t: 0.6 }); }

function paintBlood(x, y, s) {
  const g = floorCanvas.getContext('2d');
  g.save(); g.globalAlpha = 0.75;
  for (let i = 0; i < 6; i++) {
    g.fillStyle = i % 2 ? '#5a0a14' : '#7a0d1e';
    g.beginPath(); g.ellipse(x + rand(-14, 14) * s, y + rand(-8, 8) * s, rand(3, 9) * s, rand(2, 6) * s, rand(0, 3), 0, TAU); g.fill();
  }
  g.restore();
}
function paintScorch(x, y, r) {
  const g = floorCanvas.getContext('2d');
  const gr = g.createRadialGradient(x, y, 2, x, y, r);
  gr.addColorStop(0, 'rgba(10,20,5,0.55)'); gr.addColorStop(1, 'rgba(10,20,5,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}

// =======================================================================
// COLLISION
// =======================================================================
function collides(x, y, r, walkFn) {
  const x0 = Math.floor((x - r) / T), x1 = Math.floor((x + r) / T), y0 = Math.floor((y - r) / T), y1 = Math.floor((y + r) / T);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (walkFn(tAt(tx, ty))) continue;
    const cx = clamp(x, tx * T, tx * T + T), cy = clamp(y, ty * T, ty * T + T);
    if ((x - cx) ** 2 + (y - cy) ** 2 < r * r) return true;
  }
  return false;
}
function pushOut(e, walkFn) {
  const x0 = Math.floor((e.x - e.r) / T), x1 = Math.floor((e.x + e.r) / T), y0 = Math.floor((e.y - e.r) / T), y1 = Math.floor((e.y + e.r) / T);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (walkFn(tAt(tx, ty))) continue;
    const cx = clamp(e.x, tx * T, tx * T + T), cy = clamp(e.y, ty * T, ty * T + T);
    const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
    if (d2 < e.r * e.r) {
      if (d2 > 0.0001) { const d = Math.sqrt(d2), push = e.r - d; e.x += dx / d * push; e.y += dy / d * push; }
      else { e.y = ty * T + T + e.r; }
    }
  }
}
function moveEntity(e, dx, dy, walkFn) {
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 10) || 1;
  for (let i = 0; i < steps; i++) {
    e.x += dx / steps; pushOut(e, walkFn);
    e.y += dy / steps; pushOut(e, walkFn);
  }
}
const playerWalk = t => t === FLOOR;

// =======================================================================
// PLAYER
// =======================================================================
function updatePlayer(dt) {
  P.kick = Math.max(0, P.kick - dt * 8);
  P.swingT = Math.max(0, P.swingT - dt);
  P.inv = Math.max(0, P.inv - dt);
  if (P.instaT > 0) P.instaT -= dt;

  if (input.aimActive || usingTouch) P.aim = input.aim;
  if (usingTouch && settings.aimAssist && input.fire) {
    // gentle snap toward the zombie closest to where the right stick points
    let best = null, bd = 0.22;
    for (const z of zombies) {
      if (z.dead || dist(z.x, z.y, P.x, P.y) > 620) continue;
      const d = Math.abs(angDiff(input.aim, Math.atan2(z.y - 26 - (P.y - 24), z.x - P.x)));
      if (d < bd) { bd = d; best = z; }
    }
    if (best) P.aim = Math.atan2(best.y - 26 - (P.y - 24), best.x - P.x);
  }
  P.face = Math.cos(P.aim) >= 0 ? 1 : -1;

  // lunge (Dragonslayer heavy attack): fast dash, invulnerable
  if (P.lungeT > 0) {
    P.lungeT -= dt;
    const sp = 1100;
    moveEntity(P, Math.cos(P.lungeDir) * sp * dt, Math.sin(P.lungeDir) * sp * dt, playerWalk);
    lungeHits();
    if (Math.random() < 0.9) part(P.x, P.y - 26, rand(-30, 30), rand(-30, 30), 0.3, 4, '#3ad8ff', 'spark');
    if (P.lungeT <= 0) slashes.push({ x1: P.lungeFrom.x, y1: P.lungeFrom.y - 14, x2: P.x, y2: P.y - 26, life: 0.5, max: 0.5, col: '#3ad8ff', line: true });
    return;
  }

  // downed (ZapRevive self-revive)
  if (P.downed > 0) {
    P.downed -= dt;
    moveEntity(P, input.mx * 40 * dt, input.my * 40 * dt, playerWalk);
    if (P.downed <= 0) {
      P.hp = P.maxHp * 0.6; P.inv = 2;
      SFX.revive();
      showBanner('REVIVED!', 'ZapRevive kicked in', '#ffd21a', 1.6);
      ring(P.x, P.y - 26, 10, 220, 0.45, '#ffd21a', 10);
      for (const z of zombies) if (!z.dead && dist(z.x, z.y, P.x, P.y) < 220) { z.stun = 1.5; const a = Math.atan2(z.y - P.y, z.x - P.x); z.kbx += Math.cos(a) * 500; z.kby += Math.sin(a) * 500; }
    }
    return;
  }

  // movement
  let speed = 165;
  if (P.perks.has('flash')) speed *= 1.25;
  if (curW().id === 'vector' && P.sustain > 0.5) speed *= 1.25;
  if (curW().id === 'giga' && input.fire) speed *= 0.8;
  if (curW().id === 'raijin') speed *= 0.9;
  P.moving = Math.abs(input.mx) + Math.abs(input.my) > 0.05;
  if (P.moving) {
    P.walkT += dt * speed / 22;
    moveEntity(P, input.mx * speed * dt, input.my * speed * dt, playerWalk);
    if (Math.random() < dt * 6) part(P.x + rand(-6, 6), P.y, rand(-10, 10), -10, 0.4, 3, 'rgba(200,190,210,0.5)', 'dust');
  }

  // neon trail from sustained Vector fire
  if (curW().id === 'vector' && input.fire && !P.reloading && curW().mag > 0) {
    P.sustain += dt;
    if (P.sustain > 0.5) {
      P.trailT -= dt;
      if (P.trailT <= 0) { P.trailT = 0.07; if (trails.length > 70) trails.shift(); trails.push({ x: P.x, y: P.y, r: 17, life: 2.2, max: 2.2 }); }
    }
  }

  // regen
  if (gt - P.lastHurt > 2.5 && P.hp < P.maxHp) {
    const full = P.perks.has('zap') ? 5 : 10;
    P.hp = Math.min(P.maxHp, P.hp + P.maxHp / full * dt);
  }

  // swap
  const wantSlot = input.slot >= 0 && input.slot !== P.cur && input.slot < P.weapons.length;
  if ((input.swap || wantSlot) && P.weapons.length > 1 && P.swapT <= 0.15) {
    P.cur = wantSlot ? input.slot : (P.cur + 1) % P.weapons.length;
    P.reloading = false; P.swapT = 0.35; P.cool = 0; P.burstLeft = 0; P.spin = 0; P.sustain = 0;
    SFX.click();
  }

  // zone tracking
  const ft = fkind[idx(Math.floor(P.x / T), Math.floor(P.y / T))];
  const zn = FLOOR_NAMES[ft];
  if (zn && zn !== P.zoneName) { P.zoneName = zn; zoneMsg = { text: zn, t: 2.6 }; }

  updateInteraction(dt);
}

function hurtPlayer(dmg, from) {
  if (P.inv > 0 || P.lungeT > 0 || P.downed > 0 || state !== 'play') return;
  P.hp -= dmg; P.lastHurt = gt;
  screenFx.red = 0.8; cam.shake = Math.max(cam.shake, 9);
  SFX.hurt();
  if (from) { const a = Math.atan2(P.y - from.y, P.x - from.x); moveEntity(P, Math.cos(a) * 10, Math.sin(a) * 10, playerWalk); }
  part(P.x, P.y - 26, rand(-80, 80), rand(-80, 80), 0.5, 4, '#b0101e', 'blood');
  if (P.hp <= 0) {
    if (P.perks.has('zap')) {
      P.hp = 0; P.downed = 5; P.downs++;
      P.perks.clear(); P.maxHp = 100;
      SFX.down();
      showBanner('DOWNED!', 'ZapRevive: back up in 5s (perks lost)', '#ff2a55', 2.4);
      P.reloading = false;
    } else gameOver();
  }
}

// =======================================================================
// INTERACTION (wall-buys, doors, perks, box, windows)
// =======================================================================
const MAX_GUNS = 3;
function giveWeapon(id) {
  const d = WEAP[id];
  const has = P.weapons.findIndex(w => w.id === id);
  const inst = { id, mag: d.mag, reserve: d.reserve };
  if (has >= 0) { P.weapons[has] = inst; P.cur = has; }
  else if (P.weapons.length < MAX_GUNS) { P.weapons.push(inst); P.cur = P.weapons.length - 1; }
  else P.weapons[P.cur] = inst;
  P.reloading = false; P.swapT = 0.4; P.cool = 0; P.burstLeft = 0; P.spin = 0; P.heat = 0; P.overheat = 0; P.roninStreak = 0;
  hudFlash(d.name);
}

function spend(cost) {
  if (P.points < cost) { SFX.deny(); hudFlash('NOT ENOUGH POINTS'); return false; }
  P.points -= cost; cashPops.push({ v: -cost, t: 0 }); SFX.buy();
  return true;
}

function updateInteraction(dt) {
  prompt = null;
  const px = P.x, py = P.y;
  // windows (hold to rebuild)
  for (const w of windows) {
    if (!activeZones.has(w.zone) || w.boards >= 6) continue;
    const fx = w.cx + w.inX * T * 0.9, fy = w.cy + w.inY * T * 0.9 + 8;
    if (dist(px, py, fx, fy) < 62) {
      prompt = { text: 'HOLD to rebuild barrier', key: 'F', cost: 0, kind: 'window' };
      if (input.useHeld) {
        P.rebuildT += dt;
        prompt.progress = P.rebuildT / 0.45;
        if (P.rebuildT >= 0.45) {
          P.rebuildT = 0; w.boards++; w.shake = 0.15;
          SFX.hammer(); addPoints(10);
          worldText(w.cx, w.cy - 24, 'BAM!', '#ffd21a', 16, 0.4);
        }
      } else P.rebuildT = 0;
      return;
    }
  }
  // doors
  for (const d of doors) {
    if (d.open) continue;
    let near = false;
    for (const [x, y] of d.tiles) if (dist(px, py, (x + 0.5) * T, (y + 0.5) * T) < 66) near = true;
    if (near) {
      prompt = { text: 'Open door to ' + d.label, cost: d.cost, kind: 'door' };
      if (input.use && spend(d.cost)) {
        openDoor(d);
        SFX.door();
        cam.shake = 10;
        for (const [x, y] of d.tiles) for (let i = 0; i < 8; i++) part((x + 0.5) * T, (y + 0.5) * T, rand(-160, 160), rand(-160, 160), rand(0.5, 1), rand(4, 8), i % 2 ? '#c4283a' : '#f4efe9', 'chunk', { vz: rand(80, 200) });
        for (const [x, y] of d.tiles) cloud((x + 0.5) * T, (y + 0.5) * T, 22, '#8a7f8f', 1.0);
        showBanner('AREA UNLOCKED', d.label, '#ffd21a', 2);
        computeFlow(true);
      }
      return;
    }
  }
  // wall-buys
  for (const b of wallbuys) {
    if (dist(px, py, b.x, b.y + 10) < 54) {
      const own = P.weapons.some(w => w.id === b.w);
      const cost = own ? Math.round(b.price / 2) : b.price;
      prompt = { text: (own ? 'Buy ammo: ' : 'Buy ') + WEAP[b.w].name, cost, kind: 'wall', gun: b.w };
      if (input.use && spend(cost)) giveWeapon(b.w);
      return;
    }
  }
  // perks
  for (const p of perks) {
    if (dist(px, py, p.x, p.y + 16) < 56) {
      if (P.perks.has(p.id)) { prompt = { text: p.name + ' (owned)', cost: 0, kind: 'perk', owned: true }; return; }
      prompt = { text: 'Drink ' + p.name + ' - ' + p.desc, cost: p.cost, kind: 'perk' };
      if (input.use && P.downed <= 0 && spend(p.cost)) {
        P.perks.add(p.id);
        if (p.id === 'tuff') { P.maxHp = 200; P.hp = Math.min(200, P.hp + 100); }
        SFX.perk(p.id);
        setTimeout(() => SFX.slurp(), 700);
        showBanner(p.name + '!', p.desc, p.body, 2.4, { perk: p.id });
        worldText(P.x, P.y - 70, 'GULP GULP... BUUURP!', p.glow, 18, 1.4);
      }
      return;
    }
  }
  // mystery box
  if (dist(px, py, box.x, box.y + 14) < 64) {
    if (box.state === 'idle') {
      prompt = { text: 'Mystery Box - random weapon', cost: box.cost, kind: 'box' };
      if (input.use && spend(box.cost)) {
        box.state = 'spin'; box.t = 0; box.uses++;
        SFX.boxOpen();
        const pool = BOX_POOL.filter(([id]) => !P.weapons.some(w => w.id === id));
        let tot = pool.reduce((a, b) => a + b[1], 0), r = Math.random() * tot;
        box.weapon = pool[0][0];
        for (const [id, wgt] of pool) { r -= wgt; if (r <= 0) { box.weapon = id; break; } }
      }
    } else if (box.state === 'ready') {
      prompt = { text: 'Take ' + WEAP[box.weapon].name, cost: 0, kind: 'box', gun: box.weapon };
      if (input.use) { giveWeapon(box.weapon); box.state = 'close'; box.t = 0; SFX.buy(); }
    } else prompt = { text: 'The Mystery Box is deciding...', cost: 0, kind: 'box' };
    return;
  }
}

function updateBox(dt) {
  box.t += dt;
  if (box.state === 'spin') {
    box.lid = Math.min(1, box.lid + dt * 3);
    if (box.t > 0.1) box.show = BOX_POOL[Math.floor(box.t * (box.t < 2.5 ? 12 : 5)) % BOX_POOL.length][0];
    if (box.t >= 3.2) { box.state = 'ready'; box.t = 0; box.show = box.weapon; SFX.boxDone(); }
  } else if (box.state === 'ready') {
    if (box.t > 9) { box.state = 'close'; box.t = 0; }
  } else if (box.state === 'close') {
    box.lid = Math.max(0, box.lid - dt * 3);
    if (box.lid <= 0) { box.state = 'idle'; box.show = null; }
  }
}

// =======================================================================
// ZOMBIE PATHING (flow field toward the player)
// =======================================================================
const flow = new Int16Array(MW * MH);
let flowTile = -1, flowTimer = 0;
const bfsQ = new Int32Array(MW * MH);
function computeFlow(force) {
  const pt = idx(Math.floor(P.x / T), Math.floor(P.y / T));
  if (!force && pt === flowTile) return;
  flowTile = pt;
  flow.fill(-1);
  let h = 0, t = 0;
  flow[pt] = 0; bfsQ[t++] = pt;
  while (h < t) {
    const i = bfsQ[h++], x = i % MW, y = (i / MW) | 0, d = flow[i];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
      const ni = idx(nx, ny);
      if (flow[ni] >= 0 || !zombieWalk(tile[ni])) continue;
      if (dx && dy && (!zombieWalk(tile[idx(x + dx, y)]) || !zombieWalk(tile[idx(x, y + dy)]))) continue;
      flow[ni] = d + 1; bfsQ[t++] = ni;
    }
  }
}

// =======================================================================
// ZOMBIES
// =======================================================================
// Roster from the zombie look sheet: purple skin, glowing red eyes, torn black clothes.
const ZTYPES = {
  ped_m:  { w: 30, name: 'Male Pedestrian' },
  ped_f:  { w: 24, name: 'Girl Pedestrian' },
  ped_v:  { w: 16, name: 'Var. Male Pedestrian' },
  cop_m:  { w: 16, name: 'Male Cop' },
  cop_f:  { w: 12, name: 'Girl Cop' },
  boomer: { w: 0,  name: 'Big Guy Boomer' }
};
const SKINS = ['#7b4bb0', '#7247a6', '#8452b8', '#6d42a0'];
function rollType(n) {
  if (n >= 3 && Math.random() < Math.min(0.12, 0.04 + n * 0.008)) return 'boomer';
  let tot = 0; for (const k in ZTYPES) tot += ZTYPES[k].w;
  let r = Math.random() * tot;
  for (const k in ZTYPES) { r -= ZTYPES[k].w; if (r <= 0) return k; }
  return 'ped_m';
}

function spawnZombie() {
  const cand = windows.filter(w => activeZones.has(w.zone) && (!w.breacher || w.boards === 0));
  if (!cand.length) return false;
  cand.sort((a, b) => dist(a.cx, a.cy, P.x, P.y) - dist(b.cx, b.cy, P.x, P.y));
  const near = cand.slice(0, Math.min(5, cand.length));
  const w = pick(near);
  const n = R.n;
  const roll = Math.random();
  const sprinter = roll < clamp((n - 6) * 0.1, 0, 0.5);
  const runner = !sprinter && roll < clamp((n - 2) * 0.18, 0, 0.85);
  const hp = n < 10 ? 150 + (n - 1) * 100 : Math.round(950 * Math.pow(1.1, n - 9));
  const kind = rollType(n);
  const boomer = kind === 'boomer';
  const look = { kind, skin: pick(SKINS), eye: Math.random() < 0.3, tear: irand(0, 3) };
  const z = {
    x: w.cx, y: w.cy + 6, r: boomer ? 17 : 12, hp: boomer ? hp * 3 : hp, maxHp: boomer ? hp * 3 : hp,
    speed: boomer ? rand(40, 48) : sprinter ? rand(140, 155) : runner ? rand(92, 108) : rand(46, 60),
    type: boomer ? 'walk' : sprinter ? 'sprint' : runner ? 'run' : 'walk', kind,
    state: w.boards > 0 ? 'breach' : 'chase', win: w, atk: 0, atkCool: 0.6, boardT: 1.0,
    flash: 0, stun: 0, frozen: 0, frozenDmg: 0, kbx: 0, kby: 0, face: 1, walkT: rand(0, 10), look, dead: false, rise: 0.5
  };
  if (z.state === 'breach') w.breacher = z;
  zombies.push(z);
  return true;
}

function updateZombies(dt) {
  flowTimer -= dt;
  if (flowTimer <= 0) { flowTimer = 0.15; computeFlow(false); }
  groanT -= dt;
  if (groanT <= 0 && zombies.length) {
    groanT = rand(0.8, 2.2);
    const z = pick(zombies);
    if (z && !z.dead) SFX.groan(clamp(1 - dist(z.x, z.y, P.x, P.y) / 900, 0, 1));
  }

  for (const z of zombies) {
    if (z.dead) continue;
    z.flash = Math.max(0, z.flash - dt);
    z.rise = Math.max(0, z.rise - dt);
    // knockback decays
    if (z.kbx || z.kby) {
      moveEntity(z, z.kbx * dt, z.kby * dt, zombieWalk);
      const k = Math.pow(0.0005, dt); z.kbx *= k; z.kby *= k;
      if (Math.abs(z.kbx) + Math.abs(z.kby) < 4) z.kbx = z.kby = 0;
    }
    if (z.frozen > 0) {
      z.frozen -= dt;
      if (z.frozen <= 0) {
        z.frozen = 0;
        const dmg = z.frozenDmg * 1.25; z.frozenDmg = 0;
        ring(z.x, z.y - 26, 4, 70, 0.35, '#d58cff', 6);
        worldText(z.x, z.y - 40, 'SHATTER!', '#d58cff', 18, 0.6);
        SFX.unfreeze();
        damageZombie(z, dmg, { fromFreeze: true, src: 'chronos', ang: rand(0, TAU), kb: 120, hx: z.x, hy: z.y - 26, points: false });
      }
      continue;
    }
    if (z.stun > 0) { z.stun -= dt; continue; }
    const dP = dist(z.x, z.y, P.x, P.y);

    if (z.state === 'breach') {
      const w = z.win;
      z.face = Math.sign(P.x - z.x) || 1;
      if (w.boards > 0) {
        z.boardT -= dt;
        if (z.boardT <= 0) {
          z.boardT = 1.0; w.boards--; w.shake = 0.2;
          SFX.board();
          part(w.cx, w.cy, w.inX * 160 + rand(-60, 60), w.inY * 160 + rand(-60, 60), 1.2, 6, '#8a5a2b', 'plank', { vz: 120 });
        }
        if (dP < 62) zombieAttack(z, dt, dP);
        continue;
      }
      z.state = 'chase';
      if (w.breacher === z) w.breacher = null;
    }

    // steering
    let tx = P.x, ty = P.y;
    if (dP > 56) {
      const cx = Math.floor(z.x / T), cy = Math.floor(z.y / T);
      let best = flow[idx(cx, cy)], bx = -1, by = -1;
      if (best < 0) best = 9999;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= MW || ny >= MH) continue;
        const f = flow[idx(nx, ny)];
        if (f < 0 || f >= best) continue;
        if (dx && dy && (!zombieWalk(tAt(cx + dx, cy)) || !zombieWalk(tAt(cx, cy + dy)))) continue;
        best = f; bx = nx; by = ny;
      }
      if (bx >= 0) { tx = (bx + 0.5) * T; ty = (by + 0.5) * T; }
    }
    let dx = tx - z.x, dy = ty - z.y;
    const dd = Math.hypot(dx, dy) || 1;
    dx /= dd; dy /= dd;
    // separation
    for (const o of zombies) {
      if (o === z || o.dead) continue;
      const sx = z.x - o.x, sy = z.y - o.y, s2 = sx * sx + sy * sy;
      if (s2 < 26 * 26 && s2 > 0.01) { const s = Math.sqrt(s2); dx += sx / s * 0.6 * (1 - s / 26); dy += sy / s * 0.6 * (1 - s / 26); }
    }
    const m = Math.hypot(dx, dy) || 1;
    let sp = z.speed * (z.atk > 0 ? 0.3 : 1);
    if (dP < z.r + P.r + 4) sp = 0;
    moveEntity(z, dx / m * sp * dt, dy / m * sp * dt, zombieWalk);
    z.walkT += dt * sp / 18;
    if (Math.abs(P.x - z.x) > 2) z.face = P.x > z.x ? 1 : -1;
    // keep out of the player
    if (dP < z.r + P.r && dP > 0.01) {
      const push = (z.r + P.r - dP) * 0.5;
      const ax = (P.x - z.x) / dP, ay = (P.y - z.y) / dP;
      if (P.lungeT <= 0) moveEntity(P, ax * push, ay * push, playerWalk);
      moveEntity(z, -ax * push, -ay * push, zombieWalk);
    }
    zombieAttack(z, dt, dP);
  }
  // corpses
  for (const c of corpses) c.t -= dt;
  corpses = corpses.filter(c => c.t > 0);
}

function zombieAttack(z, dt, dP) {
  z.atkCool -= dt;
  if (z.atk > 0) {
    z.atk -= dt;
    if (z.atk <= 0) {
      if (dist(z.x, z.y, P.x, P.y) < z.r + P.r + 22) { hurtPlayer(z.kind === 'boomer' ? 60 : z.type === 'sprint' ? 50 : 45, z); SFX.attack(); }
      z.atkCool = 1.0;
    }
  } else if (dP < z.r + P.r + 14 && z.atkCool <= 0 && P.downed <= 0) {
    z.atk = 0.38;
  }
}

function damageZombie(z, dmg, o) {
  if (z.dead || dmg <= 0) return;
  if (z.frozen > 0 && !o.fromFreeze) {
    z.frozenDmg += dmg; z.flash = 0.05;
    if (o.points) addPoints(10);
    return;
  }
  if (P.instaT > 0) dmg = Math.max(dmg, z.hp + 1);
  z.hp -= dmg; z.flash = 0.1;
  if (o.points) addPoints(10);
  if (o.kb) { z.kbx += Math.cos(o.ang) * o.kb; z.kby += Math.sin(o.ang) * o.kb; }
  if (!o.silent) {
    const hx = o.hx != null ? o.hx : z.x, hy = o.hy != null ? o.hy : z.y - 26;
    for (let i = 0; i < (o.head ? 7 : 3); i++) part(hx, hy, Math.cos(o.ang || 0) * rand(40, 180) + rand(-60, 60), Math.sin(o.ang || 0) * rand(40, 180) + rand(-60, 60), rand(0.3, 0.6), rand(2, 4), i % 3 ? '#9a0d1f' : '#3a0008', 'blood', { vz: rand(30, 120) });
    if (o.head) { SFX.head(); P.headshots++; ring(hx, hy - 6, 3, 18, 0.15, '#fff', 3, { star: true }); }
    else if (!o.splash) SFX.hit();
  }
  if (z.hp <= 0) killZombie(z, o);
}

function killZombie(z, o) {
  z.dead = true;
  R.killed++; P.kills++;
  if (!o.noPoints) addPoints(100);
  if (z.win && z.win.breacher === z) z.win.breacher = null;
  SFX.splat();
  if (z.kind === 'boomer') boomerBurst(z);
  corpses.push({ x: z.x, y: z.y, look: z.look, face: z.face, t: 0.9, max: 0.9, ang: o.ang || 0, burn: o.src === 'sweeper' || o.src === 'katsu', frozen: o.fromFreeze });
  if (fkind[idx(Math.floor(z.x / T), Math.floor(z.y / T))]) paintBlood(z.x, z.y, 1.2);
  for (let i = 0; i < 10; i++) part(z.x, z.y - 26, rand(-160, 160), rand(-160, 60), rand(0.4, 0.8), rand(3, 6), i % 3 ? '#9a0d1f' : '#1a0005', 'blood', { vz: rand(60, 200) });
  // Brimstone Sweeper: close-range kills erupt into fiery anime dust
  if (o.src === 'sweeper' && o.dist != null && o.dist < 150) {
    worldText(z.x, z.y - 40, 'FWOOSH!', '#ff8a1f', 20, 0.6);
    for (let i = 0; i < 8; i++) { const a = rand(0, TAU); cloud(z.x + Math.cos(a) * 20, z.y - 26 + Math.sin(a) * 14, rand(12, 20), i % 2 ? '#ff8a1f' : '#ffcf5a', 0.7, Math.cos(a) * 90, Math.sin(a) * 60 - 30); }
    for (const q of zombies) {
      if (q.dead || q === z) continue;
      const d = dist(q.x, q.y, z.x, z.y);
      if (d < 110) { const a = Math.atan2(q.y - z.y, q.x - z.x); q.kbx += Math.cos(a) * 480; q.kby += Math.sin(a) * 480; damageZombie(q, 90, { ang: a, src: 'dust', splash: true, points: true }); }
    }
  }
  // power-up drop
  if (!o.noDrop && R.drops < 4 && Math.random() < 0.04) {
    R.drops++;
    let x = z.x, y = z.y;
    if (tAt(Math.floor(x / T), Math.floor(y / T)) !== FLOOR && z.win) { x = z.win.cx + z.win.inX * T; y = z.win.cy + z.win.inY * T; }
    const r = Math.random();
    powerups.push({ type: r < 0.4 ? 'ammo' : r < 0.7 ? 'insta' : 'nuke', x, y, t: 0, life: 26 });
    SFX.powerSpawn();
  }
}

/** Big Guy Boomer: bursts into a purple bile blast that shoves everything away. */
function boomerBurst(z) {
  SFX.boom();
  worldText(z.x, z.y - 50, 'BLAAARGH!', '#b04cff', 26, 0.9);
  ring(z.x, z.y - 26, 10, 120, 0.4, '#9a5cff', 10, { hatch: true });
  for (let i = 0; i < 12; i++) { const a = rand(0, TAU), sp = rand(40, 170); cloud(z.x + Math.cos(a) * 20, z.y - 26 + Math.sin(a) * 14, rand(12, 22), i % 2 ? '#7b4bb0' : '#b04cff', rand(0.7, 1.2), Math.cos(a) * sp, Math.sin(a) * sp - 20); }
  cam.shake = Math.max(cam.shake, 12);
  for (const q of zombies) {
    if (q.dead || q === z) continue;
    const d = dist(q.x, q.y, z.x, z.y);
    if (d < 120) { const a = Math.atan2(q.y - z.y, q.x - z.x); q.kbx += Math.cos(a) * 420; q.kby += Math.sin(a) * 420; q.stun = Math.max(q.stun, 0.6); }
  }
  if (dist(P.x, P.y, z.x, z.y) < 95) { hurtPlayer(30, z); screenFx.purple = 0.9; }
}

// =======================================================================
// POWER-UPS
// =======================================================================
function updatePowerups(dt) {
  for (const p of powerups) {
    p.t += dt;
    if (dist(p.x, p.y, P.x, P.y) < 34 && P.downed <= 0) { p.dead = true; activatePowerup(p.type); }
    if (p.t > p.life) p.dead = true;
  }
  powerups = powerups.filter(p => !p.dead);
}

function activatePowerup(type) {
  SFX.pickup();
  if (type === 'ammo') {
    for (const w of P.weapons) { const d = WEAP[w.id]; w.mag = d.mag; w.reserve = d.reserve; }
    P.overheat = 0; P.heat = 0;
    screenFx.yellow = 0.7;
    showBanner('MAX AMMO!', 'All weapons fully loaded', '#ffd21a', 2.2, { big: true });
    SFX.maxAmmo();
  } else if (type === 'insta') {
    P.instaT = 30;
    screenFx.red = Math.max(screenFx.red, 0.35);
    showBanner('INSTA-KILL!', 'One hit. One kill. 30 seconds.', '#ff2a55', 2.2, { big: true });
    SFX.insta();
  } else if (type === 'nuke') {
    screenFx.gold = 1;
    cam.shake = 26;
    SFX.nuke();
    showBanner('KA-BOOM!', 'NUKE  +$400', '#fff1a8', 2.4, { big: true });
    addPoints(400);
    spawnHold = 2.5;
    const list = zombies.filter(z => !z.dead);
    list.forEach((z, i) => setTimeout(() => {
      if (z.dead || state !== 'play') return;
      ring(z.x, z.y - 26, 4, 50, 0.3, '#fff1a8', 6);
      for (let k = 0; k < 6; k++) part(z.x, z.y - 26, rand(-150, 150), rand(-150, 150), 0.5, 3, k % 2 ? '#ffd21a' : '#fff', 'spark');
      killZombie(z, { noPoints: true, noDrop: true, src: 'nuke', ang: rand(0, TAU) });
    }, 60 + i * 35));
  }
}

// =======================================================================
// ROUNDS
// =======================================================================
function roundTotal(n) { return n <= 5 ? [6, 8, 13, 18, 24][n - 1] : Math.min(160, Math.round(24 + (n - 5) * 5.5)); }

function startRound(n) {
  R.n = n; R.total = roundTotal(n); R.spawned = 0; R.killed = 0; R.phase = 'active'; R.spawnT = 2.2; R.drops = 0;
  SFX.roundStart();
  showBanner('ROUND ' + n, n === 1 ? 'Survive the Pirates of the Red Moon' : 'They are getting faster...', '#ff1744', 3.2, { round: true });
  screenFx.red = Math.max(screenFx.red, 0.25);
}

function updateRound(dt) {
  if (R.phase === 'break') {
    R.breakT -= dt;
    if (R.breakT <= 0) startRound(R.n + 1);
    return;
  }
  spawnHold = Math.max(0, spawnHold - dt);
  const alive = zombies.filter(z => !z.dead).length;
  if (R.spawned < R.total && spawnHold <= 0) {
    R.spawnT -= dt;
    if (R.spawnT <= 0 && alive < 24) {
      if (spawnZombie()) R.spawned++;
      R.spawnT = Math.max(0.45, 2.0 - R.n * 0.12) * rand(0.7, 1.2);
    }
  }
  zombies = zombies.filter(z => !z.dead);
  if (R.spawned >= R.total && zombies.length === 0) {
    R.phase = 'break'; R.breakT = 9;
    SFX.roundEnd();
    showBanner('ROUND ' + R.n + ' SURVIVED', 'Next wave incoming...', '#ffffff', 3);
    bestRound = Math.max(bestRound, R.n);
    store('westvale.bestRound', String(bestRound));
    saveGame(); hudFlash('GAME SAVED');
  }
}

// =======================================================================
// FX UPDATE
// =======================================================================
function updateFx(dt) {
  for (const p of parts) {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.rot += p.vr * dt;
    if (p.kind === 'blood' || p.kind === 'shell' || p.kind === 'mag' || p.kind === 'plank' || p.kind === 'chunk') {
      p.vz -= 520 * dt; p.z += p.vz * dt;
      if (p.z <= 0) { p.z = 0; p.vz *= -0.3; p.vx *= 0.6; p.vy *= 0.6; p.vr *= 0.5; if (p.kind === 'blood' && !p.stuck) { p.stuck = true; p.life = Math.min(p.life, 0.3); } }
    } else if (p.kind === 'spark' || p.kind === 'pellet') { p.vx *= Math.pow(0.05, dt); p.vy *= Math.pow(0.05, dt); }
    else if (p.kind === 'dust') { p.vy -= 10 * dt; }
  }
  parts = parts.filter(p => p.life > 0);
  for (const t of tracers) t.life -= dt;
  tracers = tracers.filter(t => t.life > 0);
  for (const r of rings) r.life -= dt;
  rings = rings.filter(r => r.life > 0);
  for (const t of texts) { t.life -= dt; t.y += t.vy * dt; t.vy *= Math.pow(0.2, dt); }
  texts = texts.filter(t => t.life > 0);
  for (const s of slashes) s.life -= dt;
  slashes = slashes.filter(s => s.life > 0);
  for (const c of clouds) { c.life -= dt; c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= Math.pow(0.2, dt); c.vy *= Math.pow(0.3, dt); }
  clouds = clouds.filter(c => c.life > 0);
  // damaging floor effects
  for (const t of trails) {
    t.life -= dt;
    for (const z of zombies) if (!z.dead && dist(z.x, z.y, t.x, t.y) < t.r + z.r) damageZombie(z, 70 * dt, { src: 'vector', silent: true, points: false });
  }
  trails = trails.filter(t => t.life > 0);
  for (const s of shocks) {
    s.life -= dt;
    for (const z of zombies) {
      if (z.dead) continue;
      const dx = s.x2 - s.x1, dy = s.y2 - s.y1, l2 = dx * dx + dy * dy || 1;
      const u = clamp(((z.x - s.x1) * dx + (z.y - 26 - s.y1) * dy) / l2, 0, 1);
      if (dist(z.x, z.y - 26, s.x1 + dx * u, s.y1 + dy * u) < 26) { damageZombie(z, 220 * dt, { src: 'raijin', silent: true, points: false }); z.stun = Math.max(z.stun, 0.1); }
    }
  }
  shocks = shocks.filter(s => s.life > 0);
  for (const f of fields) f.life -= dt;
  fields = fields.filter(f => f.life > 0);
  for (const b of banners) b.life -= dt;
  banners = banners.filter(b => b.life > 0);
  for (const c of cashPops) c.t += dt;
  cashPops = cashPops.filter(c => c.t < 1.1);
  for (const m of hudMsgs) m.t -= dt;
  hudMsgs = hudMsgs.filter(m => m.t > 0);
  for (const w of windows) w.shake = Math.max(0, w.shake - dt);
  zoneMsg.t = Math.max(0, zoneMsg.t - dt);
  for (const k in screenFx) screenFx[k] = Math.max(0, screenFx[k] - dt * (k === 'invert' ? 1 : 1.6));
}

// =======================================================================
// FLOW: new game / game over
// =======================================================================
function resetWorld() {
  buildMap(); renderFloor(); renderAllStrips(); renderMinimap();
  zombies = []; corpses = []; powerups = []; banners = []; cashPops = []; hudMsgs = [];
  parts = []; tracers = []; rings = []; texts = []; slashes = []; trails = []; shocks = []; fields = []; projectiles = []; clouds = [];
}

function newGame(save) {
  initAudio();
  resetWorld();
  P = newPlayer();
  Object.assign(R, { n: 0, total: 0, spawned: 0, killed: 0, phase: 'break', breakT: 2.2, drops: 0 });
  zoneMsg = { text: 'WESTVALE HIGH - COURTYARD', t: 3 };
  if (save) applySave(save);
  cam.x = P.x; cam.y = P.y;
  computeFlow(true);
  state = 'play'; paused = false; overT = 0;
  releaseAllTouches();
  startDrone();
}

// ---- one save slot ---------------------------------------------------------
const SAVE_KEY = 'westvale.save.v1';
function readSave() { try { const d = JSON.parse(store(SAVE_KEY) || 'null'); return d && d.v === 1 ? d : null; } catch (e) { return null; } }
function deleteSave() { unstore(SAVE_KEY); }
function saveGame() {
  if (!P || state === 'over') return;
  const data = {
    v: 1, at: Date.now(),
    round: R.phase === 'break' ? R.n + 1 : Math.max(1, R.n),   // a round in progress restarts on load
    points: P.points, kills: P.kills, headshots: P.headshots, downs: P.downs,
    hp: Math.max(1, Math.round(P.hp)), maxHp: P.maxHp, perks: [...P.perks],
    weapons: P.weapons.map(w => ({ id: w.id, mag: w.mag, reserve: w.reserve })), cur: P.cur,
    doors: doors.map(d => d.open), boards: windows.map(w => w.boards),
    x: Math.round(P.x), y: Math.round(P.y)
  };
  store(SAVE_KEY, JSON.stringify(data));
}
function applySave(d) {
  d.doors.forEach((open, i) => { if (open && doors[i] && !doors[i].open) openDoor(doors[i]); });
  d.boards.forEach((b, i) => { if (windows[i]) windows[i].boards = clamp(b, 0, 6); });
  Object.assign(P, { points: d.points, kills: d.kills, headshots: d.headshots, downs: d.downs || 0, maxHp: d.maxHp, hp: d.hp });
  P.perks = new Set(d.perks);
  P.weapons = d.weapons.filter(w => WEAP[w.id]).slice(0, MAX_GUNS);
  if (!P.weapons.length) P.weapons = [{ id: 'revolver', mag: 6, reserve: 36 }];
  P.cur = clamp(d.cur || 0, 0, P.weapons.length - 1);
  if (tAt(Math.floor(d.x / T), Math.floor(d.y / T)) === FLOOR) { P.x = d.x; P.y = d.y; }
  R.n = d.round - 1; R.phase = 'break'; R.breakT = 4;
  zoneMsg = { text: 'SAVE LOADED - ROUND ' + d.round, t: 3 };
  showBanner('WELCOME BACK', 'Round ' + d.round + ' starts in a moment', '#d9a8ff', 2.6);
}
function saveSummary(d) {
  if (!d) return 'No saved game';
  return 'Round ' + d.round + '  •  $' + fmt(d.points) + '  •  ' + d.weapons.length + ' gun' + (d.weapons.length === 1 ? '' : 's') + (d.perks.length ? '  •  ' + d.perks.length + ' perk' + (d.perks.length === 1 ? '' : 's') : '');
}

function pauseGame() { if (state !== 'play') return; paused = true; ui.screen = 'pause'; ui.sel = 0; releaseAllTouches(); mouse.l = mouse.r = false; }
function resumeGame() { paused = false; ui.screen = 'pause'; }
function exitToMenu(save) {
  if (save) saveGame();
  stopDrone();
  state = 'menu'; paused = false; P = null; zombies = [];
  ui.screen = 'main'; ui.sel = 0;
  menuWorld();
}

function gameOver() {
  state = 'over'; overT = 0;
  P.hp = 0;
  bestRound = Math.max(bestRound, R.n);
  store('westvale.bestRound', String(bestRound));
  deleteSave();
  SFX.down();
  stopDrone();
  screenFx.red = 1;
  ui.screen = 'over'; ui.sel = 0;
  releaseAllTouches();
}

// =======================================================================
// SKY (zenith void -> electric purple horizon, 4-point stars, Red Moon)
// =======================================================================
let skyCanvas = null, moonCanvas = null, halftone = null;
const embers = [];
for (let i = 0; i < 60; i++) embers.push({ x: Math.random(), y: Math.random(), s: rand(1.5, 4), v: rand(0.015, 0.05), w: rand(0, TAU) });

function buildSky() {
  skyCanvas = document.createElement('canvas');
  skyCanvas.width = Math.max(1, Math.round(W * DPR)); skyCanvas.height = Math.max(1, Math.round(H * DPR));
  const g = skyCanvas.getContext('2d'); g.scale(DPR, DPR);
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const count = Math.round(W * H / 5200);
  for (let i = 0; i < count; i++) {
    const x = Math.random() * W, y = Math.random() * H, s = Math.random() < 0.08 ? rand(4, 7) : rand(0.8, 2.2);
    g.fillStyle = '#fff'; g.globalAlpha = rand(0.5, 1);
    if (s > 3) { // sharp 4-point anime star
      g.beginPath(); g.moveTo(x, y - s * 2); g.lineTo(x + s * 0.35, y - s * 0.35); g.lineTo(x + s * 2, y); g.lineTo(x + s * 0.35, y + s * 0.35);
      g.lineTo(x, y + s * 2); g.lineTo(x - s * 0.35, y + s * 0.35); g.lineTo(x - s * 2, y); g.lineTo(x - s * 0.35, y - s * 0.35); g.closePath(); g.fill();
    } else g.fillRect(x, y, s, s);
  }
  g.globalAlpha = 1;
  // moon sprite
  const mr = Math.round(Math.min(W, H) * 0.17);
  moonCanvas = document.createElement('canvas');
  moonCanvas.width = moonCanvas.height = Math.round(mr * 3.4 * DPR);
  const m = moonCanvas.getContext('2d'); m.scale(DPR, DPR);
  const c = mr * 1.7;
  const glow = m.createRadialGradient(c, c, mr * 0.9, c, c, mr * 1.7);
  glow.addColorStop(0, 'rgba(255,0,51,0.55)'); glow.addColorStop(1, 'rgba(255,0,51,0)');
  m.fillStyle = glow; m.beginPath(); m.arc(c, c, mr * 1.7, 0, TAU); m.fill();
  m.fillStyle = '#FF0033'; m.beginPath(); m.arc(c, c, mr, 0, TAU); m.fill();
  m.save(); m.beginPath(); m.arc(c, c, mr, 0, TAU); m.clip();
  m.fillStyle = '#ff5a75'; m.beginPath(); m.arc(c - mr * 0.3, c - mr * 0.3, mr * 0.72, 0, TAU); m.fill();
  for (let y = c - mr; y < c + mr; y += 6) for (let x = c - mr; x < c + mr; x += 6) {
    const d = (x - c + mr * 0.6 + (y - c) * 0.3) / (mr * 2);
    if (d > 0.45) { m.fillStyle = 'rgba(90,0,20,0.6)'; m.beginPath(); m.arc(x + ((y / 6) % 2 ? 3 : 0), y, 2.4 * (d - 0.4) * 2, 0, TAU); m.fill(); }
  }
  for (const [cx, cy, cr] of [[0.3, -0.2, 0.18], [-0.35, 0.3, 0.12], [0.1, 0.45, 0.1], [-0.1, -0.5, 0.08]]) {
    m.fillStyle = 'rgba(120,0,25,0.45)'; m.beginPath(); m.arc(c + cx * mr, c + cy * mr, cr * mr, 0, TAU); m.fill();
    m.strokeStyle = 'rgba(0,0,0,0.5)'; m.lineWidth = 2; m.stroke();
  }
  m.restore();
  m.lineWidth = 4; m.strokeStyle = '#000'; m.beginPath(); m.arc(c, c, mr, 0, TAU); m.stroke();

  const hp = document.createElement('canvas'); hp.width = hp.height = 6;
  const h = hp.getContext('2d'); h.fillStyle = '#000'; h.beginPath(); h.arc(3, 3, 1.2, 0, TAU); h.fill();
  halftone = ctx.createPattern(hp, 'repeat');
}

function drawSky(px, py) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(skyCanvas, 0, 0);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const s = moonCanvas.width / DPR;
  ctx.drawImage(moonCanvas, W * 0.78 - s / 2 - (px || 0) * 0.015, H * 0.2 - s / 2 - (py || 0) * 0.01, s, s);
}

function drawEmbers(dt, alpha) {
  for (const e of embers) {
    e.y -= e.v * dt; e.x += Math.sin(gt * 0.8 + e.w) * 0.02 * dt;
    if (e.y < -0.03) { e.y = 1.03; e.x = Math.random(); }
    const x = e.x * W, y = e.y * H, s = e.s;
    ctx.globalAlpha = alpha * (0.5 + 0.5 * Math.sin(gt * 4 + e.w));
    ctx.fillStyle = '#ff3a1f';
    ctx.beginPath(); ctx.moveTo(x, y - s * 2.2); ctx.quadraticCurveTo(x + s, y, x, y + s); ctx.quadraticCurveTo(x - s, y, x, y - s * 2.2); ctx.fill();
    ctx.fillStyle = '#ffcf5a'; ctx.fillRect(x - s * 0.25, y - s * 0.2, s * 0.5, s * 0.6);
  }
  ctx.globalAlpha = 1;
}

// =======================================================================
// CHARACTERS & PROPS
// =======================================================================
function ink(g, w) { g.lineWidth = w || 3; g.strokeStyle = '#000'; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(); }
function limb(g, x1, y1, x2, y2, w, col) {
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineCap = 'round';
  g.lineWidth = w + 3.5; g.strokeStyle = '#000'; g.stroke();
  g.lineWidth = w; g.strokeStyle = col; g.stroke();
}
function shadow(g, x, y, rx) { g.fillStyle = 'rgba(0,0,0,0.38)'; g.beginPath(); g.ellipse(x, y, rx, rx * 0.4, 0, 0, TAU); g.fill(); }

function gozaEmblem(g, x, y, s) {
  // the red demon-cat face on Goza's hoodie
  g.beginPath();
  g.moveTo(x - 6 * s, y - 5 * s); g.lineTo(x - 3 * s, y - 2 * s); g.lineTo(x + 3 * s, y - 2 * s); g.lineTo(x + 6 * s, y - 5 * s);
  g.lineTo(x + 5 * s, y + 2 * s); g.lineTo(x, y + 5 * s); g.lineTo(x - 5 * s, y + 2 * s); g.closePath();
  g.fillStyle = '#d4142f'; g.fill(); g.lineWidth = 1; g.strokeStyle = '#000'; g.stroke();
  g.fillStyle = '#000'; g.fillRect(x - 3 * s, y - 0.5 * s, 2 * s, 1.5 * s); g.fillRect(x + 1 * s, y - 0.5 * s, 2 * s, 1.5 * s);
}

const ZCLOTH = '#1b1a22', ZCLOTH2 = '#2c2a36';
function drawZombie(z, opt) {
  const g = ctx, x = z.x, y = z.y, L = z.look, kind = L.kind || 'ped_m';
  const frozen = z.frozen > 0;
  const t = frozen ? 0 : z.walkT;
  const big = kind === 'boomer';
  const step = Math.sin(t) * (z.type === 'walk' ? 2.5 : 4);
  const sway = Math.sin(t * 0.5) * (z.type === 'walk' ? 2 : 1);
  const riseK = z.rise > 0 ? 1 - z.rise * 0.6 : 1;
  const skin = L.skin, skinDk = '#4b2a78', skinLt = '#a07ad6';
  g.save();
  const bakeMode = opt && opt.bake;
  if (z.rise > 0) g.globalAlpha = 1 - z.rise;
  if (!bakeMode) shadow(g, x, y, big ? 20 : 13);
  g.translate(x, y); g.scale(riseK, riseK); g.translate(-x, -y);
  const tx = opt && opt.lookX != null ? opt.lookX : (P ? P.x : x), ty = opt && opt.lookY != null ? opt.lookY : (P ? P.y : y + 50);
  const toP = Math.atan2(ty - y, tx - x);
  const fx = Math.cos(toP), fy = Math.sin(toP);
  const back = fy < -0.45;
  const pants = kind === 'ped_f' ? skin : ZCLOTH;
  // legs (girl pedestrian: bare purple legs under the skirt)
  const lw = big ? 7 : 4.5, lx = big ? 7 : 4;
  limb(g, x - lx, y - 10, x - lx + step, y - 1, lw, pants);
  limb(g, x + lx, y - 10, x + lx - step, y - 1, lw, pants);
  g.fillStyle = '#121016'; for (const sx of [-lx + step, lx - step]) { g.beginPath(); g.ellipse(x + sx, y - 1, big ? 5 : 3.6, 2.2, 0, 0, TAU); g.fill(); }
  const reach = z.atk > 0 ? 18 : 13;
  const armY = y - (big ? 32 : 26);
  const ax = fx * reach, ay = fy * reach * 0.7;
  const sleeve = kind === 'ped_f' || kind === 'ped_v' ? skin : ZCLOTH;
  const arm = (side) => {
    const sx = x + side * (big ? 15 : 8), ex = sx + ax + side * 2, ey = armY + ay + Math.sin(t + side) * 2;
    limb(g, sx, armY, ex, ey, big ? 6 : 4, sleeve);
    g.fillStyle = skin; g.beginPath(); g.arc(ex, ey, big ? 4 : 3, 0, TAU); g.fill(); ink(g, 1.5);
  };
  if (back) { arm(-1); arm(1); }
  // ---- torso
  if (big) {
    // Big Guy Boomer: torn black shirt over a huge purple belly
    g.beginPath(); g.ellipse(x + sway * 0.5, y - 26, 19, 18, 0, 0, TAU); g.fillStyle = ZCLOTH; g.fill(); ink(g);
    if (!back) {
      g.beginPath(); g.ellipse(x + sway * 0.5, y - 20, 14, 12, 0, 0, TAU); g.fillStyle = skin; g.fill(); ink(g, 2.5);
      g.fillStyle = skinLt; g.beginPath(); g.ellipse(x - 4, y - 25, 5, 3, -0.4, 0, TAU); g.fill();
      g.fillStyle = skinDk; for (const [px, py, pr] of [[5, -16, 2.2], [-6, -14, 1.6], [2, -24, 1.4]]) { g.beginPath(); g.arc(x + px, y + py, pr, 0, TAU); g.fill(); }
      g.strokeStyle = '#000'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - 14, y - 28); g.lineTo(x - 9, y - 24); g.lineTo(x - 13, y - 21); g.stroke();
    }
  } else {
    g.beginPath(); g.moveTo(x - 10 + sway, y - 30); g.lineTo(x + 10 + sway, y - 30); g.lineTo(x + 10, y - 11); g.lineTo(x - 10, y - 11); g.closePath();
    g.fillStyle = kind === 'ped_f' ? '#1d2440' : ZCLOTH; g.fill();
    g.save(); g.clip();
    g.fillStyle = ZCLOTH2; g.fillRect(x + 3, y - 32, 10, 24);
    // torn holes showing purple skin
    g.fillStyle = skin;
    if (L.tear !== 1) { g.beginPath(); g.moveTo(x - 7, y - 20); g.lineTo(x - 3, y - 23); g.lineTo(x - 1, y - 18); g.lineTo(x - 5, y - 16); g.closePath(); g.fill(); }
    if (L.tear !== 2) { g.beginPath(); g.moveTo(x + 3, y - 14); g.lineTo(x + 7, y - 16); g.lineTo(x + 8, y - 12); g.closePath(); g.fill(); }
    if (kind === 'ped_v' && !back) { g.fillStyle = '#2c2a36'; g.fillRect(x - 7, y - 30, 3, 19); g.fillRect(x + 4, y - 30, 3, 19); g.fillStyle = '#9aa3b2'; g.fillRect(x - 7, y - 23, 3, 2); g.fillRect(x + 4, y - 23, 3, 2); }
    if ((kind === 'cop_m' || kind === 'cop_f') && !back) {
      g.fillStyle = '#c9ced8'; g.beginPath(); g.moveTo(x - 6, y - 26); g.lineTo(x - 2, y - 26); g.lineTo(x - 2, y - 22); g.lineTo(x - 4, y - 20); g.lineTo(x - 6, y - 22); g.closePath(); g.fill();
      g.fillStyle = '#0d0c12'; g.fillRect(x - 11, y - 16, 22, 4); g.fillStyle = '#9aa3b2'; g.fillRect(x - 2, y - 16, 4, 4);
    }
    if (kind === 'ped_f') { g.fillStyle = '#121a33'; g.beginPath(); g.moveTo(x - 11, y - 17); g.lineTo(x + 11, y - 17); g.lineTo(x + 13, y - 9); g.lineTo(x + 8, y - 11); g.lineTo(x + 4, y - 8); g.lineTo(x - 1, y - 11); g.lineTo(x - 6, y - 8); g.lineTo(x - 13, y - 9); g.closePath(); g.fill(); }
    g.restore();
    g.beginPath(); g.moveTo(x - 10 + sway, y - 30); g.lineTo(x + 10 + sway, y - 30); g.lineTo(x + 10, y - 11); g.lineTo(x - 10, y - 11); g.closePath(); ink(g);
  }
  if (!back) { arm(-1); arm(1); }
  // ---- head
  const hx = x + sway * 1.2, hy = y - (big ? 52 : 39), hr = big ? 12 : 10.5;
  if (kind === 'ped_f' || kind === 'cop_f') {
    // long purple hair (girl pedestrian) or ponytail (girl cop) behind the head
    g.fillStyle = '#4a2470';
    g.beginPath();
    if (kind === 'ped_f') { g.moveTo(hx - 12, hy - 3); g.quadraticCurveTo(hx - 15, hy + 14, hx - 9, hy + 18); g.lineTo(hx + 9, hy + 18); g.quadraticCurveTo(hx + 15, hy + 14, hx + 12, hy - 3); g.closePath(); }
    else { g.ellipse(hx - 9 * (fx >= 0 ? 1 : -1), hy + 6, 4.5, 8, 0.3, 0, TAU); }
    g.fill(); ink(g, 2);
  }
  g.fillStyle = skin; g.beginPath(); g.arc(hx, hy, hr, 0, TAU); g.fill(); ink(g);
  g.save(); g.beginPath(); g.arc(hx, hy, hr, 0, TAU); g.clip();
  g.fillStyle = skinDk; g.beginPath(); g.arc(hx + hr * 0.55, hy + hr * 0.4, hr * 0.8, 0, TAU); g.fill();
  g.fillStyle = skinLt; g.beginPath(); g.arc(hx - hr * 0.35, hy - hr * 0.45, hr * 0.38, 0, TAU); g.fill();
  g.fillStyle = skinDk; g.beginPath(); g.arc(hx - 4, hy - 6, 1.6, 0, TAU); g.arc(hx + 5, hy - 3, 1.2, 0, TAU); g.fill();
  g.restore();
  if (kind === 'ped_m' && !L.eye) { g.strokeStyle = '#2a1340'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(hx - 2, hy - hr); g.lineTo(hx + 1, hy - 6); g.lineTo(hx - 1, hy - 3); g.stroke(); }
  if (kind === 'ped_f') { g.fillStyle = '#4a2470'; g.beginPath(); g.arc(hx, hy - 2, hr + 0.5, Math.PI * 1.05, Math.PI * 1.95); g.lineTo(hx + 4, hy - 6); g.lineTo(hx - 3, hy - 4); g.closePath(); g.fill(); ink(g, 2); }
  if (kind === 'cop_m' || kind === 'cop_f') {
    // police cap with silver badge
    g.fillStyle = '#121118'; g.beginPath(); g.ellipse(hx, hy - 6, hr + 3, 5, 0, Math.PI, TAU); g.lineTo(hx + hr + 3, hy - 4); g.lineTo(hx - hr - 3, hy - 4); g.closePath(); g.fill(); ink(g, 2);
    g.beginPath(); g.ellipse(hx + fx * 3, hy - 4, hr + 1, 2.6, 0, 0, Math.PI); g.fillStyle = '#060509'; g.fill(); ink(g, 1.5);
    g.fillStyle = '#c9ced8'; g.beginPath(); g.moveTo(hx - 2.5, hy - 12); g.lineTo(hx + 2.5, hy - 12); g.lineTo(hx + 2.5, hy - 8); g.lineTo(hx, hy - 6.5); g.lineTo(hx - 2.5, hy - 8); g.closePath(); g.fill(); g.lineWidth = 1; g.strokeStyle = '#000'; g.stroke();
  }
  if (!back) {
    const ex = hx + fx * 3.5, ey = hy + (big ? 0 : 1);
    // glowing red eyes
    g.fillStyle = frozen ? 'rgba(233,196,255,0.4)' : 'rgba(255,30,30,0.35)';
    g.beginPath(); g.arc(ex, ey, 8, 0, TAU); g.fill();
    g.fillStyle = '#000'; g.beginPath(); g.ellipse(ex - 3.8, ey, 3.2, 2.6, 0.25, 0, TAU); g.ellipse(ex + 3.8, ey - 0.5, 3.2, 2.6, -0.25, 0, TAU); g.fill();
    g.fillStyle = frozen ? '#e9c4ff' : '#ff1a1a';
    g.beginPath(); g.ellipse(ex - 3.8, ey, 2.3, 1.8, 0.25, 0, TAU); g.ellipse(ex + 3.8, ey - 0.5, 2.3, 1.8, -0.25, 0, TAU); g.fill();
    g.fillStyle = '#fff5f5'; g.fillRect(ex - 4.4, ey - 1, 1, 1); g.fillRect(ex + 3.2, ey - 1.5, 1, 1);
    // brows + snarling mouth
    g.strokeStyle = '#000'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(ex - 7, ey - 4); g.lineTo(ex - 2, ey - 2.5); g.moveTo(ex + 7, ey - 4.5); g.lineTo(ex + 2, ey - 3); g.stroke();
    g.fillStyle = '#2a0812'; g.beginPath(); g.moveTo(ex - 4, ey + 4.5); g.lineTo(ex + 4, ey + 4.5); g.lineTo(ex + 2.5, ey + 8); g.lineTo(ex - 2.5, ey + 8); g.closePath(); g.fill(); ink(g, 1);
    g.fillStyle = '#f2ead8'; g.fillRect(ex - 3, ey + 4.5, 1.5, 1.6); g.fillRect(ex + 1.5, ey + 4.5, 1.5, 1.6); g.fillRect(ex - 0.6, ey + 6.6, 1.3, 1.4);
    if (L.eye) {
      // the dangling eyeball from the sheet
      const dx = ex - 6, dy = ey + 2, sw = Math.sin(t * 2) * 3;
      g.strokeStyle = '#000'; g.lineWidth = 3; g.beginPath(); g.moveTo(dx, dy); g.quadraticCurveTo(dx - 3, dy + 6, dx - 4 + sw, dy + 10); g.stroke();
      g.strokeStyle = '#c4405a'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#f2ead8'; g.beginPath(); g.arc(dx - 4 + sw, dy + 11, 2.8, 0, TAU); g.fill(); ink(g, 1.2);
      g.fillStyle = '#7b2fd0'; g.beginPath(); g.arc(dx - 4 + sw, dy + 11.5, 1.2, 0, TAU); g.fill();
    }
  }
  if (bakeMode) { g.restore(); return; }
  // hit flash
  if (z.flash > 0) {
    g.globalAlpha = 0.75; g.fillStyle = '#fff';
    g.beginPath(); g.arc(hx, hy, hr, 0, TAU); g.fill();
    if (big) { g.beginPath(); g.ellipse(x, y - 26, 19, 18, 0, 0, TAU); g.fill(); } else g.fillRect(x - 10, y - 30, 20, 19);
    g.globalAlpha = 1;
  }
  if (frozen) {
    g.globalAlpha = 0.45; g.fillStyle = '#b04cff';
    g.beginPath(); g.arc(hx, hy, hr + 1, 0, TAU); g.fill(); g.fillRect(x - 11, y - 31, 22, 21);
    g.globalAlpha = 1;
    g.strokeStyle = '#e9c4ff'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y - 22, 20, 0, TAU); g.stroke();
    g.save(); g.translate(x, y - 22); g.rotate(-z.frozen * 2); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -14); g.stroke(); g.restore();
  }
  if (z.stun > 0 && !frozen) {
    for (let i = 0; i < 3; i++) { const a = gt * 6 + i * TAU / 3; g.fillStyle = '#ffd21a'; g.font = '900 10px ' + FONT; g.textAlign = 'center'; g.fillText('★', hx + Math.cos(a) * 12, hy - 14 + Math.sin(a) * 4); }
  }
  if (P && P.instaT > 0) { g.fillStyle = 'rgba(255,23,68,0.3)'; g.beginPath(); g.arc(hx, hy, hr + 3, 0, TAU); g.fill(); }
  g.restore();
}

function drawCorpse(c) {
  const g = ctx, k = c.t / c.max;
  g.save();
  g.globalAlpha = Math.min(1, k * 1.6);
  g.translate(c.x, c.y - 6); g.scale(ZS, ZS);
  g.rotate((c.face > 0 ? -1 : 1) * Math.PI / 2 * Math.min(1, (1 - k) * 4));
  g.scale(1, 1 - (1 - k) * 0.3);
  const bigC = c.look.kind === 'boomer';
  g.fillStyle = c.burn ? '#2a1a12' : c.frozen ? '#b04cff' : '#1b1a22';
  g.fillRect(bigC ? -16 : -10, -20, bigC ? 32 : 20, 19); ink(g);
  g.fillStyle = c.burn ? '#1a1a1a' : c.look.skin; g.beginPath(); g.arc(0, -29, bigC ? 12 : 10, 0, TAU); g.fill(); ink(g);
  if (!c.burn) { g.fillStyle = '#ff1a1a'; g.globalAlpha *= 0.6; g.fillRect(-4, -30, 2, 2); g.fillRect(2, -30, 2, 2); }
  g.restore();
  if (c.burn && Math.random() < 0.3) cloud(c.x + rand(-8, 8), c.y - 14, 6, '#3a3036', 0.6, 0, -30);
}

function drawMachine(p) {
  const g = ctx, X = p.tx * T, B = (p.ty + 1) * T, Hm = 64, x0 = X + 3, w = T - 6;
  const fl = baking ? 1 : 0.75 + 0.25 * Math.sin(gt * 7 + p.tx);
  g.fillStyle = p.glow; g.globalAlpha = 0.18 * fl; g.beginPath(); g.ellipse(X + T / 2, B - 4, 34, 14, 0, 0, TAU); g.fill(); g.globalAlpha = 1;
  // side + top
  g.fillStyle = '#000'; g.globalAlpha = 0.35; g.fillRect(x0 + 4, B - 4, w, 6); g.globalAlpha = 1;
  g.fillStyle = p.trim; g.fillRect(x0, B - Hm - 12, w, 12); g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(x0, B - Hm - 12, w, 12);
  g.fillStyle = p.body; g.fillRect(x0, B - Hm, w, Hm); g.strokeRect(x0, B - Hm, w, Hm);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x0 + w - 7, B - Hm, 7, Hm);
  if (p.id === 'zap') {
    for (let i = 0; i < 4; i++) { g.fillStyle = '#111'; g.fillRect(x0, B - Hm + 6 + i * 4, w, 2); }
    g.beginPath(); g.moveTo(x0 + 20, B - Hm + 24); g.lineTo(x0 + 9, B - Hm + 40); g.lineTo(x0 + 17, B - Hm + 40); g.lineTo(x0 + 12, B - Hm + 54); g.lineTo(x0 + 26, B - Hm + 36); g.lineTo(x0 + 18, B - Hm + 36); g.closePath();
    g.fillStyle = '#111'; g.fill(); g.strokeStyle = '#fff36b'; g.lineWidth = 1.5; g.stroke();

  } else if (p.id === 'tuff') {
    g.fillStyle = '#fff'; g.fillRect(x0 + 3, B - Hm + 5, w - 6, 9); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.strokeRect(x0 + 3, B - Hm + 5, w - 6, 9);
    g.font = 'italic 900 8px ' + FONT; g.textAlign = 'center'; g.fillStyle = '#7b2fd0'; g.fillText('TUFF', X + T / 2, B - Hm + 12);
    g.beginPath(); g.moveTo(X + T / 2, B - Hm + 20); g.lineTo(x0 + w - 6, B - Hm + 25); g.lineTo(x0 + w - 8, B - Hm + 40); g.lineTo(X + T / 2, B - Hm + 48); g.lineTo(x0 + 8, B - Hm + 40); g.lineTo(x0 + 6, B - Hm + 25); g.closePath();
    g.fillStyle = '#fff'; g.fill(); ink(g, 2); g.fillStyle = '#7b2fd0'; g.fillRect(X + T / 2 - 2, B - Hm + 26, 4, 14); g.fillRect(X + T / 2 - 7, B - Hm + 31, 14, 4);
  } else {
    for (const [i, c] of [['0', '#ff8a1f'], ['1', '#2fbf4f'], ['2', '#e0132f']]) { g.fillStyle = c; g.fillRect(x0, B - Hm + 3 + i * 4, w, 3); }
    g.fillStyle = '#d9e3ef'; g.fillRect(x0 + 4, B - Hm + 18, w - 8, 26); g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(x0 + 4, B - Hm + 18, w - 8, 26);
    g.save(); g.beginPath(); g.rect(x0 + 5, B - Hm + 19, w - 10, 24); g.clip();
    g.fillStyle = '#2a7fff'; g.fillRect(x0 + 5, B - Hm + 27, w - 10, 16);
    g.strokeStyle = '#9fe6ff'; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i < 3; i++) { const yy = B - Hm + 30 + i * 4; g.moveTo(x0 + 5, yy); for (let xx = 0; xx < w - 10; xx += 4) g.lineTo(x0 + 5 + xx, yy + Math.sin(gt * 4 + xx * 0.4 + i) * 1.5); }
    g.stroke(); g.restore();
    g.font = 'italic 900 7px ' + FONT; g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText('FLASH', X + T / 2, B - Hm + 52);
  }
  g.fillStyle = p.glow; g.globalAlpha = fl; g.fillRect(x0 + 6, B - 10, w - 12, 4); g.globalAlpha = 1;
  g.strokeStyle = '#000'; g.lineWidth = 1.5; g.strokeRect(x0 + 6, B - 10, w - 12, 4);
}

function drawBox() {
  const g = ctx, X = box.tx * T, B = (box.ty + 1) * T, w = T * 2, h = 26;
  if (box.state !== 'idle') {
    const a = box.state === 'spin' ? Math.min(1, box.t * 2) : box.state === 'ready' ? 1 : box.lid;
    const gr = g.createLinearGradient(0, B - 300, 0, B - h);
    gr.addColorStop(0, 'rgba(176,76,255,0)'); gr.addColorStop(1, 'rgba(255,42,85,' + 0.55 * a + ')');
    g.fillStyle = gr; g.fillRect(X + 14, B - 300, w - 28, 300 - h);
  }
  shadow(g, X + T, B - 2, 42);
  // chest body
  g.fillStyle = '#7a3a1c'; g.fillRect(X + 2, B - h, w - 4, h); ink(g);
  g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(X + 2, B - h, w - 4, h);
  g.fillStyle = '#c4283a'; g.fillRect(X + 2, B - h + 8, w - 4, 6); g.fillStyle = '#f4efe9'; g.fillRect(X + 2, B - h + 14, w - 4, 3);
  g.fillStyle = '#ffd21a'; for (const xx of [X + 6, X + w - 12]) { g.fillRect(xx, B - h, 6, h); g.strokeStyle = '#000'; g.lineWidth = 1.5; g.strokeRect(xx, B - h, 6, h); }
  // lid
  g.save(); g.translate(X + 2, B - h); g.rotate(-box.lid * 0.9);
  g.fillStyle = '#8a4a24'; g.fillRect(0, -16, w - 4, 16); g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(0, -16, w - 4, 16);
  g.fillStyle = '#c4283a'; g.fillRect(0, -10, w - 4, 4);
  g.restore();
  // glowing ? / skull emblem
  const pulse = 0.6 + 0.4 * Math.sin(gt * 4);
  g.font = 'italic 900 22px ' + FONT; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 4; g.strokeStyle = '#000'; g.strokeText('?', X + T, B - h / 2 + 2);
  g.fillStyle = 'rgba(255,210,26,' + pulse + ')'; g.fillText('?', X + T, B - h / 2 + 2);
  // floating weapon
  if (box.show && (box.state === 'spin' || box.state === 'ready')) {
    const rise = box.state === 'spin' ? Math.min(1, box.t / 2.8) : 1;
    const by = B - h - 20 - rise * 34 + Math.sin(gt * 3) * 3;
    g.save(); g.translate(X + T - 20, by);
    if (box.state === 'ready' && box.t > 6 && Math.floor(gt * 8) % 2) g.globalAlpha = 0.4;
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.ellipse(18, 0, 34, 14, 0, 0, TAU); g.fill();
    drawGun(g, box.show, { lw: 1.6 });
    g.restore();
  }
}

function drawStatue() {
  const g = ctx, cx = 31 * T, B = 39 * T;
  shadow(g, cx, B - 4, 44);
  // pedestal
  g.fillStyle = '#c9c3d0'; g.fillRect(cx - 34, B - 64, 68, 14); g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(cx - 34, B - 64, 68, 14);
  g.fillStyle = '#9b94a3'; g.fillRect(cx - 34, B - 50, 68, 50); g.strokeRect(cx - 34, B - 50, 68, 50);
  g.font = 'italic 900 11px ' + FONT; g.textAlign = 'center'; g.fillStyle = '#c4283a'; g.fillText('CAPT. WESTVALE', cx, B - 30); g.fillStyle = '#000'; g.fillText('EST. 1931', cx, B - 17);
  // pirate captain (bronze-gray cel shade)
  const sx = cx, sy = B - 64;
  limb(g, sx - 6, sy - 2, sx - 6, sy - 22, 7, '#7d8a8a');
  limb(g, sx + 6, sy - 2, sx + 6, sy - 22, 7, '#7d8a8a');
  g.beginPath(); g.moveTo(sx - 13, sy - 50); g.lineTo(sx + 13, sy - 50); g.lineTo(sx + 15, sy - 20); g.lineTo(sx - 15, sy - 20); g.closePath();
  g.fillStyle = '#8fa0a0'; g.fill(); ink(g);
  g.beginPath(); g.moveTo(sx - 13, sy - 50); g.lineTo(sx - 26, sy - 14); g.lineTo(sx - 13, sy - 22); g.closePath(); g.fillStyle = '#c4283a'; g.fill(); ink(g); // red cape
  limb(g, sx + 12, sy - 46, sx + 26, sy - 66, 6, '#8fa0a0');
  limb(g, sx + 26, sy - 66, sx + 44, sy - 100, 3, '#e8edf5'); // raised cutlass
  g.fillStyle = '#ffd21a'; g.beginPath(); g.arc(sx + 26, sy - 66, 4, 0, TAU); g.fill(); ink(g, 2);
  g.fillStyle = '#9fb0b0'; g.beginPath(); g.arc(sx, sy - 60, 11, 0, TAU); g.fill(); ink(g);
  g.beginPath(); g.moveTo(sx - 20, sy - 64); g.quadraticCurveTo(sx, sy - 90, sx + 20, sy - 64); g.quadraticCurveTo(sx, sy - 70, sx - 20, sy - 64);
  g.fillStyle = '#1a1a1a'; g.fill(); ink(g); // tricorn hat
  pirateSkull(g, sx, sy - 73, 0.22);
}

function drawPowerup(p) {
  const g = ctx, bob = Math.sin(gt * 4 + p.x) * 4, x = p.x, y = p.y - 24 + bob;
  if (p.life - p.t < 6 && Math.floor(gt * 8) % 2) return;
  const col = p.type === 'ammo' ? '#9dff3c' : p.type === 'insta' ? '#ff1744' : '#ffd21a';
  g.globalAlpha = 0.35 + 0.15 * Math.sin(gt * 6);
  g.fillStyle = col; g.beginPath(); g.ellipse(x, p.y, 26, 10, 0, 0, TAU); g.fill();
  g.beginPath(); g.arc(x, y, 24, 0, TAU); g.fill();
  g.globalAlpha = 1;
  if (p.type === 'ammo') {
    g.fillStyle = '#4f6b2a'; g.fillRect(x - 15, y - 9, 30, 18); ink(g); g.strokeStyle = '#000'; g.lineWidth = 3; g.strokeRect(x - 15, y - 9, 30, 18);
    for (let i = 0; i < 4; i++) { g.fillStyle = '#e8b84a'; g.fillRect(x - 11 + i * 6, y - 16, 4, 9); g.strokeStyle = '#000'; g.lineWidth = 1.2; g.strokeRect(x - 11 + i * 6, y - 16, 4, 9); }
    g.font = '900 8px ' + FONT; g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText('MAX', x, y + 4);
  } else if (p.type === 'insta') {
    pirateSkull(g, x, y, 0.55, '#ff1744');
  } else {
    g.fillStyle = '#ffd21a'; g.beginPath(); g.arc(x, y, 13, 0, TAU); g.fill(); ink(g);
    g.fillStyle = '#111';
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x, y); g.arc(x, y, 10, i * TAU / 3 + gt, i * TAU / 3 + gt + 0.8); g.closePath(); g.fill(); }
    g.beginPath(); g.arc(x, y, 3, 0, TAU); g.fillStyle = '#ffd21a'; g.fill(); ink(g, 1.5);
  }
}

// =======================================================================
// WORLD RENDER
// =======================================================================
// =======================================================================
// PIXEL BUFFER: the world is drawn at art resolution, then scaled up by a whole number
// with nearest-neighbour (Point filtering) -> crisp pixels, no sub-pixel blur.
// =======================================================================
const wb = document.createElement('canvas');
const wbx = wb.getContext('2d');
let PX = 3;                                   // screen (CSS) pixels per art pixel - always an integer
const view = { offX: 0, offY: 0, ox: 0, oy: 0 };
let labels = [];
function sizeBuffer(baseZ) {
  PX = clamp(Math.round(baseZ * AP), 2, 8);
  Z = PX / AP;
  wb.width = Math.ceil(W / PX) + 2; wb.height = Math.ceil(H / PX) + 2;
}
function toScreen(wx, wy) { return { x: view.ox + (view.offX + wx / AP) * PX, y: view.oy + (view.offY + wy / AP) * PX }; }
function toWorld(sx, sy) { return { x: ((sx - view.ox) / PX - view.offX) * AP, y: ((sy - view.oy) / PX - view.offY) * AP }; }
const snapA = v => Math.round(v / AP) * AP;

// ---- pixel Goza in the world ---------------------------------------------------------------
function gozaDir(aim) { const s = Math.sin(aim); return s < -0.55 ? 'up' : s > 0.55 ? 'down' : 'side'; }
/** Draw pixel Goza with feet at (x, y). k = size of one sprite pixel (AP in the world, an integer on menus). */
function drawPixelGoza(g, x, y, dir, frame, flip, k) {
  const img = gozaFrames[dir][frame & 3];
  g.save(); g.imageSmoothingEnabled = false;
  if (flip) { g.translate(x + 8 * k, y - 27 * k); g.scale(-1, 1); g.drawImage(img, 0, 0, 16 * k, 28 * k); }
  else g.drawImage(img, x - 8 * k, y - 27 * k, 16 * k, 28 * k);
  g.restore();
}
const _gunCache = new Map();
const GUN_STEPS = 48;
/** Arm + hand + gun, baked at art resolution for one of 48 aim angles (alpha hardened, cached). */
function gunSprite(id, ang) {
  const step = ((Math.round(ang / TAU * GUN_STEPS) % GUN_STEPS) + GUN_STEPS) % GUN_STEPS;
  const key = id + '|' + (settings.gunMode === 'custom' ? settings.gunHue : 'd') + '|' + step;
  let c = _gunCache.get(key);
  if (c) return c;
  const a = step / GUN_STEPS * TAU;
  c = bakeVector(60, 60, g => { g.translate(30, 30); g.scale(1.35 / AP, 1.35 / AP); }, () => {
    const g = ctx;
    g.rotate(a);
    if (Math.cos(a) < 0) g.scale(1, -1);
    g.translate(7, 2);
    limb(g, -8, 0, 2, 2, 4.5, '#18171f');
    g.fillStyle = '#f4f4f8'; g.fillRect(-3, -1.2, 2, 4.4); g.fillStyle = '#7b2fd0'; g.fillRect(-0.6, -0.8, 1.6, 4);
    g.fillStyle = '#e8b48a'; g.beginPath(); g.arc(2, 3, 3.2, 0, TAU); g.fill(); ink(g, 1.5);
    g.scale(0.66, 0.66);
    drawGun(g, id, { lw: 2.6 });
  });
  if (_gunCache.size > 600) _gunCache.clear();
  _gunCache.set(key, c);
  return c;
}
function heldGunAngle() {
  const w = curW(), d = WEAP[w.id];
  let ang = P.aim;
  if (d.kind === 'melee' && P.swingT > 0) ang = P.swingDir + (P.swingSide || 1) * (1 - P.swingT / 0.22) * 2.2 - (P.swingSide || 1) * 1.1;
  if (P.swapT > 0) ang += P.swapT * 3;
  if (P.reloading) ang += (P.reloadPhase === 1 || P.reloadPhase === 2) ? 0.6 * Math.cos(P.aim) : 0.2;
  return ang;
}
function drawHeldGunPx() {
  const ang = heldGunAngle();
  const spr = gunSprite(curW().id, ang);
  const kx = -Math.round(Math.cos(P.aim) * P.kick * 2) * AP, ky = -Math.round(Math.sin(P.aim) * P.kick * 2) * AP;
  const sx = snapA(P.x) + kx, sy = snapA(P.y - 24) + ky;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(spr, sx - 30 * AP, sy - 30 * AP, 60 * AP, 60 * AP);
}
function pxShadow(x, y, w) {
  ctx.fillStyle = 'rgba(20,0,30,0.32)';
  const ax = snapA(x), ay = snapA(y);
  ctx.fillRect(ax - w * AP, ay - AP, w * 2 * AP, 2 * AP);
  ctx.fillRect(ax - (w - 2) * AP, ay - 2 * AP, (w - 2) * 2 * AP, AP);
  ctx.fillRect(ax - (w - 2) * AP, ay + AP, (w - 2) * 2 * AP, AP);
}
function drawPlayer(ghost) {
  const g = ctx, x = snapA(P.x), y = snapA(P.y);
  if (P.downed > 0) {
    pxShadow(P.x, P.y, 9);
    g.save(); g.imageSmoothingEnabled = false; g.translate(x, y - 6 * AP); g.rotate(-Math.PI / 2 * P.face);
    g.drawImage(gozaFrames.down[0], -14 * AP, -8 * AP, 16 * AP, 28 * AP); g.restore();
    const f = 1 - P.downed / 5;
    g.lineWidth = 5; g.strokeStyle = '#000'; g.beginPath(); g.arc(x, y - 50, 16, -Math.PI / 2, -Math.PI / 2 + TAU * f); g.stroke();
    g.lineWidth = 3; g.strokeStyle = '#ffd21a'; g.stroke();
    if (Math.random() < 0.3) part(x + rand(-14, 14), y - 20 + rand(-10, 10), rand(-60, 60), rand(-60, 60), 0.15, 2, '#ffd21a', 'spark');
    return;
  }
  const blink = P.inv > 0 && Math.floor(gt * 16) % 2;
  g.globalAlpha = ghost ? 0.38 : blink ? 0.5 : 1;
  const dir = gozaDir(P.aim), flip = dir === 'side' && Math.cos(P.aim) < 0;
  const frame = P.moving ? Math.floor(P.walkT * 0.9) & 3 : 0;
  if (!ghost) pxShadow(P.x, P.y, 7);
  if (dir === 'up' && !ghost) drawHeldGunPx();
  drawPixelGoza(g, x, y, dir, frame, flip, AP);
  if (dir !== 'up' && !ghost) drawHeldGunPx();
  g.globalAlpha = 1;
}

// ---- zombies: vector designs baked once per pose into crisp pixel sprites --------------
const ZS = 1.3;                       // zombies drawn a bit bigger to match the pixel characters
const _zCache = new Map();
function zombieSprite(z, variant) {
  const L = z.look;
  const tx = P ? P.x : z.x, ty = P ? P.y : z.y + 100;
  const ang = z.lookAng != null ? z.lookAng : Math.atan2(ty - z.y, tx - z.x);
  const dir = ((Math.round(ang / (TAU / 8)) % 8) + 8) % 8;
  const frame = z.frozen > 0 ? 0 : ((Math.floor(z.walkT / (Math.PI / 2)) % 4) + 4) % 4;
  const key = [L.kind, SKINS.indexOf(L.skin), L.eye ? 1 : 0, (L.tear || 0) % 2, frame, dir, z.atk > 0 ? 1 : 0, z.type === 'walk' ? 0 : 1, variant || ''].join('|');
  let c = _zCache.get(key);
  if (c) return c;
  const da = dir * TAU / 8;
  const fake = { x: 0, y: 0, look: Object.assign({}, L, { tear: (L.tear || 0) % 2 }), walkT: frame * Math.PI / 2 + 0.4, type: z.type, atk: z.atk > 0 ? 0.1 : 0, flash: 0, frozen: 0, stun: 0, rise: 0 };
  c = bakeVector(44, 58, g => { g.translate(22, 54); g.scale(ZS / AP, ZS / AP); }, () => drawZombie(fake, { lookX: Math.cos(da) * 100, lookY: Math.sin(da) * 100, bake: true }));
  if (variant) {
    const g = c.getContext('2d');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = variant === 'flash' ? 'rgba(255,255,255,0.85)' : 'rgba(176,76,255,0.55)';
    g.fillRect(0, 0, c.width, c.height);
    g.globalCompositeOperation = 'source-over';
  }
  if (_zCache.size > 1500) _zCache.clear();
  _zCache.set(key, c);
  return c;
}
function drawZombiePx(z, ghost) {
  const g = ctx, x = snapA(z.x), y = snapA(z.y);
  if (!ghost) pxShadow(z.x, z.y, z.look.kind === 'boomer' ? 10 : 7);
  const variant = z.flash > 0 ? 'flash' : z.frozen > 0 ? 'frozen' : '';
  const spr = zombieSprite(z, variant);
  g.save();
  g.imageSmoothingEnabled = false;
  g.globalAlpha = ghost ? 0.3 : z.rise > 0 ? 1 - z.rise : 1;
  g.drawImage(spr, x - 22 * AP, y - 54 * AP, 44 * AP, 58 * AP);
  g.restore();
  if (ghost) return;
  const headY = y - (z.look.kind === 'boomer' ? 80 : 60);
  if (z.stun > 0 && !z.frozen) for (let i = 0; i < 3; i++) { const a = gt * 6 + i * TAU / 3; g.fillStyle = '#ffd21a'; g.fillRect(snapA(x + Math.cos(a) * 14), snapA(headY + Math.sin(a) * 4), AP * 2, AP * 2); }
  if (z.frozen > 0) { g.fillStyle = '#e9c4ff'; for (let i = 0; i < 12; i++) { const a = i / 12 * TAU - z.frozen * 2; g.fillRect(snapA(x + Math.cos(a) * 22), snapA(y - 28 + Math.sin(a) * 22), AP, AP); } }
  if (P && P.instaT > 0) { g.fillStyle = 'rgba(255,23,68,0.5)'; g.fillRect(x - 3 * AP, headY - 6 * AP, 6 * AP, AP); }
}

// ---- machines, box, statue as baked pixel sprites ------------------------------------
const _propCache = {};
function drawMachinePx(p) {
  let c = _propCache['m' + p.id];
  const X0 = p.tx * T - 5 * AP, Y0 = (p.ty + 1) * T - 37 * AP;
  if (!c) c = _propCache['m' + p.id] = bakeVector(26, 42, g => { g.scale(1 / AP, 1 / AP); g.translate(-X0, -Y0); }, () => drawMachine(p));
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, X0, Y0, 26 * AP, 42 * AP);
  // living glow strip + the odd spark
  const fl = 0.6 + 0.4 * Math.sin(gt * 7 + p.tx);
  ctx.globalAlpha = fl; ctx.fillStyle = p.glow; ctx.fillRect(p.tx * T + 4 * AP, (p.ty + 1) * T - 4 * AP, 8 * AP, AP); ctx.globalAlpha = 1;
  if (p.id === 'zap' && Math.random() < 0.05) tracer(p.tx * T + rand(0, T), (p.ty + 1) * T - 76, p.tx * T + rand(-10, 50), (p.ty + 1) * T - rand(90, 110), '#fff36b', 2, 0.1, 'lightning');
}
function drawBoxPx() {
  if (box.state !== 'idle' || box.lid > 0) { drawBox(); return; }
  let c = _propCache.box;
  const X0 = box.tx * T - 4 * AP, Y0 = (box.ty + 1) * T - 22 * AP;
  if (!c) c = _propCache.box = bakeVector(40, 26, g => { g.scale(1 / AP, 1 / AP); g.translate(-X0, -Y0); }, () => drawBox());
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c, X0, Y0, 40 * AP, 26 * AP);
  const pulse = 0.5 + 0.5 * Math.sin(gt * 4);
  ctx.globalAlpha = pulse * 0.8; ctx.fillStyle = '#ffd21a';
  ctx.fillRect(box.tx * T + T - 2 * AP, (box.ty + 1) * T - 9 * AP, 3 * AP, 4 * AP); ctx.globalAlpha = 1;
}
function drawStatuePx() {
  const X = 31 * T - 20 * AP, Y = 39 * T - 70 * AP;
  pxShadow(31 * T, 39 * T - 2 * AP, 18);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(statueArt, X, Y, 40 * AP, 70 * AP);
  labels.push({ x: 31 * T, y: 39 * T - 11 * AP, text: 'CAPT. WESTVALE', size: 3.2, col: '#111018', plain: true });
  labels.push({ x: 31 * T, y: 39 * T - 6.5 * AP, text: 'EST. 1931', size: 3.2, col: '#111018', plain: true });
}

function occluded(e, rows) {
  const tx = Math.floor(e.x / T), ty = Math.floor(e.y / T);
  for (let dy = 1; dy <= rows; dy++) if (heightAt(tx, ty + dy) >= WH) return true;
  return false;
}

function drawWorld() {
  const sk = settings.shake ? cam.shake : 0;
  const shx = sk ? rand(-sk, sk) : 0, shy = sk ? rand(-sk, sk) : 0;
  const bw = wb.width, bh = wb.height;
  view.offX = Math.floor(bw / 2) - Math.round((cam.x + shx) / AP);
  view.offY = Math.floor(bh / 2) - Math.round((cam.y + shy) / AP);
  view.ox = Math.round(W / 2 - Math.floor(bw / 2) * PX); view.oy = Math.round(H / 2 - Math.floor(bh / 2) * PX);
  const main = ctx; ctx = wbx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, bw, bh);
  ctx.imageSmoothingEnabled = false;
  ctx.setTransform(1 / AP, 0, 0, 1 / AP, view.offX, view.offY);
  labels = [];
  const vx0 = -view.offX * AP, vy0 = -view.offY * AP, vx1 = vx0 + bw * AP, vy1 = vy0 + bh * AP;

  // floor (art-res canvas, drawn 1:1)
  const ax0 = clamp(Math.floor(vx0 / AP), 0, MW * A), ay0 = clamp(Math.floor(vy0 / AP), 0, MH * A);
  const ax1 = clamp(Math.ceil(vx1 / AP), 0, MW * A), ay1 = clamp(Math.ceil(vy1 / AP) + 16, 0, MH * A);
  if (ax1 > ax0 && ay1 > ay0) ctx.drawImage(floorCanvas, ax0, ay0, ax1 - ax0, ay1 - ay0, ax0 * AP, ay0 * AP, (ax1 - ax0) * AP, (ay1 - ay0) * AP);

  // floor-level fx
  for (const t of trails) {
    const a = t.life / t.max;
    ctx.globalAlpha = Math.min(1, a * 1.5);
    ctx.fillStyle = 'rgba(255,43,214,0.35)'; ctx.beginPath(); ctx.ellipse(t.x, t.y, t.r * 1.4, t.r * 0.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ff2bd6'; ctx.beginPath(); ctx.ellipse(t.x, t.y, t.r, t.r * 0.55, 0, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const f of fields) {
    const a = Math.min(1, f.life / 0.4);
    ctx.save(); ctx.translate(f.x, f.y); ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(90,40,140,0.35)'; ctx.beginPath(); ctx.arc(0, 0, f.r, 0, TAU); ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.rotate(gt * (1 + i) * (i % 2 ? -1 : 1) * 0.6);
      ctx.setLineDash([12, 8]); ctx.lineWidth = 3; ctx.strokeStyle = i % 2 ? '#d58cff' : '#b04cff';
      ctx.beginPath(); ctx.arc(0, 0, f.r * (0.4 + i * 0.28), 0, TAU); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.restore();
  }
  for (const p of powerups) { ctx.globalAlpha = 0.25; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 20, 8, 0, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;

  // depth-sorted entities interleaved with wall rows
  const items = [];
  for (const c of corpses) items.push([c.y - 2, 0, c]);
  for (const z of zombies) if (!z.dead) items.push([z.y, 1, z]);
  if (P) items.push([P.y, 2, P]);
  for (const p of perks) items.push([(p.ty + 1) * T - 0.5, 3, p]);
  items.push([(box.ty + 1) * T - 0.5, 4, box]);
  items.push([39 * T - 0.5, 5, null]);
  for (const p of powerups) items.push([p.y, 6, p]);
  items.sort((a, b) => a[0] - b[0]);
  const drawItem = it => {
    switch (it[1]) {
      case 0: drawCorpse(it[2]); break;
      case 1: drawZombiePx(it[2]); break;
      case 2: drawPlayer(); break;
      case 3: drawMachinePx(it[2]); break;
      case 4: drawBoxPx(); break;
      case 5: drawStatuePx(); break;
      case 6: drawPowerup(it[2]); break;
    }
  };
  const r0 = clamp(Math.floor(vy0 / T) - 1, 0, MH - 1), r1 = clamp(Math.floor((vy1 + PAD) / T) + 1, 0, MH - 1);
  const cx0 = clamp(Math.floor(vx0 / AP) - 1, 0, MW * A), cx1 = clamp(Math.ceil(vx1 / AP) + 1, 0, MW * A);
  let k = 0;
  while (k < items.length && items[k][0] < r0 * T) drawItem(items[k++]);
  for (let r = r0; r <= r1; r++) {
    while (k < items.length && items[k][0] < (r + 1) * T) drawItem(items[k++]);
    if (cx1 > cx0) ctx.drawImage(strips[r], cx0, 0, cx1 - cx0, A + PADA, cx0 * AP, r * T - PAD, (cx1 - cx0) * AP, (A + PADA) * AP);
    // window boards (pixel planks on the window's top face)
    for (const w of windows) {
      if (w.y !== r || w.boards <= 0) continue;
      const front = !wallish(tAt(w.x, r + 1));
      // front-facing window: planks fill the opening in the wall; side windows: planks on top
      const X = w.x * T, Y = front ? r * T - PAD + (PADA - WHA + A + 11) * AP : r * T - WH + 3 * AP;
      const sh = w.shake > 0 ? (Math.random() < 0.5 ? -AP : AP) : 0;
      const step = front ? 2 : 1.4;
      for (let i = 0; i < w.boards; i++) {
        const tilt = (i % 3) - 1;
        const slot = front ? [1, 4, 0, 5, 2, 3][i % 6] : i;
        const bx = X + 2 * AP + sh, by = Y + Math.round(slot * step) * AP, bwid = 12 * AP;
        ctx.fillStyle = '#111018'; ctx.fillRect(bx - AP, by - AP + (tilt < 0 ? AP : 0), bwid + 2 * AP, 4 * AP);
        ctx.fillStyle = i % 2 ? '#b07a40' : '#8a5a2b'; ctx.fillRect(bx, by, bwid, 2 * AP);
        ctx.fillStyle = '#6a4220'; ctx.fillRect(bx, by + AP, bwid, AP);
        if (tilt) { ctx.fillStyle = '#111018'; ctx.fillRect(tilt > 0 ? bx : bx + bwid - 3 * AP, by - AP, 3 * AP, AP); }
        ctx.fillStyle = '#d8d8d8'; ctx.fillRect(bx + AP, by, AP, AP); ctx.fillRect(bx + bwid - 2 * AP, by, AP, AP);
      }
    }
  }
  while (k < items.length) drawItem(items[k++]);

  // x-ray silhouettes for characters hidden behind tall walls
  if (P && occluded(P, 2)) drawPlayer(true);
  for (const z of zombies) if (!z.dead && occluded(z, 2)) drawZombiePx(z, true);

  // door price tags (crisp, drawn after upscale)
  for (const d of doors) {
    if (d.open || !P || dist(P.x, P.y, d.cx, d.cy) > 300) continue;
    labels.push({ x: d.cx, y: d.cy - WH - 22, text: '$' + fmt(d.cost), tag: true });
  }

  drawFxWorld();
  ctx = main;
  // blit the art buffer with nearest-neighbour integer scaling
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(wb, view.ox, view.oy, bw * PX, bh * PX);
  drawLabels();
}

/** Crisp text on top of the pixel world: manga SFX, prices, plaques. */
function drawLabels() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  for (const l of labels) {
    const p = toScreen(l.x, l.y);
    if (l.tag) {
      const s = UI;
      ctx.font = 'italic 900 ' + Math.round(16 * s) + 'px ' + FONT;
      const w = ctx.measureText(l.text).width + 18 * s;
      ctx.fillStyle = '#111018'; ctx.fillRect(p.x - w / 2 - 2, p.y - 13 * s, w + 4, 26 * s);
      ctx.fillStyle = '#c4142c'; ctx.fillRect(p.x - w / 2, p.y - 11 * s, w, 22 * s);
      outlineText(ctx, l.text, p.x, p.y, Math.round(16 * s), '#fff', '#000', 4);
    } else if (l.plain) {
      ctx.font = '900 ' + Math.round(l.size * PX) + 'px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = l.col; ctx.fillText(l.text, p.x, p.y);
    }
  }
  for (const t of texts) {
    const p = toScreen(t.x, t.y);
    const age = t.max - t.life, pop = age < 0.12 ? easeOutBack(age / 0.12) : 1;
    ctx.globalAlpha = Math.min(1, t.life / (t.max * 0.35));
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(t.rot); ctx.scale(pop, pop);
    const size = Math.max(12, t.size * Z * 0.85);
    outlineText(ctx, t.str, 0, 0, size, t.color, '#000', size * 0.25);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawFxWorld() {
  const g = ctx;
  // shock arcs (Raijin)
  for (const s of shocks) {
    const a = s.life / s.max;
    g.globalAlpha = a * (0.5 + 0.5 * Math.random());
    zigzag(g, s.x1, s.y1, s.x2, s.y2, 14, '#ffe14d', 2.5);
  }
  g.globalAlpha = 1;
  // clouds (black-outlined smoke puffs)
  for (const c of clouds) {
    const a = c.life / c.max, r = c.r * (1.3 - a * 0.3);
    g.globalAlpha = Math.min(1, a * 1.4);
    g.fillStyle = '#000'; g.beginPath(); g.arc(c.x, c.y, r + 2.5, 0, TAU); g.fill();
    g.fillStyle = c.color; g.beginPath(); g.arc(c.x, c.y, r, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.beginPath(); g.arc(c.x - r * 0.3, c.y - r * 0.3, r * 0.4, 0, TAU); g.fill();
  }
  g.globalAlpha = 1;
  // particles
  for (const p of parts) {
    const a = clamp(p.life / p.max * 2, 0, 1);
    g.globalAlpha = a;
    switch (p.kind) {
      case 'blood': g.fillStyle = '#000'; g.beginPath(); g.arc(p.x, p.y - p.z, p.size + 1, 0, TAU); g.fill(); g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y - p.z, p.size, 0, TAU); g.fill(); break;
      case 'spark': g.strokeStyle = p.color; g.lineWidth = p.size; g.lineCap = 'round'; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); g.stroke(); break;
      case 'pellet': g.fillStyle = '#000'; g.beginPath(); g.arc(p.x, p.y, p.size + 1.5, 0, TAU); g.fill(); g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size, 0, TAU); g.fill(); break;
      case 'shell': case 'mag': case 'plank': case 'chunk': {
        g.save(); g.translate(p.x, p.y - p.z); g.rotate(p.rot);
        const w = p.kind === 'shell' ? 5 : p.kind === 'mag' ? 6 : p.kind === 'plank' ? 22 : p.size, h = p.kind === 'shell' ? 2.5 : p.kind === 'mag' ? 10 : p.kind === 'plank' ? 5 : p.size;
        g.fillStyle = p.color; g.fillRect(-w / 2, -h / 2, w, h); g.strokeStyle = '#000'; g.lineWidth = 1.2; g.strokeRect(-w / 2, -h / 2, w, h);
        g.restore(); break;
      }
      case 'dust': g.fillStyle = p.color; g.beginPath(); g.arc(p.x, p.y, p.size * (2 - a), 0, TAU); g.fill(); break;
      default: g.fillStyle = p.color; g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
  }
  g.globalAlpha = 1;
  // projectiles
  for (const p of projectiles) {
    g.save(); g.translate(p.x, p.y);
    if (p.kind === 'chrono') {
      g.rotate(gt * 18);
      for (let i = 0; i < 3; i++) { g.lineWidth = 5; g.strokeStyle = '#000'; g.beginPath(); g.ellipse(0, 0, 9 - i * 2.5, 5 - i, i, 0, TAU); g.stroke(); g.lineWidth = 2.5; g.strokeStyle = i % 2 ? '#e9c4ff' : '#b04cff'; g.stroke(); }
      g.restore();
      g.globalAlpha = 0.5; g.strokeStyle = '#b04cff'; g.lineWidth = 2; g.beginPath(); g.arc(p.x - p.vx * 0.02, p.y - p.vy * 0.02, 6, 0, TAU); g.stroke(); g.globalAlpha = 1;
      continue;
    }
    g.rotate(Math.atan2(p.vy, p.vx));
    const s = p.kind === 'sub' ? 0.6 : 1;
    g.scale(s, s);
    g.fillStyle = '#ffcf5a'; g.beginPath(); g.moveTo(-10, -4); g.lineTo(-24 - Math.random() * 10, 0); g.lineTo(-10, 4); g.fill();
    g.fillStyle = '#3c5a2e'; g.fillRect(-12, -3.5, 12, 7); g.strokeStyle = '#000'; g.lineWidth = 2; g.strokeRect(-12, -3.5, 12, 7);
    g.beginPath(); g.moveTo(0, -5); g.lineTo(10, 0); g.lineTo(0, 5); g.closePath(); g.fillStyle = '#55ff3a'; g.fill(); g.stroke();
    g.restore();
  }
  // tracers
  for (const t of tracers) {
    const a = t.life / t.max;
    g.globalAlpha = Math.min(1, a * 1.5);
    if (t.style === 'lightning') { zigzag(g, t.x1, t.y1, t.x2, t.y2, 18, t.color, t.w); continue; }
    g.lineCap = 'round';
    if (t.style === 'needle') {
      const mx = lerp(t.x1, t.x2, 1 - a), my = lerp(t.y1, t.y2, 1 - a);
      g.beginPath(); g.moveTo(mx, my); g.lineTo(t.x2, t.y2);
      g.lineWidth = t.w + 3; g.strokeStyle = '#000'; g.stroke(); g.lineWidth = t.w; g.strokeStyle = t.color; g.stroke();
      continue;
    }
    g.beginPath(); g.moveTo(t.x1, t.y1); g.lineTo(t.x2, t.y2);
    g.lineWidth = t.w * a + 3.5; g.strokeStyle = '#000'; g.stroke();
    g.lineWidth = t.w * a + 1; g.strokeStyle = t.color; g.stroke();
    g.lineWidth = Math.max(1, t.w * a * 0.4); g.strokeStyle = '#fff'; g.stroke();
    if (t.style === 'blade') {
      const ang = Math.atan2(t.y2 - t.y1, t.x2 - t.x1), nx = -Math.sin(ang), ny = Math.cos(ang);
      g.lineWidth = 1.5; g.strokeStyle = '#fff';
      for (let i = 0; i < 6; i++) { const u = Math.random(), off = rand(6, 14) * (i % 2 ? 1 : -1); const px = lerp(t.x1, t.x2, u) + nx * off, py = lerp(t.y1, t.y2, u) + ny * off; g.beginPath(); g.moveTo(px, py); g.lineTo(px - Math.cos(ang) * 30, py - Math.sin(ang) * 30); g.stroke(); }
    }
  }
  g.globalAlpha = 1;
  // slashes (Dragonslayer cyan arc-waves)
  for (const s of slashes) {
    const a = s.life / s.max;
    g.globalAlpha = Math.min(1, a * 1.5);
    if (s.line) {
      g.lineCap = 'round';
      g.beginPath(); g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2);
      g.lineWidth = 16 * a + 4; g.strokeStyle = '#000'; g.stroke();
      g.lineWidth = 16 * a; g.strokeStyle = s.col; g.stroke();
      g.lineWidth = 5 * a; g.strokeStyle = '#fff'; g.stroke();
      continue;
    }
    g.save(); g.translate(s.x, s.y); g.rotate(s.ang);
    const sw = 1.15, R = s.r * (1.05 - a * 0.1);
    g.beginPath(); g.arc(0, 0, R, -sw, sw); g.arc(-R * 0.25, 0, R * 0.8, sw * 0.9, -sw * 0.9, true); g.closePath();
    g.fillStyle = s.col; g.fill(); g.lineWidth = 3; g.strokeStyle = '#000'; g.stroke();
    g.beginPath(); g.arc(0, 0, R * 0.96, -sw * 0.8, sw * 0.8); g.lineWidth = 2; g.strokeStyle = '#fff'; g.stroke();
    g.restore();
  }
  g.globalAlpha = 1;
  // rings / starbursts / explosions
  for (const r of rings) {
    const a = r.life / r.max, rad = lerp(r.r1, r.r0, a);
    g.globalAlpha = Math.min(1, a * 1.6);
    if (r.star) {
      g.save(); g.translate(r.x, r.y); g.rotate(r.ang || 0);
      g.beginPath();
      for (let i = 0; i < 16; i++) { const aa = i / 16 * TAU, rr = i % 2 ? rad * 0.35 : rad * (i % 4 === 0 ? 1.3 : 0.9); g.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr); }
      g.closePath(); g.fillStyle = r.color; g.fill(); g.lineWidth = 2; g.strokeStyle = '#000'; g.stroke(); g.restore();
    } else if (r.hatch) {
      g.save(); g.beginPath(); g.arc(r.x, r.y, rad, 0, TAU);
      g.fillStyle = r.color; g.fill(); g.clip();
      g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 2;
      for (let i = -rad; i < rad; i += 7) { g.beginPath(); g.moveTo(r.x + i, r.y - rad); g.lineTo(r.x + i + rad, r.y + rad); g.moveTo(r.x + i + rad, r.y - rad); g.lineTo(r.x + i, r.y + rad); g.stroke(); }
      g.restore();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(r.x, r.y, rad * 0.45 * a, 0, TAU); g.fill();
      g.lineWidth = 5; g.strokeStyle = '#000'; g.beginPath(); g.arc(r.x, r.y, rad, 0, TAU); g.stroke();
    } else {
      g.lineWidth = r.width + 3; g.strokeStyle = '#000'; g.beginPath(); g.arc(r.x, r.y, rad, 0, TAU); g.stroke();
      g.lineWidth = r.width; g.strokeStyle = r.color; g.stroke();
    }
  }
  g.globalAlpha = 1;
  g.globalAlpha = 1;
}

function zigzag(g, x1, y1, x2, y2, amp, col, w) {
  const n = Math.max(4, Math.floor(dist(x1, y1, x2, y2) / 26));
  const ang = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(ang), ny = Math.cos(ang);
  g.beginPath(); g.moveTo(x1, y1);
  for (let i = 1; i < n; i++) { const u = i / n, o = rand(-amp, amp); g.lineTo(lerp(x1, x2, u) + nx * o, lerp(y1, y2, u) + ny * o); }
  g.lineTo(x2, y2);
  g.lineJoin = 'miter'; g.lineCap = 'round';
  g.lineWidth = w + 5; g.strokeStyle = '#000'; g.stroke();
  g.lineWidth = w + 1.5; g.strokeStyle = col; g.stroke();
  g.lineWidth = Math.max(1, w * 0.35); g.strokeStyle = '#fff'; g.stroke();
}

// =======================================================================
// SCREEN OVERLAYS
// =======================================================================
function drawLighting() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const sp = P ? toScreen(P.x, P.y - 20) : { x: W / 2, y: H / 2 };
  const gr = ctx.createRadialGradient(sp.x, sp.y, 200 * Z, sp.x, sp.y, Math.max(W, H) * 0.8);
  gr.addColorStop(0, 'rgba(20,0,40,0)'); gr.addColorStop(1, 'rgba(20,0,40,0.3)');
  ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);

  if (screenFx.invert > 0) { ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
  const flash = (v, c) => { if (v > 0) { ctx.globalAlpha = Math.min(1, v); ctx.fillStyle = c; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = Math.min(0.5, v) * 0.6; ctx.fillStyle = halftone; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; } };
  flash(screenFx.white * 0.8, '#ffffff');
  flash(screenFx.yellow * 0.55, '#ffd21a');
  flash(screenFx.gold * 0.9, '#fff1a8');
  flash(screenFx.purple * 0.5, '#9a5cff');
  // damage / low health vignette
  const low = P && P.hp > 0 && P.hp < P.maxHp * 0.45 ? (0.35 + 0.25 * Math.sin(gt * 6)) * (1 - P.hp / (P.maxHp * 0.45)) : 0;
  const red = Math.max(screenFx.red * 0.7, low, P && P.instaT > 0 ? 0.18 + 0.1 * Math.sin(gt * 5) : 0);
  if (red > 0.01) {
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.72);
    v.addColorStop(0, 'rgba(180,0,20,0)'); v.addColorStop(1, 'rgba(180,0,20,' + Math.min(0.85, red) + ')');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
  }
}

// =======================================================================
// HUD
// =======================================================================
function txt(str, x, y, size, fill, opt) {
  opt = opt || {};
  ctx.font = (opt.noItalic ? '' : 'italic ') + '900 ' + Math.round(size) + 'px ' + (opt.font || FONT);
  ctx.textAlign = opt.align || 'center'; ctx.textBaseline = opt.base || 'middle'; ctx.lineJoin = 'round';
  if (opt.shadow !== false) { ctx.fillStyle = '#000'; ctx.fillText(str, x + size * 0.06, y + size * 0.08); }
  ctx.lineWidth = size * 0.2 + 2; ctx.strokeStyle = '#000'; ctx.strokeText(str, x, y);
  if (opt.rim) { ctx.lineWidth = size * 0.08; ctx.strokeStyle = opt.rim; ctx.strokeText(str, x, y); }
  ctx.fillStyle = fill; ctx.fillText(str, x, y);
}

function panel(x, y, w, h, col) {
  ctx.beginPath(); ctx.moveTo(x + 10, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - 10, y + h); ctx.lineTo(x, y + h); ctx.closePath();
  ctx.fillStyle = col || 'rgba(10,0,20,0.72)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
}

function perkIcon(id, x, y, s) {
  const p = perks.find(q => q.id === id);
  ctx.beginPath(); ctx.arc(x, y, s, 0, TAU); ctx.fillStyle = p.body; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = p.trim; ctx.beginPath(); ctx.arc(x, y, s - 4, 0, TAU); ctx.stroke();
  ctx.fillStyle = id === 'zap' ? '#111' : '#fff';
  if (id === 'zap') { ctx.beginPath(); ctx.moveTo(x + 2, y - s * 0.6); ctx.lineTo(x - s * 0.35, y + 1); ctx.lineTo(x, y + 1); ctx.lineTo(x - 2, y + s * 0.6); ctx.lineTo(x + s * 0.35, y - 2); ctx.lineTo(x, y - 2); ctx.closePath(); ctx.fill(); }
  else if (id === 'tuff') { ctx.fillRect(x - 2, y - s * 0.5, 4, s); ctx.fillRect(x - s * 0.5, y - 2, s, 4); }
  else { ctx.beginPath(); ctx.moveTo(x - s * 0.4, y - s * 0.4); ctx.lineTo(x + s * 0.4, y - s * 0.4); ctx.lineTo(x + s * 0.2, y + s * 0.5); ctx.lineTo(x - s * 0.2, y + s * 0.5); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#2a7fff'; ctx.fillRect(x - s * 0.3, y - s * 0.1, s * 0.6, s * 0.3); }
}

function drawRoundCounter(x, y, s) {
  const n = R.n;
  ctx.save();
  if (R.phase === 'break' && n > 0) ctx.globalAlpha = 0.5 + 0.5 * Math.sin(gt * 6);
  if (n >= 1 && n <= 5) {
    ctx.lineCap = 'round';
    for (let i = 0; i < n; i++) {
      const tx = x + (i < 4 ? i * 13 * s : -6 * s), ty = y;
      ctx.beginPath();
      if (i < 4) { ctx.moveTo(tx, ty - 22 * s); ctx.lineTo(tx + 3 * s, ty + 22 * s); }
      else { ctx.moveTo(x - 10 * s, y + 12 * s); ctx.lineTo(x + 50 * s, y - 14 * s); }
      ctx.lineWidth = 11 * s; ctx.strokeStyle = '#000'; ctx.stroke();
      ctx.lineWidth = 6 * s; ctx.strokeStyle = '#d10022'; ctx.stroke();
    }
  } else if (n > 5) {
    txt(String(n), x, y, 58 * s, '#d10022', { align: 'left', font: KFONT, noItalic: true });
  }
  ctx.restore();
}

function drawWeaponPanel(x, y, s) {
  const w = curW(), d = WEAP[w.id];
  const pw = 250 * s, ph = 92 * s;
  panel(x - pw, y, pw, ph);
  // gun art with the 4-phase reload animation
  ctx.save();
  ctx.translate(x - pw + 30 * s, y + 46 * s);
  const big = 1.9 * s;
  let mag = null, slide = 0, tilt = 0, phaseName = '';
  if (P.reloading) {
    const f = P.reloadT / P.reloadDur;
    if (f < 0.25) { slide = -4 * (f / 0.25); tilt = -0.18 * (f / 0.25); phaseName = 'SLIDE LOCK'; }
    else if (f < 0.5) { const k = (f - 0.25) / 0.25; mag = { dx: 0, dy: k * 30, rot: k * 0.4, a: 1 - k }; slide = -4; tilt = -0.18; phaseName = 'MAG DROP'; }
    else if (f < 0.75) { const k = (f - 0.5) / 0.25; mag = { dx: 0, dy: (1 - k) * 26, a: 1 }; slide = -4; tilt = -0.12; phaseName = k > 0.85 ? 'CLICK!' : 'MAG INSERT'; }
    else { const k = (f - 0.75) / 0.25; slide = -4 * Math.sin(k * Math.PI) - (1 - Math.min(1, k * 2)) * 0; tilt = -0.12 * (1 - k); phaseName = 'RACK'; }
  }
  ctx.rotate(tilt);
  ctx.scale(big, big);
  drawGun(ctx, w.id, { lw: 1.6, mag, slide });
  if (w.id === 'giga' && P.spin > 0) { ctx.fillStyle = 'rgba(255,204,51,' + P.spin * 0.6 + ')'; ctx.fillRect(12, -6, 23, 10); }
  ctx.restore();
  // name + ammo
  txt(d.name, x - 14 * s, y + 14 * s, 13 * s, '#fff', { align: 'right', shadow: false });
  if (d.kind === 'melee') txt('∞', x - 16 * s, y + 52 * s, 34 * s, '#3ad8ff', { align: 'right' });
  else if (d.noReload) txt(String(w.reserve), x - 16 * s, y + 52 * s, 32 * s, w.reserve ? '#ffcc33' : '#ff2a55', { align: 'right' });
  else {
    const low = w.mag <= Math.ceil(d.mag * 0.25);
    txt(String(w.reserve), x - 16 * s, y + 56 * s, 18 * s, '#bbb', { align: 'right' });
    ctx.font = 'italic 900 ' + Math.round(18 * s) + 'px ' + FONT;
    const rw = ctx.measureText(String(w.reserve)).width;
    txt(String(w.mag) + ' /', x - 22 * s - rw, y + 50 * s, 32 * s, low ? '#ff2a55' : '#fff', { align: 'right' });
  }
  // status line
  let status = '', sc = '#ffd21a';
  if (P.reloading) { status = 'RELOAD: ' + phaseName; }
  else if (w.id === 'giga') { status = P.overheat > 0 ? 'OVERHEATED!' : 'HEAT'; sc = P.overheat > 0 ? '#ff2a55' : '#ffcc33'; }
  else if (!d.noReload && w.mag === 0 && w.reserve === 0) { status = 'NO AMMO'; sc = '#ff2a55'; }
  else if (!d.noReload && w.mag <= Math.ceil(d.mag * 0.25)) { status = usingTouch ? 'LOW AMMO - RELOAD' : 'LOW AMMO - [R] RELOAD'; sc = '#ff2a55'; }
  else if (w.id === 'ronin' && P.roninStreak > 0) status = 'HEADSHOT CHAIN ' + (P.roninStreak % 3) + '/3';
  else if (w.id === 'vector' && P.sustain > 0.5) { status = 'NEON RUSH +25%'; sc = '#ff2bd6'; }
  if (status) txt(status, x - 14 * s, y + 80 * s, 11 * s, sc, { align: 'right', shadow: false });
  if (P.reloading) {
    ctx.fillStyle = '#000'; ctx.fillRect(x - pw + 14 * s, y + ph - 9 * s, 120 * s, 6 * s);
    ctx.fillStyle = '#ffd21a'; ctx.fillRect(x - pw + 15 * s, y + ph - 8 * s, 118 * s * (P.reloadT / P.reloadDur), 4 * s);
  }
  if (w.id === 'giga') {
    const hf = P.overheat > 0 ? 1 : P.heat / 7;
    ctx.fillStyle = '#000'; ctx.fillRect(x - pw + 14 * s, y + ph - 9 * s, 120 * s, 6 * s);
    ctx.fillStyle = hf > 0.75 ? '#ff2a55' : '#ffcc33'; ctx.fillRect(x - pw + 15 * s, y + ph - 8 * s, 118 * s * hf, 4 * s);
  }
  // weapon slots (up to 3)
  for (let i = 0; i < P.weapons.length; i++) {
    const o = P.weapons[i], sx = x - pw + 8 * s + i * 82 * s, sy = y - 30 * s, cur = i === P.cur;
    ctx.globalAlpha = cur ? 1 : 0.6;
    panel(sx, sy, 76 * s, 24 * s, cur ? 'rgba(123,47,208,0.85)' : 'rgba(10,0,20,0.6)');
    ctx.save(); ctx.translate(sx + 22 * s, sy + 12 * s); ctx.scale(0.62 * s, 0.62 * s); drawGun(ctx, o.id, { lw: 1.8 }); ctx.restore();
    if (!usingTouch) txt(String(i + 1), sx + 70 * s, sy + 12 * s, 11 * s, cur ? '#fff' : '#aaa', { align: 'right', shadow: false });
    ctx.globalAlpha = 1;
  }
  for (const m of hudMsgs) { const k = m.t / 0.6; ctx.globalAlpha = k; txt(m.text, x - pw / 2, y - 46 * s - (1 - k) * 20, 16 * s, '#fff', { rim: '#ff2a55' }); ctx.globalAlpha = 1; }
}

function drawPoints(x, y, s) {
  const str = '$' + fmt(P.points);
  txt(str, x, y, 40 * s, '#ffd21a', { align: 'right', rim: '#ff2a55' });
  ctx.font = 'italic 900 ' + Math.round(40 * s) + 'px ' + FONT;
  const w = ctx.measureText(str).width;
  cashPops.forEach((c, i) => {
    const k = c.t / 1.1;
    ctx.globalAlpha = 1 - k;
    txt((c.v > 0 ? '+' : '-') + fmt(Math.abs(c.v)), x - w - 10 * s - k * 30 * s, y - 6 * s - k * 46 * s - (i % 3) * 4, 18 * s, c.v > 0 ? '#fff36b' : '#ff5a6e', { align: 'right' });
  });
  ctx.globalAlpha = 1;
}

function drawMinimap(x, y, s) {
  const mw = MW * 3 * s, mh = MH * 3 * s;
  panel(x - 6, y - 6, mw + 12, mh + 12, 'rgba(10,0,20,0.6)');
  ctx.drawImage(minimap, x, y, mw, mh);
  for (const z of zombies) { if (z.dead) continue; ctx.fillStyle = '#ff1744'; ctx.fillRect(x + z.x / T * 3 * s - 1.5, y + z.y / T * 3 * s - 1.5, 3, 3); }
  for (const p of powerups) { ctx.fillStyle = '#9dff3c'; ctx.fillRect(x + p.x / T * 3 * s - 2, y + p.y / T * 3 * s - 2, 4, 4); }
  const px = x + P.x / T * 3 * s, py = y + P.y / T * 3 * s;
  ctx.save(); ctx.translate(px, py); ctx.rotate(P.aim);
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.closePath(); ctx.fillStyle = '#ffd21a'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.restore();
}

function drawHUD() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const s = UI, touchUI = usingTouch;
  const L = safeL + 16 * s, Rr = W - safeR - 16 * s, top = safeTop + 14 * s, bot = H - safeBot - 16 * s;

  // minimap + zone
  const ms = touchUI ? 0.75 * s : s;
  drawMinimap(L + 4, top + 4, ms);
  txt(P.zoneName, L + 4, top + MH * 3 * ms + 26 * s, 13 * s, '#fff', { align: 'left', shadow: false });

  // round + perks + health
  let rx, ry;
  if (touchUI) { rx = L + MW * 3 * ms + 34 * s; ry = top + 34 * s; }
  else { rx = L + 20 * s; ry = bot - 34 * s; }
  drawRoundCounter(rx, ry, s);
  const perkY = touchUI ? ry + 54 * s : ry - 62 * s;
  let i = 0;
  for (const id of ['zap', 'tuff', 'flash']) if (P.perks.has(id)) { perkIcon(id, rx + i * 34 * s, perkY, 14 * s); i++; }
  const hbY = touchUI ? perkY + (i ? 26 : 0) * s : perkY - (i ? 26 : 0) * s;
  const hbw = 130 * s;
  ctx.fillStyle = '#000'; ctx.fillRect(rx - 8 * s, hbY - 5 * s, hbw + 4, 10 * s);
  ctx.fillStyle = P.hp < P.maxHp * 0.35 ? '#ff1744' : '#9dff3c'; ctx.fillRect(rx - 8 * s + 2, hbY - 3 * s, hbw * clamp(P.hp / P.maxHp, 0, 1), 6 * s);
  txt(Math.ceil(Math.max(0, P.hp)) + ' HP', rx + hbw, hbY, 10 * s, '#fff', { align: 'left', shadow: false });

  // weapon + points
  if (touchUI) {
    drawPoints(Rr, top + 22 * s, s * 0.85);
    drawWeaponPanel(Rr, top + 86 * s, s * 0.8);
  } else {
    drawWeaponPanel(Rr, bot - 150 * s, s);
    drawPoints(Rr, bot - 22 * s, s);
  }

  // zombies left + best
  const left = R.phase === 'active' ? Math.max(0, R.total - R.killed) : 0;
  if (!touchUI) txt('ZOMBIES ' + left + '   BEST R' + bestRound, Rr, top + 14 * s, 13 * s, '#ff8aa0', { align: 'right', shadow: false });

  // active power-ups
  if (P.instaT > 0) {
    const px = W / 2, py = bot - (touchUI ? 150 : 70) * s, pulse = 1 + 0.12 * Math.sin(gt * 10);
    ctx.save(); ctx.translate(px, py); ctx.scale(pulse, pulse);
    ctx.fillStyle = 'rgba(255,23,68,0.35)'; ctx.beginPath(); ctx.arc(0, 0, 26 * s, 0, TAU); ctx.fill();
    pirateSkull(ctx, 0, 0, 0.6 * s, '#ff1744');
    ctx.restore();
    txt(Math.ceil(P.instaT) + 's', px, py + 30 * s, 13 * s, '#ff1744');
  }

  // zone name splash
  if (zoneMsg.t > 0) {
    const a = Math.min(1, zoneMsg.t / 0.5, (2.6 - zoneMsg.t) / 0.3 + 0.2);
    ctx.globalAlpha = clamp(a, 0, 1);
    txt('— ' + zoneMsg.text + ' —', W / 2, top + (touchUI ? 90 : 40) * s, 20 * s, '#fff', { rim: '#7b2fd0' });
    ctx.globalAlpha = 1;
  }

  // banners
  banners.forEach((b, bi) => {
    const age = b.max - b.life, k = clamp(age / 0.2, 0, 1), a = Math.min(1, b.life / 0.4);
    const slot = banners.length - 1 - bi;
    const y = H * 0.3 + slot * 118 * s * Math.min(1, H / 620);
    ctx.save(); ctx.globalAlpha = a; ctx.translate(W / 2, y); ctx.rotate(-0.04); ctx.scale(easeOutBack(k), easeOutBack(k));
    const size = (b.big ? 60 : b.round ? 68 : 40) * s * Math.min(1, H / 620);
    if (b.big || b.round) {
      // speed-line burst behind
      ctx.fillStyle = b.color; ctx.globalAlpha = a * 0.5;
      for (let i = 0; i < 18; i++) { const an = i / 18 * TAU + gt; ctx.beginPath(); ctx.moveTo(Math.cos(an) * 40 * s, Math.sin(an) * 18 * s); ctx.lineTo(Math.cos(an - 0.05) * 320 * s, Math.sin(an - 0.05) * 120 * s); ctx.lineTo(Math.cos(an + 0.05) * 320 * s, Math.sin(an + 0.05) * 120 * s); ctx.fill(); }
      ctx.globalAlpha = a;
    }
    txt(b.text, 0, 0, size, b.color, { rim: '#fff', font: b.round ? KFONT : FONT, noItalic: b.round });
    if (b.sub) txt(b.sub, 0, size * 0.75, 16 * s, '#fff', { shadow: false });
    if (b.perk) perkIcon(b.perk, 0, -size * 1.05, 22 * s);
    ctx.restore();
  });

  // interaction prompt
  if (prompt && P.downed <= 0) {
    const py = bot - (touchUI ? 170 : 110) * s;
    const key = usingTouch ? (prompt.kind === 'window' ? 'HOLD USE' : 'TAP USE') : (prompt.kind === 'window' ? 'HOLD F' : 'F');
    let line = prompt.text;
    ctx.font = 'italic 900 ' + Math.round(17 * s) + 'px ' + FONT;
    const costStr = prompt.cost ? '  $' + fmt(prompt.cost) : '';
    const tw = ctx.measureText('[' + key + '] ' + line + costStr).width + 40 * s;
    panel(W / 2 - tw / 2, py - 18 * s, tw, 36 * s, 'rgba(10,0,20,0.8)');
    txt('[' + key + '] ' + line, W / 2 - (costStr ? ctx.measureText(costStr).width / 2 : 0), py, 17 * s, '#fff', { shadow: false });
    if (costStr) { ctx.font = 'italic 900 ' + Math.round(17 * s) + 'px ' + FONT; const full = ctx.measureText('[' + key + '] ' + line).width; txt(costStr, W / 2 - (costStr ? ctx.measureText(costStr).width / 2 : 0) + full / 2 + ctx.measureText(costStr).width / 2 + 0, py, 17 * s, P.points >= prompt.cost ? '#ffd21a' : '#ff2a55', { shadow: false }); }
    if (prompt.progress) { ctx.fillStyle = '#ffd21a'; ctx.fillRect(W / 2 - tw / 2 + 12, py + 14 * s, (tw - 24) * clamp(prompt.progress, 0, 1), 3 * s); }
    if (prompt.gun) {
      ctx.save(); ctx.translate(W / 2 - 30 * s, py - 46 * s); ctx.scale(1.5 * s, 1.5 * s); drawGun(ctx, prompt.gun, { lw: 1.4 }); ctx.restore();
      txt(WEAP[prompt.gun].trait, W / 2, py + 30 * s, 12 * s, '#c9b8ff', { shadow: false });
    }
  }

  // round break countdown
  if (R.phase === 'break' && R.n > 0) txt('NEXT ROUND IN ' + Math.ceil(R.breakT), W / 2, top + (touchUI ? 120 : 70) * s, 16 * s, '#ff8aa0', { shadow: false });

  // crosshair
  if (!usingTouch && mouse.seen && !paused) {
    const d = WEAP[curW().id], spread = (d.spread || 0.02) * 260 + (P.moving ? 6 : 0) + P.kick * 8;
    const cx = mouse.x, cy = mouse.y;
    ctx.lineCap = 'round';
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      ctx.beginPath(); ctx.moveTo(cx + dx * (6 + spread), cy + dy * (6 + spread)); ctx.lineTo(cx + dx * (16 + spread), cy + dy * (16 + spread));
      ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.lineWidth = 2.5; ctx.strokeStyle = P.instaT > 0 ? '#ff1744' : '#fff'; ctx.stroke();
    }
    ctx.fillStyle = '#ff2a55'; ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, TAU); ctx.fill();
  }
}

// =======================================================================
// TOUCH CONTROLS
// =======================================================================
function layoutTouch() {
  const s = UI;
  const bx = W - safeR - 46 * s, by = H - safeBot - 46 * s;
  const mk = (id, label, x, y, r, visible, col) => ({ id, label, x, y, r, visible, col, down: false,
    onPress: () => { vkeys[id] = true; vpress.add(id); }, onRelease: () => { vkeys[id] = false; } });
  touch.buttons = [
    // bottom-right thumb cluster (kept below the weapon panel on short landscape phones)
    mk('reload', 'RELOAD', bx, by - 66 * s, 27 * s, () => true, '#7ae8ff'),
    mk('swap', 'SWAP', bx, by - 132 * s, 25 * s, () => P && P.weapons.length > 1, '#c9b8ff'),
    mk('melee', 'KNIFE', bx - 66 * s, by - 10 * s, 25 * s, () => P && WEAP[curW().id].kind !== 'melee', '#ff8aa0'),
    mk('heavy', 'LUNGE', bx - 66 * s, by - 10 * s, 28 * s, () => P && WEAP[curW().id].kind === 'melee', '#3ad8ff'),
    mk('use', 'USE', bx - 74 * s, by - 96 * s, 32 * s, () => !!prompt, '#ffd21a'),
    { id: 'pause', label: 'II', x: W / 2, y: safeTop + 24 * s, r: 20 * s, visible: () => true, col: '#fff', onPress: () => { pauseGame(); }, onRelease: null }
  ];
}

function drawTouchControls() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const s = UI;
  for (const st of [touch.left, touch.right]) {
    const isL = st === touch.left;
    const R0 = stickR();
    const ox = st.id !== null ? st.ox : (isL ? safeL + R0 + 34 * s : W - safeR - 200 * s), oy = st.id !== null ? st.oy : H - safeBot - R0 - 40 * s;
    ctx.globalAlpha = st.id !== null ? 0.8 : 0.28;
    ctx.beginPath(); ctx.arc(ox, oy, R0, 0, TAU); ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = isL ? '#fff' : '#ff2a55'; ctx.stroke();
    const v = stickVec(st, R0);
    ctx.beginPath(); ctx.arc(ox + v.x * R0, oy + v.y * R0, R0 * 0.44, 0, TAU); ctx.fillStyle = isL ? '#f4efe9' : '#ff2a55'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
    if (st.id === null) txt(isL ? 'MOVE' : 'AIM + FIRE', ox, oy, 12 * s, '#fff', { shadow: false });
  }
  ctx.globalAlpha = 1;
  for (const b of touch.buttons) {
    if (!b.visible()) continue;
    ctx.globalAlpha = b.down ? 1 : 0.8;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.fillStyle = b.down ? b.col : 'rgba(10,0,20,0.65)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = b.col; ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 3, 0, TAU); ctx.stroke();
    txt(b.label, b.x, b.y, (b.label.length > 4 ? 10 : 13) * s, b.down ? '#000' : b.col, { shadow: false });
  }
  ctx.globalAlpha = 1;
}


// =======================================================================
// MENUS: main / play (new + load) / customize / settings / quit / pause / game over
// Works with mouse (hover + click), touch (tap + drag sliders) and keyboard (arrows/WASD + Enter, Esc = back).
// =======================================================================
const ui = { screen: 'main', sel: 0, items: [], hover: -1, drag: null, confirm: null, from: 'main', t: 0, frame: 'goza_hero' };

function menuWorld() { resetWorld(); cam.x = 31 * T; cam.y = 24 * T; }

function uiGo(screen, from) {
  if (from) ui.from = from;
  ui.screen = screen; ui.sel = 0; ui.confirm = null; ui.t = 0; ui.drag = null;
  SFX.click();
}

function uiBack() {
  if (ui.confirm) { ui.confirm = null; return; }
  switch (ui.screen) {
    case 'start': case 'quit': uiGo('main'); break;
    case 'custom': uiGo('start'); break;
    case 'settings': uiGo(ui.from === 'pause' ? 'pause' : 'main'); break;
    case 'pause': resumeGame(); break;
  }
}

// ---- layout helpers -------------------------------------------------------
function L() {
  const s = UI;
  const bw = Math.min(W - 40, 360 * s);
  const bh = clamp(Math.min(56 * s, H * 0.105), 38, 64);
  return { s, bw, bh, gap: Math.max(6, bh * 0.2) };
}
function button(label, act, o) { return Object.assign({ kind: 'button', label, act }, o || {}); }

/** Rebuild the interactive items for the current screen (called every frame). */
function uiBuild() {
  const { s, bw, bh, gap } = L();
  const items = [];
  const column = (list, top) => {
    let y = top;
    for (const it of list) {
      const h = it.sub ? bh * 1.18 : bh;
      Object.assign(it, { x: W / 2 - bw / 2, y, w: bw, h });
      items.push(it); y += h + gap;
    }
    return y;
  };
  const wide = W > H * 1.15;
  if (ui.confirm) {
    column([button(ui.confirm.yes, () => { const f = ui.confirm.act; ui.confirm = null; f(); }, { danger: true }),
            button('CANCEL', () => { ui.confirm = null; })], H * 0.55);
    ui.items = items; return;
  }
  switch (ui.screen) {
    case 'main': {
      const top = wide ? H * 0.47 : H * 0.5;
      column([
        button('START', () => uiGo('start')),
        button('SETTINGS', () => uiGo('settings', 'main')),
        button('QUIT', () => { uiGo('quit'); try { window.close(); } catch (e) {} })
      ], top);
      items.push({ kind: 'mute', x: W - safeR - 58 * s, y: safeTop + 12 * s, w: 46 * s, h: 46 * s, act: () => setMuted(!muted), nofocus: true });
      break;
    }
    case 'start': {
      const save = readSave();
      column([
        button('NEW GAME', () => {
          if (save) ui.confirm = { text: 'Start a new game?', sub: 'Your saved game (' + saveSummary(save) + ') will be replaced when you next save.', yes: 'START NEW GAME', act: () => newGame(null) };
          else newGame(null);
        }, { sub: 'Start fresh from Round 1' }),
        button('LOAD GAME', () => { const d = readSave(); if (d) newGame(d); }, { sub: saveSummary(save), disabled: !save }),
        button('CUSTOMIZE', () => uiGo('custom'), { sub: 'Character & gun color' }),
        button('BACK', uiBack)
      ], Math.max(safeTop + 90 * s, H * 0.24));
      break;
    }
    case 'custom': {
      const top = safeTop + 70 * s;
      const colW = wide ? Math.min(380 * s, (W - 60) / 2) : Math.min(W - 40, 380 * s);
      const cx1 = wide ? W / 2 - colW - 10 : W / 2 - colW / 2;
      const cx2 = wide ? W / 2 + 10 : cx1;
      const charH = wide ? H - top - bh - 40 * s : Math.min(190 * s, H * 0.3);
      ui.cust = { cx1, cx2, colW, top, charH };
      // character picker (only GozaPlayz for now)
      items.push(button('◀', () => { ui.turn = (ui.turn || 0) + 3; SFX.click(); }, { x: cx1 + 8, y: top + charH / 2 - 20 * s, w: 40 * s, h: 40 * s, small: true }));
      items.push(button('▶', () => { ui.turn = (ui.turn || 0) + 1; SFX.click(); }, { x: cx1 + colW - 48 * s, y: top + charH / 2 - 20 * s, w: 40 * s, h: 40 * s, small: true }));
      // gun color
      const gy = wide ? top : top + charH + 14 * s;
      const half = (colW - 10) / 2;
      ui.cust.gy = gy;
      items.push(button('DEFAULT', () => { settings.gunMode = 'default'; saveSettings(); }, { x: cx2, y: gy + 34 * s, w: half, h: bh * 0.85, on: settings.gunMode === 'default' }));
      items.push(button('CUSTOM', () => { settings.gunMode = 'custom'; saveSettings(); }, { x: cx2 + half + 10, y: gy + 34 * s, w: half, h: bh * 0.85, on: settings.gunMode === 'custom' }));
      items.push({ kind: 'slider', hue: true, label: 'HUE', x: cx2, y: gy + 34 * s + bh * 0.85 + 14 * s, w: colW, h: 34 * s,
        get: () => settings.gunHue / 360, set: v => { settings.gunHue = Math.round(v * 360); settings.gunMode = 'custom'; } });
      ui.cust.previewY = gy + 34 * s + bh * 0.85 + 60 * s;
      items.push(button('BACK', uiBack, { x: W / 2 - bw / 2, y: H - safeBot - bh - 12 * s, w: bw, h: bh }));
      break;
    }
    case 'settings': {
      const rows = 7;
      const top = safeTop + 64 * s;
      const rh = Math.min(bh, (H - top - safeBot - 16) / rows - gap * 0.6);
      const w = Math.min(W - 40, 460 * s), x = W / 2 - w / 2;
      let y = top;
      const add = it => { Object.assign(it, { x, y, w, h: rh }); items.push(it); y += rh + gap * 0.6; };
      add({ kind: 'slider', label: 'MASTER VOLUME', get: () => settings.master, set: v => { settings.master = v; applyAudioSettings(); } });
      add({ kind: 'slider', label: 'MUSIC', get: () => settings.music, set: v => { settings.music = v; applyAudioSettings(); } });
      add({ kind: 'slider', label: 'SOUND FX', get: () => settings.sfx, set: v => { settings.sfx = v; applyAudioSettings(); } });
      add(button('SCREEN SHAKE: ' + (settings.shake ? 'ON' : 'OFF'), () => { settings.shake = !settings.shake; saveSettings(); }));
      add(button('TOUCH AIM ASSIST: ' + (settings.aimAssist ? 'ON' : 'OFF'), () => { settings.aimAssist = !settings.aimAssist; saveSettings(); }));
      add(button('JOYSTICK SIZE: ' + ['SMALL', 'MEDIUM', 'LARGE'][settings.stick], () => { settings.stick = (settings.stick + 1) % 3; saveSettings(); }));
      add(button('BACK', uiBack));
      break;
    }
    case 'quit':
      column([button('BACK TO MENU', () => uiGo('main'))], H * 0.62);
      break;
    case 'pause':
      column([
        button('RESUME', resumeGame),
        button('SETTINGS', () => uiGo('settings', 'pause')),
        button('SAVE & EXIT', () => { exitToMenu(true); }, { sub: 'Resume later from Round ' + (R.phase === 'break' ? R.n + 1 : Math.max(1, R.n)) }),
        button('EXIT WITHOUT SAVING', () => { ui.confirm = { text: 'Quit without saving?', sub: 'Progress since your last save will be lost.', yes: 'QUIT', act: () => exitToMenu(false) }; }, { danger: true })
      ], Math.max(safeTop + 100 * s, H * 0.3));
      break;
    case 'over':
      if (overT > 1.0) column([button('PLAY AGAIN', () => newGame(null)), button('MAIN MENU', () => exitToMenu(false))], H * 0.66);
      break;
  }
  ui.items = items;
  const focusable = items.filter(i => !i.nofocus && !i.disabled);
  if (ui.sel >= focusable.length) ui.sel = Math.max(0, focusable.length - 1);
}

function focusList() { return ui.items.filter(i => !i.nofocus && !i.disabled); }
function hitItem(x, y) {
  for (let i = ui.items.length - 1; i >= 0; i--) {
    const it = ui.items[i];
    const pad = it.kind === 'slider' ? 12 : 0;
    if (x >= it.x - pad && x <= it.x + it.w + pad && y >= it.y - pad && y <= it.y + it.h + pad) return it;
  }
  return null;
}
function sliderSet(it, x) {
  const tx = it.x + (it.hue ? 0 : it.w * 0.42), tw = it.hue ? it.w : it.w * 0.5;
  it.set(clamp((x - tx) / tw, 0, 1));
}

function uiDown(x, y) {
  initAudio();
  const it = hitItem(x, y);
  if (!it || it.disabled) return;
  const f = focusList(); const i = f.indexOf(it); if (i >= 0) ui.sel = i;
  if (it.kind === 'slider') { ui.drag = it; sliderSet(it, x); return; }
  if (it.act) { SFX.click(); it.act(); }
}
function uiMove(x, y) {
  if (ui.drag) { sliderSet(ui.drag, x); return; }
  const it = hitItem(x, y);
  ui.hover = it ? ui.items.indexOf(it) : -1;
  if (it && !it.disabled && !it.nofocus) { const f = focusList(); const i = f.indexOf(it); if (i >= 0 && i !== ui.sel) ui.sel = i; }
  cv.style.cursor = it && !it.disabled ? 'pointer' : 'default';
}
function uiUp() { if (ui.drag) { ui.drag = null; saveSettings(); } }

function uiKey(code) {
  const f = focusList();
  if (code === 'Escape' || code === 'Backspace') { uiBack(); return; }
  if (!f.length) return;
  const cur = f[clamp(ui.sel, 0, f.length - 1)];
  if (code === 'ArrowDown' || code === 'KeyS' || code === 'Tab') { ui.sel = (ui.sel + 1) % f.length; SFX.click(); }
  else if (code === 'ArrowUp' || code === 'KeyW') { ui.sel = (ui.sel - 1 + f.length) % f.length; SFX.click(); }
  else if ((code === 'ArrowLeft' || code === 'KeyA' || code === 'ArrowRight' || code === 'KeyD') && cur.kind === 'slider') {
    const dir = code === 'ArrowLeft' || code === 'KeyA' ? -1 : 1;
    cur.set(clamp(cur.get() + dir * 0.05, 0, 1)); saveSettings();
  } else if (code === 'Enter' || code === 'Space' || code === 'NumpadEnter') { if (cur.act) { SFX.click(); cur.act(); } }
}

// ---- drawing ---------------------------------------------------------------
function drawLogo(cx, cy, k) {
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.05 + Math.sin(gt * 1.5) * 0.01); ctx.scale(k, k);
  txt('WESTVALE', 0, -40, 46, '#f4efe9', { rim: '#7b2fd0' });
  txt('ZOMBIES', 6, 18, 74, '#FF0033', { rim: '#fff' });
  ctx.restore();
}

function drawItem(it, focused) {
  const { s } = L();
  if (it.kind === 'mute') {
    ctx.beginPath(); ctx.arc(it.x + it.w / 2, it.y + it.h / 2, it.w / 2, 0, TAU); ctx.fillStyle = 'rgba(10,0,20,0.7)'; ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = muted ? '#ff2a55' : '#c9a8ff'; ctx.stroke();
    txt(muted ? 'OFF' : '♪', it.x + it.w / 2, it.y + it.h / 2, (muted ? 12 : 20) * s, '#fff', { rim: '#7b2fd0', noItalic: true, shadow: false });
    return;
  }
  if (it.kind === 'slider') {
    ctx.globalAlpha = 1;
    const tx = it.x + (it.hue ? 0 : it.w * 0.42), tw = it.hue ? it.w : it.w * 0.5;
    const ty = it.y + it.h / 2, v = it.get();
    if (!it.hue) txt(it.label, it.x, ty, Math.min(17 * s, it.h * 0.42), focused ? '#ffd21a' : '#fff', { align: 'left', rim: '#7b2fd0', shadow: false });
    const th = it.hue ? it.h * 0.55 : 10 * s;
    ctx.beginPath(); ctx.rect(tx, ty - th / 2, tw, th);
    if (it.hue) {
      const gr = ctx.createLinearGradient(tx, 0, tx + tw, 0);
      for (let i = 0; i <= 6; i++) gr.addColorStop(i / 6, 'hsl(' + i * 60 + ',90%,55%)');
      ctx.fillStyle = gr;
    } else ctx.fillStyle = '#1a0f2a';
    ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.stroke();
    if (!it.hue) { ctx.fillStyle = '#7b2fd0'; ctx.fillRect(tx + 2, ty - th / 2 + 2, (tw - 4) * v, th - 4); }
    const kx = tx + tw * v;
    ctx.beginPath(); ctx.arc(kx, ty, (it.hue ? it.h * 0.42 : 12 * s), 0, TAU);
    ctx.fillStyle = it.hue ? 'hsl(' + Math.round(v * 360) + ',90%,55%)' : '#fff'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.stroke(); ctx.lineWidth = 2; ctx.strokeStyle = focused ? '#ffd21a' : '#fff'; ctx.stroke();
    if (!it.hue) txt(Math.round(v * 100) + '%', it.x + it.w, ty, 13 * s, '#d9a8ff', { align: 'right', shadow: false });
    return;
  }
  // button
  const dis = it.disabled;
  const hot = focused && !dis;
  const pulse = hot ? 1 + Math.sin(gt * 8) * 0.012 : 1;
  ctx.save();
  ctx.translate(it.x + it.w / 2, it.y + it.h / 2); ctx.scale(pulse, pulse); ctx.translate(-(it.x + it.w / 2), -(it.y + it.h / 2));
  ctx.globalAlpha = dis ? 0.45 : 1;
  const k = Math.min(12, it.h * 0.25);
  ctx.beginPath(); ctx.moveTo(it.x + k, it.y); ctx.lineTo(it.x + it.w, it.y); ctx.lineTo(it.x + it.w - k, it.y + it.h); ctx.lineTo(it.x, it.y + it.h); ctx.closePath();
  let fill = 'rgba(16,6,30,0.86)';
  if (it.on) fill = 'rgba(123,47,208,0.95)';
  if (hot) fill = it.danger ? '#a0102a' : '#c4142c';
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.stroke();
  ctx.lineWidth = 2; ctx.strokeStyle = hot ? '#fff' : it.danger ? '#ff5a6e' : it.on ? '#e9c4ff' : '#7b2fd0'; ctx.stroke();
  if (hot && !it.small) {
    // anime selection arrow
    txt('▶', it.x - 14 * s, it.y + it.h / 2, 16 * s, '#ffd21a', { noItalic: true, shadow: false });
  }
  const size = it.small ? 18 * s : Math.min(26 * s, it.h * (it.sub ? 0.36 : 0.46));
  const ly = it.sub ? it.y + it.h * 0.38 : it.y + it.h / 2;
  // white text, purple stroke, black outer stroke
  txt(it.label, it.x + it.w / 2, ly, size, '#fff', { rim: '#7b2fd0', noItalic: !!it.small });
  if (it.sub) txt(it.sub, it.x + it.w / 2, it.y + it.h * 0.76, Math.min(12 * s, it.h * 0.2), dis ? '#999' : '#d9a8ff', { shadow: false });
  ctx.restore();
}

function drawItems() {
  const f = focusList();
  const focused = f[clamp(ui.sel, 0, f.length - 1)];
  for (const it of ui.items) drawItem(it, it === focused);
}

function screenTitle(text, y, size) { txt(text, W / 2, y, size, '#fff', { rim: '#7b2fd0' }); }

function drawShowcase() {
  // the zombie crew shuffling on the right, drawn as crisp pixel sprites
  const s = UI, wide = W > H * 1.15;
  if (!wide) return;
  const kinds = ['cop_m', 'boomer', 'ped_f'];
  kinds.forEach((kind, i) => {
    const z = { x: 0, y: 0, look: { kind, skin: SKINS[i % SKINS.length], eye: i === 2, tear: i }, walkT: gt * 3 + i * 2, type: 'walk', flash: 0, frozen: 0, stun: 0, rise: 0, atk: Math.sin(gt * 2 + i) > 0.7 ? 0.1 : 0 };
    z.lookAng = Math.atan2(120, -200);
    const k = Math.max(2, Math.round(H / 170)), spr = zombieSprite(z, '');
    const x = Math.round(W * (0.74 + i * 0.09)), y = Math.round(H * 0.9);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(spr, x - 22 * k, y - 54 * k, 44 * k, 58 * k);
  });
}

function drawMenu() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  uiBuild();
  const s = UI;
  if (state === 'play' && paused) { ctx.fillStyle = 'rgba(8,0,18,0.72)'; ctx.fillRect(0, 0, W, H); }
  switch (ui.screen) {
    case 'main': {
      drawShowcase();
      drawLogo(W / 2, Math.max(safeTop + 80 * s, H * 0.2), Math.min(1.25 * s, W / 520));
      panel(W / 2 - 160 * s, Math.max(safeTop + 80 * s, H * 0.2) + 62 * s, 320 * s, 26 * s, '#000');
      txt('PIRATES OF THE RED MOON', W / 2, Math.max(safeTop + 80 * s, H * 0.2) + 75 * s, 14 * s, '#ffd21a', { shadow: false });
      if (bestRound > 0) txt('BEST: ROUND ' + bestRound, W / 2, H - safeBot - 18 * s, 13 * s, '#ff8aa0', { shadow: false });
      else txt(usingTouch ? 'Tap a button to begin' : 'Click or use ↑ ↓ + Enter', W / 2, H - safeBot - 18 * s, 12 * s, '#aaa', { shadow: false });
      break;
    }
    case 'start': screenTitle('PLAY', Math.max(safeTop + 44 * s, H * 0.12), 46 * s); break;
    case 'settings': screenTitle('SETTINGS', safeTop + 34 * s, 38 * s); break;
    case 'custom': {
      screenTitle('CUSTOMIZE', safeTop + 34 * s, 38 * s);
      const c = ui.cust;
      if (c) {
        // character card
        panel(c.cx1, c.top, c.colW, c.charH, 'rgba(16,6,30,0.86)');
        txt('CHARACTER', c.cx1 + 18 * s, c.top + 16 * s, 14 * s, '#ffd21a', { align: 'left', shadow: false });
        txt('1 / 1', c.cx1 + c.colW - 16 * s, c.top + 16 * s, 12 * s, '#aaa', { align: 'right', shadow: false });
        {
          // pixel GozaPlayz turntable, integer scale, nearest-neighbour
          const avail = c.charH - 80 * s, k = Math.max(1, Math.floor(avail / 28));
          const cxm = Math.round(c.cx1 + c.colW / 2), feet = Math.round(c.top + 32 * s + 27 * k);
          const glow = ctx.createRadialGradient(cxm, feet - 14 * k, 4, cxm, feet - 14 * k, 22 * k);
          glow.addColorStop(0, 'rgba(196,20,44,0.45)'); glow.addColorStop(1, 'rgba(123,47,208,0)');
          ctx.fillStyle = glow; ctx.fillRect(c.cx1, c.top, c.colW, c.charH);
          const turn = (Math.floor(gt / 1.6) + (ui.turn || 0)) % 4, dir = ['down', 'side', 'up', 'side'][turn];
          ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(cxm - 7 * k, feet, 14 * k, k);
          drawPixelGoza(ctx, cxm, feet, dir, Math.floor(gt * 7) & 3, turn === 3, k);
        }
        txt('GozaPlayz', c.cx1 + c.colW / 2, c.top + c.charH - 30 * s, 22 * s, '#fff', { rim: '#7b2fd0' });
        txt('More characters coming soon', c.cx1 + c.colW / 2, c.top + c.charH - 11 * s, 10 * s, '#aaa', { shadow: false });
        // gun color panel
        txt('GUN COLOR', c.cx2, c.gy + 14 * s, 14 * s, '#ffd21a', { align: 'left', shadow: false });
        txt(settings.gunMode === 'custom' ? 'All guns: hue ' + settings.gunHue + '°' : 'Each gun keeps its own design', c.cx2 + c.colW, c.gy + 14 * s, 11 * s, '#d9a8ff', { align: 'right', shadow: false });
        // live preview
        const py = c.previewY, guns = ['revolver', 'vector', 'chronos', 'kuro'];
        const avail = H - safeBot - L().bh - 24 * s - py;
        if (avail > 30 * s) {
          const sc = Math.min(1.7 * s, avail / 40, c.colW / (guns.length * 56));
          guns.forEach((id, i) => {
            ctx.save(); ctx.translate(c.cx2 + 18 * s + i * (c.colW / guns.length), py + Math.min(avail, 60 * s) / 2); ctx.scale(sc, sc);
            drawGun(ctx, id, { lw: 1.6 }); ctx.restore();
          });
        }
      }
      break;
    }
    case 'quit': {
      screenTitle('SEE YOU, SURVIVOR', H * 0.32, 40 * s);
      txt('Thanks for playing Westvale Zombies!', W / 2, H * 0.43, 16 * s, '#ffd21a', { shadow: false });
      txt('Your saved game is safe. You can close this tab or app now.', W / 2, H * 0.5, 13 * s, '#ddd', { shadow: false });
      break;
    }
    case 'pause': {
      screenTitle('PAUSED', Math.max(safeTop + 50 * s, H * 0.15), 58 * s);
      if (P) txt('ROUND ' + Math.max(1, R.n) + '   •   $' + fmt(P.points) + '   •   ' + P.kills + ' KILLS', W / 2, Math.max(safeTop + 50 * s, H * 0.15) + 44 * s, 13 * s, '#d9a8ff', { shadow: false });
      break;
    }
    case 'over': {
      const k = clamp(overT / 0.8, 0, 1);
      ctx.fillStyle = 'rgba(30,0,10,' + 0.75 * k + ')'; ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = k * 0.3; ctx.fillStyle = halftone; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1;
      const cy = H * 0.24, pop = easeOutBack(clamp(overT / 0.5, 0, 1));
      ctx.save(); ctx.translate(W / 2, cy); ctx.scale(pop, pop); ctx.rotate(-0.05);
      txt('GAME OVER', 0, 0, 66 * s, '#FF0033', { rim: '#fff' });
      ctx.restore();
      if (overT > 0.5) {
        txt('YOU SURVIVED ' + R.n + ' ROUND' + (R.n === 1 ? '' : 'S'), W / 2, cy + 62 * s, 24 * s, '#fff', { rim: '#7b2fd0' });
        txt(['KILLS ' + P.kills, 'HEADSHOTS ' + P.headshots, 'POINTS $' + fmt(P.points), 'DOWNS ' + P.downs].join('    '), W / 2, cy + 98 * s, 13 * s, '#ffd21a', { shadow: false });
        txt('BEST: ROUND ' + bestRound, W / 2, cy + 124 * s, 15 * s, '#ff8aa0');
      }
      break;
    }
  }
  if (!ui.confirm) drawItems();
  if (ui.confirm) {
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, W, H);
    uiBuild();
    screenTitle(ui.confirm.text, H * 0.36, 32 * s);
    txt(ui.confirm.sub, W / 2, H * 0.45, 13 * s, '#ddd', { shadow: false });
    drawItems();
  }
}

// =======================================================================
// MAIN LOOP
// =======================================================================
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  cv.style.width = W + 'px'; cv.style.height = H + 'px';
  UI = clamp(Math.min(W, H) / 430, 0.72, 1.45);
  sizeBuffer(clamp(Math.max(W, H) / 1000, 0.62, 2.2) * 1.15);
  const s = getComputedStyle(document.getElementById('safe'));
  safeTop = parseFloat(s.paddingTop) || 0; safeBot = parseFloat(s.paddingBottom) || 0;
  safeL = parseFloat(s.paddingLeft) || 0; safeR = parseFloat(s.paddingRight) || 0;
  buildSky();
  layoutTouch();
}

function updateCamera(dt) {
  let tx = P.x, ty = P.y - 20;
  if (!usingTouch && mouse.seen) {
    const wp = toWorld(mouse.x, mouse.y);
    tx += clamp((wp.x - P.x) * 0.22, -140, 140); ty += clamp((wp.y - P.y) * 0.22, -100, 100);
  } else if (input.fire) { tx += Math.cos(P.aim) * 70; ty += Math.sin(P.aim) * 70; }
  const k = 1 - Math.exp(-7 * dt);
  cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  cam.shake *= Math.pow(0.0015, dt); if (cam.shake < 0.3) cam.shake = 0;
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now; gt += dt;

  if (pressed.has('KeyM')) setMuted(!muted);
  if ((pressed.has('Escape') || pressed.has('KeyP')) && state === 'play' && !paused) pauseGame();

  if (state === 'play' && !paused) {
    readInput(P, toWorld);
    updatePlayer(dt);
    updateWeapon(dt);
    updateProjectiles(dt);
    updateZombies(dt);
    updateRound(dt);
    updatePowerups(dt);
    updateBox(dt);
    updateFx(dt);
    updateCamera(dt);
  } else if (state === 'over') {
    overT += dt;
    updateFx(dt * 0.4);
  } else if (state === 'menu') {
    // slow fly-over of the school behind the menus
    cam.x = 31 * T + Math.sin(gt * 0.05) * 16 * T;
    cam.y = 22 * T + Math.cos(gt * 0.037) * 11 * T;
    cam.shake = 0;
  }
  pressed.clear();
  if (state === 'play' && !paused) cv.style.cursor = usingTouch ? 'default' : 'none';

  // ---- render
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  drawSky(cam.x, cam.y);
  if (state === 'menu') {
    drawWorld();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
    v.addColorStop(0, 'rgba(6,0,14,0.55)'); v.addColorStop(1, 'rgba(0,0,0,0.88)');
    ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    drawEmbers(dt, 0.9);
    drawMenu();
    return;
  }
  drawWorld();
  drawLighting();
  drawEmbers(dt, 0.5);
  if (state === 'play') {
    if (!paused) { drawHUD(); if (usingTouch) drawTouchControls(); }
    else drawMenu();
  } else drawMenu();
}

addEventListener('resize', resize);
addEventListener('orientationchange', () => setTimeout(resize, 250));
if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (state === 'play' && !paused) pauseGame(); if (ac && ac.state === 'running') ac.suspend(); }
  else if (ac) ac.resume();
});

resize();
buildGoza(); buildStatue();
menuWorld();
requestAnimationFrame(frame);

// ---- PWA: register the offline service worker (only works over https / localhost)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
