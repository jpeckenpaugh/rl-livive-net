/* Cabinet power-up state machine (AIA-46 R1/R2).
 *
 * Cold boot: OFF (black) -> FLICKER_ON (CRT sweep) -> POST/EPROM (lines track
 * the real load steps) -> STUDIO_INTRO (slice-in) -> CROSS_SLICE -> TITLE.
 * Warm boot (RESET): FLICKER_OFF -> cancel audio -> short POST -> TITLE. The
 * Python/ONNX runtime is already resident, so a reset never reloads it.
 *
 * The real work is passed in as `steps` from main.js so each POST line advances
 * only when its load step actually resolves. */
import { BOOT_TIMINGS } from "./config.js";
import { $ } from "./lib.js";
import { showScreen, setStatus } from "./screens.js";
import { Sound, Commentary, Composer } from "./audio.js";
import { resetAttractDemo } from "./attract.js";
import { postLineModel } from "./boot-model.js";

export const POST_BANNER = "LUNAR LANDER · TOURNAMENT EDITION";
const POST_EPROM = "EPROM CHECK";
const POST_READY = "READY";
const POST_WARM = "SYSTEM WARM · READY";

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))); }

export function prefersReducedMotion() {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }
  catch (err) { return false; }
}

/* --------------------------------------------------------------- CRT overlay */
function crtEl() { return $("crt-fx"); }

// Collapse the picture to a bright line, then black. The class is left on (the
// animation fills forwards) so the monitor stays black until crtOn() clears it.
function crtOff() {
  const el = crtEl();
  if (el) { el.classList.remove("crt-on"); void el.offsetWidth; el.classList.add("crt-off"); }
  return sleep(prefersReducedMotion() ? 120 : BOOT_TIMINGS.flickerOff);
}

// CRT power-on sweep. Clears the black crt-off shutter, then plays the flash.
async function crtOn() {
  const el = crtEl();
  if (el) { el.classList.remove("crt-off"); void el.offsetWidth; el.classList.add("crt-on"); }
  await sleep(prefersReducedMotion() ? 160 : BOOT_TIMINGS.flickerOn);
  if (el) el.classList.remove("crt-on");
}

/* ------------------------------------------------------------- POST screen */
let postLineEls = [];

function postList() { return $("post-lines"); }

function postLineEl(label) {
  const li = document.createElement("li");
  li.className = "post-line";
  li.dataset.state = "pending";
  const name = document.createElement("span");
  name.className = "post-label";
  name.textContent = label;
  const lead = document.createElement("span");
  lead.className = "post-lead";
  lead.setAttribute("aria-hidden", "true");
  const status = document.createElement("span");
  status.className = "post-status";
  status.textContent = "";
  li.append(name, lead, status);
  return li;
}

// Build the full POST list up front, then advance its states as steps resolve.
function renderPost(steps) {
  const labels = [POST_EPROM, ...steps.map((s) => s.label), POST_READY];
  const list = postList();
  postLineEls = [];
  if (!list) return labels;
  list.innerHTML = "";
  const banner = document.createElement("li");
  banner.className = "post-line post-banner";
  banner.textContent = POST_BANNER;
  list.appendChild(banner);
  for (const label of labels) {
    const el = postLineEl(label);
    list.appendChild(el);
    postLineEls.push(el);
  }
  setPostProgress(labels, 0);
  // EPROM CHECK passes immediately; real work starts at the next line.
  setPostStatus(0, "OK");
  setPostProgress(labels, 1);
  return labels;
}

function setPostStatus(index, status) {
  const el = postLineEls[index];
  const span = el && el.querySelector(".post-status");
  if (span) span.textContent = status;
}

function setPostProgress(labels, completed) {
  postLineModel(labels, completed).forEach((line, i) => {
    const el = postLineEls[i];
    if (el) el.dataset.state = line.state;
  });
}

/* ------------------------------------------------------------ load stepping */
function withTimeout(promise, ms, label) {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

async function runSteps(steps, labels) {
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    setPostProgress(labels, i + 1); // this step's line becomes active
    let status = "OK";
    try {
      await withTimeout(step.run(), BOOT_TIMINGS.stepTimeout, step.label);
    } catch (err) {
      if (!step.optional) throw err;
      status = "WARN";
      console.warn(`boot: optional step "${step.label}" skipped`, err);
    }
    setPostStatus(i + 1, status);
    setPostProgress(labels, i + 2);
    await sleep(BOOT_TIMINGS.lineSettle);
  }
}

