/* Unit check for the bundled pixel-font @font-face src URLs (AIA-49).
 *
 * The stylesheet is served from /styles/fonts.css, so a bare
 * "assets/fonts/..." src resolves to /styles/assets/fonts/... and 404s on the
 * live site. This asserts each src resolves to a real file at /assets/fonts/
 * when resolved relative to the stylesheet's own URL.
 *
 * Run: node --test tests/fonts.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = resolve(repoRoot, "styles/fonts.css");
// The browser resolves src URLs against the stylesheet's fetched URL, which is
// /styles/fonts.css — mirror that here instead of the repo root.
const sheetUrl = pathToFileURL(cssPath);

test("every @font-face src resolves to a real bundled font file", () => {
  const css = readFileSync(cssPath, "utf8");
  const sources = [...css.matchAll(/@font-face\s*{[^}]*src:\s*url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
  assert.equal(sources.length, 2, "expected Press Start 2P and VT323 @font-face rules");
  for (const src of sources) {
    const resolved = fileURLToPath(new URL(src, sheetUrl));
    assert.ok(
      resolved.includes(`${resolve(repoRoot, "assets/fonts")}/`),
      `${src} should resolve into assets/fonts/, got ${resolved}`,
    );
    assert.ok(existsSync(resolved), `${src} resolves to a missing file: ${resolved}`);
  }
});

test("font preloads in index.html point at the same shipped files", () => {
  const html = readFileSync(resolve(repoRoot, "index.html"), "utf8");
  for (const name of ["press-start-2p-latin.woff2", "vt323-latin.woff2"]) {
    assert.ok(html.includes(`assets/fonts/${name}`), `index.html should preload ${name}`);
    assert.ok(existsSync(resolve(repoRoot, "assets/fonts", name)), `assets/fonts/${name} should exist`);
  }
});
