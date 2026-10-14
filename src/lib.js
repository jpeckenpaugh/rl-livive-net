/* Small pure and DOM helpers shared by every module. */

export const $ = (id) => document.getElementById(id);
export const $canvas = (id) => { const c = $(id); return c ? c.getContext("2d") : null; };
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
export function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/* Deterministic shared-hazard PRNG (mulberry32), keyed by (seed, step index). */
export function mulberry32(a) {
  a = a >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashSeed(seed, t) {
  let h = (seed >>> 0) ^ Math.imul((t + 1) >>> 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}