/* ---------------------------------------------------------------- title fade */
function titleEl() { return $("screen-attract"); }

// Staged fade of the title into its ready state (title -> coin -> tagline).
async function stageTitle() {
  showScreen("attract");
  const att = titleEl();
  if (att) {
    att.classList.remove("boot-title-in");
    void att.offsetWidth;
    att.classList.add("boot-title-in");
  }
  await sleep(BOOT_TIMINGS.titleStage);
  if (att) att.classList.remove("boot-title-in");
}

// Cross-slice: the studio lockup slices out while the title slices in. The
// router would hide the studio immediately, so drive this transition by hand
// and only commit to the attract screen once the wipe completes.
async function crossSliceToTitle(bootEl) {
  const att = titleEl();
  if (att) {
    att.hidden = false;
    att.classList.remove("slice-in", "boot-title-in");
    void att.offsetWidth;
    att.classList.add("slice-in", "boot-title-in");
  }
  if (bootEl) {
    bootEl.classList.remove("slice-in");
    void bootEl.offsetWidth;
    bootEl.classList.add("slice-out");
  }
  await sleep(BOOT_TIMINGS.crossSlice + BOOT_TIMINGS.titleStage);
  if (bootEl) bootEl.classList.remove("slice-out", "slice-in");
  if (att) att.classList.remove("slice-in", "boot-title-in");
  showScreen("attract");
}

/* ---------------------------------------------------------------- sequences */
// Cold boot with the real load steps. Throws on a critical step failure so the
// caller can fall through to the existing CABINET FAULT state.
export async function coldBoot(steps) {
  const startedAt = Date.now();
  const fx = crtEl();
  if (fx) fx.classList.remove("crt-on");
  const list = postList();
  if (list) list.innerHTML = "";
  postLineEls = [];
  setStatus("");
  // OFF: black beat with nothing on screen.
  showScreen("post");
  await sleep(BOOT_TIMINGS.off);
  // FLICKER_ON
  await crtOn();
  // POST / EPROM, tracking the real work.
  const labels = renderPost(steps);
  setStatus("SYSTEM CHECK");
  await runSteps(steps, labels);
  setPostStatus(labels.length - 1, "OK");
  setPostProgress(labels, labels.length);
  // Keep a minimum readable boot time on a warm cache.
  const elapsed = Date.now() - startedAt;
  if (elapsed < BOOT_TIMINGS.minTotal) await sleep(BOOT_TIMINGS.minTotal - elapsed);
  // STUDIO_INTRO: LIVIVE.NET STUDIOS slices in.
  const bootEl = $("screen-boot");
  showScreen("boot");
  if (bootEl) {
    bootEl.classList.remove("slice-out");
    void bootEl.offsetWidth;
    bootEl.classList.add("slice-in");
  }
  await sleep(BOOT_TIMINGS.studioHold);
  // CROSS_SLICE + TITLE.
  await crossSliceToTitle(bootEl);
}

// Warm boot: the runtime is resident, so just power on, show a short POST, and
// return to the title. The studio intro is intentionally skipped (documented in
// AIA-47) to keep a reset snappy.
export async function warmBoot() {
  // Hold music across the router swaps; resumeMusic() restarts the title track.
  Sound.suspendMusic();
  showScreen("post");
  const list = postList();
  if (list) { list.innerHTML = ""; postLineEls = []; }
  await crtOn();
  if (list) {
    const warm = postLineEl(POST_WARM);
    warm.dataset.state = "done";
    const status = warm.querySelector(".post-status");
    if (status) status.textContent = "OK";
    list.appendChild(warm);
  }
  await sleep(BOOT_TIMINGS.warmPost);
  await stageTitle();
  Sound.resumeMusic();
}

let resetting = false;

// RESET = warm boot (R2). Flicker the picture off, cancel every live audio
// layer and the running mode, then warm-boot back to the title ready state.
export async function cabinetReset() {
  if (resetting) return;
  resetting = true;
  try {
    Sound.unlock();
    Sound.sfx("select");
    Commentary.stop();
    Composer.stop();
    Sound.stopVoices();
    Sound.stopMusic();
    resetAttractDemo();
    await crtOff();
    await warmBoot();
    setStatus("CABINET READY · INSERT COIN");
  } catch (err) {
    console.error("cabinet reset fault", err);
    const fx = crtEl();
    if (fx) fx.classList.remove("crt-off");
    showScreen("attract");
  } finally {
    resetting = false;
  }
}
