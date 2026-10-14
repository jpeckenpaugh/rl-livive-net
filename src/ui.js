/* Cabinet menus: House Rules (hazards), pilot selection, and keyboard menu
 * navigation. */
import { MENU_SCREENS } from "./config.js";
import { state } from "./state.js";
import { $, clamp } from "./lib.js";
import { data } from "./data.js";
import { hazLevel, hazOn } from "./hazards.js";
import { Sound, Commentary } from "./audio.js";
import { modelLabel, modelRole } from "./models.js";
import { showScreen, isTitleScreen } from "./screens.js";

/* ============================================================================
 * MODIFIERS (per match / per round)
 * ==========================================================================*/
export function openMods(context) {
  state.modsContext = context;
  const title = $("mods-title");
  if (context === "round") {
    if (title) title.textContent = `ROUND ${state.match.round + 1} OF ${state.match.totalRounds} — HOUSE RULES`;
    // Cup only: each pit stop past the opener introduces the next challenger.
    if (state.match.round >= 1) Commentary.line("new_challenger");
  } else {
    if (title) title.textContent = "HOUSE RULES";
  }
  const seedEl = $("mods-seed");
  if (seedEl) seedEl.textContent = `${context === "round" ? "ROUND" : "COURSE"} SEED ${(state.match.seedBase % 100000)} · LOCKED`;
  const acceptRow = $("mods-accept-row"); if (acceptRow) acceptRow.hidden = false;
  const custom = $("mods-custom"); if (custom) custom.hidden = true;
  renderHazardGrid();
  showScreen("mods");
}
export function renderHazardGrid() {
  const grid = $("mods-grid"); if (!grid || !state.match) return;
  grid.innerHTML = data.hazards.map((h) => {
    const level = hazLevel(h.key, state.match.hazards);
    const on = level > 0;
    const soon = !!h.soon;
    const chips = h.levels.map((lvl, i) => {
      const idx = i + 1;
      const active = on && level === idx;
      return `<button class="hazard-chip${active ? " active" : ""}" type="button" data-hazard="${h.key}" data-level="${idx}" aria-pressed="${active}">${lvl.label}</button>`;
    }).join("");
    // The intensity options are hidden while the hazard is off.
    const levelsHtml = (on && !soon) ? `<div class="hazard-levels" role="group" aria-label="${h.name} intensity">${chips}</div>` : "";
    return `<div class="hazard-card${on ? " armed" : ""}${soon ? " soon" : ""}" data-hazard="${h.key}">
      <div class="hazard-head">
        <span class="hazard-name">${h.name}${soon ? ' <em class="hazard-soon-tag">SOON</em>' : ""}</span>
        <button class="hazard-toggle${on ? " on" : ""}" type="button" data-hazard="${h.key}" aria-pressed="${on}" aria-label="${h.name} ${on ? "on" : "off"}"${soon ? " disabled" : ""}>${on ? "ON" : "OFF"}</button>
      </div>
      <span class="hazard-effect">${h.effect}</span>
      <span class="hazard-explain">${h.explain || ""}</span>
      ${levelsHtml}
    </div>`;
  }).join("");
  updateModsSummary();
  grid.querySelectorAll(".hazard-toggle").forEach((btn) => {
    btn.addEventListener("click", () => toggleHazard(btn.dataset.hazard));
  });
  grid.querySelectorAll(".hazard-chip").forEach((btn) => {
    btn.addEventListener("click", () => setHazardLevel(btn.dataset.hazard, Number(btn.dataset.level)));
  });
}
/* Off/On is a separate switch. Turning a hazard on arms its first level; turning
 * it off clears it. The config chips below set the intensity directly. */
function toggleHazard(key) {
  if (!state.match) return;
  const h = data.hazardByKey[key];
  if (!h || !h.real) return;
  const on = hazLevel(key, state.match.hazards) > 0;
  state.match.hazards[key] = on ? 0 : 1;
  Sound.sfx("menu");
  renderHazardGrid();
}
function setHazardLevel(key, level) {
  if (!state.match) return;
  const h = data.hazardByKey[key];
  if (!h || !h.real) return;
  state.match.hazards[key] = clamp(Number(level) || 0, 0, h.levels.length);
  Sound.sfx("menu");
  renderHazardGrid();
}
function hazardStarRating() {
  const total = Object.keys(data.hazardKeys).reduce((sum, key) => sum + hazLevel(key, state.match.hazards), 0);
  if (total === 0) return "☆☆☆";
  if (total <= 2) return "★☆☆";
  if (total <= 5) return "★★☆";
  return "★★★";
}
function updateModsSummary() {
  const el = $("mods-summary"); if (!el || !state.match) return;
  const armed = data.hazards.filter((h) => hazOn(h.key, state.match.hazards)).length;
  const stars = hazardStarRating();
  el.textContent = armed === 0 ? "CLEAN SKY — NO HAZARDS." : `HAZARDS ARMED: ${armed} · DIFFICULTY ${stars}`;
}

/* ============================================================================
 * PLAYERS SCREEN
 * ==========================================================================*/
