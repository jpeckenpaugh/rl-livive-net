/* Graduated hazard rules. The hazard table lives in /data/hazards.json; this
 * module owns the small selection and deterministic step logic. */
import { data } from "./data.js";
import { state } from "./state.js";
import { mulberry32, hashSeed } from "./lib.js";

/* Selected hazard level: 0 = OFF, 1..n = index into the hazard's levels. */
export function hazLevel(key, hz) {
  const table = hz || (state.match && state.match.hazards) || data.hazardKeys;
  return table[key] || 0;
}
export function hazOn(key, hz) { return hazLevel(key, hz) > 0; }
export function hazSetting(key, hz) {
  const def = data.hazardByKey[key];
  const level = hazLevel(key, hz);
  return def && def.levels[level - 1] ? def.levels[level - 1] : null;
}
export function hazRate(key, hz) { const s = hazSetting(key, hz); return s && typeof s.rate === "number" ? s.rate : 0; }
export function hazForce(key, hz) { const s = hazSetting(key, hz); return s && typeof s.force === "number" ? s.force : 0; }
export function hazTag(key, hz) { const s = hazSetting(key, hz); return s ? s.tag : ""; }
export function gravityFor(hz) {
  const s = hazSetting("gravity", hz);
  return s ? s.gravity : data.gravityDefault;
}
/* One shared decision per physics step, identical for every pilot. */
export function hazardAt(seed, t, hz) {
  const rng = mulberry32(hashSeed(seed, t));
  // Always draw the same rolls in the same order so every pilot sees the same sky.
  const sensorRoll = rng();
  const thrusterRoll = rng();
  const thrusterKind = rng() < 0.5 ? "drop" : "misfire";
  const misfireAction = 1 + Math.floor(rng() * 3);
  const windRoll = rng();
  const sensor = hazOn("sensor", hz) && sensorRoll < hazRate("sensor", hz);
  const thrusterFault = hazOn("thruster", hz) && thrusterRoll < hazRate("thruster", hz);
  const wind = hazOn("wind", hz) ? (windRoll * 2 - 1) * hazForce("wind", hz) : 0;
  return { sensor, thrusterFault, thrusterKind, misfireAction, wind };
}
/* A fault step drops every commanded burn; coasting pilots misfire identically. */
export function applySharedThrusterFault(requested, fault) {
  if (!fault.thrusterFault) return requested;
  if (requested !== 0) return 0;
  return fault.misfireAction;
}
