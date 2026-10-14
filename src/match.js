/* Tournament / match engine: versus, doubles, and the four-pilot cup, plus the
 * win / lose / cup-result screens. */
import { PANELS, STEP_INTERVAL_MS, MAX_CATCH_UP_STEPS, PLACE_LABELS } from "./config.js";
import { state } from "./state.js";
import { $, clamp, pick, escapeHtml } from "./lib.js";
import { data } from "./data.js";
import { hazOn, hazTag, hazLevel, gravityFor, hazardAt, applySharedThrusterFault } from "./hazards.js";
import { Sound, Commentary } from "./audio.js";
import { drawScene, fitPixelCanvas, startConfetti, stopConfetti } from "./render.js";
import { modelLabel, modelRole, modelEntry, ensureModelSession, chooseModelActions } from "./models.js";
import { showScreen, setStatus } from "./screens.js";
import { readPythonJson } from "./python.js";
import { addLeaderboardEntry, qualifiesHighScore } from "./leaderboard.js";
import { pressed, setupTouchForMatch } from "./input.js";

const multiSims = [];

export function initializePanels() {
  const board = $("multi-board");
  if (!board) return;
  for (let i = 0; i < PANELS; i++) {
    const card = document.createElement("article");
    card.className = "multi-sim-card";
    card.dataset.slot = String(i);
    card.style.setProperty("--pilot-color", data.pilotColors[i]);
    const viewport = document.createElement("div"); viewport.className = "multi-sim-viewport";
    const canvas = document.createElement("canvas"); canvas.width = 600; canvas.height = 400;
    canvas.setAttribute("aria-label", `Pilot ${i + 1} flight`);
    const laneHud = document.createElement("div"); laneHud.className = "lane-hud";
    const nameEl = document.createElement("span"); nameEl.className = "lane-name";
    const placeEl = document.createElement("span"); placeEl.className = "lane-place-badge"; placeEl.hidden = true;
    const left = document.createElement("span"); left.className = "lane-hud-left"; left.append(nameEl, placeEl);
    const pointsEl = document.createElement("span"); pointsEl.className = "lane-points";
    laneHud.append(left, pointsEl);
    const lanePlace = document.createElement("div"); lanePlace.className = "lane-place"; lanePlace.hidden = true;
    const lanePlaceNum = document.createElement("span"); lanePlaceNum.className = "lane-place-num";
    const lanePlaceLabel = document.createElement("span"); lanePlaceLabel.className = "lane-place-label";
    lanePlace.append(lanePlaceNum, lanePlaceLabel);
    viewport.append(canvas, laneHud, lanePlace);
    card.append(viewport);
    board.append(card);
    multiSims.push({
      index: i, el: card, nameEl, placeEl, pointsEl, canvas, ctx: canvas.getContext("2d"),
      lanePlace, lanePlaceNum, lanePlaceLabel,
      state: null, prevObservation: null, action: 0, reward: 0, done: false,
      outcome: "FLYING", steps: 0, placement: null, pilot: null,
    });
  }
}
export function drawPanels() {
  if (!state.match) return;
  for (const sim of multiSims) {
    const active = sim.pilot != null;
    sim.el.hidden = !active;
    if (!active) continue;
    // First time this lane is visible its canvas may still be at the native
    // default; fit it once the card has laid out.
    if (!sim.canvas.dataset.pixelScale) fitPixelCanvas(sim.canvas);
    drawScene(sim.canvas, sim.ctx, sim.state, sim.action, sim.pilot.color);
    const stats = state.match.stats[sim.pilot.slot];
    const roundPts = sim.reward;
    const total = (stats ? stats.total : 0) + roundPts;
    sim.nameEl.textContent = `P${sim.pilot.slot + 1} · ${sim.pilot.shortName}`;
    sim.el.style.setProperty("--pilot-color", sim.pilot.color);
    sim.pointsEl.textContent = `${total.toFixed(0)} PTS`;
    sim.pointsEl.classList.toggle("done", sim.done);
    sim.placeEl.hidden = !sim.placement;
    sim.placeEl.textContent = sim.placement ? placeText(sim.placement) : "";
    sim.placeEl.className = `lane-place-badge${sim.placement === 1 ? " gold" : sim.placement ? " ranked" : ""}`;
    // Big lane-place overlay: only shown once the round is ranked.
    const showPlace = !!sim.placement && state.match.phase === "roundComplete";
    sim.lanePlace.hidden = !showPlace;
    if (showPlace) {
      sim.lanePlace.style.setProperty("--pilot-color", sim.pilot.color);
      sim.lanePlaceNum.textContent = String(sim.placement);
      sim.lanePlaceLabel.textContent = placeText(sim.placement).toUpperCase();
    }
  }
}
export function placeText(p) { return PLACE_LABELS[p - 1] || `#${p}`; }