export function selectCabinetMode(mode) {
  state.cabinetMode = mode;
  state.playerModels = [];
  state.mpActiveSlot = 0;
  state.mpStep = "slots";
  const slotCount = mode === "versus" ? 2 : 4;
  for (let i = 0; i < slotCount; i++) state.playerModels.push(defaultModelFor(i, mode));
  renderPlayers();
}
export function renderPlayers() {
  const slotsEl = $("players-grid"); if (!slotsEl) return;
  const mode = state.cabinetMode;
  const slotCount = mode === "versus" ? 2 : 4;
  state.playerModels = state.playerModels.slice(0, slotCount);
  while (state.playerModels.length < slotCount) state.playerModels.push(defaultModelFor(state.playerModels.length, mode));
  if (state.mpActiveSlot >= slotCount) state.mpActiveSlot = 0;
  const chip = $("players-chip");
  if (chip) chip.textContent = mode === "versus" ? "CHOOSE PILOTS · VERSUS 1 v 1" : mode === "doubles" ? "CHOOSE PILOTS · DOUBLES 2 v 2" : "CHOOSE PILOTS · CUP";
  slotsEl.replaceChildren(...state.playerModels.map((mid, slot) => {
    const human = mid === "human";
    const card = document.createElement("button");
    card.type = "button";
    card.className = `slot-card${slot === state.mpActiveSlot ? " active" : ""}`;
    card.style.setProperty("--pilot-color", data.pilotColors[slot]);
    const n = document.createElement("span"); n.className = "slot-num"; n.textContent = `PILOT ${slot + 1}`;
    const nm = document.createElement("strong"); nm.textContent = human ? "HUMAN PILOT" : modelLabel(mid);
    const rl = document.createElement("small"); rl.textContent = human ? "you fly" : modelRole(mid);
    card.append(n, nm, rl);
    card.addEventListener("click", () => { Sound.sfx("select"); state.mpActiveSlot = slot; state.mpStep = "pilots"; renderPlayers(); });
    return card;
  }));
  const slotsStep = $("players-slots-step");
  const pilotsStep = $("players-pilots-step");
  if (slotsStep) slotsStep.hidden = state.mpStep !== "slots";
  if (pilotsStep) pilotsStep.hidden = state.mpStep !== "pilots";
  const stepTitle = $("players-step-title");
  if (stepTitle) stepTitle.textContent = `SELECT PILOT ${state.mpActiveSlot + 1}`;
  const cardsEl = $("mp-pilot-cards"); if (!cardsEl) return;
  const options = (state.mpActiveSlot === 0 && mode !== "cup")
    ? [{ id: "human", label: "Human Pilot", algorithm: "YOU" }, ...state.catalog]
    : state.catalog;
  cardsEl.replaceChildren(...options.map((m) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "pilot-card";
    const name = document.createElement("span"); name.className = "pilot-card-name"; name.textContent = m.label;
    const tags = document.createElement("span"); tags.className = "pilot-card-tags";
    if (state.playerModels[state.mpActiveSlot] === m.id) {
      const sel = document.createElement("span"); sel.className = "pilot-tag default"; sel.textContent = "SELECTED"; tags.append(sel);
    }
    const algo = document.createElement("span"); algo.className = "pilot-tag"; algo.textContent = m.algorithm || "PILOT";
    tags.append(algo);
    card.append(name, tags);
    card.addEventListener("click", () => {
      state.playerModels[state.mpActiveSlot] = m.id;
      Sound.sfx("select");
      state.mpStep = "slots";
      if (state.mpActiveSlot < slotCount - 1) state.mpActiveSlot += 1;
      renderPlayers();
    });
    return card;
  }));
}
export function defaultModelFor(slot, mode) {
  const models = state.catalog.length ? state.catalog.map((m) => m.id) : ["ppo"];
  if (mode === "cup") return models[slot % models.length];
  if (slot === 0) return "human";
  return models[(slot - 1) % models.length];
}

/* ============================================================================
 * MENU KEYBOARD NAVIGATION
 * ==========================================================================*/
/*
 * Screens where the cabinet owns the arrow keys for menu navigation.
 * Gameplay screens (solo/match) keep their flight controls instead.
 */
export function focusableItems() {
  // The start menu and multi-player sub-menu live inside #screen-attract.
  const screen = isTitleScreen(state.currentScreenName) ? $("screen-attract") : $(`screen-${state.currentScreenName}`);
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
  state.menuIndex = clamp(state.menuIndex, 0, items.length - 1);
  const el = items[state.menuIndex];
  el.classList.add("kbd-focus");
  try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
  if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
}
/* Reset the highlight to the first item each time a menu screen opens. */
export function resetMenuFocus() {
  clearMenuFocus();
  if (!MENU_SCREENS.has(state.currentScreenName)) return;
  state.menuIndex = 0;
  setMenuFocus(focusableItems());
}
function moveMenuFocus(delta) {
  const items = focusableItems();
  if (!items.length) return;
  const current = items.indexOf(document.activeElement);
  state.menuIndex = current >= 0 ? current + delta : state.menuIndex + delta;
  state.menuIndex = ((state.menuIndex % items.length) + items.length) % items.length;
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
  state.menuIndex = idx;
  setMenuFocus(items);
  return true;
}
function activateMenuItem() {
  const items = focusableItems();
  const focused = document.activeElement;
  const el = (focused && items.includes(focused)) ? focused : items[state.menuIndex];
  if (!el) return;
  if (el.tagName === "SELECT") { el.focus(); return; }
  el.click();
}
export function handleMenuKey(e) {
  if (!MENU_SCREENS.has(state.currentScreenName)) return false;
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
    if (state.currentScreenName === "attract") {
      const start = $("start-game");
      if (start && !start.disabled) start.click();
      return true;
    }
    activateMenuItem();
    return true;
  }
  return false;
}
