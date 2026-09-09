// Sovereign Index live-demo driver — deployed URL, real clicks, records timeline.json (CommonJS)
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
function waitFor(page, sel, text, timeout = 25000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = async () => {
      while (Date.now() - t0 < timeout) {
        try {
          const found = await safeEval(page, (s, t) => {
            const els = [...document.querySelectorAll(s)];
            return t ? els.some((e) => e.textContent.includes(t)) : els.length > 0;
          }, sel, text || null);
          if (found) return resolve(true);
        } catch {}
        await sleep(350);
      }
      reject(new Error("timeout waiting " + sel + " " + (text || "")));
    };
    poll();
  });
}

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

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitFor(page, "#idxlist .card", "AI & Consumer");
  mark("dashboard");
  await sleep(5000);

  await safeClick(page, '#nav [data-v="new"]', "new");
  mark("newview");
  await sleep(1200);
  await page.type('#n_name', INDEX);
  mark("typed-name");
  await sleep(700);
  const presetOk = await safeEval(page, () => {
    const b = [...document.querySelectorAll('#presets button')].find((x) => x.textContent.includes("Mag-7 Blend"));
    if (b) { b.click(); return true; } return false;
  });
  if (!presetOk) throw new Error("preset not found");
  mark("preset");
  await sleep(1200);

  await safeClick(page, "#n_create", "create");
  await waitFor(page, "#idxlist .card", INDEX);
  mark("created");
  await sleep(4000);

  const opened = await safeEval(page, (name) => {
    const card = [...document.querySelectorAll('#idxlist .card')].find((e) => e.textContent.includes(name));
    if (!card) return false; card.click(); return true;
  }, INDEX);
  if (!opened) throw new Error("could not open created card");
  await waitFor(page, "#d_stats .stat .v");
  await waitFor(page, "#d_holdings table");
  mark("detail");
  await sleep(8000);

  await safeEval(page, () => { const i = document.querySelector('#dc_usd'); if (i) { i.value = "5000"; i.dispatchEvent(new Event('input', { bubbles: true })); } return !!i; });
  await sleep(400);
  await safeClick(page, "#dc_set", "set-dca");
  mark("dcaset");
  await sleep(3000);
  await safeClick(page, "#dc_dep", "deposit-now");
  await waitFor(page, "#d_log .log", "DEPOSIT");
  mark("deposited");
  await sleep(8000);

  const p2 = await browser.newPage();
  await p2.goto(URL + "/api/prices", { waitUntil: "domcontentloaded", timeout: 40000 });
  await sleep(1500);
  mark("prices");
  await sleep(6000);
  await p2.close();

  await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitFor(page, "#idxlist .card");
  mark("close");
  await sleep(9000);

  fs.writeFileSync("/home/ubuntu/sovereign-index/demo/timeline.json", JSON.stringify(marks, null, 2));
  await browser.close();
  console.log("DONE phases:", JSON.stringify(marks));
  process.exit(0);
})().catch((e) => { console.error("DRIVER ERROR:", e && e.message || e); try { fs.writeFileSync("/home/ubuntu/sovereign-index/demo/timeline.json", JSON.stringify(marks, null, 2)); } catch {} process.exit(2); });