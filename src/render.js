/* Canvas drawing: integer pixel fit, cabinet scaling, the shared scene painter,
 * and the confetti overlay. */
import { SCALE, NATIVE_W, NATIVE_H, VIEWPORT_HALF_H } from "./config.js";

const NATIVE_W_DEFAULT = NATIVE_W, NATIVE_H_DEFAULT = NATIVE_H;
export function screenPoint(point) { return [point[0] * SCALE, 400 - point[1] * SCALE]; }

function devicePixelRatioInt() { return Math.max(1, Math.round(window.devicePixelRatio || 1)); }

/* Apply the fitted device-pixel scale and return the logical (native) size so
 * callers keep drawing in 600x400 coordinates. */
export function beginPixelFrame(canvas, ctx, nativeW = NATIVE_W_DEFAULT, nativeH = NATIVE_H_DEFAULT) {
  const w = Number(canvas.dataset.logicalW) || nativeW;
  const h = Number(canvas.dataset.logicalH) || nativeH;
  const scale = Number(canvas.dataset.pixelScale) || 1;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  return { w, h };
}

/* Size a game canvas for its parent frame, at the current devicePixelRatio.
 * Hidden (zero-width) parents are left untouched so the next visible fit can
 * run. Height is intentionally not measured: the wrap grows with the canvas,
 * so a height read would be circular. */
export function fitPixelCanvas(canvas, nativeW = NATIVE_W_DEFAULT, nativeH = NATIVE_H_DEFAULT) {
  if (!canvas) return;
  const host = canvas.parentElement || canvas;
  const styles = getComputedStyle(host);
  const padX = parseFloat(styles.paddingLeft || "0") + parseFloat(styles.paddingRight || "0");
  const availW = (host.clientWidth || 0) - padX;
  if (!(availW > 0)) return;
  let fit = availW / nativeW;
  if (!isFinite(fit) || fit <= 0) fit = 1;
  // Whole-number upscale for wide frames; narrower frames shrink in CSS. Either
  // way the internal transform is a whole number of device pixels per logical
  // pixel, so the scene is never resampled by a fractional setTransform (and
  // fractional-DPR displays round to the nearest whole scale).
  const narrow = fit < 1;
  const cssScale = narrow ? fit : Math.floor(fit);
  const displayW = nativeW * cssScale;
  const deviceScale = (narrow ? 1 : cssScale) * devicePixelRatioInt();
  canvas.dataset.logicalW = String(nativeW);
  canvas.dataset.logicalH = String(nativeH);
  canvas.dataset.pixelScale = String(deviceScale);
  canvas.width = Math.max(1, Math.round(nativeW * deviceScale));
  canvas.height = Math.max(1, Math.round(nativeH * deviceScale));
  canvas.style.width = `${displayW.toFixed(2)}px`;
  canvas.style.height = `${(displayW * nativeH / nativeW).toFixed(2)}px`;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.imageSmoothingEnabled = false;
}

export function fitAllPixelCanvases() {
  // Full-bleed playfields — the attract demo and the solo game view — are CSS
  // backgrounds (canvas at 100% of a 3:2 monitor, 1:1 with the native 600x400
  // backing store), so they are not integer-fitted here.
  document.querySelectorAll(".multi-sim-card canvas").forEach((c) => fitPixelCanvas(c));
}

let pixelFitQueued = false;
export function schedulePixelFit() {
  if (pixelFitQueued) return;
  pixelFitQueued = true;
  requestAnimationFrame(() => { pixelFitQueued = false; fitAllPixelCanvases(); });
}

/* D5 — scale/letterbox the whole fixed cabinet box. The cabinet never reflows;
 * `--cab-scale = min(vw/(cab-w + margin), vh/(cab-h + margin))`. The box scales
 * up on large displays too, so it always fills as much of the viewport as its
 * aspect ratio allows instead of sitting at native size with dead space around
 * it. Re-run on resize and orientationchange. */
export function fitCabinet() {
  const cs = getComputedStyle(document.documentElement);
  const cabW = parseFloat(cs.getPropertyValue("--cab-w")) || 1060;
  const cabH = parseFloat(cs.getPropertyValue("--cab-h")) || 740;
  const margin = 8;
  const scale = Math.min(
    window.innerWidth / (cabW + margin),
    window.innerHeight / (cabH + margin)
  );
  document.documentElement.style.setProperty("--cab-scale", String(scale));
}

