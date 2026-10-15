/* Persisted audio on/off flags (AIA-46 R3).
 *
 * SFX / Music / Talk(voice) survive RESET and a full page reload. Every path is
 * fail-soft: a missing, blocked, or corrupt localStorage just falls back to the
 * all-on default, and a write that fails is reported but never thrown. The
 * storage is injectable so the logic is unit-testable without a browser. */
import { AUDIO_PREFS_KEY } from "./config.js";

export const AUDIO_PREFS_DEFAULT = { sfx: true, music: true, voices: true };

function defaultStorage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch (err) {
    return null;
  }
}

// Keep only known boolean fields; anything else falls back to the default.
function normalize(raw) {
  const out = { ...AUDIO_PREFS_DEFAULT };
  if (raw && typeof raw === "object") {
    if (typeof raw.sfx === "boolean") out.sfx = raw.sfx;
    if (typeof raw.music === "boolean") out.music = raw.music;
    if (typeof raw.voices === "boolean") out.voices = raw.voices;
  }
  return out;
}

export function readAudioPrefs(storage = defaultStorage()) {
  try {
    if (!storage) return { ...AUDIO_PREFS_DEFAULT };
    const raw = storage.getItem(AUDIO_PREFS_KEY);
    if (!raw) return { ...AUDIO_PREFS_DEFAULT };
    return normalize(JSON.parse(raw));
  } catch (err) {
    return { ...AUDIO_PREFS_DEFAULT };
  }
}

export function writeAudioPrefs(prefs, storage = defaultStorage()) {
  try {
    if (!storage) return false;
    storage.setItem(AUDIO_PREFS_KEY, JSON.stringify(normalize(prefs)));
    return true;
  } catch (err) {
    return false;
  }
}
