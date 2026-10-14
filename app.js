/* ============================================================================
 * LUNAR LANDER — TOURNAMENT EDITION
 * Cabinet shell, deterministic shared hazards, match/cup engine, chiptune
 * audio, celebrations. Runs the classic LunarLander-v2 shim under Pyodide.
 * ==========================================================================*/

const PYODIDE_VERSION = "0.23.4";
const ONNX_RUNTIME_VERSION = "1.19.2";
const FPS = 50;
const STEP_INTERVAL_MS = 1000 / FPS;
const MAX_CATCH_UP_STEPS = 4;
const MAX_FRAME_ELAPSED_MS = 100;
const SCALE = 30;
const PANELS = 4;

/* ---------------------------------------------------------------- branding */
const PILOT_COLORS = ["#31E0F0", "#FF4FD8", "#C7F36B", "#FF9D5C"];
const PILOT_TOKEN = ["--p1", "--p2", "--p3", "--p4"];
const TAGLINES = {
  attract: [
    "INSERT COIN — PRESS START",
    "ONLY ONE LANDS CLEAN.",
    "SAME SKY. SAME HAZARDS. FLY CLEAN.",
    "FOUR PILOTS. ONE PAD. NO MERCY.",
  ],
  roundCall: [
    "PILOTS, TO YOUR PADS. ROUND {n}.",
    "SAME SKY. SAME HAZARDS. FLY CLEAN.",
    "READY? STICK IT.",
    "NOBODY GETS AN EASY SKY.",
  ],
  winnerMatch: [
    "STICKED THE LANDING.",
    "TOUCHDOWN. CHAMPION.",
    "THE PAD REMEMBERS.",
    "CLEAN LANDING. FIRST PLACE.",
  ],
  winnerRoundClose: ["DIRTY MARGIN. CLEAN WIN.", "CLUTCH.", "BY A NOSE."],
  winnerRoundBig: ["RAN AWAY WITH IT.", "NO CONTEST.", "LEFT THEM IN ORBIT."],
  loser: [
    "SO CLOSE YOU COULD SMELL THE REGOLITH.",
    "DOWN IN FLAMES. TRY AGAIN.",
    "THE PAD IS HARD. TRY AGAIN.",
    "SHAKE IT OFF. NEXT ROUND.",
    "CRASHED. LIKE THE KIT.",
  ],
};
const ARENAS = ["SALVAGE STATION-04", "MARE SERENITATIS", "TYCHO RIM", "SHACKLETON DEEP", "OCEANUS PROCELLARUM", "FRA MAURO BASIN"];

/* ---------------------------------------------------------------- hazards */
const GRAVITY_DEFAULT = -10.0;

/*
 * Graduated hazards. Each entry owns an ordered `levels` list; a hazard's
 * selected level is stored as an index in `match.hazards` (0 = OFF, 1..n =
 * index into `levels`). Every level carries a short `tag` (round-intro text)
 * and a chip `label`, plus one effect field (`rate`, `force`, or `gravity`).
 */
const HAZARDS = [
  {
    key: "sensor", name: "SENSOR GLITCH", effect: "stale readings", real: true,
    explain: "Your gauges freeze for a step; the pilot reads one stale reading.",
    levels: [
      { tag: "5%", label: "5%", rate: 0.05 },
      { tag: "10%", label: "10%", rate: 0.10 },
      { tag: "20%", label: "20%", rate: 0.20 },
    ],
  },
  {
    key: "thruster", name: "FAULTY THRUSTERS", effect: "drop / misfire", real: true,
    explain: "A commanded burn is dropped, or a coasting lander misfires.",
    levels: [
      { tag: "5%", label: "5%", rate: 0.05 },
      { tag: "10%", label: "10%", rate: 0.10 },
      { tag: "20%", label: "20%", rate: 0.20 },
    ],
  },
  {
    key: "wind", name: "WIND SHEAR", effect: "sideways draft", real: true,
    explain: "A side wind pushes every lander at the same time.",
    levels: [
      { tag: "MILD", label: "MILD (0.7)", force: 0.7 },
      { tag: "STD", label: "STD (1.4)", force: 1.4 },
      { tag: "GALE", label: "GALE (2.1)", force: 2.1 },
    ],
  },
  {
    key: "lowgrav", name: "LOW GRAVITY", effect: "floaty", real: true,
    explain: "Gravity is weaker; the lander floats and descends slowly.",
    levels: [
      { tag: "MILD", label: "MILD (-8.0)", gravity: -8.0 },
      { tag: "STRONG", label: "STRONG (-6.5)", gravity: -6.5 },
    ],
  },
  {
    key: "heavygrav", name: "HEAVY GRAVITY", effect: "heavy", real: true,
    explain: "Gravity is stronger; the lander falls fast.",
    levels: [
      { tag: "MILD", label: "MILD (-12.0)", gravity: -12.0 },
      { tag: "STRONG", label: "STRONG (-14.5)", gravity: -14.5 },
    ],
  },
  {
    key: "meteor", name: "METEOR SHOWER", effect: "incoming!", real: false, soon: true,
    explain: "Rocks across the descent corridor. Still in the workshop.",
    levels: [],
  },
];
/* Recommended match = sensor 10% + thruster 10% (the old binary defaults). */
const RECOMMENDED = { sensor: 2, thruster: 2 };
const HAZARD_KEYS = { sensor: 0, thruster: 0, wind: 0, lowgrav: 0, heavygrav: 0 };
const HAZARD_BY_KEY = Object.fromEntries(HAZARDS.map((h) => [h.key, h]));

/* ---------------------------------------------------------------- helpers */
const $ = (id) => document.getElementById(id);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* Deterministic shared-hazard PRNG (mulberry32), keyed by (seed, step index). */
function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(seed, t) {
  let h = (seed >>> 0) ^ Math.imul((t + 1) >>> 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}
/* Selected hazard level: 0 = OFF, 1..n = index into the hazard's levels. */
function hazLevel(key, hz) {
  const table = hz || (match && match.hazards) || HAZARD_KEYS;
  return table[key] || 0;
}
function hazOn(key, hz) { return hazLevel(key, hz) > 0; }
function hazSetting(key, hz) {
  const def = HAZARD_BY_KEY[key];
  const level = hazLevel(key, hz);
  return def && def.levels[level - 1] ? def.levels[level - 1] : null;
}
function hazRate(key, hz) { const s = hazSetting(key, hz); return s && typeof s.rate === "number" ? s.rate : 0; }
function hazForce(key, hz) { const s = hazSetting(key, hz); return s && typeof s.force === "number" ? s.force : 0; }
function hazTag(key, hz) { const s = hazSetting(key, hz); return s ? s.tag : ""; }
function gravityFor(hz) {
  const low = hazSetting("lowgrav", hz);
  if (low) return low.gravity;
  const heavy = hazSetting("heavygrav", hz);
  if (heavy) return heavy.gravity;
  return GRAVITY_DEFAULT;
}
/* One shared decision per physics step, identical for every pilot. */
function hazardAt(seed, t, hz) {
  const rng = mulberry32(hashSeed(seed, t));
  // Always draw the same rolls in the same order so every pilot sees the same sky.
  const sensorRoll = rng();
  const thrusterRoll = rng();
  const thrusterKind = rng() < 0.5 ? "drop" : "misfire";
  const misfireAction = 1 + Math.floor(rng() * 3);
  const windRoll = rng();
  const sensor = hazOn("sensor", hz) && sensorRoll < hazRate("sensor", hz);
  const thrusterFault = hazOn("thruster", hz) && thrusterRoll < hazRate("thruster", hz);
  const wind = hazOn("wind", hz) ? (windRoll * 2 - 1) * hazForce("wind", hz) : 0;
  return { sensor, thrusterFault, thrusterKind, misfireAction, wind };
}
/* A fault step drops every commanded burn; coasting pilots misfire identically. */
function applySharedThrusterFault(requested, fault) {
  if (!fault.thrusterFault) return requested;
  if (requested !== 0) return 0;
  return fault.misfireAction;
}

/* ---------------------------------------------------------------- audio */
const Sound = (() => {
  let ctx = null;
  let musicOn = true;
  let unlocked = false;
  let musicTimer = null;
  let musicStep = 0;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }
  function tone(freq, dur, type = "square", vol = 0.05, delay = 0, slideTo = null) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function chord(freqs, dur, type, vol, delay) {
    freqs.forEach((f, i) => tone(f, dur, type, vol, (delay || 0) + i * 0.02));
  }
  function sfx(name) {
    if (!ctx) return;
    switch (name) {
      case "menu": tone(440, 0.05, "square", 0.04); break;
      case "select": chord([660, 990], 0.09, "square", 0.05); break;
      case "coin": chord([988, 1319], 0.12, "square", 0.06); tone(1760, 0.18, "square", 0.05, 0.1); break;
      case "countdown": tone(name === "go" ? 1046 : 523, 0.12, "triangle", 0.06); break;
      case "go": chord([523, 784, 1046], 0.22, "triangle", 0.06); break;
      case "thrust": tone(90 + 40, 0.05, "sawtooth", 0.015); break;
      case "land": chord([523, 659, 784], 0.3, "triangle", 0.07); break;
      case "crash": tone(220, 0.5, "sawtooth", 0.07, 0, 55); break;
      case "fanfare": {
        const notes = [523, 659, 784, 1046, 784, 1046, 1318];
        notes.forEach((f, i) => tone(f, 0.16, "square", 0.06, i * 0.12));
        break;
      }
      case "lose": tone(392, 0.32, "triangle", 0.06); tone(294, 0.42, "triangle", 0.06, 0.16); break;
      default: break;
    }
  }
  const BASS = [98, 98, 131, 98, 87, 87, 116, 131];
  const LEAD = [392, 523, 659, 523, 587, 523, 440, 392, 349, 440, 523, 440, 392, 349, 330, 392];
  function musicTick() {
    if (!musicOn || !ctx) return;
    const b = BASS[musicStep % BASS.length];
    const l = LEAD[musicStep % LEAD.length];
    tone(b, 0.22, "triangle", 0.03);
    tone(l, 0.14, "square", 0.018, 0.02);
    musicStep++;
  }
  function startMusic() {
    if (!ctx || !musicOn || musicTimer) return;
    musicTimer = setInterval(musicTick, 300);
    musicTick();
  }
  function stopMusic() {
    if (musicTimer) clearInterval(musicTimer);
    musicTimer = null;
  }
  function unlock() {
    if (unlocked) return;
    const c = ensure();
    if (!c) return;
    unlocked = true;
    if (musicOn) startMusic();
  }
  function toggleMusic() {
    musicOn = !musicOn;
    if (musicOn) { ensure(); startMusic(); } else stopMusic();
    return musicOn;
  }
  return {
    unlock, sfx, toggleMusic, ensure, startMusic, stopMusic,
    isOn: () => musicOn,
    isUnlocked: () => unlocked,
    setEnabled(on) { musicOn = on; if (on) startMusic(); else stopMusic(); },
  };
})();

