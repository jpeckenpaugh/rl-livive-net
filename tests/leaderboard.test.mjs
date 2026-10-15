/* Unit check for the per-pilot leaderboards (AIA-53). Pure logic against a fake
 * storage; see docs/TESTING_AND_DEPLOYMENT.md (smallest check, no browser).
 *
 * Run: node --test tests/leaderboard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { recordFlight, recordRound, recordWin, boards, load, cabinetHighScore } from "../src/leaderboard.js";
import { LB_KEY } from "../src/config.js";

function fakeStorage(initial) {
  const map = new Map(initial ? Object.entries(initial) : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

test("v2 is the active key and v1 name-keyed data is not migrated", () => {
  assert.equal(LB_KEY, "ll_leaderboards_v2");
  const legacy = fakeStorage({ ll_leaderboards_v1: JSON.stringify({ records: [{ name: "AAA", value: 999 }] }) });
  const [high, wins] = boards(legacy);
  assert.equal(high.rows.length, 0);
  assert.equal(wins.rows.length, 0);
});

test("a fresh cabinet shows both boards empty", () => {
  const [high, wins] = boards(fakeStorage());
  assert.equal(high.tag, "HIGH SCORE");
  assert.equal(wins.tag, "MOST WINS");
  assert.equal(high.rows.length, 0);
  assert.equal(wins.rows.length, 0);
});

test("recordFlight raises the max and ignores lower or negative scores without throwing", () => {
  const storage = fakeStorage();
  recordFlight("ppo", 120, storage);
  recordFlight("ppo", 80, storage);
  assert.equal(load(storage).pilots.ppo.highScore, 120);
  assert.doesNotThrow(() => recordFlight("ppo", -50, storage));
  assert.doesNotThrow(() => recordFlight("ppo", undefined, storage));
  assert.equal(load(storage).pilots.ppo.highScore, 120);
});

test("recordRound adds a win only on placement 1, regardless of score", () => {
  const storage = fakeStorage();
  recordRound("runner", 2, 300, storage);
  recordRound("champ", 1, -10, storage);
  const pilots = load(storage).pilots;
  assert.equal(pilots.runner.wins, 0);
  assert.equal(pilots.runner.highScore, 300);
  assert.equal(pilots.champ.wins, 1);
  assert.equal(pilots.champ.highScore, 0, "a negative score never becomes a high score");
});

test("recordWin increments, never filtered by score", () => {
  const storage = fakeStorage();
  recordWin("ppo", storage);
  recordWin("ppo", storage);
  assert.equal(load(storage).pilots.ppo.wins, 2);
  assert.equal(cabinetHighScore(storage), 0);
});

test("boards sort descending and cap each board at three rows", () => {
  const storage = fakeStorage();
  for (const [id, score] of Object.entries({ a: 10, b: 50, c: 30, d: 20 })) recordFlight(id, score, storage);
  for (const id of ["a", "b", "c"]) { recordWin(id, storage); recordWin(id, storage); recordWin(id, storage); }
  recordWin("d", storage);

  const [high, wins] = boards(storage);
  assert.deepEqual(high.rows.map((r) => r.pilotId), ["b", "c", "d"]);
  assert.deepEqual(high.rows.map((r) => r.value), [50, 30, 20]);
  assert.equal(high.rows.length, 3);
  assert.equal(wins.rows.length, 3, "only the top three winders are shown");
  assert.deepEqual(wins.rows.map((r) => r.value), [3, 3, 3]);
});

test("corrupt or blocked storage never throws (fail-soft)", () => {
  const corrupt = fakeStorage({ [LB_KEY]: "{not json" });
  assert.doesNotThrow(() => recordFlight("ppo", 10, corrupt));
  assert.equal(load(corrupt).pilots.ppo.highScore, 10);
  const denied = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(boards(denied).map((b) => b.rows.length), [0, 0]);
});
