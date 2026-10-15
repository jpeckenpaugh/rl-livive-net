/* Entry point: boot the Python runtime, wire the cabinet, and run the main
 * animation loop. */
import { PYODIDE_VERSION, MAX_FRAME_ELAPSED_MS, STEP_INTERVAL_MS, MAX_CATCH_UP_STEPS, MENU_SCREENS } from "./config.js";
import { state } from "./state.js";
import { $ } from "./lib.js";
import { data, loadData } from "./data.js";
import { readPythonJson, installWheel, loadPySetup } from "./python.js";
import { showScreen, setStatus, isTitleScreen } from "./screens.js";
import { Sound, Commentary } from "./audio.js";
import { fitCabinet, schedulePixelFit, updateConfetti, stopConfetti } from "./render.js";
import { loadCatalog, ensureModelSession } from "./models.js";
import { renderHighScores } from "./leaderboard.js";
import { pressed, bindTouch } from "./input.js";
import {
  enterSolo, renderPilotCards, populateSoloPilots, hideSoloResult, requestSoloReset,
  soloResultVisible, moveResultFocus, activateResultFocus, openSoloMode, soloFrame,
  primeSoloScene, soloErrorOverlay, cancelSoloAutoCountdown,
} from "./solo.js";
import {
  prepareMatch, beginRound, continueAfterRound, showMatchBanner, advanceFromWin,
  moveMatchResultFocus, initializePanels, advanceMatchStep, roundComplete, drawPanels,
  updateMatchPips, finishRound, cancelRoundAutoCountdown,
} from "./match.js";
import { renderHazardGrid, openMods, defaultModelFor, selectCabinetMode, resetMenuFocus, handleMenuKey } from "./ui.js";
import { attractDemoFrame, rotateAttractTagline, resetAttractDemo } from "./attract.js";
import { initManual, renderManual, isManualOpen } from "./manual.js";
import { initBuild, isBuildOpen } from "./build.js";
import { loadCustomModels } from "./custom-models.js";
import { coldBoot, cabinetReset } from "./boot.js";
import { readAudioPrefs, writeAudioPrefs } from "./audio-prefs.js";

/* ============================================================================
 * MAIN LOOP
 * ==========================================================================*/
let lastFrame = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const elapsed = lastFrame === 0 ? 0 : Math.min(now - lastFrame, MAX_FRAME_ELAPSED_MS);
  lastFrame = now;
  updateConfetti(elapsed / 1000);

  if (isTitleScreen(state.currentScreenName)) {
    attractDemoFrame(elapsed);
    rotateAttractTagline(now);
  }
  if (state.currentScreenName === "solo") soloFrame(elapsed);
  if (state.currentScreenName === "match") matchLoop(elapsed);
}

async function matchLoop(elapsedMs) {
  if (!state.match || state.match.phase !== "running" || !state.running || state.match.busy) return;
  state.match.accumulator = Math.min((state.match.accumulator || 0) + elapsedMs, STEP_INTERVAL_MS * MAX_CATCH_UP_STEPS);
  if (state.match.accumulator < STEP_INTERVAL_MS) return;
  state.match.busy = true;
  try {
    let steps = 0;
    while (steps < MAX_CATCH_UP_STEPS && state.running && state.match.accumulator >= STEP_INTERVAL_MS) {
      await advanceMatchStep();
      state.match.accumulator = Math.max(0, state.match.accumulator - STEP_INTERVAL_MS);
      steps++;
      if (roundComplete()) break;
    }
    drawPanels();
    updateMatchPips();
    if (roundComplete()) finishRound();
  } catch (err) { matchFault(err); }
  finally { state.match.busy = false; }
}
function matchFault(err) {
  state.running = false; state.match.busy = false;
  setStatus("CABINET FAULT");
  const el = $("match-error");
  if (el) { el.textContent = `CABINET FAULT · ${String(err && err.message || err).split("\n").slice(-4).join(" ")}`; el.hidden = false; }
  console.error(err);
}

/* ============================================================================
 * BOOT / WIRING
 * ==========================================================================*/