/* ---------------------------------------------------------------- screens */
const SCREEN_NAMES = ["boot", "attract", "menu", "solo", "mode", "players", "mods", "roundintro", "match", "win", "lose", "cup", "about"];
let currentScreenName = "boot";
function showScreen(name) {
  if (!SCREEN_NAMES.includes(name)) name = "attract";
  for (const candidate of SCREEN_NAMES) {
    const el = $(`screen-${candidate}`);
    if (el) el.hidden = candidate !== name;
  }
  currentScreenName = name;
  if (name !== "match" && name !== "solo") stopRunning();
  if (!["match", "attract", "win"].includes(name)) stopConfetti();
  showMatchBanner(false);
  resetMenuFocus();
  window.scrollTo({ top: 0, behavior: "auto" });
}
function setStatus(message) {
  const el = $("cabinet-status");
  if (el) el.textContent = message;
}

/* ---------------------------------------------------------------- model catalog */
const MODEL_FALLBACK = [{
  id: "ppo", label: "seekdepth jpeckenpaugh", url: "models/ppo-LunarLander-v2.onnx",
  author: "seekdepth", algorithm: "PPO", role: "default",
  source: "https://huggingface.co/seekdepth/ppo-LunarLander-v2",
}];
const MODEL_SOURCES = {
  ppo: "https://huggingface.co/seekdepth/ppo-LunarLander-v2",
  miftakhov: "https://github.com/RMiftakhov/LunarLander-v2-drlnd",
  sanket: "https://github.com/sanketsans/openAIenv",
  khordoo: "https://github.com/khordoo/Deep-Reinforcement-Learning-with-PyTorch",
  cpow: "https://github.com/cpow-89/Extended-Deep-Q-Learning-For-Open-AI-Gym-Environments",
};
let catalog = [];
const modelSessions = new Map();
const modelLoading = new Map();
let onnxRuntimeLoading = null;

function modelEntry(id) { return catalog.find((m) => m.id === id) || null; }
function modelLabel(id) { const e = modelEntry(id); return e ? e.label : id; }
function modelRole(id) { const e = modelEntry(id); return e ? (e.algorithm || e.role || "PILOT") : "PILOT"; }

async function loadCatalog() {
  let manifest = null;
  try {
    const res = await fetch(new URL("./models/manifest.json", import.meta.url), { cache: "no-store" });
    if (res.ok) manifest = await res.json();
  } catch (err) { console.warn("manifest unavailable", err); }
  const entries = manifest && Array.isArray(manifest.models) && manifest.models.length ? manifest.models : MODEL_FALLBACK;
  catalog = entries.filter((m) => m && m.id && m.url).map((m) => ({
    id: String(m.id),
    label: String(m.label || m.id),
    url: new URL(m.url, import.meta.url).href,
    author: m.author ? String(m.author) : "",
    algorithm: m.algorithm ? String(m.algorithm) : "",
    role: m.role ? String(m.role) : "",
    source: m.source ? String(m.source) : (MODEL_SOURCES[m.id] || ""),
  }));
}
async function ensureModelSession(modelId) {
  if (modelSessions.has(modelId)) return modelSessions.get(modelId);
  if (modelLoading.has(modelId)) return modelLoading.get(modelId);
  const entry = modelEntry(modelId);
  if (!entry) throw new Error(`Unknown AI model: ${modelId}`);
  const loading = (async () => {
    await loadOnnxRuntime();
    const ort = globalThis.ort;
    ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/`;
    ort.env.wasm.numThreads = 1;
    const session = await ort.InferenceSession.create(entry.url, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    if (!session.inputNames.includes("observation") || !session.outputNames.includes("logits")) {
      session.release();
      throw new Error(`${entry.label}: unexpected ONNX input or output name`);
    }
    modelSessions.set(modelId, session);
    return session;
  })().finally(() => { modelLoading.delete(modelId); });
  modelLoading.set(modelId, loading);
  return loading;
}
function loadOnnxRuntime() {
  if (globalThis.ort) return Promise.resolve(globalThis.ort);
  if (onnxRuntimeLoading) return onnxRuntimeLoading;
  onnxRuntimeLoading = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ONNX_RUNTIME_VERSION}/dist/ort.min.js`;
    script.async = true;
    script.onload = () => globalThis.ort ? resolve(globalThis.ort) : reject(new Error("ONNX Runtime Web missing browser API"));
    script.onerror = () => reject(new Error("Could not load ONNX Runtime Web"));
    document.head.appendChild(script);
  }).catch((err) => { onnxRuntimeLoading = null; throw err; });
  return onnxRuntimeLoading;
}
async function chooseModelActions(modelId, observations) {
  if (observations.length === 0) return [];
  const session = await ensureModelSession(modelId);
  const ort = globalThis.ort;
  const values = new Float32Array(observations.length * 8);
  observations.forEach((obs, i) => values.set(obs, i * 8));
  const input = new ort.Tensor("float32", values, [observations.length, 8]);
  const result = await session.run({ observation: input });
  const logits = result.logits.data;
  const actions = [];
  for (let row = 0; row < observations.length; row++) {
    let best = 0;
    const off = row * 4;
    for (let i = 1; i < 4; i++) if (logits[off + i] > logits[off + best]) best = i;
    actions.push(best);
  }
  return actions;
}

/* ---------------------------------------------------------------- drawing */
const $canvas = (id) => { const c = $(id); return c ? c.getContext("2d") : null; };
const VIEWPORT_HALF_H = 400 / SCALE / 2;
function screenPoint(point) { return [point[0] * SCALE, 400 - point[1] * SCALE]; }

