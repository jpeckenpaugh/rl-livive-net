/* Pure roster helpers for the Cabinet Manual.
 *
 * The About panel used to hard-code the pilot list, so it drifted behind the
 * models that actually ship. These helpers read the build manifest (or the
 * boot catalog) and produce the roster markup, which keeps About in sync with
 * `models/manifest.json` with no hand edits. No DOM access here so the roster
 * can be unit-checked in plain Node.
 */
import { escapeHtml } from "./lib.js";

/* The first-party pilot is the one the cabinet ships by default; every other
 * entry is an imported contender. */
export const DEFAULT_PILOT_ID = "ppo";

/* Normalize manifest/catalog entries to the five columns About cares about. */
export function pilotRows(models) {
  if (!Array.isArray(models)) return [];
  return models
    .filter((m) => m && m.id && m.url)
    .map((m) => ({
      id: String(m.id),
      label: String(m.label || m.id),
      author: m.author ? String(m.author) : "",
      algorithm: m.algorithm ? String(m.algorithm) : (m.role ? String(m.role) : ""),
      role: m.role ? String(m.role) : "contender",
      source: m.source ? String(m.source) : "",
    }));
}

function sourceLink(row) {
  if (!row.source) return "—";
  return `<a href="${escapeHtml(row.source)}" target="_blank" rel="noreferrer">Source ↗</a>`;
}

/* The "The pilots" table body: one row per model, source always present. */
export function renderPilotRowsHTML(models) {
  return pilotRows(models)
    .map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th>`
      + `<td>${escapeHtml(row.algorithm || row.role)}</td>`
      + `<td>${escapeHtml(row.author || "—")}</td>`
      + `<td>${sourceLink(row)}</td></tr>`)
    .join("");
}

/* Contender repos for "Sources & further reading", also manifest-driven so a
 * newly bundled contender shows up without editing the page. */
export function renderContenderLinksHTML(models) {
  return pilotRows(models)
    .filter((row) => row.id !== DEFAULT_PILOT_ID && row.source)
    .map((row) => `<li><a href="${escapeHtml(row.source)}" target="_blank" rel="noreferrer">${escapeHtml(row.label)}</a></li>`)
    .join("");
}