async function boot() {
  applyAudioPrefs();
  const startBtn = $("start-game");
  if (startBtn) startBtn.disabled = true;
  bindTouch($("cabinet-deck"), pressed);
  try {
    await coldBoot(buildBootSteps());
  } catch (err) {
    console.error(err);
    setStatus("CABINET FAULT");
    soloErrorOverlay(String(err && err.message || err));
    return;
  }
  enableCabinet();
  setStatus("CABINET READY · INSERT COIN");
}

/* Real load steps, in order. Each POST line advances only when its step
 * resolves. The ONNX pilot warm-up is best-effort so a slow CDN cannot fault
 * boot; the attract demo retries it later if it is skipped. */
function buildBootSteps() {
  return [
    { label: "LOADING CATALOG", run: bootCatalog },
    { label: "PYTHON CORE", run: async () => {
      state.pyodide = await loadPyodide({ indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/` });
    } },
    { label: "NUMPY / MICROPIP", run: () => state.pyodide.loadPackage(["numpy", "micropip"]) },
    { label: "PHYSICS MODULE", run: bootPhysics },
    { label: "NEURAL PILOT", run: bootWarmPilot, optional: true },
  ];
}

async function bootCatalog() {
  await loadData();
  initializePanels();
  await loadCatalog();
  await loadCustomModels();
  renderHighScores();
  renderManual();
  populateSoloPilots();
}

async function bootPhysics() {
  const wheelBase = new URL("./third_party/wheels/", window.location.href);
  await installWheel(new URL("pypybox2d-2.1.post331-py3-none-any.whl", wheelBase).href);
  const appWheel = new URL("./packages/lunarlander_gym_shim-0.1.0-py3-none-any.whl", window.location.href);
  await installWheel(appWheel.href);
  await state.pyodide.runPythonAsync(await loadPySetup());
  state.simReady = true;
  primeSoloScene();
}

function bootWarmPilot() {
  const id = state.catalog[0] && state.catalog[0].id;
  return id ? ensureModelSession(id) : Promise.resolve();
}

/* R3: seed the audio layers and toggle pills from localStorage before any
 * sound can play; the persisted value wins over the default. */
function applyAudioPrefs() {
  const prefs = readAudioPrefs();
  Sound.setEnabled(prefs.music);
  Sound.setSfxEnabled(prefs.sfx);
  Sound.setVoicesEnabled(prefs.voices);
  setTogglePressed("sfx-toggle", prefs.sfx);
  setTogglePressed("music-toggle", prefs.music);
  setTogglePressed("voice-toggle", prefs.voices);
}

function setTogglePressed(id, on) {
  const el = $(id);
  if (el) el.setAttribute("aria-pressed", String(!!on));
}

function saveAudioPrefs() {
  writeAudioPrefs({ sfx: Sound.isSfxOn(), music: Sound.isOn(), voices: Sound.isVoicesOn() });
}

function enableCabinet() {
  const start = $("start-game");
  if (start) { start.disabled = false; start.classList.add("ready"); }
}

function startMatchFromCabinet() {
  Sound.sfx("coin");
  const mode = state.cabinetMode;
  const slotCount = mode === "versus" ? 2 : 4;
  const slotModels = state.playerModels.slice(0, slotCount).map((m, i) => m || defaultModelFor(i, mode));
  state.match = null;
  prepareMatch({ mode, slotModels, totalRounds: mode === "cup" ? 10 : 3, hazards: { ...data.recommended } }).then(() => {
    openMods(mode === "cup" ? "round" : "match");
  }).catch((err) => { setStatus("CABINET FAULT"); console.error(err); });
}

function wireEvents() {
  // first tap unlocks audio
  const unlock = () => Sound.unlock();
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });

  const sfxBtn = $("sfx-toggle");
  if (sfxBtn) sfxBtn.addEventListener("click", () => {
    const on = Sound.toggleSfx();
    sfxBtn.setAttribute("aria-pressed", String(on));
    saveAudioPrefs();
    if (on) Sound.sfx("menu");
  });

  const musicBtn = $("music-toggle");
  if (musicBtn) musicBtn.addEventListener("click", () => {
    const on = Sound.toggleMusic();
    musicBtn.setAttribute("aria-pressed", String(on));
    saveAudioPrefs();
    Sound.sfx("menu");
  });

  const voiceBtn = $("voice-toggle");
  if (voiceBtn) voiceBtn.addEventListener("click", () => {
    const on = Sound.toggleVoices();
    if (!on) Commentary.stop();
    voiceBtn.setAttribute("aria-pressed", String(on));
    saveAudioPrefs();
    Sound.sfx("menu");
  });

  // RESET is the warm boot (R2): works from any screen, not just solo.
  const resetBtn = $("cabinet-reset");
  if (resetBtn) resetBtn.addEventListener("click", () => { cabinetReset(); });

  const start = $("start-game");
  if (start) start.addEventListener("click", () => {
    Sound.unlock();
    Commentary.line("coin");
    showScreen("menu");
  });

  // The deck's RESET button is a discrete action (ArrowDown is not a held key
  // in the game loop), so wire it directly. On solo it still resets the current
  // flight; everywhere else it is the same warm-boot RESET as the header.
  const deckReset = $("cabinet-deck") && $("cabinet-deck").querySelector(".arc-btn.reset");
  if (deckReset) deckReset.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    if (state.currentScreenName === "solo") { Sound.unlock(); requestSoloReset(); }
    else cabinetReset();
  });

  document.querySelectorAll("[data-screen]").forEach((btn) => {
    btn.addEventListener("click", () => { Sound.sfx("menu"); showScreen(btn.dataset.screen); });
  });
  document.querySelectorAll("[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      Sound.sfx("select");
      selectCabinetMode(btn.dataset.mode);
      showScreen("players");
      Commentary.line("select");
    });
  });
  const confirm = $("players-confirm");
  if (confirm) confirm.addEventListener("click", () => { startMatchFromCabinet(); });
  const modsAccept = $("mods-accept");
  if (modsAccept) modsAccept.addEventListener("click", () => { Sound.sfx("select"); beginRound(); });
  const modsCustomize = $("mods-customize");
  if (modsCustomize) modsCustomize.addEventListener("click", () => {
    Sound.sfx("menu");
    const row = $("mods-accept-row"); if (row) row.hidden = true;
    const custom = $("mods-custom"); if (custom) custom.hidden = false;
    resetMenuFocus();
  });
  const modsProceed = $("mods-proceed");
  if (modsProceed) modsProceed.addEventListener("click", () => { Sound.sfx("select"); beginRound(); });
  const modsClear = $("mods-clear");
  if (modsClear) modsClear.addEventListener("click", () => { if (state.match) { state.match.hazards = { ...data.hazardKeys }; Sound.sfx("menu"); renderHazardGrid(); } });
  const modsRec = $("mods-recommend");
  if (modsRec) modsRec.addEventListener("click", () => { if (state.match) { state.match.hazards = { ...data.hazardKeys, ...data.recommended }; Sound.sfx("menu"); renderHazardGrid(); } });
  const matchContinue = $("match-continue");
  if (matchContinue) matchContinue.addEventListener("click", () => { Sound.sfx("select"); continueAfterRound(); });

  const cupContinue = $("cup-continue");
  if (cupContinue) cupContinue.addEventListener("click", () => { Sound.sfx("coin"); resetAttractDemo(); showScreen("attract"); });

  const loseRematch = $("lose-rematch");
  if (loseRematch) loseRematch.addEventListener("click", () => { Sound.sfx("select"); rematch(); });
  const loseMenu = $("lose-menu");
  if (loseMenu) loseMenu.addEventListener("click", () => { Sound.sfx("menu"); resetAttractDemo(); showScreen("attract"); });
  const bannerTitle = $("match-banner-title");
  if (bannerTitle) bannerTitle.addEventListener("click", () => {
    state.running = false; state.match = null; Sound.sfx("menu");
    showMatchBanner(false); resetAttractDemo(); showScreen("attract");
  });
  const matchBanner = $("match-banner");
  if (matchBanner) matchBanner.addEventListener("pointerdown", cancelRoundAutoCountdown);
  const winRematch = $("win-rematch");
  if (winRematch) winRematch.addEventListener("click", (e) => { e.stopPropagation(); Sound.sfx("select"); rematch(); });
  const winTitle = $("win-title");
  if (winTitle) winTitle.addEventListener("click", (e) => { e.stopPropagation(); Sound.sfx("menu"); resetAttractDemo(); showScreen("attract"); });
  const winScreen = $("screen-win");
  if (winScreen) winScreen.addEventListener("click", advanceFromWin);

  const soloReset = $("solo-reset");
  if (soloReset) soloReset.addEventListener("click", requestSoloReset);
  document.querySelectorAll("[data-solo-mode]").forEach((btn) => {
    btn.addEventListener("click", () => { Sound.sfx("select"); openSoloMode(btn.dataset.soloMode); });
  });
  const resultNext = $("result-next");
  if (resultNext) resultNext.addEventListener("click", () => { Sound.sfx("coin"); hideSoloResult(); requestSoloReset(); });
  const resultTitle = $("result-title");
  if (resultTitle) resultTitle.addEventListener("click", () => { Sound.sfx("menu"); hideSoloResult(); showScreen("attract"); });
  const resultChangeMode = $("result-change-mode");
  if (resultChangeMode) resultChangeMode.addEventListener("click", () => { Sound.sfx("menu"); hideSoloResult(); showScreen("solomode"); });
  const resultChangePilot = $("result-change-pilot");
  if (resultChangePilot) resultChangePilot.addEventListener("click", () => { Sound.sfx("menu"); hideSoloResult(); renderPilotCards(); showScreen("pilotselect"); });
  const soloResultEl = $("solo-result");
  if (soloResultEl) soloResultEl.addEventListener("pointerdown", cancelSoloAutoCountdown);

  // Flight controls: held arrow keys. Menu screens own the arrow keys for
  // navigation, so skip them here and let native select/input work.
  window.addEventListener("keydown", (event) => {
    if (isManualOpen() || isBuildOpen() || MENU_SCREENS.has(state.currentScreenName)) return;
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

  window.addEventListener("keydown", (e) => {
    if (isManualOpen() || isBuildOpen()) return;
    if (state.currentScreenName === "solo" && soloResultVisible()) {
      if (e.code === "ArrowUp") { cancelSoloAutoCountdown(); e.preventDefault(); moveResultFocus(-1); return; }
      if (e.code === "ArrowDown") { cancelSoloAutoCountdown(); e.preventDefault(); moveResultFocus(1); return; }
      if (e.code === "Enter" || e.code === "Space") {
        e.preventDefault();
        activateResultFocus();
        return;
      }
    }
    if (e.code === "ArrowDown" && state.currentScreenName === "solo") { e.preventDefault(); requestSoloReset(); return; }
    if (state.currentScreenName === "win" && (e.code === "Enter" || e.code === "Space")) { e.preventDefault(); advanceFromWin(); return; }
    if (state.currentScreenName === "match" && state.match && state.match.phase === "roundComplete") {
      if (e.code === "ArrowUp" || e.code === "ArrowDown") {
        cancelRoundAutoCountdown();
        e.preventDefault();
        moveMatchResultFocus(e.code === "ArrowUp" ? -1 : 1);
        return;
      }
      if (e.code === "Enter" || e.code === "Space") { e.preventDefault(); continueAfterRound(); return; }
    }
    handleMenuKey(e);
  });
  document.addEventListener("visibilitychange", () => { if (document.hidden) pressed.clear(); });

  // Scale/letterbox the fixed cabinet (D5) and keep playfields crisp when the
  // frame or the display density changes.
  window.addEventListener("resize", fitCabinet);
  window.addEventListener("orientationchange", () => { fitCabinet(); schedulePixelFit(); });
  window.addEventListener("resize", schedulePixelFit);
  fitCabinet();
  if (window.matchMedia) {
    const dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    if (dprQuery && dprQuery.addEventListener) dprQuery.addEventListener("change", schedulePixelFit);
  }
}

function rematch() {
  if (!state.match) return;
  const cfg = { mode: state.match.mode, slotModels: state.match.pilots.map((p) => p.modelId), totalRounds: state.match.totalRounds, hazards: { ...state.match.hazards } };
  state.match = null;
  prepareMatch(cfg).then(() => {
    if (cfg.mode === "cup") openMods("round");
    else openMods("match");
  }).catch((err) => { setStatus("CABINET FAULT"); console.error(err); });
}

wireEvents();
initManual();
initBuild();
requestAnimationFrame(frame);
boot();