function drawScene(canvas, ctx, scene, action, pcolor) {
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0A0B10";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#8293a1";
  for (let i = 0; i < 45; i++) {
    const x = (i * 137 + 29) % w, y = (i * 71 + 19) % 275;
    ctx.globalAlpha = 0.22 + ((i * 17) % 6) / 12;
    ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
  if (!scene) return;
  const terrain = scene.terrain || [];
  if (terrain.length) {
    let p = screenPoint(terrain[0][0]);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    for (const seg of terrain) { p = screenPoint(seg[1]); ctx.lineTo(p[0], p[1]); }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = "#1b2530"; ctx.fill();
    ctx.beginPath();
    p = screenPoint(terrain[0][0]); ctx.moveTo(p[0], p[1]);
    for (const seg of terrain) { p = screenPoint(seg[1]); ctx.lineTo(p[0], p[1]); }
    ctx.strokeStyle = "#697784"; ctx.lineWidth = 2; ctx.stroke();
  }
  if (scene.pad) {
    const padLeft = screenPoint([scene.pad[0], scene.pad[1]]);
    const padRight = screenPoint([scene.pad[2], scene.pad[1]]);
    ctx.strokeStyle = "#C7F36B"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(padLeft[0], padLeft[1]); ctx.lineTo(padRight[0], padRight[1]); ctx.stroke();
    ctx.fillStyle = "#C7F36B"; ctx.font = "10px 'VT323', monospace";
    ctx.fillText("LANDING ZONE", padLeft[0] + 7, padLeft[1] + 19);
  }
  for (const body of scene.bodies || []) {
    if (body.circle) {
      const c = screenPoint(body.circle.center);
      ctx.fillStyle = body.particle ? "#FF9D5C" : "#d3dde3";
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1, body.circle.radius * SCALE), 0, Math.PI * 2); ctx.fill();
      continue;
    }
    if (!body.vertices || !body.vertices.length) continue;
    const pts = body.vertices.map(screenPoint);
    if (body.particle) {
      ctx.fillStyle = "#FF9D5C"; ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], 2, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.fillStyle = pcolor || "#e4ebef";
    ctx.strokeStyle = "#aab7c0"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (!scene.observation) return;
  const obs = scene.observation;
  const x = w / 2 + obs[0] * (w / 2), y = h - (obs[1] * VIEWPORT_HALF_H + 8.1) * SCALE;
  ctx.save(); ctx.translate(x, y); ctx.rotate(obs[4]);
  if (action === 2) {
    ctx.fillStyle = "#FF9D5C";
    const jitter = 3 + ((Math.floor(performance.now() / 60) % 5));
    ctx.beginPath(); ctx.moveTo(-5, 12); ctx.lineTo(0, 27 + jitter); ctx.lineTo(5, 12); ctx.fill();
  }
  if (action === 1 || action === 3) {
    const sign = action === 1 ? 1 : -1;
    ctx.fillStyle = "#75d8e6";
    ctx.beginPath(); ctx.moveTo(sign * 9, 0); ctx.lineTo(sign * 20, 4); ctx.lineTo(sign * 9, 7); ctx.fill();
  }
  ctx.restore();
}
/* ---------------------------------------------------------------- confetti */
const confettiLayers = [];
function startConfetti(canvas, colorHex) {
  if (!canvas) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width));
  canvas.height = Math.max(1, Math.floor(rect.height));
  const palette = [colorHex || "#E5B95C", "#E5B95C", "#FFF3C4"];
  const count = canvas.width < 420 ? 8 : 16;
  const pieces = [];
  for (let i = 0; i < count; i++) {
    pieces.push({
      x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height,
      vy: 90 + Math.random() * 120, vx: (Math.random() - 0.5) * 60,
      size: 5 + Math.floor(Math.random() * 4), color: palette[i % palette.length], rot: Math.random() * Math.PI,
    });
  }
  confettiLayers.push({ canvas, ctx, pieces, life: 0 });
}
function stopConfetti() { confettiLayers.length = 0; }
function updateConfetti(dt) {
  for (const layer of confettiLayers) {
    const { canvas, ctx, pieces } = layer;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    layer.life += dt;
    for (const p of pieces) {
      p.y += p.vy * dt; p.x += p.vx * dt; p.rot += dt * 4;
      if (p.y > canvas.height + 12) { p.y = -12; p.x = Math.random() * canvas.width; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }
}

/* ============================================================================
 * SOLO FLIGHT
 * ==========================================================================*/
const solo = {
  running: false, busy: false, state: null, action: 0, appliedAction: 0,
  controllerMode: null, request: 0, episode: 0, totalReward: 0,
  prevObservation: null, stepIndex: 0, autoReset: null, speed: 1,
  accumulator: 0, resetRequested: false,
};
const soloCanvas = $("solo-canvas");
const soloCtx = soloCanvas ? soloCanvas.getContext("2d") : null;

function soloStatus(msg) { const el = $("solo-status"); if (el) el.textContent = msg; }
function soloOverlay(message, error = false, loading = false) {
  const panel = $("solo-overlay"); if (!panel) return;
  panel.classList.remove("hidden", "error", "loading");
  if (error) panel.classList.add("error");
  if (loading) panel.classList.add("loading");
  const m = $("solo-message"); if (m) m.textContent = message;
}
function soloHideOverlay() { const p = $("solo-overlay"); if (p) p.classList.add("hidden"); }
function updateSoloTelemetry() {
  if (!solo.state) return;
  const obs = solo.state.observation;
  $("altitude").textContent = Math.max(0, obs[1] * 100).toFixed(1);
  $("hspeed").textContent = obs[2].toFixed(2);
  $("vspeed").textContent = obs[3].toFixed(2);
  $("reward").textContent = solo.totalReward.toFixed(1);
}
function updateSoloButtons() {
  const choices = [["human-controller", "human"], ["policy-controller", "policy"], ["override-controller", "override"]];
  for (const [id, mode] of choices) {
    const btn = $(id); if (!btn) continue;
    const selected = solo.controllerMode === mode;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-pressed", String(selected));
    const label = btn.querySelector(".controller-state");
    if (label) label.textContent = selected ? "ACTIVE" : (mode !== "human" && modelSessions.has(modelSelectValue()) ? "READY" : "SELECT");
  }
  const help = $("controller-help");
  if (help) {
    help.hidden = solo.controllerMode !== "override";
    help.textContent = "The AI flies. Hold ←/→ to steer or ↑ for the main engine — let go and it takes back the stick.";
  }
}
function modelSelectValue() { const s = $("model-select"); return s ? s.value : null; }
function updatePilotSource() {
  const target = $("pilot-source"); if (!target) return;
  const entry = modelEntry(modelSelectValue());
  if (!entry || !entry.source) { target.hidden = true; target.replaceChildren(); return; }
  target.hidden = false;
  const label = document.createElement("span");
  label.className = "pilot-source-label"; label.textContent = "PILOT SOURCE";
  const link = document.createElement("a");
  link.href = entry.source; link.target = "_blank"; link.rel = "noreferrer";
  link.textContent = `↗ ${entry.label}`;
  target.replaceChildren(label, link);
}
function populateSoloSelectors() {
  if (!catalog.length) return;
  const single = $("model-select");
  if (single) {
    single.replaceChildren(...catalog.map((m) => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.label; return o; }));
    single.value = catalog[0].id;
  }
  const field = $("model-select-field");
  if (field) field.hidden = catalog.length < 2;
  updatePilotSource();
}
function humanSoloAction() {
  if (pressed.has("ArrowUp")) return 2;
  if (pressed.has("ArrowLeft")) return 1;
  if (pressed.has("ArrowRight")) return 3;
  return 0;
}
async function chooseController(mode) {
  const request = ++solo.request;
  if (mode !== "human") {
    const btn = { policy: $("policy-controller"), override: $("override-controller") }[mode];
    const label = btn ? btn.querySelector(".controller-state") : null;
    if (btn) btn.disabled = true;
    if (label) label.textContent = "LOADING";
    try { await ensureModelSession(modelSelectValue()); }
    catch (err) {
      if (btn) btn.disabled = false;
      if (label) label.textContent = "RETRY";
      soloStatus("THIS PILOT WON'T BOOT");
      console.error(err);
      return;
    }
    if (btn) btn.disabled = false;
    if (request !== solo.request) { if (label) label.textContent = "READY"; return; }
  }
  const previous = solo.controllerMode;
  const wasAuto = solo.autoReset !== null;
  if (mode !== previous) solo.autoReset = null;
  while (solo.busy && request === solo.request) await new Promise((r) => setTimeout(r, 0));
  if (request !== solo.request) return;
  solo.controllerMode = mode;
  pressed.clear();
  updateSoloButtons();
  if (wasAuto && mode !== previous && pyodide && solo.state) { await resetSoloEpisode(); return; }
  if (solo.episode === 0 && solo.state && !solo.running) await resetSoloEpisode();
}
async function resetSoloEpisode() {
  if (!pyodide || solo.busy || !solo.controllerMode) return;
  solo.busy = true; solo.running = false; solo.autoReset = null;
  try {
    solo.state = readPythonJson("reset_json()");
    solo.action = 0; solo.appliedAction = 0;
    solo.prevObservation = Array.from(solo.state.observation);
    solo.stepIndex = 0; solo.accumulator = 0; solo.totalReward = 0; solo.episode += 1;
    const ep = $("solo-episode"); if (ep) ep.textContent = `FLIGHT ${String(solo.episode).padStart(2, "0")}`;
    updateSoloTelemetry();
    drawScene(soloCanvas, soloCtx, solo.state, solo.appliedAction);
    soloStatus("FLIGHT LIVE"); soloHideOverlay();
    const rb = $("solo-reset"); if (rb) rb.disabled = false;
    solo.running = true;
  } catch (err) { soloFault(err); }
  finally { solo.busy = false; }
}
function requestSoloReset() {
  if (solo.busy) { solo.resetRequested = true; solo.running = false; return; }
  resetSoloEpisode();
}
function soloFault(error) {
  solo.running = false; solo.busy = false;
  soloStatus("CABINET FAULT");
  soloOverlay(String(error && error.message || error).split("\n").slice(-4).join(" "), true);
  console.error(error);
}
async function soloFrame(elapsedMs) {
  if (!solo.running && solo.autoReset === null) { solo.accumulator = 0; return; }
  if (solo.autoReset !== null) {
    solo.autoReset -= (elapsedMs * solo.speed) / 1000;
    if (solo.autoReset <= 0) { solo.autoReset = null; await resetSoloEpisode(); return; }
  }
  if (!solo.running) { solo.accumulator = 0; return; }
  solo.accumulator = Math.min(solo.accumulator + elapsedMs * solo.speed, STEP_INTERVAL_MS * MAX_CATCH_UP_STEPS);
  if (solo.busy || solo.accumulator < STEP_INTERVAL_MS) return;
  solo.busy = true;
  let terminal = null;
  try {
    let steps = 0;
    while (steps < MAX_CATCH_UP_STEPS && solo.running && solo.accumulator >= STEP_INTERVAL_MS) {
      let action = 0;
      if (solo.controllerMode === "human") action = humanSoloAction();
      else if (solo.controllerMode === "policy") action = (await chooseModelActions(modelSelectValue(), [solo.prevObservation]))[0];
      else if (solo.controllerMode === "override") {
        const ai = (await chooseModelActions(modelSelectValue(), [solo.prevObservation]))[0];
        const human = (pressed.has("ArrowLeft") ? 1 : pressed.has("ArrowRight") ? 3 : pressed.has("ArrowUp") ? 2 : null);
        action = human === null ? ai : human;
      }
      const before = Array.from(solo.state.observation);
      solo.appliedAction = action;
      const result = readPythonJson(`step_json(${action})`);
      solo.prevObservation = before;
      solo.state = result.state;
      solo.totalReward += result.reward;
      if (action === 2) Sound.sfx("thrust");
      if (result.terminated || result.truncated) { solo.running = false; terminal = result; }
      solo.stepIndex += 1;
      solo.accumulator = Math.max(0, solo.accumulator - STEP_INTERVAL_MS);
      steps++;
    }
    updateSoloTelemetry();
    drawScene(soloCanvas, soloCtx, solo.state, solo.appliedAction);
    if (terminal) {
      solo.accumulator = 0;
      if (terminal.terminated && terminal.reward >= 0) Sound.sfx("land"); else Sound.sfx("crash");
      if (solo.controllerMode === "policy") {
        solo.autoReset = 2.0;
        soloStatus(`NEXT FLIGHT IN ${solo.autoReset.toFixed(1)}s`);
      } else {
        soloStatus(terminal.terminated ? "FLIGHT COMPLETE" : "TIME'S UP");
        soloOverlay(`Flight over · ${solo.totalReward.toFixed(1)} points · reset to fly again`);
      }
      const rb = $("solo-reset"); if (rb) rb.disabled = false;
    }
  } catch (err) { soloFault(err); }
  finally {
    solo.busy = false;
    if (solo.resetRequested) { solo.resetRequested = false; resetSoloEpisode(); }
  }
}

/* ============================================================================
 * TOURNAMENT / MATCH ENGINE
 * ==========================================================================*/
let match = null;
const multiSims = [];

function initializePanels() {
  const board = $("multi-board");
  if (!board) return;
  for (let i = 0; i < PANELS; i++) {
    const card = document.createElement("article");
    card.className = "multi-sim-card";
    card.dataset.slot = String(i);
    card.style.setProperty("--pilot-color", PILOT_COLORS[i]);
    const head = document.createElement("div"); head.className = "multi-sim-heading";
    const plate = document.createElement("strong"); plate.className = "model-name";
    const place = document.createElement("span"); place.className = "placement";
    head.append(plate, place);
    const viewport = document.createElement("div"); viewport.className = "multi-sim-viewport";
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 400;
    canvas.setAttribute("aria-label", `Pilot ${i + 1} flight`);
    const lanePlace = document.createElement("div"); lanePlace.className = "lane-place"; lanePlace.hidden = true;
    const lanePlaceNum = document.createElement("span"); lanePlaceNum.className = "lane-place-num";
    const lanePlaceLabel = document.createElement("span"); lanePlaceLabel.className = "lane-place-label";
    lanePlace.append(lanePlaceNum, lanePlaceLabel);
    viewport.append(canvas, lanePlace);
    const foot = document.createElement("div"); foot.className = "multi-sim-reward";
    const status = document.createElement("span"); status.className = "sim-outcome";
    foot.append(status);
    card.append(head, viewport, foot);
    board.append(card);
    multiSims.push({
      index: i, el: card, plate, place, status, canvas, ctx: canvas.getContext("2d"),
      lanePlace, lanePlaceNum, lanePlaceLabel,
      state: null, prevObservation: null, action: 0, reward: 0, done: false,
      outcome: "FLYING", steps: 0, placement: null, pilot: null,
    });
  }
}
function drawPanels() {
  if (!match) return;
  for (const sim of multiSims) {
    const active = sim.pilot != null;
    sim.el.hidden = !active;
    if (!active) continue;
    drawScene(sim.canvas, sim.ctx, sim.state, sim.action, sim.pilot.color);
    const stats = match.stats[sim.pilot.slot];
    sim.plate.textContent = `P${sim.pilot.slot + 1} · ${sim.pilot.shortName}`;
    sim.el.style.setProperty("--pilot-color", sim.pilot.color);
    sim.place.textContent = sim.placement ? placeText(sim.placement) : "";
    sim.place.className = `placement${sim.placement === 1 ? " gold" : sim.placement ? " ranked" : ""}`;
    // Big lane-place overlay: only shown once the round is ranked.
    const showPlace = !!sim.placement && match.phase === "roundComplete";
    sim.lanePlace.hidden = !showPlace;
    if (showPlace) {
      sim.lanePlace.style.setProperty("--pilot-color", sim.pilot.color);
      sim.lanePlaceNum.textContent = String(sim.placement);
      sim.lanePlaceLabel.textContent = placeText(sim.placement).toUpperCase();
    }
    const roundPts = sim.reward;
    if (sim.done) {
      sim.status.textContent = `${sim.outcome} · ROUND ${roundPts.toFixed(1)} · TOTAL ${(stats ? stats.total + roundPts : roundPts).toFixed(1)} pts`;
      sim.status.classList.add("complete");
    } else {
      sim.status.textContent = `FLYING · ROUND ${roundPts.toFixed(1)} · TOTAL ${(stats ? stats.total + roundPts : roundPts).toFixed(1)} pts`;
      sim.status.classList.remove("complete");
    }
  }
}
const PLACE_LABELS = ["1st", "2nd", "3rd", "4th"];
function placeText(p) { return PLACE_LABELS[p - 1] || `#${p}`; }

function makePilot(slot, modelId) {
  const human = modelId === "human";
  return {
    slot, modelId, human,
    color: PILOT_COLORS[slot],
    name: human ? "HUMAN PILOT" : modelLabel(modelId),
    shortName: human ? "YOU" : shortName(modelLabel(modelId)),
    role: human ? "HUMAN PILOT" : modelRole(modelId),
    source: human ? "" : (modelEntry(modelId) ? modelEntry(modelId).source : ""),
  };
}
function shortName(label) {
  return label.split(/\s+/)[0].toUpperCase().slice(0, 10);
}

function newMatch({ mode, slotModels, totalRounds, hazards }) {
  const pilots = slotModels.map((mid, slot) => makePilot(slot, mid));
  const slotCount = pilots.length;
  const teams = mode === "versus" ? [[0], [1]] : mode === "doubles" ? [[0, 1], [2, 3]] : null;
  const bestOf = mode === "versus" || mode === "doubles" ? 3 : 0;
  const hazardState = { ...HAZARD_KEYS, ...(hazards || {}) };
  return {
    mode, pilots, slotCount, teams, bestOf,
    totalRounds: mode === "cup" ? totalRounds : bestOf,
    round: 0, roundWins: teams ? [0, 0] : null,
    stats: pilots.map(() => ({ total: 0, wins: 0, lands: 0, placements: [] })),
    hazards: hazardState,
    seedBase: (Math.floor(Date.now() / 1000) ^ 0x1f3a5c7) >>> 0,
    phase: "idle", roundSteps: 0, gravity: gravityFor(hazardState),
    lastRound: null, champion: null, humanSlot: pilots.findIndex((p) => p.human),
  };
}

async function prepareMatch(matchConfig) {
  match = newMatch(matchConfig);
  for (const sim of multiSims) { sim.pilot = null; sim.placement = null; }
  const needed = match.slotCount;
  for (let i = 0; i < needed; i++) {
    multiSims[i].pilot = match.pilots[i];
    multiSims[i].placement = null;
    multiSims[i].reward = 0;
    multiSims[i].done = false;
    multiSims[i].outcome = "FLYING";
    multiSims[i].steps = 0;
  }
  setStatus("PILOTS, TO YOUR PADS");
  const toLoad = match.pilots.filter((p) => !p.human).map((p) => p.modelId);
  await Promise.all([...new Set(toLoad)].map((id) => ensureModelSession(id)));
  setupTouchForMatch();
  const touch = $("match-touch");
  if (touch) touch.hidden = match.humanSlot < 0;
}

function hazardIntroText() {
  const active = HAZARDS.filter((h) => hazOn(h.key, match.hazards) && !h.soon);
  if (!active.length) return "CLEAN SKY — NO HAZARDS.";
  return `${active.map((h) => `${h.name} ${hazTag(h.key, match.hazards)}`).join(" · ")} — SAME SKY. SAME HAZARDS.`;
}

function beginRound() {
  match.round += 1;
  match.roundSteps = 0;
  match.gravity = gravityFor(match.hazards);
  const seed = (match.seedBase + match.round * 2654435761) >>> 0;
  match.roundSeed = seed;
  for (const sim of multiSims) {
    sim.done = false; sim.reward = 0; sim.action = 0; sim.steps = 0; sim.placement = null; sim.outcome = "FLYING";
  }
  const arena = ARENAS[(match.round - 1) % ARENAS.length];
  match.arena = arena;
  // round intro
  $("roundintro-mode").textContent = match.mode.toUpperCase();
  $("roundintro-round").textContent = `ROUND ${match.round}`;
  $("roundintro-arena").textContent = arena;
  $("roundintro-announcer").textContent = pick(TAGLINES.roundCall).replace("{n}", String(match.round));
  $("roundintro-hazards").textContent = hazardIntroText();
  showScreen("roundintro");
  runCountdown(async () => {
    await resetRoundEnvs(seed);
    showScreen("match");
    updateMatchHead();
    match.phase = "running";
    running = true;
    drawPanels();
  });
}

function runCountdown(done) {
  let n = 3;
  const el = $("roundintro-count");
  const tick = () => {
    if (n > 0) { if (el) el.textContent = String(n); Sound.sfx("countdown"); n -= 1; setTimeout(tick, 700); }
    else { if (el) el.textContent = "GO"; Sound.sfx("go"); setTimeout(() => done(), 500); }
  };
  tick();
}

async function resetRoundEnvs(seed) {
  const scenes = readPythonJson(`reset_many_seeded_json(${JSON.stringify(JSON.stringify({ seed, gravity: match.gravity }))})`);
  for (let i = 0; i < multiSims.length; i++) {
    const sim = multiSims[i];
    if (!sim.pilot) continue;
    sim.state = scenes[i];
    sim.prevObservation = Array.from(scenes[i].observation);
    sim.reward = 0; sim.action = 0; sim.done = false; sim.steps = 0;
  }
  match.accumulator = 0;
}

function updateMatchHead() {
  const head = $("match-round");
  if (head) head.textContent = `ROUND ${match.round} / ${match.totalRounds} · ${match.arena}`;
  updateMatchPips();
}
function updateMatchPips() {
  const el = $("match-pips");
  if (!el) return;
  if (match.teams) {
    el.textContent = match.teams.map((t, i) => `TEAM ${i + 1} ${pip(match.roundWins[i], match.bestOf)}`).join("   ");
  } else {
    el.textContent = match.pilots.map((p) => `P${p.slot + 1} ${escapeHtml(p.shortName)}`).join("   ");
  }
}
function pip(wins, best) {
  const pipsNeeded = Math.ceil(best / 2);
  let s = "";
  for (let i = 0; i < pipsNeeded; i++) s += i < wins ? "●" : "○";
  return s;
}

function activeSims() { return multiSims.filter((s) => s.pilot && !s.done); }

async function advanceMatchStep() {
  const t = match.roundSteps;
  const fault = hazardAt(match.roundSeed, t, match.hazards);
  const actions = multiSims.map(() => 0);
  const groups = new Map();
  for (const sim of activeSims()) {
    if (sim.pilot.human) continue;
    const g = groups.get(sim.pilot.modelId) || [];
    g.push(sim);
    groups.set(sim.pilot.modelId, g);
  }
  // sensor glitch: uniform timing, pilot uses its own previous observation
  for (const [modelId, sims] of groups) {
    const obs = sims.map((s) => (fault.sensor ? s.prevObservation : s.state.observation));
    const chosen = await chooseModelActions(modelId, obs);
    sims.forEach((s, i) => { s.action = chosen[i]; actions[s.index] = chosen[i]; });
  }
  // human
  for (const sim of activeSims()) {
    if (!sim.pilot.human) continue;
    const a = matchAction("ArrowUp", 2) ?? matchAction("ArrowLeft", 1) ?? matchAction("ArrowRight", 3) ?? 0;
    sim.action = a; actions[sim.index] = a;
  }
  // uniform thruster fault
  for (const sim of activeSims()) actions[sim.index] = applySharedThrusterFault(actions[sim.index], fault);

  const active = multiSims.map((s) => !!(s.pilot && !s.done));
  const payload = { actions, active, hazards: { gravity: match.gravity, wind: fault.wind } };
  const results = readPythonJson(`step_many_json(${JSON.stringify(JSON.stringify(payload))})`);
  for (let i = 0; i < multiSims.length; i++) {
    const sim = multiSims[i];
    const result = results[i];
    if (!result || !sim.pilot) continue;
    const before = Array.from(sim.state.observation);
    sim.prevObservation = before;
    sim.state = result.state;
    sim.reward += result.reward;
    sim.steps += 1;
    if (result.terminated || result.truncated) {
      sim.done = true;
      sim.outcome = result.truncated ? "TIME'S UP" : (result.reward > 0 ? "LANDED" : "CRASHED");
      Sound.sfx(sim.outcome === "LANDED" ? "land" : "crash");
    }
  }
  if (match.roundSteps % 7 === 0 && multiSims.some((s) => s.pilot && !s.done && s.action === 2)) Sound.sfx("thrust");
  match.roundSteps += 1;
}
function matchAction(code, value) { return pressed.has(code) ? value : null; }

function roundComplete() { return activeSims().length === 0; }

function landingBonus(sim) { return sim.outcome === "LANDED" ? 1 : 0; }
function compareSims(a, b) {
  if (Math.abs(a.reward - b.reward) < 0.001) {
    if (landingBonus(a) !== landingBonus(b)) return landingBonus(b) - landingBonus(a);
    return a.steps - b.steps;
  }
  return b.reward - a.reward;
}
function teamScore(match, teamIdx) {
  return match.teams[teamIdx].reduce((sum, slot) => sum + (match.simBySlot[slot]?.reward || 0), 0);
}
function teamLanded(match, teamIdx) {
  return match.teams[teamIdx].every((slot) => match.simBySlot[slot]?.outcome === "LANDED");
}

function finishRound() {
  match.phase = "roundComplete";
  match.simBySlot = {};
  for (const sim of multiSims) if (sim.pilot) match.simBySlot[sim.pilot.slot] = sim;
  const ranked = multiSims.filter((s) => s.pilot).slice().sort(compareSims);
  // Every mode gets a full 1..N placement so the lanes can crown their pilots.
  ranked.forEach((sim, idx) => { sim.placement = idx + 1; });

  let info;
  if (match.teams) {
    const s0 = teamScore(match, 0), s1 = teamScore(match, 1);
    let winner = s0 > s1 ? 0 : s1 > s0 ? 1 : -1;
    if (winner === -1 || Math.abs(s0 - s1) < 15) {
      const l0 = teamLanded(match, 0) ? 1 : 0, l1 = teamLanded(match, 1) ? 1 : 0;
      if (l0 !== l1) winner = l0 > l1 ? 0 : 1;
    }
    if (winner !== -1) match.roundWins[winner] += 1;
    for (const sim of ranked) {
      const st = match.stats[sim.pilot.slot];
      st.total += sim.reward;
      st.placements.push(sim.placement);
      if (sim.outcome === "LANDED") st.lands += 1;
      const team = match.teams.findIndex((t) => t.includes(sim.pilot.slot));
      if (winner !== -1 && team === winner) st.wins += 1;
    }
    info = { winnerTeam: winner, margin: Math.abs(s0 - s1), scores: [s0, s1], landed0: teamLanded(match, 0), landed1: teamLanded(match, 1) };
  } else {
    for (const sim of ranked) {
      const stats = match.stats[sim.pilot.slot];
      stats.total += sim.reward;
      stats.placements.push(sim.placement);
      if (sim.outcome === "LANDED") stats.lands += 1;
      if (sim.placement === 1) stats.wins += 1;
    }
    info = { winnerTeam: null, winnerSlot: ranked[0].pilot.slot, margin: ranked[0].reward - (ranked[1]?.reward || 0), scores: ranked.map((s) => s.reward), cup: true };
  }
  drawPanels();
  updateMatchPips();
  showRoundResult(info);
}

/* Round end lands on the 4-lane board: big place numbers + a continue banner. */
function showRoundResult(info) {
  const humanLost = match.humanSlot >= 0 && !humanWonRound(info);
  const kickerEl = $("match-banner-kicker");
  const winnerEl = $("match-banner-winner");
  const marginEl = $("match-banner-margin");
  let title, margin, color;
  if (info.cup) {
    const p = match.pilots[info.winnerSlot];
    title = `ROUND ${match.round} — ${p.shortName}`;
    color = p.color;
    margin = `+${Math.max(0, info.margin).toFixed(1)} PTS`;
    if (kickerEl) kickerEl.textContent = `ROUND ${match.round} COMPLETE`;
  } else if (info.winnerTeam === null || info.winnerTeam === -1) {
    title = `ROUND ${match.round} COMPLETE`;
    color = "#94A3B8";
    margin = "DEAD HEAT";
    if (kickerEl) kickerEl.textContent = "ROUND COMPLETE";
  } else {
    const slots = match.teams[info.winnerTeam];
    const lead = match.pilots[slots[0]];
    title = `ROUND ${match.round} — ${slots.map((s) => match.pilots[s].shortName).join(" + ")}`;
    color = lead.color;
    margin = `+${info.margin.toFixed(1)} PTS`;
    if (kickerEl) kickerEl.textContent = "ROUND COMPLETE";
  }
  if (humanLost) {
    title = `SO CLOSE — ${Math.abs(info.margin || 0).toFixed(1)} BEHIND`;
    color = "#94A3B8";
    if (kickerEl) kickerEl.textContent = pick(TAGLINES.loser);
  }
  if (winnerEl) { winnerEl.textContent = title; winnerEl.style.color = color; }
  if (marginEl) marginEl.textContent = margin;
  const matchOver = match.teams ? (match.roundWins[0] >= 2 || match.roundWins[1] >= 2) : match.round >= match.totalRounds;
  const cont = $("match-continue");
  if (cont) { cont.textContent = matchOver ? "RESULTS ▶" : "NEXT ROUND ▶"; cont.hidden = false; }
  if (currentScreenName !== "match") showScreen("match");
  showMatchBanner(true, matchOver);
  if (!humanLost && info.winnerTeam !== -1) { Sound.sfx("land"); startConfetti($("match-confetti"), color); }
}

function showMatchBanner(visible, isOver) {
  const banner = $("match-banner");
  if (!banner) return;
  banner.hidden = !visible;
  const prompt = $("match-banner-prompt");
  if (prompt) prompt.textContent = isOver ? "PRESS START · SPACE / ENTER FOR RESULTS" : "PRESS START · SPACE / ENTER";
}

function humanWonRound(info) {
  if (match.humanSlot < 0) return true;
  if (info.cup) return info.winnerSlot === match.humanSlot;
  const humanTeam = match.teams.findIndex((t) => t.includes(match.humanSlot));
  return info.winnerTeam === humanTeam;
}

function continueAfterRound() {
  if (!match || match.phase !== "roundComplete") return;
  stopConfetti();
  const cont = $("match-continue"); if (cont) cont.hidden = true;
  showMatchBanner(false);
  const matchOver = match.teams ? (match.roundWins[0] >= 2 || match.roundWins[1] >= 2) : match.round >= match.totalRounds;
  if (!matchOver) {
    if (match.mode === "cup") openMods("round");
    else beginRound();
    return;
  }
  endMatch();
}

function endMatch() {
  match.phase = "done";
  running = false;
  // determine champion
  let championSlot;
  if (match.teams) {
    championSlot = match.roundWins[0] >= 2 ? match.teams[0][0] : match.teams[1][0];
  } else {
    const ranked = match.pilots.slice().sort((a, b) => match.stats[b.slot].total - match.stats[a.slot].total);
    championSlot = ranked[0].slot;
  }
  match.champion = championSlot;
  const humanWon = match.humanSlot < 0 ? true : (match.teams ? match.teams.findIndex((t) => t.includes(match.humanSlot)) === (match.roundWins[0] >= 2 ? 0 : 1) : championSlot === match.humanSlot);
  if (match.humanSlot >= 0 && !humanWon) showLose();
  else showWin(championSlot);
}

function showWin(championSlot) {
  const champ = match.pilots[championSlot];
  const podium = $("win-podium");
  if (podium) {
    const ranked = match.teams ? [] : match.pilots.slice().sort((a, b) => match.stats[b.slot].total - match.stats[a.slot].total);
    if (match.teams) {
      const winnerTeam = match.teams.findIndex((t) => t.includes(championSlot));
      const loserTeam = 1 - winnerTeam;
      const order = [
        { pilot: match.pilots[match.teams[loserTeam][0]], place: 2 },
        { pilot: champ, place: 1 },
      ];
      podium.innerHTML = order.map((o) => podiumBar(o.pilot, o.place)).join("");
    } else {
      const order = [ranked[1], ranked[0], ranked[2]].filter(Boolean);
      const placeFor = (p) => ranked.indexOf(p) + 1;
      podium.innerHTML = order.map((p) => podiumBar(p, placeFor(p), p === champ)).join("");
    }
  }
  const nameEl = $("win-name");
  if (nameEl) { nameEl.textContent = champ.name; nameEl.style.color = champ.color; }
  const tag = $("win-tagline");
  if (tag) tag.textContent = pick(TAGLINES.winnerMatch);
  showScreen("win");
  Sound.sfx("fanfare");
  requestAnimationFrame(() => startConfetti($("win-confetti"), champ.color));
}

function cupSvg() {
  return `<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M6 3h12v3a6 6 0 0 1-5 5.9V15h3v3H8v-3h3v-3.1A6 6 0 0 1 6 6V3zm-2 1H2v2a3 3 0 0 0 3 3V5zm16 0h2v2a3 3 0 0 1-3 3V5z" fill="currentColor"/></svg>`;
}
function podiumBar(pilot, place, isChamp) {
  const h = place === 1 ? 150 : place === 2 ? 100 : 70;
  return `<div class="podium-col${place === 1 ? " champion" : ""}" style="--pilot-color:${pilot.color}">
      <div class="podium-cup">${place === 1 ? cupSvg() : ""}</div>
      <div class="podium-bar" style="height:${h}px"><span>${place}</span></div>
      <div class="podium-name">P${pilot.slot + 1} ${escapeHtml(pilot.shortName)}</div>
    </div>`;
}
function showLose() {
  const tag = $("lose-tagline");
  if (tag) tag.textContent = pick(TAGLINES.loser);
  const human = match.pilots[match.humanSlot];
  const humanTeam = match.teams ? match.teams.findIndex((t) => t.includes(match.humanSlot)) : null;
  const marginEl = $("lose-margin");
  if (marginEl) {
    if (match.teams) {
      const other = 1 - humanTeam;
      marginEl.textContent = `${teamScore(match, humanTeam).toFixed(0)} — ${teamScore(match, other).toFixed(0)} · ${match.pilots[human.slot].name}`;
    } else {
      marginEl.textContent = `${match.stats[human.slot].total.toFixed(0)} pts · ${match.pilots[match.champion].shortName} took the cup`;
    }
  }
  Sound.sfx("lose");
  showScreen("lose");
}
function openCup(championSlot) {
  const ranked = match.pilots.slice().sort((a, b) => match.stats[b.slot].total - match.stats[a.slot].total);
  const podium = $("cup-podium");
  if (podium) {
    const order = [ranked[1], ranked[0], ranked[2], ranked[3]].filter(Boolean);
    podium.innerHTML = order.map((p) => podiumBar(p, ranked.indexOf(p) + 1, p === ranked[0])).join("");
  }
  const chip = $("cup-chip");
  if (chip) chip.textContent = match.mode === "cup" ? `4 PILOTS · ${match.totalRounds} ROUNDS` : `${match.mode.toUpperCase()} · MATCH COMPLETE`;
  const table = $("cup-table");
  if (table) {
    table.innerHTML = `<thead><tr><th>#</th><th>Pilot</th><th>Score</th><th>Wins</th><th>Lands</th><th>Round finishes</th><th>Source</th></tr></thead><tbody>${ranked.map((p, i) => {
      const st = match.stats[p.slot];
      const src = p.source ? `<a href="${p.source}" target="_blank" rel="noreferrer">↗ source</a>` : "—";
      return `<tr class="stand-row" style="--pilot-color:${p.color}"><td>${i + 1}</td><td><span class="pilot-chip" style="--pilot-color:${p.color}"></span>P${p.slot + 1} ${escapeHtml(p.name)}</td><td>${st.total.toFixed(0)}</td><td>${st.wins}</td><td>${st.lands}</td><td class="place-cells">${st.placements.map((pl) => `<i class="p${pl}">${pl}</i>`).join("")}</td><td>${src}</td></tr>`;
    }).join("")}</tbody>`;
  }
  // high-score entry
  const humanScore = match.humanSlot >= 0 ? match.stats[match.humanSlot].total : null;
  const entry = $("cup-entry");
  const qualifies = humanScore != null && qualifiesHighScore(humanScore);
  if (entry) entry.hidden = !qualifies;
  showScreen("cup");
}
function advanceFromWin() {
  if (currentScreenName !== "win" || !match) return;
  stopConfetti();
  openCup(match.champion);
}

/* ---------------------------------------------------------------- high scores */
const HS_KEY = "ll_highscores_v2";
function loadHighScores() {
  try { const raw = localStorage.getItem(HS_KEY); const arr = raw ? JSON.parse(raw) : []; return Array.isArray(arr) ? arr : []; }
  catch (e) { return []; }
}
function saveHighScores(list) { try { localStorage.setItem(HS_KEY, JSON.stringify(list.slice(0, 5))); } catch (e) {} }
function qualifiesHighScore(score) {
  const list = loadHighScores();
  return score > 0 && (list.length < 5 || score > list[list.length - 1].score);
}
function commitHighScore(initials, score, mode) {
  const list = loadHighScores();
  list.push({ initials: (initials || "AAA").toUpperCase().slice(0, 3), score: Math.round(score), mode, at: Date.now() });
  list.sort((a, b) => b.score - a.score);
  saveHighScores(list);
  renderHighScores();
}
function renderHighScores() {
  const el = $("highscore-list"); if (!el) return;
  const list = loadHighScores().slice(0, 3);
  if (!list.length) {
    el.innerHTML = `<li><span class="hs-rank">01</span><span class="hs-name">SDP</span><span class="hs-pts">312</span></li><li><span class="hs-rank">02</span><span class="hs-name">KHD</span><span class="hs-pts">294</span></li><li><span class="hs-rank">03</span><span class="hs-name">CPW</span><span class="hs-pts">288</span></li>`;
    return;
  }
  el.innerHTML = list.map((r, i) => `<li><span class="hs-rank">${String(i + 1).padStart(2, "0")}</span><span class="hs-name">${escapeHtml(r.initials)}</span><span class="hs-pts">${r.score}</span></li>`).join("");
}

/* ============================================================================
 * MODIFIERS (per match / per round)
 * ==========================================================================*/
let modsContext = "match";
let playerModels = [];

function openMods(context) {
  modsContext = context;
  const title = $("mods-title");
  const chip = $("mods-chip");
  if (context === "round") {
    if (title) title.textContent = "ROUND MODIFIERS";
    if (chip) chip.textContent = `CUP · ROUND ${match.round + 1} OF ${match.totalRounds}`;
  } else {
    if (title) title.textContent = "MATCH MODIFIERS";
    if (chip) chip.textContent = match.mode === "versus" ? "1 v 1 · BEST OF 3" : "2 v 2 · BEST OF 3";
  }
  const seedEl = $("mods-seed");
  if (seedEl) seedEl.textContent = `${context === "round" ? "ROUND" : "COURSE"} SEED ${(match.seedBase % 100000)} · LOCKED`;
  renderHazardGrid();
  showScreen("mods");
}
function renderHazardGrid() {
  const grid = $("mods-grid"); if (!grid || !match) return;
  grid.innerHTML = HAZARDS.map((h) => {
    const level = hazLevel(h.key, match.hazards);
    const on = level > 0;
    const soon = !!h.soon;
    const chips = h.levels.map((lvl, i) => {
      const idx = i + 1;
      const active = level === idx;
      return `<button class="hazard-chip${active ? " active" : ""}" type="button" data-hazard="${h.key}" data-level="${idx}" aria-pressed="${active}"${soon ? " disabled" : ""}>${escapeHtml(lvl.label)}</button>`;
    }).join("");
    const offChip = `<button class="hazard-chip${!on ? " active" : ""}" type="button" data-hazard="${h.key}" data-level="0" aria-pressed="${!on}"${soon ? " disabled" : ""}>OFF</button>`;
    return `<div class="hazard-card${on ? " armed" : ""}${soon ? " soon" : ""}" data-hazard="${h.key}">
      <span class="hazard-name">${h.name}${soon ? ' <em class="hazard-soon-tag">SOON</em>' : ""}</span>
      <span class="hazard-effect">${escapeHtml(h.effect)}</span>
      <span class="hazard-explain">${escapeHtml(h.explain || "")}</span>
      <div class="hazard-levels" role="group" aria-label="${h.name} intensity">${offChip}${chips}</div>
    </div>`;
  }).join("");
  updateModsSummary();
  grid.querySelectorAll(".hazard-chip").forEach((btn) => {
    btn.addEventListener("click", () => setHazardLevel(btn.dataset.hazard, Number(btn.dataset.level)));
  });
}
function setHazardLevel(key, level) {
  if (!match) return;
  const h = HAZARD_BY_KEY[key];
  if (!h || !h.real) return;
  const max = h.levels.length;
  const next = clamp(Number(level) || 0, 0, max);
  // Clicking OFF or the already-active chip clears the hazard.
  match.hazards[key] = next === hazLevel(key, match.hazards) ? 0 : next;
  if (h.levels.length && hazOn(key, match.hazards) && (key === "lowgrav" || key === "heavygrav")) {
    const other = key === "lowgrav" ? "heavygrav" : "lowgrav";
    if (hazOn(other, match.hazards)) { match.hazards[other] = 0; flashGravity(); }
  }
  Sound.sfx("menu");
  renderHazardGrid();
}
function flashGravity() {
  const seedEl = $("mods-seed");
  if (!seedEl) return;
  const original = seedEl.textContent;
  seedEl.textContent = "GRAVITY SWAPPED.";
  setTimeout(() => { seedEl.textContent = original; }, 1200);
}
function hazardStarRating() {
  const total = Object.keys(HAZARD_KEYS).reduce((sum, key) => sum + hazLevel(key, match.hazards), 0);
  if (total === 0) return "☆☆☆";
  if (total <= 2) return "★☆☆";
  if (total <= 5) return "★★☆";
  return "★★★";
}
function updateModsSummary() {
  const el = $("mods-summary"); if (!el || !match) return;
  const armed = HAZARDS.filter((h) => hazOn(h.key, match.hazards)).length;
  const stars = hazardStarRating();
  el.textContent = armed === 0 ? "CLEAN SKY — NO HAZARDS." : `HAZARDS ARMED: ${armed} · DIFFICULTY ${stars}`;
}

/* ============================================================================
 * PLAYERS SCREEN
 * ==========================================================================*/
function renderPlayers() {
  const grid = $("players-grid"); if (!grid) return;
  const mode = cabinetMode;
  const slotCount = mode === "versus" ? 2 : 4;
  playerModels = playerModels.slice(0, slotCount);
  while (playerModels.length < slotCount) playerModels.push(defaultModelFor(playerModels.length, mode));
  const chip = $("players-chip");
  if (chip) chip.textContent = mode === "versus" ? "VERSUS · BEST OF 3" : mode === "doubles" ? "DOUBLES · BEST OF 3" : "CUP · 10 SEEDED ROUNDS";
  grid.innerHTML = playerModels.map((mid, slot) => {
    const human = mid === "human";
    const label = human ? "HUMAN PILOT" : modelLabel(mid);
    const role = human ? "you fly" : modelRole(mid);
    const src = human ? "" : (modelEntry(mid) && modelEntry(mid).source ? `<a class="pilot-src" href="${modelEntry(mid).source}" target="_blank" rel="noreferrer">source ↗</a>` : "");
    return `<div class="player-card" style="--pilot-color:${PILOT_COLORS[slot]}">
      <div class="player-head"><span class="pilot-chip" style="--pilot-color:${PILOT_COLORS[slot]}"></span><b>PILOT ${slot + 1}</b></div>
      <div class="player-role">${escapeHtml(role)}</div>
      <label class="player-select"><span>CHOOSE</span>
        <select data-slot="${slot}" ${slot !== 0 ? "" : ""}></select>
      </label>
      <div class="player-src-row">${src}</div>
    </div>`;
  }).join("");
  grid.querySelectorAll("select[data-slot]").forEach((sel) => {
    const slot = Number(sel.dataset.slot);
    const opts = [];
    if (slot === 0) opts.push({ value: "human", label: "HUMAN PILOT" });
    catalog.forEach((m) => opts.push({ value: m.id, label: m.label }));
    sel.innerHTML = opts.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join("");
    sel.value = playerModels[slot] || opts[0].value;
    sel.addEventListener("change", () => { playerModels[slot] = sel.value; Sound.sfx("menu"); renderPlayers(); });
  });
}
function defaultModelFor(slot, mode) {
  const models = catalog.length ? catalog.map((m) => m.id) : ["ppo"];
  if (mode === "cup") return models[slot % models.length];
  if (slot === 0) return "human";
  return models[(slot - 1) % models.length];
}
let cabinetMode = "versus";

/* ============================================================================
 * ATTRACT ANIMATION
 * ==========================================================================*/
function attractFrame(now) {
  const canvas = $("attract-canvas"); if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0A0B10"; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#3a4658";
  for (let i = 0; i < 40; i++) { const x = (i * 137 + 11) % w, y = (i * 71 + 5) % (h * 0.7); ctx.fillRect(x, y, 1, 1); }
  ctx.strokeStyle = "#C7F36B"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(w * 0.28, h * 0.78); ctx.lineTo(w * 0.64, h * 0.78); ctx.stroke();
  const t = now / 1000;
  const x = w / 2 + Math.sin(t * 0.5) * w * 0.22;
  const y = h * 0.3 + Math.abs(Math.sin(t * 0.8)) * h * 0.2;
  ctx.save(); ctx.translate(x, y); ctx.rotate(Math.sin(t) * 0.3);
  ctx.fillStyle = "#31E0F0"; ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, 6); ctx.lineTo(-7, 6); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#FF9D5C"; ctx.beginPath(); ctx.moveTo(-3, 6); ctx.lineTo(0, 12 + Math.abs(Math.sin(t * 12)) * 5); ctx.lineTo(3, 6); ctx.fill();
  ctx.restore();
}

