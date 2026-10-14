/* Three persistent leaderboards stored in localStorage. */
import { LB_KEY, HS_REEL_DWELL_MS } from "./config.js";
import { $, escapeHtml } from "./lib.js";

/* Three persistent leaderboards. Nothing is seeded: a fresh browser shows every
 * board empty, and only real completed games write rows. All of it lives in
 * localStorage, so the cabinet remembers the player's own results and never
 * shows fabricated "demo" records. */
export function loadBoards() {
  try {
    const data = JSON.parse(localStorage.getItem(LB_KEY) || "{}") || {};
    return {
      records: Array.isArray(data.records) ? data.records : [],
      cup: Array.isArray(data.cup) ? data.cup : [],
      flights: Array.isArray(data.flights) ? data.flights : [],
    };
  } catch (e) { return { records: [], cup: [], flights: [] }; }
}
export function saveBoards(boards) { try { localStorage.setItem(LB_KEY, JSON.stringify(boards)); } catch (e) {} }
export function topFive(list) { return list.slice().sort((a, b) => b.value - a.value).slice(0, 5); }
/* The title boards show only the top three rows; the storage keeps five. */
export function topThree(list) { return topFive(list).slice(0, 3); }
export function boardBest(list) {
  const rows = loadBoards()[list] || [];
  if (!rows.length) return 0;
  return rows.reduce((m, r) => Math.max(m, Number(r.value) || 0), 0);
}
/* Record one real result. `flight` (seconds) also files it under the
 * longest-flight board; `cup` files it under cup champions. Scores at or below
 * zero are ignored. */
export function addLeaderboardEntry(entry) {
  const name = (entry.name || "YOU").toString().slice(0, 12);
  const value = Math.round(Number(entry.value) || 0);
  if (value <= 0) return;
  const boards = loadBoards();
  const now = Date.now();
  boards.records.push({ name, value, at: now });
  boards.records = topFive(boards.records);
  if (Number(entry.flight) > 0) {
    boards.flights.push({ name, value: Math.round(Number(entry.flight)), at: now });
    boards.flights = topFive(boards.flights);
  }
  if (entry.cup) { boards.cup.push({ name, value, at: now }); boards.cup = topFive(boards.cup); }
  saveBoards(boards);
  renderHighScores();
}
export function leaderboards() {
  const b = loadBoards();
  return [
    { tag: "CABINET RECORDS", rows: topThree(b.records).map((r) => ({ name: r.name, score: Math.round(r.value) })) },
    { tag: "CUP CHAMPIONS", rows: topThree(b.cup).map((r) => ({ name: r.name, score: Math.round(r.value) })) },
    { tag: "LONGEST FLIGHTS · SEC", rows: topThree(b.flights).map((r) => ({ name: r.name, score: Math.round(r.value) })) },
  ];
}
export function qualifiesHighScore(score) {
  const list = loadBoards().records;
  return score > 0 && (list.length < 5 || score > Math.min(...list.map((r) => r.value)));
}
export function commitHighScore(initials, score, mode) {
  addLeaderboardEntry({ name: (initials || "AAA").toUpperCase().slice(0, 3), value: score, cup: mode === "cup" });
}
export function renderBoard(listEl, tagEl, board) {
  if (!listEl) return;
  if (tagEl) tagEl.textContent = board.tag;
  if (!board.rows.length) {
    listEl.innerHTML = `<li class="hs-empty">NO RECORDS YET</li>`;
    return;
  }
  listEl.innerHTML = board.rows.map((row, i) =>
    `<li class="${i === 0 ? "rank-one" : ""}"><span class="hs-rank">${String(i + 1).padStart(2, "0")}</span>` +
    `<span class="hs-name">${escapeHtml(row.name)}</span>` +
    `<span class="hs-pts">${row.score}</span></li>`
  ).join("");
}
/* The three title-screen boards are always visible. The match screen's
 * between-round reel keeps cycling them with a 6s stepped dwell. */
let hsReelIndex = 0;
let hsReelTimer = null;
export function renderHighScores() {
  const boards = leaderboards();
  renderBoard($("highscore-list"), $("hs-panel-tag"), boards[0]);
  renderBoard($("highscore-list-2"), $("hs-panel-tag-2"), boards[1]);
  renderBoard($("highscore-list-3"), $("hs-panel-tag-3"), boards[2]);
  renderBoard($("between-highscore-list"), $("between-reel-tag"), boards[hsReelIndex % boards.length]);
}
export function startHighScoreReel() {
  if (hsReelTimer) return;
  hsReelTimer = setInterval(() => {
    hsReelIndex = (hsReelIndex + 1) % 3;
    renderBoard($("between-highscore-list"), $("between-reel-tag"), leaderboards()[hsReelIndex]);
  }, HS_REEL_DWELL_MS);
}