export function drawScene(canvas, ctx, scene, action, pcolor) {
  const { w, h } = beginPixelFrame(canvas, ctx);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0A0B10";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#8293a1";
  for (let i = 0; i < 45; i++) {
    const x = (i * 137 + 29) % w, y = (i * 71 + 19) % 275;
    ctx.globalAlpha = 0.22 + ((i * 17) % 6) / 12;
    ctx.fillRect(x, y, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
  }
  ctx.globalAlpha = 1;
  if (!scene) return;
  const terrain = scene.terrain || [];
  if (terrain.length) {
    let p = screenPoint(terrain[0][0]);
    ctx.beginPath(); ctx.moveTo(p[0], p[1]);
    for (const seg of terrain) { p = screenPoint(seg[1]); ctx.lineTo(p[0], p[1]); }
    ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
    ctx.fillStyle = "#1b2530"; ctx.fill();
    ctx.beginPath();
    p = screenPoint(terrain[0][0]); ctx.moveTo(p[0], p[1]);
    for (const seg of terrain) { p = screenPoint(seg[1]); ctx.lineTo(p[0], p[1]); }
    ctx.strokeStyle = "#697784"; ctx.lineWidth = 2; ctx.stroke();
  }
  if (scene.pad) {
    const padLeft = screenPoint([scene.pad[0], scene.pad[1]]);
    const padRight = screenPoint([scene.pad[2], scene.pad[1]]);
    ctx.strokeStyle = "#C7F36B"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(padLeft[0], padLeft[1]); ctx.lineTo(padRight[0], padRight[1]); ctx.stroke();
    ctx.fillStyle = "#C7F36B"; ctx.font = "10px 'VT323', monospace";
    ctx.fillText("LANDING ZONE", padLeft[0] + 7, padLeft[1] + 19);
  }
  for (const body of scene.bodies || []) {
    if (body.circle) {
      const c = screenPoint(body.circle.center);
      ctx.fillStyle = body.particle ? "#FF9D5C" : "#d3dde3";
      ctx.beginPath(); ctx.arc(c[0], c[1], Math.max(1, body.circle.radius * SCALE), 0, Math.PI * 2); ctx.fill();
      continue;
    }
    if (!body.vertices || !body.vertices.length) continue;
    const pts = body.vertices.map(screenPoint);
    if (body.particle) {
      ctx.fillStyle = "#FF9D5C"; ctx.beginPath(); ctx.arc(pts[0][0], pts[0][1], 2, 0, Math.PI * 2); ctx.fill();
      continue;
    }
    ctx.fillStyle = pcolor || "#e4ebef";
    ctx.strokeStyle = "#aab7c0"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  if (!scene.observation) return;
  const obs = scene.observation;
  const x = w / 2 + obs[0] * (w / 2), y = h - (obs[1] * VIEWPORT_HALF_H + 8.1) * SCALE;
  ctx.save(); ctx.translate(x, y); ctx.rotate(obs[4]);
  if (action === 2) {
    ctx.fillStyle = "#FF9D5C";
    const jitter = 3 + ((Math.floor(performance.now() / 60) % 5));
    ctx.beginPath(); ctx.moveTo(-5, 12); ctx.lineTo(0, 27 + jitter); ctx.lineTo(5, 12); ctx.fill();
  }
  if (action === 1 || action === 3) {
    const sign = action === 1 ? 1 : -1;
    ctx.fillStyle = "#75d8e6";
    ctx.beginPath(); ctx.moveTo(sign * 9, 0); ctx.lineTo(sign * 20, 4); ctx.lineTo(sign * 9, 7); ctx.fill();
  }
  ctx.restore();
}

/* ---------------------------------------------------------------- confetti */
const confettiLayers = [];
export function startConfetti(canvas, colorHex) {
  if (!canvas) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) { const ctx = canvas.getContext("2d"); ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.floor(rect.width));
  canvas.height = Math.max(1, Math.floor(rect.height));
  const palette = [colorHex || "#E5B95C", "#E5B95C", "#FFF3C4"];
  const count = canvas.width < 420 ? 8 : 16;
  const pieces = [];
  for (let i = 0; i < count; i++) {
    pieces.push({
      x: Math.random() * canvas.width, y: -20 - Math.random() * canvas.height,
      vy: 90 + Math.random() * 120, vx: (Math.random() - 0.5) * 60,
      size: 5 + Math.floor(Math.random() * 4), color: palette[i % palette.length], rot: Math.random() * Math.PI,
    });
  }
  confettiLayers.push({ canvas, ctx, pieces, life: 0 });
}
export function stopConfetti() { confettiLayers.length = 0; }
export function updateConfetti(dt) {
  for (const layer of confettiLayers) {
    const { canvas, ctx, pieces } = layer;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    layer.life += dt;
    for (const p of pieces) {
      p.y += p.vy * dt; p.x += p.vx * dt; p.rot += dt * 4;
      if (p.y > canvas.height + 12) { p.y = -12; p.x = Math.random() * canvas.width; }
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }
}