/* ============================================================================
 * MAIN LOOP
 * ==========================================================================*/
let running = false;
let lastFrame = 0;
let attractTaglineAt = 0;
let attractTaglineIdx = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = lastFrame === 0 ? 0 : Math.min(now - lastFrame, MAX_FRAME_ELAPSED_MS);
  lastFrame = now;
  updateConfetti(elapsed / 1000);

  if (currentScreenName === "attract") {
    attractFrame(now);
    if (now - attractTaglineAt > 3000) {
      attractTaglineAt = now;
      attractTaglineIdx = (attractTaglineIdx + 1) % TAGLINES.attract.length;
      const el = $("attract-tagline"); if (el) el.textContent = TAGLINES.attract[attractTaglineIdx];
    }
  }
  if (currentScreenName === "solo") soloFrame(elapsed);
  if (currentScreenName === "match") matchLoop(elapsed);
}

async function matchLoop(elapsedMs) {
  if (!match || match.phase !== "running" || !running || match.busy) return;
  match.accumulator = Math.min((match.accumulator || 0) + elapsedMs, STEP_INTERVAL_MS * MAX_CATCH_UP_STEPS);
  if (match.accumulator < STEP_INTERVAL_MS) return;
  match.busy = true;
  try {
    let steps = 0;
    while (steps < MAX_CATCH_UP_STEPS && running && match.accumulator >= STEP_INTERVAL_MS) {
      await advanceMatchStep();
      match.accumulator = Math.max(0, match.accumulator - STEP_INTERVAL_MS);
      steps++;
      if (roundComplete()) break;
    }
    drawPanels();
    updateMatchPips();
    if (roundComplete()) finishRound();
  } catch (err) { matchFault(err); }
  finally { match.busy = false; }
}
function matchFault(err) {
  running = false; match.busy = false;
  setStatus("CABINET FAULT");
  const el = $("match-error");
  if (el) { el.textContent = `CABINET FAULT · ${String(err && err.message || err).split("\n").slice(-4).join(" ")}`; el.hidden = false; }
  console.error(err);
}

