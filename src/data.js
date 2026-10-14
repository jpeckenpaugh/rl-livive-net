/* Data tables loaded from /data at boot. Keeping them out of the code lets the
 * cabinet's copy, hazards, music and catalog be edited without touching logic. */

export const data = {
  pilotColors: [],
  pilotTokens: [],
  taglines: {},
  arenas: [],
  gravityDefault: -10.0,
  recommended: {},
  hazardKeys: {},
  hazards: [],
  hazardByKey: {},
  tracks: {},
  modelFallback: [],
  modelSources: {},
  voiceFallback: [],
};

async function fetchJson(rel) {
  const res = await fetch(new URL(`../data/${rel}`, import.meta.url));
  if (!res.ok) throw new Error(`Could not load data/${rel} (${res.status})`);
  return res.json();
}

export async function loadData() {
  const [branding, hazards, tracks, models, voice] = await Promise.all([
    fetchJson("branding.json"),
    fetchJson("hazards.json"),
    fetchJson("tracks.json"),
    fetchJson("models.json"),
    fetchJson("voice.json"),
  ]);
  data.pilotColors = branding.pilotColors;
  data.pilotTokens = branding.pilotTokens;
  data.taglines = branding.taglines;
  data.arenas = branding.arenas;
  data.gravityDefault = hazards.gravityDefault;
  data.recommended = hazards.recommended;
  data.hazardKeys = hazards.keys;
  data.hazards = hazards.hazards;
  data.hazardByKey = Object.fromEntries(hazards.hazards.map((h) => [h.key, h]));
  data.tracks = tracks.tracks;
  data.modelFallback = models.fallback;
  data.modelSources = models.sources;
  data.voiceFallback = voice.fallback;
}
