/* Unit check for the Cabinet Manual roster (see AGENTS test policy: smallest
 * check that proves the change, no browser needed).
 *
 * Run: node --test tests/manual_roster.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pilotRows, renderPilotRowsHTML, renderContenderLinksHTML, DEFAULT_PILOT_ID } from "../src/manual-roster.js";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/manifest.json", import.meta.url), "utf8"));

test("fixture manifest ships the expected nine pilots", () => {
  assert.equal(fixture.models.length, 9);
});

test("roster renders one row per pilot and every row has a source", () => {
  const rows = pilotRows(fixture.models);
  assert.equal(rows.length, 9);
  for (const row of rows) {
    assert.ok(row.source.startsWith("http"), `${row.id} source should be a URL, got ${JSON.stringify(row.source)}`);
    assert.ok(row.label.length > 0, `${row.id} needs a label`);
  }
  const html = renderPilotRowsHTML(fixture.models);
  assert.equal((html.match(/<tr>/g) || []).length, 9);
  assert.ok(!html.includes("—</a>"), "an empty source must not become an empty link");
});

test("contender links exclude the default pilot and keep all eight repos", () => {
  const rows = pilotRows(fixture.models);
  const links = renderContenderLinksHTML(fixture.models);
  assert.equal((links.match(/<li>/g) || []).length, 8);
  const defaultRow = rows.find((row) => row.id === DEFAULT_PILOT_ID);
  assert.ok(defaultRow, "fixture should carry the default pilot");
  assert.ok(!links.includes(defaultRow.label), "default pilot should not appear in contender links");
});