/* ============================================================================
 * INPUT
 * ==========================================================================*/
const pressed = new Set();
function bindTouch(pad, set) {
  if (!pad) return;
  pad.querySelectorAll("[data-touch]").forEach((btn) => {
    const code = btn.dataset.touch;
    const down = (e) => { e.preventDefault(); set.add(code); btn.classList.add("pressed"); };
    const up = (e) => { e.preventDefault(); set.delete(code); btn.classList.remove("pressed"); };
    btn.addEventListener("pointerdown", down);
    btn.addEventListener("pointerup", up);
    btn.addEventListener("pointerleave", up);
    btn.addEventListener("pointercancel", up);
  });
}
function setupTouchForMatch() { /* pads bound once in boot */ }

window.addEventListener("keydown", (event) => {
  // Menu screens own the arrow keys for navigation; let native select/input work.
  if (MENU_SCREENS.has(currentScreenName)) return;
  const tag = document.activeElement ? document.activeElement.tagName : "";
  if (tag === "SELECT" || tag === "INPUT" || tag === "TEXTAREA") return;
  if (["ArrowLeft", "ArrowRight", "ArrowUp"].includes(event.code)) {
    event.preventDefault();
    pressed.add(event.code);
    Sound.unlock();
  }
});
window.addEventListener("keyup", (event) => { pressed.delete(event.code); });
window.addEventListener("blur", () => pressed.clear());

