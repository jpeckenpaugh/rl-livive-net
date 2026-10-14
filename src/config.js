/* Global tunables and the cabinet screen registry. */

export const PYODIDE_VERSION = "0.23.4";
export const ONNX_RUNTIME_VERSION = "1.19.2";
export const FPS = 50;
export const STEP_INTERVAL_MS = 1000 / FPS;
export const MAX_CATCH_UP_STEPS = 4;
export const MAX_FRAME_ELAPSED_MS = 100;
export const SCALE = 30;
export const PANELS = 4;
export const NATIVE_W = 600;
export const NATIVE_H = 400;
export const VIEWPORT_HALF_H = NATIVE_H / SCALE / 2;
export const LB_KEY = "ll_leaderboards_v1";
export const HS_REEL_DWELL_MS = 6000;
export const ATTRACT_RESTART_DELAY_MS = 1800;
export const ATTRACT_RETRY_DELAY_MS = 6000;
export const PLACE_LABELS = ["1st", "2nd", "3rd", "4th"];

export const SCREEN_NAMES = ["boot", "attract", "menu", "solomode", "pilotselect", "solo", "mode", "players", "mods", "roundintro", "match", "win", "lose", "cup"];

// Screen -> song. Menu sub-screens share one theme; every other screen has its
// own. showScreen() is the single place that applies this map.
export const SCREEN_TRACKS = {
  boot: "boot",
  attract: "attract",
  menu: "menu", solomode: "menu", pilotselect: "menu", mode: "menu", players: "menu", mods: "menu",
  solo: "solo",
  roundintro: "roundintro",
  match: "match",
  win: "win",
  lose: "lose",
  cup: "cup",
};

// The title, start menu, and multi-player sub-menu all share one layout: the
// live demo background stays up and only the foreground panel swaps. They are
// therefore panels inside #screen-attract, not separate cabinet screens.
export const TITLE_SCREENS = new Set(["attract", "menu", "solomode", "pilotselect", "mode", "players", "mods"]);
export const TITLE_PANELS = {
  attract: "title-panel-attract",
  menu: "title-panel-menu",
  solomode: "title-panel-solo",
  pilotselect: "title-panel-pilot",
  mode: "title-panel-mode",
  players: "title-panel-players",
  mods: "title-panel-houserules",
};

export const MENU_SCREENS = new Set(["attract", "menu", "solomode", "pilotselect", "mode", "players", "mods", "cup", "lose"]);
