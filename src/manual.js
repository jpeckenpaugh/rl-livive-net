/* The "Cabinet Manual" overlay: the cabinet's About page as a modal web
 * document. The marquee `?` button opens it over the playfield; the panel
 * closes on the `×`, the footer Close, `Esc`, or a dimmer click. The pilot
 * roster is rendered from the loaded catalog so About never drifts from the
 * models that ship. */
import { $ } from "./lib.js";
import { state } from "./state.js";
import { Sound } from "./audio.js";
import { renderPilotRowsHTML } from "./manual-roster.js";

export function isManualOpen() {
  const overlay = $("about-overlay");
  return !!overlay && !overlay.hidden;
}

/* Fill the manifest-driven parts of the manual from the loaded catalog. */
export function renderManual() {
  const roster = $("manual-roster-rows");
  if (roster) roster.innerHTML = renderPilotRowsHTML(state.catalog);
}

export function openManual() {
  const overlay = $("about-overlay");
  if (!overlay || !overlay.hidden) return;
  renderManual();
  overlay.hidden = false;
  Sound.sfx("select");
  const close = $("about-close");
  if (close) close.focus({ preventScroll: true });
}

export function closeManual() {
  const overlay = $("about-overlay");
  if (!overlay || overlay.hidden) return;
  overlay.hidden = true;
  Sound.sfx("menu");
  const about = $("cabinet-about");
  if (about) about.focus({ preventScroll: true });
}

export function initManual() {
  const about = $("cabinet-about");
  if (about) about.addEventListener("click", () => { Sound.unlock(); openManual(); });

  const overlay = $("about-overlay");
  if (overlay) overlay.addEventListener("click", (event) => {
    // A click on the dimmer (or the backdrop itself) closes; clicks inside the
    // panel do not bubble out as a close.
    if (event.target === overlay || event.target.classList.contains("manual-dimmer")) closeManual();
  });

  for (const id of ["about-close", "about-close-foot"]) {
    const btn = $(id);
    if (btn) btn.addEventListener("click", closeManual);
  }

  window.addEventListener("keydown", (event) => {
    if (event.code !== "Escape" || !isManualOpen()) return;
    event.preventDefault();
    closeManual();
  });
}