/* ============================================================================
 * BOOT / WIRING
 * ==========================================================================*/
let pyodide = null;
function readPythonJson(expression) { return JSON.parse(pyodide.runPython(expression)); }

async function installWheel(url) {
  pyodide.globals.set("_wheel_url", url);
  try { await pyodide.runPythonAsync("import micropip\nawait micropip.install(_wheel_url, deps=False)"); }
  finally { pyodide.globals.delete("_wheel_url"); }
}

const PY_SETUP = `
import json
from lunar_lander_local import LunarLander
from pypybox2d import Circle

env = LunarLander(render_mode=None)
multi_envs = [LunarLander(render_mode=None) for _ in range(4)]

def scene_data(target_env, observation):
    bodies = []
    for body in target_env.drawlist + target_env.particles:
        for fixture in body.fixtures:
            shape = fixture.shape
            if isinstance(shape, Circle):
                center = body.transform * shape.position
                bodies.append({"circle": {"center": [center.x, center.y], "radius": shape.radius}, "particle": body in target_env.particles})
            elif hasattr(shape, "vertices"):
                transform = body.transform
                world_vertices = [transform * point for point in shape.vertices]
                bodies.append({"vertices": [[p.x, p.y] for p in world_vertices], "particle": False})
    return {"observation": observation.tolist(), "terrain": target_env.sky_polys,
            "pad": [target_env.helipad_x1, target_env.helipad_y, target_env.helipad_x2], "bodies": bodies}

def reset_json():
    observation, _ = env.reset()
    return json.dumps(scene_data(env, observation))

def step_json(action):
    observation, reward, terminated, truncated, _ = env.step(int(action))
    return json.dumps({"state": scene_data(env, observation), "reward": reward,
                       "terminated": terminated, "truncated": truncated})

def reset_many_seeded_json(payload_json):
    payload = json.loads(payload_json)
    seed = int(payload["seed"])
    gravity = float(payload.get("gravity", -10.0))
    scenes = []
    for sim_env in multi_envs:
        sim_env.gravity = gravity
        sim_env.world.gravity = (0, gravity)
        observation, _ = sim_env.reset(seed=seed)
        scenes.append(scene_data(sim_env, observation))
    return json.dumps(scenes)

def step_many_json(payload_json):
    payload = json.loads(payload_json)
    actions = payload["actions"]
    active = payload["active"]
    hazards = payload.get("hazards", {})
    gravity = float(hazards.get("gravity", -10.0))
    wind = float(hazards.get("wind", 0.0))
    results = []
    for sim_env, action, should_step in zip(multi_envs, actions, active):
        if not should_step:
            results.append(None)
            continue
        sim_env.world.gravity = (0, gravity)
        if wind and sim_env.lander is not None:
            sim_env.lander.apply_force_to_center((wind, 0))
        observation, reward, terminated, truncated, _ = sim_env.step(int(action))
        results.append({"state": scene_data(sim_env, observation), "reward": reward,
                        "terminated": terminated, "truncated": truncated})
    return json.dumps(results)
`;

