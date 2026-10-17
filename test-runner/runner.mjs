import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { chromium } from "playwright";

const rootDir = process.env.WORKSPACE_DIR || "/game";
const artifactsDir = process.env.ARTIFACTS_DIR || "/artifacts";
const galleryDir = path.join(artifactsDir, "gallery");
fs.mkdirSync(galleryDir, { recursive: true });

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".onnx": "application/octet-stream",
  ".whl": "application/zip"
};

const server = http.createServer((req, res) => {
  let reqPath = req.url.split("?")[0];
  if (reqPath === "/") reqPath = "/index.html";
  const filePath = path.join(rootDir, reqPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "application/octet-stream" });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
});

server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const localUrl = `http://127.0.0.1:${port}/`;
  const targetUrl = "https://lunar.livive.net/";

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: artifactsDir,
      size: { width: 1280, height: 720 }
    }
  });

  const page = await context.newPage();
  const startMs = Date.now();

  try {
    await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(async () => {
      await page.goto(localUrl, { waitUntil: "domcontentloaded" });
    });

    // Wait for POST boot sequence to finish and #start-game to become visible
    await page.locator("#start-game").waitFor({ state: "visible", timeout: 15000 }).catch(async () => {
      await page.keyboard.press("Space");
      await page.waitForTimeout(1500);
    });

    // 1. Attract Cabinet Screen
    await page.waitForTimeout(2200);
    await page.screenshot({ path: path.join(galleryDir, "01-attract-cabinet.png") });

    // 2. Cabinet Manual Modal
    const aboutBtn = page.locator("#cabinet-about");
    if (await aboutBtn.isVisible().catch(() => false)) {
      await aboutBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: path.join(galleryDir, "02-cabinet-manual.png") });
      await page.locator("#about-close").click().catch(() => {});
      await page.waitForTimeout(800);
    } else {
      await page.screenshot({ path: path.join(galleryDir, "02-cabinet-manual.png") });
    }

    // 3. Mode Selection -> Solo Mode Select
    await page.locator("#start-game").click().catch(async () => {
      await page.keyboard.press("Space");
    });
    await page.waitForTimeout(1000);
    await page.locator('button[data-screen="solomode"]').first().click().catch(() => {});
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(galleryDir, "03-solo-mode-select.png") });

    // 4. Choose Your Pilot (9 Trained ONNX Policies)
    await page.locator('button[data-solo-mode="policy"]').first().click().catch(() => {});
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(galleryDir, "04-choose-pilot.png") });

    // 5. Launch AI Pilot & Capture Live Policy Inspector Early Flight
    await page.locator("#pilot-cards button").first().click().catch(() => {});
    await page.waitForTimeout(4500);
    await page.screenshot({ path: path.join(galleryDir, "05-ai-pilot-policy-inspector.png") });

    // 6. Watch AI Pilot Approach Landing Zone & Capture Final Telemetry
    await page.waitForTimeout(6500);
    await page.screenshot({ path: path.join(galleryDir, "06-lunar-touchdown-telemetry.png") });

    const elapsed = Date.now() - startMs;
    if (elapsed < 30500) {
      await page.waitForTimeout(30500 - elapsed);
    }
  } catch (err) {
    console.error("Error during showcase choreography:", err);
  } finally {
    const video = page.video();
    await context.close();
    await browser.close();
    server.close();

    if (video) {
      const videoPath = await video.path();
      const destVideo = path.join(artifactsDir, "demo.webm");
      if (fs.existsSync(videoPath)) {
        fs.copyFileSync(videoPath, destVideo);
        try {
          fs.unlinkSync(videoPath);
        } catch {}
      }
    }
  }
});
