// Sovereign Index NEW-UI live demo driver (landing + /app + good closure), CommonJS
const puppeteer = require("puppeteer");
const fs = require("node:fs");

const URL = "https://sovereign-index.onrender.com";
const INDEX = "MegaTech Focus";
const start = Date.now();
const marks = [];
function mark(phase) { marks.push({ phase, t: ((Date.now() - start) / 1000).toFixed(2) }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function safeEval(page, fn, ...args) {
  for (let i = 0; i < 8; i++) {
    try { return await page.evaluate(fn, ...args); }
    catch (e) { if (/detached Frame/i.test(String(e))) { await sleep(250); continue; } throw e; }
  }
}
async function safeClick(page, sel, label) {
  const ok = await safeEval(page, (s) => { const el = document.querySelector(s); if (!el) return false; el.click(); return true; }, sel);
  if (!ok) throw new Error("click missed: " + (label || sel));
  await sleep(300);
}
function waitForText(page, sel, text, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = async () => {
      while (Date.now() - t0 < timeout) {
        try {
          const found = await safeEval(page, (s, t) => [...document.querySelectorAll(s)].some((e) => e.textContent.includes(t)), sel, text);
          if (found) return resolve(true);
        } catch {}
        await sleep(350);
      }
      reject(new Error("timeout waiting " + sel + " " + text));
    };
    poll();
  });
}
function waitSel(page, sel, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = async () => {
      while (Date.now() - t0 < timeout) {
        try {
          const found = await safeEval(page, (s) => document.querySelectorAll(s).length > 0, sel);
          if (found) return resolve(true);
        } catch {}
        await sleep(300);
      }
      reject(new Error("timeout " + sel));
    };
    poll();
  });
}
const scrollTo = (page, sel) => safeEval(page, (s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ behavior: "smooth", block: "start" }); return !!el; }, sel);

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: "/home/ubuntu/.cache/puppeteer/chrome/linux-152.0.7977.42/chrome-linux64/chrome",
    args: ["--window-position=0,0", "--window-size=1280,720", "--no-first-run", "--no-default-browser-check", "--disable-dev-shm-usage", "--no-sandbox"],
    defaultViewport: { width: 1280, height: 720 },
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  fs.writeFileSync("/tmp/driver-live-pid", String(process.pid));

  // ---- LANDING: hero + live panel ----
  await page.goto(URL + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForText(page, "h1", "Your personal index");
  await waitSel(page, "#pNav");           // live panel populated
  await sleep(1000);
  mark("landing-hero");
  await sleep(6000);

  // scroll through landing sections (triggers reveal animations + ticker)
  await scrollTo(page, "#what"); await sleep(2500); mark("landing-what");
  await scrollTo(page, "#how"); await sleep(2500); mark("landing-how");
  await scrollTo(page, "section.showcase-wrap"); await sleep(2500); mark("landing-showcase");
  await scrollTo(page, "#dev"); await sleep(2500); mark("landing-dev");
  await scrollTo(page, "section:last-of-type"); await sleep(2000); mark("landing-cta");

  // ---- PRODUCT: /app ----
  await page.goto(URL + "/app", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForText(page, "#idxlist", "AI & Consumer");
  mark("app-dash");
  await sleep(4000);

  await safeClick(page, '#nav [data-v="new"]', "new");
  await sleep(1200);
  await page.type('#n_name', INDEX);
  await sleep(600);
  const presetOk = await safeEval(page, () => {
    const b = [...document.querySelectorAll('#presets button')].find((x) => x.textContent.includes("Mag-7 Blend"));
    if (b) { b.click(); return true; } return false;
  });
  if (!presetOk) throw new Error("preset not found");
  mark("app-new");
  await sleep(2000);
  await safeClick(page, "#n_create", "create");
  await waitForText(page, "#idxlist .card", INDEX);
  mark("app-created");
  await sleep(1500);
  const opened = await safeEval(page, (name) => {
    const card = [...document.querySelectorAll('#idxlist .card')].find((e) => e.textContent.includes(name));
    if (!card) return false; card.click(); return true;
  }, INDEX);
  if (!opened) throw new Error("open created");
  await waitSel(page, "#d_holdings table");
  mark("app-detail");
  await sleep(7000);

  await safeEval(page, () => { const i = document.querySelector('#dc_usd'); if (i) { i.value = "5000"; i.dispatchEvent(new Event('input', { bubbles: true })); } return !!i; });
  await sleep(400);
  await safeClick(page, "#dc_set", "set-dca");
  mark("app-dcaset");
  await sleep(2500);
  await safeClick(page, "#dc_dep", "deposit-now");
  await waitForText(page, "#d_log .log", "DEPOSIT");
  mark("app-deposit");
  await sleep(7000);

  // real prices JSON
  const p2 = await browser.newPage();
  await p2.goto(URL + "/api/prices", { waitUntil: "domcontentloaded", timeout: 40000 });
  await sleep(1500); mark("app-prices"); await sleep(5000);
  await p2.close();

  // ---- GOOD CLOSURE: back to landing CTA band "Tell it your mix" ----
  await page.goto(URL + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForText(page, "h1", "Your personal index");
  await scrollTo(page, "section:last-of-type");      // CTA band
  await sleep(800);
  mark("close-band");
  await sleep(6000);

  fs.writeFileSync("/home/ubuntu/sovereign-index/demo/timeline.json", JSON.stringify(marks, null, 2));
  await browser.close();
  console.log("DONE:", JSON.stringify(marks));
  process.exit(0);
})().catch((e) => { console.error("DRIVER ERROR:", e && e.message || e); try { fs.writeFileSync("/home/ubuntu/sovereign-index/demo/timeline.json", JSON.stringify(marks, null, 2)); } catch {} process.exit(2); });