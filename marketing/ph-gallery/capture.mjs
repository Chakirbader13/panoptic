// Capture chaque .slide du deck en PNG 1270x760 @2x (retina) pour la galerie Product Hunt.
// Reutilise le Chromium de Playwright deja embarque par le moteur.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const deck = "file://" + join(HERE, "deck.html");

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1270, height: 760 }, deviceScaleFactor: 2 });
await page.goto(deck, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready); // s'assure que Geist est charge avant capture

const ids = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
for (const id of ids) {
  const el = await page.$("#" + id);
  await el.screenshot({ path: join(HERE, `panoptic-ph-${id}.png`) });
  console.log("ecrit  panoptic-ph-" + id + ".png");
}
await browser.close();
console.log(`\n${ids.length} slides exportees en 2540x1520 (1270x760 @2x).`);
