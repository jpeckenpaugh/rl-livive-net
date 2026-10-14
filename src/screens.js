/* Screen router: the single place that swaps cabinet screens and their music. */
import { SCREEN_NAMES, SCREEN_TRACKS, TITLE_SCREENS, TITLE_PANELS } from "./config.js";
import { state } from "./state.js";
import { $ } from "./lib.js";
import { Sound } from "./audio.js";
import { stopConfetti, schedulePixelFit } from "./render.js";
import { stopSolo, hideSoloResult } from "./solo.js";
import { stopRunning, showMatchBanner } from "./match.js";
import { resetMenuFocus } from "./ui.js";

export function isTitleScreen(name) { return TITLE_SCREENS.has(name); }

export function showScreen(name) {
  if (!SCREEN_NAMES.includes(name)) name = "attract";
  const title = isTitleScreen(name);
  for (const candidate of SCREEN_NAMES) {
    const el = $(`screen-${candidate}`);
    if (!el) continue;
    if (candidate === "attract") el.hidden = !title;
    else if (candidate === "menu" || candidate === "mode") { /* rendered inside #screen-attract */ }
    else el.hidden = candidate !== name;
  }
  for (const key of Object.keys(TITLE_PANELS)) {
    const panel = $(TITLE_PANELS[key]);
    if (panel) panel.hidden = key !== name;
  }
  const attractScreen = $("screen-attract");
  if (attractScreen) attractScreen.dataset.panel = name;
  state.currentScreenName = name;
  Sound.setTrack(SCREEN_TRACKS[name] || name);
  if (name !== "match" && name !== "solo") stopRunning();
  // Leaving Solo Flight halts its loop and closes any Flight Over pop-up, so
  // the power button is a real exit.
  if (name !== "solo") {
    stopSolo();
    hideSoloResult();
  }
  if (!["match", "attract", "win"].includes(name)) stopConfetti();
  showMatchBanner(false);
  resetMenuFocus();
  // The cabinet is a single fixed frame — the document cannot scroll, so there
  // is nothing to reset here. Long screens scroll inside `.cabinet-screen`.
  // Re-fit playfield canvases for the newly visible screen (hidden ones were 0px).
  schedulePixelFit();
}
export function setStatus(message) {
  const el = $("cabinet-status");
  if (el) el.textContent = message;
}
