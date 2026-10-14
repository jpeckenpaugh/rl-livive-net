/* Shared mutable application state. Feature modules read and write these fields
 * instead of importing each other's module-level `let` bindings. */
export const state = {
  // current match object (match module)
  match: null,
  // match animation-loop flag (runtime + match modules)
  running: false,
  // loaded pilot catalog (models module)
  catalog: [],
  // active cabinet screen (screens module)
  currentScreenName: "boot",
  // multi-player setup (ui module)
  cabinetMode: "versus",
  playerModels: [],
  mpActiveSlot: 0,
  mpStep: "slots",
  // house-rules context (ui module)
  modsContext: "match",
  // keyboard menu focus (ui module)
  menuIndex: 0,
  // attract tagline rotation (attract module)
  attractTaglineAt: 0,
  attractTaglineIdx: 0,
  // python runtime (runtime/boot module)
  pyodide: null,
  simReady: false,
};
