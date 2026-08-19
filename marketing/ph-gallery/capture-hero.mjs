// Capture le hero anime image par image (timeline deterministe renderFrame(t)) puis
// assemble un mp4 net (@2x) + un GIF 1270x760 via ffmpeg. Aucune dependance a la vitesse
// de rendu: on pilote window.renderFrame(t) et on screenshot chaque frame.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.HOME + "/.local/bin/ffmpeg";
const FPS = 24, DURATION = 5.0, HOLD = 1.0; // 5s d'anim + 1s de pause finale
const nAnim = Math.round(FPS * DURATION), nHold = Math.round(FPS * HOLD);
const tmp = mkdtempSync(join(tmpdir(), "panoptic-hero-"));

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1270, height: 760 }, deviceScaleFactor: 2 });
await page.goto("file://" + join(HERE, "hero.html"), { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => window.__ready === true);

let f = 0;
const pad = (n) => String(n).padStart(4, "0");
for (let i = 0; i < nAnim; i++) {
  const t = i / (nAnim - 1);
  await page.evaluate((t) => window.renderFrame(t), t);
  await page.screenshot({ path: join(tmp, `f${pad(f++)}.png`) });
}
// pause sur la derniere frame
for (let i = 0; i < nHold; i++) {
  await page.evaluate(() => window.renderFrame(1));
  await page.screenshot({ path: join(tmp, `f${pad(f++)}.png`) });
}
await browser.close();
console.log(`${f} frames capturees (@2x).`);

const input = join(tmp, "f%04d.png");
// mp4 h264, net, boucle-friendly
execFileSync(FFMPEG, ["-y", "-framerate", String(FPS), "-i", input,
  "-vf", "scale=2540:1520:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "slow", "-movflags", "+faststart",
  join(HERE, "panoptic-hero.mp4")], { stdio: "ignore" });
console.log("ecrit  panoptic-hero.mp4 (2540x1520)");

// GIF 1270x760 avec palette dediee (qualite/poids)
const pal = join(tmp, "pal.png");
execFileSync(FFMPEG, ["-y", "-i", input, "-vf", "fps=" + FPS + ",scale=1270:760:flags=lanczos,palettegen=stats_mode=diff", pal], { stdio: "ignore" });
execFileSync(FFMPEG, ["-y", "-framerate", String(FPS), "-i", input, "-i", pal,
  "-lavfi", "fps=" + FPS + ",scale=1270:760:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3",
  "-loop", "0", join(HERE, "panoptic-hero.gif")], { stdio: "ignore" });
console.log("ecrit  panoptic-hero.gif (1270x760)");

rmSync(tmp, { recursive: true, force: true });
