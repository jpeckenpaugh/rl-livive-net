/* Unit check for persisted audio toggles (AIA-46 R3). Pure logic only against a
 * fake storage; see docs/TESTING_AND_DEPLOYMENT.md.
 *
 * Run: node --test tests/audio_prefs.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readAudioPrefs, writeAudioPrefs, AUDIO_PREFS_DEFAULT } from "../src/audio-prefs.js";
import { AUDIO_PREFS_KEY } from "../src/config.js";

function fakeStorage(initial) {
  const map = new Map(initial ? Object.entries(initial) : []);
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

test("missing storage falls back to the all-on default", () => {
  assert.deepEqual(readAudioPrefs(null), AUDIO_PREFS_DEFAULT);
  assert.deepEqual(readAudioPrefs(fakeStorage()), AUDIO_PREFS_DEFAULT);
});

test("write then read round-trips every flag", () => {
  const storage = fakeStorage();
  assert.equal(writeAudioPrefs({ sfx: false, music: true, voices: false }, storage), true);
  assert.deepEqual(readAudioPrefs(storage), { sfx: false, music: true, voices: false });
});

test("corrupt or partial state falls back per-field to the default", () => {
  const corrupt = fakeStorage({ [AUDIO_PREFS_KEY]: "{not json" });
  assert.deepEqual(readAudioPrefs(corrupt), AUDIO_PREFS_DEFAULT);

  const partial = fakeStorage({ [AUDIO_PREFS_KEY]: JSON.stringify({ sfx: false }) });
  assert.deepEqual(readAudioPrefs(partial), { sfx: false, music: true, voices: true });

  const junk = fakeStorage({ [AUDIO_PREFS_KEY]: JSON.stringify({ sfx: "no", music: 1, voices: true }) });
  assert.deepEqual(readAudioPrefs(junk), { sfx: true, music: true, voices: true });
});

test("a blocked storage never throws (fail-soft)", () => {
  const denied = {
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("blocked"); },
  };
  assert.deepEqual(readAudioPrefs(denied), AUDIO_PREFS_DEFAULT);
  assert.equal(writeAudioPrefs({ sfx: false }, denied), false);
});
