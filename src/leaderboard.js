/* Per-pilot leaderboards persisted in localStorage (AIA-53).
 *
 * Two boards, both keyed by pilot *id* (not pilot name) so they compare the
 * roster and auto-fill as you play:
 *   - HIGH SCORE: best single score, highScore only ever rises (max)
 *   - MOST WINS:  round wins + cup championships, regardless of score
 *
 * Storage shape: { pilots: { "<pilotId>": { highScore, wins } } }. v2 starts
 * clean; the old name-keyed v1 board is not migrated. Every path is fail-soft
 * and the storage is injectable so the pure helpers unit-test without a browser. */
import { LB_KEY } from "./config.js";
import { $, escapeHtml } from "./lib.js";
import { modelLabel } from "./models.js";

export const BOARD_LIMIT = 3;

function defaultStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (err) {
    return null;
  }
}

function empty() { return { pilots: {} }; }

/* Coerce one stored pilot record to safe numbers. A negative or missing high
 * score becomes 0; nothing here throws. */
function normalizeRecord(raw) {
  const rec = raw && typeof raw === "object" ? raw : {};
  const high = Number(rec.highScore);
  const wins = Number(rec.wins);
  return {
    highScore: Number.isFinite(high) && high > 0 ? Math.round(high) : 0,
    wins: Number.isFinite(wins) && wins > 0 ? Math.floor(wins) : 0,
  };
}

export function load(storage = defaultStorage()) {
  try {
    if (!storage) return empty();
    const raw = storage.getItem(LB_KEY);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    const src = parsed && typeof parsed === "object" && parsed.pilots && typeof parsed.pilots === "object" ? parsed.pilots : {};
    const pilots = {};
    for (const id of Object.keys(src)) pilots[id] = normalizeRecord(src[id]);
    return { pilots };
  } catch (err) { return empty(); }
}

export function save(data, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(LB_KEY, JSON.stringify({ pilots: (data && data.pilots) || {} }));
    return true;
  } catch (err) { return false; }
}

function ensurePilot(data, pilotId) {
  const id = String(pilotId == null ? "" : pilotId);
  if (!id) return null;
  if (!data.pilots[id]) data.pilots[id] = { highScore: 0, wins: 0 };
  return data.pilots[id];
}

/* Record one finished solo flight. The high score only rises; a lower or
 * negative score is ignored without blocking or throwing. */
export function recordFlight(pilotId, score, storage = defaultStorage()) {
  const data = load(storage);
  const rec = ensurePilot(data, pilotId);
  const value = Math.round(Number(score) || 0);
  if (rec && value > rec.highScore) rec.highScore = value;
  save(data, storage);
  return rec;
}

/* Record one ranked round: the score can set a new high score, and a placement
 * of 1 adds a win. Wins are never filtered by score, so a round win (or a cup
 * champion) with a zero/negative total still counts. */
export function recordRound(pilotId, placement, score, storage = defaultStorage()) {
  const data = load(storage);
  const rec = ensurePilot(data, pilotId);
  const value = Math.round(Number(score) || 0);
  if (rec) {
    if (value > rec.highScore) rec.highScore = value;
    if (Number(placement) === 1) rec.wins += 1;
  }
  save(data, storage);
  return rec;
}

/* Record a cup/match championship win, independent of the champion's score. */
export function recordWin(pilotId, storage = defaultStorage()) {
  const data = load(storage);
  const rec = ensurePilot(data, pilotId);
  if (rec) rec.wins += 1;
  save(data, storage);
  return rec;
}

function topRows(entries, metric) {
  return entries
    .filter((e) => e[metric] > 0)
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, BOARD_LIMIT)
    .map((e) => ({ pilotId: e.pilotId, value: e[metric] }));
}

/* The two title-screen boards, each sorted by its metric descending and capped
 * at BOARD_LIMIT rows. Pure: no DOM, label lookup happens at render time. */
export function boards(storage = defaultStorage()) {
  const entries = Object.entries(load(storage).pilots).map(([pilotId, rec]) => ({ pilotId, ...rec }));
  return [
    { tag: "HIGH SCORE", metric: "highScore", rows: topRows(entries, "highScore") },
    { tag: "MOST WINS", metric: "wins", rows: topRows(entries, "wins") },
  ];
}

/* Cabinet-wide best high score, for the solo result tile. */
export function cabinetHighScore(storage = defaultStorage()) {
  const rows = boards(storage)[0].rows;
  return rows.length ? rows[0].value : 0;
}

function pilotLabel(pilotId) { return modelLabel(pilotId) || pilotId || "PILOT"; }

function renderBoard(listEl, tagEl, board) {
  if (!listEl) return;
  if (tagEl) tagEl.textContent = board.tag;
  if (!board.rows.length) {
    listEl.innerHTML = `<li class="hs-empty">NO RECORDS YET</li>`;
    return;
  }
  listEl.innerHTML = board.rows.map((row, i) =>
    `<li class="${i === 0 ? "rank-one" : ""}"><span class="hs-rank">${String(i + 1).padStart(2, "0")}</span>` +
    `<span class="hs-name">${escapeHtml(pilotLabel(row.pilotId))}</span>` +
    `<span class="hs-pts">${row.value}</span></li>`
  ).join("");
}

/* Paint the two title panels (HIGH SCORE / MOST WINS) from storage. */
export function renderHighScores(storage = defaultStorage()) {
  const [high, wins] = boards(storage);
  renderBoard($("highscore-list"), $("hs-panel-tag"), high);
  renderBoard($("highscore-list-2"), $("hs-panel-tag-2"), wins);
}