function makePilot(slot, modelId) {
  const human = modelId === "human";
  return {
    slot, modelId, human,
    color: data.pilotColors[slot],
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
  const hazardState = { ...data.hazardKeys, ...(hazards || {}) };
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

export async function prepareMatch(matchConfig) {
  state.match = newMatch(matchConfig);
  for (const sim of multiSims) { sim.pilot = null; sim.placement = null; }
  const needed = state.match.slotCount;
  for (let i = 0; i < needed; i++) {
    multiSims[i].pilot = state.match.pilots[i];
    multiSims[i].placement = null;
    multiSims[i].reward = 0;
    multiSims[i].done = false;
    multiSims[i].outcome = "FLYING";
    multiSims[i].steps = 0;
  }
  setStatus("PILOTS, TO YOUR PADS");
  const toLoad = state.match.pilots.filter((p) => !p.human).map((p) => p.modelId);
  await Promise.all([...new Set(toLoad)].map((id) => ensureModelSession(id)));
  setupTouchForMatch();
}

function hazardIntroText() {
  const active = data.hazards.filter((h) => hazOn(h.key, state.match.hazards) && !h.soon);
  if (!active.length) return "CLEAN SKY — NO HAZARDS.";
  return `${active.map((h) => `${h.name} ${hazTag(h.key, state.match.hazards)}`).join(" · ")} — SAME SKY. SAME HAZARDS.`;
}

export function beginRound() {
  state.match.round += 1;
  state.match.roundSteps = 0;
  const betweenReel = $("between-reel"); if (betweenReel) betweenReel.hidden = true;
  Commentary.roundStart(state.match.round, state.match.totalRounds);
  state.match.gravity = gravityFor(state.match.hazards);
  const seed = (state.match.seedBase + state.match.round * 2654435761) >>> 0;
  state.match.roundSeed = seed;
  for (const sim of multiSims) {
    sim.done = false; sim.reward = 0; sim.action = 0; sim.steps = 0; sim.placement = null; sim.outcome = "FLYING";
  }
  const arena = data.arenas[(state.match.round - 1) % data.arenas.length];
  state.match.arena = arena;
  // round intro
  $("roundintro-mode").textContent = state.match.mode.toUpperCase();
  $("roundintro-round").textContent = `ROUND ${state.match.round}`;
  $("roundintro-arena").textContent = arena;
  $("roundintro-announcer").textContent = pick(data.taglines.roundCall).replace("{n}", String(state.match.round));
  $("roundintro-hazards").textContent = hazardIntroText();
  showScreen("roundintro");
  runCountdown(async () => {
    await resetRoundEnvs(seed);
    showScreen("match");
    updateMatchHead();
    state.match.phase = "running";
    state.running = true;
    drawPanels();
  });
}

function runCountdown(done) {
  let n = 3;
  const el = $("roundintro-count");
  const tick = () => {
    if (n > 0) { if (el) el.textContent = String(n); Sound.sfx("countdown"); n -= 1; setTimeout(tick, 700); }
    else { if (el) el.textContent = "GO"; Commentary.go(); Sound.sfx("go"); setTimeout(() => done(), 500); }
  };
  tick();
}

async function resetRoundEnvs(seed) {
  const scenes = readPythonJson(`reset_many_seeded_json(${JSON.stringify(JSON.stringify({ seed, gravity: state.match.gravity }))})`);
  for (let i = 0; i < multiSims.length; i++) {
    const sim = multiSims[i];
    if (!sim.pilot) continue;
    sim.state = scenes[i];
    sim.prevObservation = Array.from(scenes[i].observation);
    sim.reward = 0; sim.action = 0; sim.done = false; sim.steps = 0;
  }
  state.match.accumulator = 0;
}

function updateMatchHead() {
  const head = $("match-round");
  if (head) head.textContent = `ROUND ${state.match.round} / ${state.match.totalRounds} · ${state.match.arena}`;
  updateMatchPips();
}
export function updateMatchPips() {
  const el = $("match-pips");
  if (!el) return;
  if (state.match.teams) {
    el.textContent = state.match.teams.map((t, i) => `TEAM ${i + 1} ${pip(state.match.roundWins[i], state.match.bestOf)}`).join("   ");
  } else {
    // Cup lanes carry their own name HUD; keep the top line clear.
    el.textContent = "";
  }
}
function pip(wins, best) {
  const pipsNeeded = Math.ceil(best / 2);
  let s = "";
  for (let i = 0; i < pipsNeeded; i++) s += i < wins ? "●" : "○";
  return s;
}

function activeSims() { return multiSims.filter((s) => s.pilot && !s.done); }

export async function advanceMatchStep() {
  const t = state.match.roundSteps;
  const fault = hazardAt(state.match.roundSeed, t, state.match.hazards);
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
  const payload = { actions, active, hazards: { gravity: state.match.gravity, wind: fault.wind } };
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
  if (state.match.roundSteps % 7 === 0 && multiSims.some((s) => s.pilot && !s.done && s.action === 2)) Sound.sfx("thrust");
  state.match.roundSteps += 1;
}
function matchAction(code, value) { return pressed.has(code) ? value : null; }

export function roundComplete() { return activeSims().length === 0; }

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

/* Cumulative leader by total score; -1 when no pilots. Drives "takes the lead". */
function leaderSlot() {
  if (!state.match || !state.match.pilots.length) return -1;
  let best = -1, bestTotal = -Infinity;
  for (const p of state.match.pilots) {
    const total = state.match.stats[p.slot].total;
    if (total > bestTotal) { bestTotal = total; best = p.slot; }
  }
  return best;
}

export function finishRound() {
  state.match.phase = "roundComplete";
  state.match.simBySlot = {};
  for (const sim of multiSims) if (sim.pilot) state.match.simBySlot[sim.pilot.slot] = sim;
  const prevLeader = state.match.round > 1 ? leaderSlot() : null;
  const ranked = multiSims.filter((s) => s.pilot).slice().sort(compareSims);
  // Every mode gets a full 1..N placement so the lanes can crown their pilots.
  ranked.forEach((sim, idx) => { sim.placement = idx + 1; });

  let info;
  if (state.match.teams) {
    const s0 = teamScore(state.match, 0), s1 = teamScore(state.match, 1);
    let winner = s0 > s1 ? 0 : s1 > s0 ? 1 : -1;
    if (winner === -1 || Math.abs(s0 - s1) < 15) {
      const l0 = teamLanded(state.match, 0) ? 1 : 0, l1 = teamLanded(state.match, 1) ? 1 : 0;
      if (l0 !== l1) winner = l0 > l1 ? 0 : 1;
    }
    if (winner !== -1) state.match.roundWins[winner] += 1;
    for (const sim of ranked) {
      const st = state.match.stats[sim.pilot.slot];
      st.total += sim.reward;
      st.placements.push(sim.placement);
      if (sim.outcome === "LANDED") st.lands += 1;
      const team = state.match.teams.findIndex((t) => t.includes(sim.pilot.slot));
      if (winner !== -1 && team === winner) st.wins += 1;
    }
    info = { winnerTeam: winner, margin: Math.abs(s0 - s1), scores: [s0, s1], landed0: teamLanded(state.match, 0), landed1: teamLanded(state.match, 1) };
  } else {
    for (const sim of ranked) {
      const stats = state.match.stats[sim.pilot.slot];
      stats.total += sim.reward;
      stats.placements.push(sim.placement);
      if (sim.outcome === "LANDED") stats.lands += 1;
      if (sim.placement === 1) stats.wins += 1;
    }
    info = { winnerTeam: null, winnerSlot: ranked[0].pilot.slot, margin: ranked[0].reward - (ranked[1]?.reward || 0), scores: ranked.map((s) => s.reward), cup: true };
  }
  const newLeader = leaderSlot();
  info.leadChanged = prevLeader != null && newLeader !== prevLeader;
  info.leadSlot = newLeader;
  drawPanels();
  updateMatchPips();
  showRoundResult(info);
}

/* Running standings shown inside the round-complete pop-up. */
function renderMatchStandings() {
  const el = $("match-standings"); if (!el || !state.match) return;
  const rows = state.match.pilots.slice().sort((a, b) => state.match.stats[b.slot].total - state.match.stats[a.slot].total);
  el.replaceChildren(...rows.map((p) => {
    const st = state.match.stats[p.slot];
    const row = document.createElement("div");
    row.className = "match-standing";
    row.style.setProperty("--pilot-color", p.color);
    const nm = document.createElement("span"); nm.className = "standing-name"; nm.textContent = p.name;
    const val = document.createElement("span"); val.className = "standing-val";
    val.textContent = state.match.teams ? `${st.wins} W · ${st.total.toFixed(0)} PTS` : `${st.total.toFixed(0)} PTS · ${st.lands} LANDED`;
    row.append(nm, val);
    return row;
  }));
}

/* Round end lands on the 4-lane board: big place numbers + a continue banner. */
function showRoundResult(info) {
  const humanLost = state.match.humanSlot >= 0 && !humanWonRound(info);
  const kickerEl = $("match-banner-kicker");
  const winnerEl = $("match-banner-winner");
  const marginEl = $("match-banner-margin");
  let title, margin, color;
  if (info.cup) {
    const p = state.match.pilots[info.winnerSlot];
    title = `ROUND ${state.match.round} — ${p.shortName}`;
    color = p.color;
    margin = `+${Math.max(0, info.margin).toFixed(1)} PTS`;
    if (kickerEl) kickerEl.textContent = `ROUND ${state.match.round} COMPLETE`;
  } else if (info.winnerTeam === null || info.winnerTeam === -1) {
    title = `ROUND ${state.match.round} COMPLETE`;
    color = "#94A3B8";
    margin = "DEAD HEAT";
    if (kickerEl) kickerEl.textContent = "ROUND COMPLETE";
  } else {
    const slots = state.match.teams[info.winnerTeam];
    const lead = state.match.pilots[slots[0]];
    title = `ROUND ${state.match.round} — ${slots.map((s) => state.match.pilots[s].shortName).join(" + ")}`;
    color = lead.color;
    margin = `+${info.margin.toFixed(1)} PTS`;
    if (kickerEl) kickerEl.textContent = "ROUND COMPLETE";
  }
  if (humanLost) {
    const behind = Math.abs(info.margin || 0).toFixed(1);
    title = `SO CLOSE — ${behind} BEHIND`;
    color = "#94A3B8";
    if (kickerEl) kickerEl.textContent = pick(data.taglines.loser);
    // The loser's screen must not show a bare "+" margin, which reads as a win.
    margin = `WINNER'S MARGIN +${behind} PTS`;
  }
  if (winnerEl) { winnerEl.textContent = title; winnerEl.style.color = color; }
  if (marginEl) marginEl.textContent = margin;
  const matchOver = state.match.teams ? (state.match.roundWins[0] >= 2 || state.match.roundWins[1] >= 2) : state.match.round >= state.match.totalRounds;
  const cont = $("match-continue");
  if (cont) { cont.textContent = matchOver ? "RESULTS ▶" : "NEXT ROUND ▶"; cont.hidden = false; }
  if (state.currentScreenName !== "match") showScreen("match");
  renderMatchStandings();
  showMatchBanner(true, matchOver);
  matchResultIndex = 0;
  if (!matchOver) startRoundAutoCountdown();
  // Announcer reacts to the round. The director composes a Player N line from
  // the round context (subject + event + modifier) and falls back to the classic
  // flawless/perfect/K.O. clips when the new dynamic clips are not baked yet.
  const roundSims = Object.values(state.match.simBySlot || {}).filter(Boolean);
  const humanSim = state.match.humanSlot >= 0 ? state.match.simBySlot[state.match.humanSlot] : null;
  const humanLanded = !!(humanSim && humanSim.outcome === "LANDED");
  const anyLanded = roundSims.some((s) => s.outcome === "LANDED");
  const landedCount = roundSims.filter((s) => s.outcome === "LANDED").length;
  const crashedCount = roundSims.filter((s) => s.outcome === "CRASHED").length;
  const winnerSlot = info.cup ? info.winnerSlot : (info.winnerTeam != null && info.winnerTeam >= 0 ? state.match.teams[info.winnerTeam][0] : null);
  const winnerSim = winnerSlot != null ? state.match.simBySlot[winnerSlot] : null;
  Commentary.roundResult({
    round: state.match.round,
    teamMode: !!state.match.teams,
    winnerSlot,
    winnerLanded: !!(winnerSim && winnerSim.outcome === "LANDED"),
    margin: Math.abs(info.margin || 0),
    humanSlot: state.match.humanSlot,
    humanWon: !humanLost,
    humanLanded,
    anyLanded,
    landedCount,
    crashedCount,
    slotCount: roundSims.length,
  });
  if (info.leadChanged) Commentary.takesTheLead({ leadSlot: info.leadSlot });
  if (!humanLost && info.winnerTeam !== -1) { Sound.sfx("land"); startConfetti($("match-confetti"), color); }
}

export function showMatchBanner(visible, isOver) {
  const banner = $("match-banner");
  if (!banner) return;
  banner.hidden = !visible;
  if (!visible) { cancelRoundAutoCountdown(); return; }
  const prompt = $("match-banner-prompt");
  if (prompt) prompt.textContent = isOver ? "PRESS START · SPACE / ENTER FOR RESULTS" : "PRESS START · SPACE / ENTER";
}

/* Round-complete auto-advance: five seconds, then the next round starts. Any
 * player move (arrow keys, a click) cancels it. */
let roundAuto = { timer: null, remaining: 0 };
export function cancelRoundAutoCountdown() {
  if (roundAuto.timer) { clearInterval(roundAuto.timer); roundAuto.timer = null; }
}
function updateRoundAutoPrompt() {
  const prompt = $("match-banner-prompt");
  if (prompt) prompt.textContent = `NEXT ROUND IN ${roundAuto.remaining} · MOVE TO CANCEL`;
}
function startRoundAutoCountdown() {
  cancelRoundAutoCountdown();
  roundAuto.remaining = 5;
  updateRoundAutoPrompt();
  roundAuto.timer = setInterval(() => {
    roundAuto.remaining -= 1;
    if (roundAuto.remaining <= 0) {
      cancelRoundAutoCountdown();
      if (state.match && state.match.phase === "roundComplete") continueAfterRound();
      return;
    }
    updateRoundAutoPrompt();
  }, 1000);
}
let matchResultIndex = 0;
function matchResultItems() {
  const banner = $("match-banner");
  if (!banner || banner.hidden) return [];
  return Array.from(banner.querySelectorAll("button")).filter((el) => !el.hidden);
}
export function moveMatchResultFocus(delta) {
  const items = matchResultItems();
  if (!items.length) return;
  matchResultIndex = ((matchResultIndex + delta) % items.length + items.length) % items.length;
  document.querySelectorAll(".kbd-focus").forEach((el) => el.classList.remove("kbd-focus"));
  const el = items[matchResultIndex];
  el.classList.add("kbd-focus");
  try { el.focus({ preventScroll: true }); } catch (err) { el.focus(); }
}

function humanWonRound(info) {
  if (state.match.humanSlot < 0) return true;
  if (info.cup) return info.winnerSlot === state.match.humanSlot;
  const humanTeam = state.match.teams.findIndex((t) => t.includes(state.match.humanSlot));
  return info.winnerTeam === humanTeam;
}

export function continueAfterRound() {
  if (!state.match || state.match.phase !== "roundComplete") return;
  cancelRoundAutoCountdown();
  stopConfetti();
  const cont = $("match-continue"); if (cont) cont.hidden = true;
  showMatchBanner(false);
  const betweenReel = $("between-reel"); if (betweenReel) betweenReel.hidden = true;
  const matchOver = state.match.teams ? (state.match.roundWins[0] >= 2 || state.match.roundWins[1] >= 2) : state.match.round >= state.match.totalRounds;
  // Next Round starts the next round directly; House Rules only shows up front.
  if (!matchOver) { beginRound(); return; }
  endMatch();
}

function endMatch() {
  state.match.phase = "done";
  state.running = false;
  // determine champion
  let championSlot;
  if (state.match.teams) {
    championSlot = state.match.roundWins[0] >= 2 ? state.match.teams[0][0] : state.match.teams[1][0];
  } else {
    const ranked = state.match.pilots.slice().sort((a, b) => state.match.stats[b.slot].total - state.match.stats[a.slot].total);
    championSlot = ranked[0].slot;
  }
  state.match.champion = championSlot;
  const champPilot = state.match.pilots[championSlot];
  const champStats = state.match.stats[championSlot];
  if (champPilot && champStats) {
    addLeaderboardEntry({
      name: champPilot.name,
      value: champStats.total,
      cup: state.match.mode === "cup",
    });
  }
  const humanWon = state.match.humanSlot < 0 ? true : (state.match.teams ? state.match.teams.findIndex((t) => t.includes(state.match.humanSlot)) === (state.match.roundWins[0] >= 2 ? 0 : 1) : championSlot === state.match.humanSlot);
  if (state.match.humanSlot >= 0 && !humanWon) showLose();
  else showWin(championSlot);
}

function showWin(championSlot) {
  const champ = state.match.pilots[championSlot];
  const podium = $("win-podium");
  if (podium) {
    const ranked = state.match.teams ? [] : state.match.pilots.slice().sort((a, b) => state.match.stats[b.slot].total - state.match.stats[a.slot].total);
    if (state.match.teams) {
      const winnerTeam = state.match.teams.findIndex((t) => t.includes(championSlot));
      const loserTeam = 1 - winnerTeam;
      const order = [
        { pilot: state.match.pilots[state.match.teams[loserTeam][0]], place: 2 },
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
  if (tag) tag.textContent = pick(data.taglines.winnerMatch);
  const statsEl = $("win-stats");
  if (statsEl) {
    const st = state.match.stats[championSlot] || { total: 0, wins: 0, lands: 0 };
    statsEl.textContent = state.match.teams
      ? `${state.match.mode.toUpperCase()} · ROUNDS WON ${Math.max(...state.match.roundWins)} · ${st.total.toFixed(0)} PTS`
      : `${state.match.mode.toUpperCase()} · ${st.wins} ROUNDS WON · ${st.lands} LANDED · ${st.total.toFixed(0)} PTS`;
  }
  showScreen("win");
  Commentary.matchWin(championSlot);
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
  if (tag) tag.textContent = pick(data.taglines.loser);
  const human = state.match.pilots[state.match.humanSlot];
  const humanTeam = state.match.teams ? state.match.teams.findIndex((t) => t.includes(state.match.humanSlot)) : null;
  const marginEl = $("lose-margin");
  if (marginEl) {
    if (state.match.teams) {
      const other = 1 - humanTeam;
      marginEl.textContent = `${teamScore(state.match, humanTeam).toFixed(0)} — ${teamScore(state.match, other).toFixed(0)} · ${state.match.pilots[human.slot].name}`;
    } else {
      marginEl.textContent = `${state.match.stats[human.slot].total.toFixed(0)} pts · ${state.match.pilots[state.match.champion].shortName} took the cup`;
    }
  }
  Commentary.matchLose();
  Commentary.line("game_over", { priority: 8 });
  Sound.sfx("lose");
  showScreen("lose");
}
export function openCup(championSlot) {
  const ranked = state.match.pilots.slice().sort((a, b) => state.match.stats[b.slot].total - state.match.stats[a.slot].total);
  const podium = $("cup-podium");
  if (podium) {
    const order = [ranked[1], ranked[0], ranked[2], ranked[3]].filter(Boolean);
    podium.innerHTML = order.map((p) => podiumBar(p, ranked.indexOf(p) + 1, p === ranked[0])).join("");
  }
  const chip = $("cup-chip");
  if (chip) chip.textContent = state.match.mode === "cup" ? `4 PILOTS · ${state.match.totalRounds} ROUNDS` : `${state.match.mode.toUpperCase()} · MATCH COMPLETE`;
  const table = $("cup-table");
  if (table) {
    table.innerHTML = `<thead><tr><th>#</th><th>Pilot</th><th>Score</th><th>Wins</th><th>Lands</th><th>Round finishes</th><th>Source</th></tr></thead><tbody>${ranked.map((p, i) => {
      const st = state.match.stats[p.slot];
      const src = p.source ? `<a href="${p.source}" target="_blank" rel="noreferrer">↗ source</a>` : "—";
      return `<tr class="stand-row" style="--pilot-color:${p.color}"><td>${i + 1}</td><td><span class="pilot-chip" style="--pilot-color:${p.color}"></span>P${p.slot + 1} ${escapeHtml(p.name)}</td><td>${st.total.toFixed(0)}</td><td>${st.wins}</td><td>${st.lands}</td><td class="place-cells">${st.placements.map((pl) => `<i class="p${pl}">${pl}</i>`).join("")}</td><td>${src}</td></tr>`;
    }).join("")}</tbody>`;
  }
  // high-score entry
  const humanScore = state.match.humanSlot >= 0 ? state.match.stats[state.match.humanSlot].total : null;
  const entry = $("cup-entry");
  const qualifies = humanScore != null && qualifiesHighScore(humanScore);
  if (entry) entry.hidden = !qualifies;
  showScreen("cup");
}
export function advanceFromWin() {
  if (state.currentScreenName !== "win" || !state.match) return;
  stopConfetti();
  openCup(state.match.champion);
}

export function stopRunning() {
  state.running = false;
  if (state.match) state.match.busy = false;
}