async function boot() {
  renderHighScores();
  initializePanels();
  const startBtn = $("start-game");
  if (startBtn) startBtn.disabled = true;
  bindTouch($("solo-touch"), pressed);
  bindTouch($("match-touch"), pressed);
  showScreen("boot");
  setStatus("ROLLING OUT THE PILOTS");
  await loadCatalog();
  populateSoloSelectors();
  await new Promise((r) => setTimeout(r, 1200));
  showScreen("attract");
  try {
    pyodide = await loadPyodide({ indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/` });
    await pyodide.loadPackage(["numpy", "micropip"]);
    const wheelBase = new URL("./third_party/wheels/", window.location.href);
    await installWheel(new URL("pypybox2d-2.1.post331-py3-none-any.whl", wheelBase).href);
    const appWheel = new URL("./packages/lunarlander_gym_shim-0.1.0-py3-none-any.whl", window.location.href);
    await installWheel(appWheel.href);
    await pyodide.runPythonAsync(PY_SETUP);
    solo.state = readPythonJson("reset_json()");
    solo.totalReward = 0;
    updateSoloTelemetry();
    drawScene(soloCanvas, soloCtx, solo.state, 0);
    // warm the default pilot in the background
    ensureModelSession(catalog[0]?.id).catch(() => {});
    enableCabinet();
    setStatus("CABINET READY · INSERT COIN");
  } catch (err) {
    console.error(err);
    setStatus("CABINET FAULT");
    soloOverlay(String(err && err.message || err).split("\n").slice(-4).join(" "), true);
  }
}
function enableCabinet() {
  const start = $("start-game");
  if (start) { start.disabled = false; start.classList.add("ready"); }
  ["human-controller", "policy-controller", "override-controller"].forEach((id) => { const el = $(id); if (el) el.disabled = false; });
}

/* ---- event wiring ---- */
function startMatchFromCabinet() {
  Sound.sfx("coin");
  const mode = cabinetMode;
  const slotCount = mode === "versus" ? 2 : 4;
  const slotModels = playerModels.slice(0, slotCount).map((m, i) => m || defaultModelFor(i, mode));
  match = null;
  prepareMatch({ mode, slotModels, totalRounds: mode === "cup" ? 10 : 3, hazards: { ...RECOMMENDED } }).then(() => {
    openMods(mode === "cup" ? "round" : "match");
  }).catch((err) => { setStatus("CABINET FAULT"); console.error(err); });
}

/* ---- cabinet menu keyboard navigation ---- */
/*
 * Screens where the cabinet owns the arrow keys for menu navigation.
 * Gameplay screens (solo/match) keep their flight controls instead.
 */
const MENU_SCREENS = new Set(["attract", "menu", "mode", "players", "mods", "cup", "lose", "about"]);
let menuIndex = 0;

function focusableItems() {
  const screen = $(`screen-${currentScreenName}`);
  if (!screen) return [];
  return Array.from(screen.querySelectorAll("button, a[href], select, input, [tabindex]:not([tabindex='-1'])"))
    .filter((el) => !el.disabled && !el.hidden && !el.closest("[hidden]"));
}
function clearMenuFocus() {
  document.querySelectorAll(".kbd-focus").forEach((el) => el.classList.remove("kbd-focus"));
}
function setMenuFocus(items) {
  clearMenuFocus();
  if (!items.length) return;
  menuIndex = clamp(menuIndex, 0, items.length - 1);
  const el = items[menuIndex];
  el.classList.add("kbd-focus");
  try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
  if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
}
/* Reset the highlight to the first item each time a menu screen opens. */
function resetMenuFocus() {
  clearMenuFocus();
  if (!MENU_SCREENS.has(currentScreenName)) return;
  menuIndex = 0;
  setMenuFocus(focusableItems());
}
function moveMenuFocus(delta) {
  const items = focusableItems();
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  menuIndex = current >= 0 ? current + delta : menuIndex + delta;
  menuIndex = ((menuIndex % items.length) + items.length) % items.length;
  setMenuFocus(items);
}
/* Left/Right step within a hazard level-chip row. */
function stepChipFocus(delta) {
  const active = document.activeElement;
  if (!active || !active.classList.contains("hazard-chip")) return false;
  const chips = Array.from(active.parentElement.querySelectorAll(".hazard-chip")).filter((c) => !c.disabled);
  const i = chips.indexOf(active);
  if (i < 0) return false;
  const items = focusableItems();
  const idx = items.indexOf(chips[(i + delta + chips.length) % chips.length]);
  if (idx < 0) return false;
  menuIndex = idx;
  setMenuFocus(items);
  return true;
}
function activateMenuItem() {
  const items = focusableItems();
  const focused = document.activeElement;
  const el = (focused && items.includes(focused)) ? focused : items[menuIndex];
  if (!el) return;
  if (el.tagName === "SELECT") { el.focus(); return; }
  el.click();
}
function handleMenuKey(e) {
  if (!MENU_SCREENS.has(currentScreenName)) return false;
  const tag = document.activeElement ? document.activeElement.tagName : "";
  // Text inputs keep fully native behaviour.
  if (tag === "INPUT" || tag === "TEXTAREA") return false;
  // A focused <select> keeps Left/Right/typing native, but Up/Down still walk the
  // cabinet menu so the "USE UP/DOWN" promise holds (Left/Right changes the value).
  if (tag === "SELECT") {
    if (e.code === "ArrowUp") { e.preventDefault(); moveMenuFocus(-1); return true; }
    if (e.code === "ArrowDown") { e.preventDefault(); moveMenuFocus(1); return true; }
    return false;
  }
  if (e.code === "ArrowUp") { e.preventDefault(); moveMenuFocus(-1); return true; }
  if (e.code === "ArrowDown") { e.preventDefault(); moveMenuFocus(1); return true; }
  if (e.code === "ArrowLeft" && stepChipFocus(-1)) { e.preventDefault(); return true; }
  if (e.code === "ArrowRight" && stepChipFocus(1)) { e.preventDefault(); return true; }
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    if (currentScreenName === "attract") {
      const start = $("start-game");
      if (start && !start.disabled) start.click();
      return true;
    }
    activateMenuItem();
    return true;
  }
  return false;
}

function wireEvents() {
  // first tap unlocks audio
  const unlock = () => Sound.unlock();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });

  const musicBtn = $("music-toggle");
  if (musicBtn) musicBtn.addEventListener("click", () => {
    const on = Sound.toggleMusic();
    musicBtn.textContent = on ? "MUSIC ON" : "MUSIC OFF";
    musicBtn.setAttribute("aria-pressed", String(on));
    Sound.sfx("menu");
  });

  const start = $("start-game");
  if (start) start.addEventListener("click", () => { Sound.unlock(); Sound.sfx("coin"); showScreen("menu"); });

  document.querySelectorAll("[data-screen]").forEach((btn) => {
    btn.addEventListener("click", () => { Sound.sfx("menu"); showScreen(btn.dataset.screen); });
  });
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      Sound.sfx("select");
      cabinetMode = btn.dataset.mode;
      playerModels = [];
      const slotCount = cabinetMode === "versus" ? 2 : 4;
      for (let i = 0; i < slotCount; i++) playerModels.push(defaultModelFor(i, cabinetMode));
      renderPlayers();
      showScreen("players");
    });
  });
  const confirm = $("players-confirm");
  if (confirm) confirm.addEventListener("click", () => { startMatchFromCabinet(); });
  const modsProceed = $("mods-proceed");
  if (modsProceed) modsProceed.addEventListener("click", () => { Sound.sfx("select"); beginRound(); });
  const modsClear = $("mods-clear");
  if (modsClear) modsClear.addEventListener("click", () => { if (match) { match.hazards = { ...HAZARD_KEYS }; Sound.sfx("menu"); renderHazardGrid(); } });
  const modsRec = $("mods-recommend");
  if (modsRec) modsRec.addEventListener("click", () => { if (match) { match.hazards = { ...HAZARD_KEYS, ...RECOMMENDED }; Sound.sfx("menu"); renderHazardGrid(); } });
  const modsBack = $("mods-back");
  if (modsBack) modsBack.addEventListener("click", () => { Sound.sfx("menu"); renderPlayers(); showScreen("players"); });

  const matchContinue = $("match-continue");
  if (matchContinue) matchContinue.addEventListener("click", () => { Sound.sfx("select"); continueAfterRound(); });

  const cupContinue = $("cup-continue");
  if (cupContinue) cupContinue.addEventListener("click", () => { Sound.sfx("coin"); showScreen("attract"); attractTaglineAt = 0; });
  const cupSave = $("cup-save");
  if (cupSave) cupSave.addEventListener("click", () => {
    const input = $("cup-initials");
    const score = match && match.humanSlot >= 0 ? match.stats[match.humanSlot].total : 0;
    commitHighScore(input ? input.value : "AAA", score, match ? match.mode : "");
    Sound.sfx("select");
    const entry = $("cup-entry"); if (entry) entry.hidden = true;
  });

  const loseRematch = $("lose-rematch");
  if (loseRematch) loseRematch.addEventListener("click", () => { Sound.sfx("select"); rematch(); });
  const loseMenu = $("lose-menu");
  if (loseMenu) loseMenu.addEventListener("click", () => { Sound.sfx("menu"); showScreen("menu"); });
  const matchAbandon = $("match-abandon");
  if (matchAbandon) matchAbandon.addEventListener("click", () => { running = false; match = null; Sound.sfx("menu"); showScreen("menu"); });
  const winScreen = $("screen-win");
  if (winScreen) winScreen.addEventListener("click", advanceFromWin);

  const soloReset = $("solo-reset");
  if (soloReset) soloReset.addEventListener("click", requestSoloReset);
  const human = $("human-controller");
  if (human) human.addEventListener("click", () => chooseController("human"));
  const policy = $("policy-controller");
  if (policy) policy.addEventListener("click", () => chooseController("policy"));
  const override = $("override-controller");
  if (override) override.addEventListener("click", () => chooseController("override"));
  const modelSelect = $("model-select");
  if (modelSelect) modelSelect.addEventListener("change", () => { updateSoloButtons(); updatePilotSource(); });
  window.addEventListener("keydown", (e) => {
    if (e.code === "ArrowDown" && currentScreenName === "solo") { e.preventDefault(); requestSoloReset(); return; }
    if (currentScreenName === "win" && (e.code === "Enter" || e.code === "Space")) { e.preventDefault(); advanceFromWin(); return; }
    if (currentScreenName === "match" && match && match.phase === "roundComplete" && (e.code === "Enter" || e.code === "Space")) { e.preventDefault(); continueAfterRound(); return; }
    handleMenuKey(e);
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pressed.clear(); });
}

function rematch() {
  if (!match) return;
  const cfg = { mode: match.mode, slotModels: match.pilots.map((p) => p.modelId), totalRounds: match.totalRounds, hazards: { ...match.hazards } };
  match = null;
  prepareMatch(cfg).then(() => {
    if (cfg.mode === "cup") openMods("round");
    else openMods("match");
  }).catch((err) => { setStatus("CABINET FAULT"); console.error(err); });
}

function stopRunning() {
  running = false;
  if (match) match.busy = false;
}

wireEvents();
requestAnimationFrame(frame);
boot();
