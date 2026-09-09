// Sovereign Index — HTTP server (zero-dep node:http). Serves dashboard + REST + SSE.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { openDB } from "./db.js";
import { createIndex, getIndex, listIndexes, setPositions, setAgentState, logRebalance, updateDca } from "./db.js";
import { normalizeWeights, portfolioState, driftBps, maxAbsDriftBps, planRebalance, signManifest } from "./engine.js";
import { fetchAllPrices, fetchPrices } from "./chainlink.js";
import { ASSETS, EXECUTION_MODE, GEO, assetByTicker, PRESETS, presetList } from "./config.js";
import { geoCheck } from "./geogate.js";
import { runSweep, runIndexNow, agentBus, planIndex, runDepositNow } from "./agent.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = Number(process.env.PORT || 8080);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".ico": "image/x-icon",
};

const db = openDB();

// ---- helpers ----------------------------------------------------------------
function json(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req, cap = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > cap) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { reject(new Error("invalid json")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname, isHead = false) {
  let file = path.normalize(pathname);
  if (file === "/" || file === "") file = "/landing.html";
  else if (file === "/app" || file === "/app/") file = "/app.html";
  if (file.includes("..")) return json(res, 403, { error: "forbidden" });
  const abs = path.join(PUBLIC_DIR, file);
  if (!abs.startsWith(PUBLIC_DIR)) return json(res, 403, { error: "forbidden" });
  if (!existsSync(abs) || !statSync(abs).isFile()) return json(res, 404, { error: "not found", path: pathname });
  const ext = path.extname(abs).toLowerCase();
  res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream", "Cache-Control": "no-store" });
  if (isHead) return res.end(); // HEAD: headers only, no body
  res.end(readFileSync(abs));
}

function usd(micro) {
  if (micro == null) return null;
  const n = Number(BigInt(micro));
  return (n / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// qty of one token whose value is `usdMicro` micro-USD at `priceMicro` micro-USD/token
function qtyFor(usdMicro, priceMicro) {
  if (priceMicro <= 0n) return 0n;
  return usdMicro / BigInt(priceMicro);
}

// compute a read model for an index with live prices
function indexViewModel(idx, prices) {
  const targets = idx.weights;
  const state = portfolioState(idx.positions, prices);
  const drift = driftBps(state.weights, targets);
  constraints: {
    // maxAbsDrift computed only on priced assets
  }
  let maxDrift = 0n;
  for (const v of Object.values(drift)) if (v != null) { const a = v < 0n ? -v : v; if (a > maxDrift) maxDrift = a; }
  const holdings = idx.weights ? Object.keys(idx.weights).map((tk) => {
    const p = prices[tk];
    const bal = idx.positions[tk] || 0n;
    const val = state.value[tk];
    const w = state.weights[tk];
    return {
      ticker: tk,
      qty: bal.toString(),
      priceUsd: p && p.micro != null ? usd(p.micro) : null,
      valueUsd: val != null ? usd(val) : null,
      weightMicro: w != null ? w.toString() : null,
      targetMicro: targets[tk] ? targets[tk].toString() : null,
      driftBps: drift[tk] != null ? drift[tk].toString() : null,
    };
  }) : [];
  return {
    id: idx.id,
    name: idx.name,
    navUsd: usd(state.total),
    navMicro: state.total.toString(),
    maxDriftBps: maxDrift.toString(),
    driftThresholdBps: idx.drift_threshold_bps,
    mechanism: EXECUTION_MODE,
    dca: {
      usd: idx.dca && idx.dca.usd_micro ? idx.dca.usd_micro.toString() : "0",
      periodDays: idx.dca ? idx.dca.period_days : 7,
      nextTs: idx.dca ? idx.dca.next_ts : null,
    },
    holdings,
    agent: {
      status: idx.agent.status,
      nonce: idx.agent.nonce,
      lastRun: idx.agent.last_run_ts,
      lastRebalance: idx.agent.last_rebalance_ts,
      lastDriftBps: idx.agent.last_drift_bps,
    },
    log: (idx.log || []).slice(0, 20),
  };
}

// Seed a demo index on boot when the DB is empty (SOV_SEED_ON_BOOT=1).
async function maybeSeedDemo() {
  if (listIndexes(db).length > 0) return;
  const weights = normalizeWeights({ NVDAc: 500_000n, TSLAc: 300_000n, AAPLc: 200_000n });
  const id = createIndex(db, { name: "AI & Consumer", weights, thresholdBps: 300, seedUsdMicro: 10_000_000_000n });
  const px = await fetchPrices(Object.keys(weights));
  const pos = {};
  for (const [tk, w] of Object.entries(weights)) {
    const p = px[tk];
    if (p && p.micro != null) pos[tk] = qtyFor((10_000_000_000n * w) / 1_000_000n, BigInt(p.micro));
  }
  setPositions(db, id, pos);
  setAgentState(db, id, { status: "seeded", last_run_ts: Date.now() });
  console.log(`seeded demo index #${id} (${Object.keys(pos).length} holdings)`);
}

// ---- routes ----------------------------------------------------------------
async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const method = req.method;
  const cors = () => {
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return true;
    }
    return false;
  };
  if (cors()) return;

  // --- public meta / prices --------------------------------------------------
  if (method === "GET" && p === "/health") {
    return json(res, 200, {
      ok: true, name: "sovereign-index", mechanism: EXECUTION_MODE, geo: GEO,
      chainId: "8453",
      deadline: "2026-09-10T03:59:00.000Z", // Sep 9 11:59pm EST
      assets: ASSETS.length,
    });
  }

  if (method === "GET" && p === "/api/meta") {
    const g = await geoCheck(req);
    return json(res, 200, {
      geo: g,
      assets: ASSETS.map((a) => ({ ticker: a.ticker, name: a.name, addr: a.addr, feed: a.feed })),
      executionMode: EXECUTION_MODE,
      agentIntervalMs: 60_000,
    });
  }

  if (method === "GET" && p === "/api/presets") {
    return json(res, 200, { presets: presetList() });
  }

  if (method === "GET" && p === "/api/prices") {
    const g = await geoCheck(req);
    const px = await fetchAllPrices();
    return json(res, 200, {
      geo: g,
      prices: Object.fromEntries(Object.entries(px).map(([k, v]) => [k, v.error ? { error: v.error } : { usd: usd(v.micro), micro: v.micro.toString(), updatedAt: v.updatedAt }])),
    });
  }

  // --- indexes: reads --------------------------------------------------------
  if (method === "GET" && p === "/api/indexes") {
    const ids = listIndexes(db);
    const px = await fetchAllPrices();
    const out = ids.map((row) => {
      const idx = getIndex(db, row.id);
      return indexViewModel(idx, px);
    });
    return json(res, 200, { indexes: out });
  }

  const idxMatch = p.match(/^\/api\/indexes\/(\d+)$/);
  const rebalMatch = p.match(/^\/api\/indexes\/(\d+)\/rebalance$/);
  const dcaMatch = p.match(/^\/api\/indexes\/(\d+)\/dca$/);
  const planMatch = p.match(/^\/api\/indexes\/(\d+)\/plan$/);
  const depositMatch = p.match(/^\/api\/indexes\/(\d+)\/deposit$/);
  if (method === "GET" && idxMatch) {
    const idx = getIndex(db, Number(idxMatch[1]));
    if (!idx) return json(res, 404, { error: "index not found" });
    const px = await fetchAllPrices();
    return json(res, 200, indexViewModel(idx, px));
  }

  // --- indexes: writes (geo-gated) -------------------------------------------
  if (method === "POST" && p === "/api/indexes") {
    const g = await geoCheck(req);
    if (!g.allowed) return json(res, 403, { error: "geo-restricted", geo: g });
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
    const name = (body.name || "Sovereign Index").slice(0, 80);
    let name2 = name;
    let weightsIn = body.weights || {};
    if ((!weightsIn || Object.keys(weightsIn).length === 0) && body.preset && PRESETS[body.preset]) {
      weightsIn = PRESETS[body.preset];
      if (name === "Sovereign Index") name2 = "Sovereign: " + body.preset;
    }
    if (!weightsIn || Object.keys(weightsIn).length === 0) return json(res, 400, { error: "weights or a preset required" });
    for (const tk of Object.keys(weightsIn)) if (!assetByTicker(tk)) return json(res, 400, { error: `unknown ticker ${tk}` });
    const targets = normalizeWeights(weightsIn);
    const seedUsdMicro = BigInt(Math.round(Number(body.seedUsd || 0) * 1e6));
    const threshold = Number(body.driftThresholdBps || 300);
    const dcaUsdMicro = BigInt(Math.round(Number(body.dcaUsd || 0) * 1e6));
    const dcaPeriodDays = Number(body.periodDays || 7);
    const id = createIndex(db, { name: name2 || name, weights: targets, thresholdBps: threshold, seedUsdMicro, dcaUsdMicro, dcaPeriodDays });
    // allocate the paper seed across tickers at live prices
    if (seedUsdMicro > 0n) {
      // retry once on RPC hiccup so a fresh index isn't seeded at 0 NAV
      let px = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        px = await fetchPrices(Object.keys(targets));
        const anyPriced = Object.keys(targets).some((tk) => px[tk] && px[tk].micro != null);
        if (anyPriced) break;
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
      const pos = {};
      for (const [tk, w] of Object.entries(targets)) {
        const p = px[tk];
        if (p && p.micro != null) {
          const usdForTk = (seedUsdMicro * w) / 1_000_000n;
          pos[tk] = qtyFor(usdForTk, p.micro);
        }
      }
      setPositions(db, id, pos);
      setAgentState(db, id, { status: "seeded", last_run_ts: Date.now() });
    }
    return json(res, 201, {
      id, name,
      weights: Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, v.toString()])),
      subset: Object.keys(targets),
    });
  }

  if (method === "POST" && dcaMatch) {
    const g = await geoCheck(req);
    if (!g.allowed) return json(res, 403, { error: "geo-restricted", geo: g });
    const id = Number(dcaMatch[1]);
    if (!getIndex(db, id)) return json(res, 404, { error: "index not found" });
    let body;
    try { body = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
    const dcaUsdMicro = BigInt(Math.round(Number(body.dcaUsd || 0) * 1e6));
    const periodDays = Number(body.periodDays || 7);
    const updated = updateDca(db, id, { dcaUsdMicro, dcaPeriodDays: periodDays });
    return json(res, 200, { ok: true, id, dca: { usd: updated.dca.usd_micro.toString(), periodDays: updated.dca.period_days, nextTs: updated.dca.next_ts } });
  }

  if (method === "POST" && depositMatch) {
    const g = await geoCheck(req);
    if (!g.allowed) return json(res, 403, { error: "geo-restricted", geo: g });
    const id = Number(depositMatch[1]);
    if (!getIndex(db, id)) return json(res, 404, { error: "index not found" });
    const r = await runDepositNow(db, id);
    return json(res, 200, r);
  }

  if (method === "GET" && planMatch) {
    const id = Number(planMatch[1]);
    const idx = getIndex(db, id);
    if (!idx) return json(res, 404, { error: "index not found" });
    const px = await fetchPrices(Object.keys(idx.weights));
    const plan = await planIndex(db, id, px);
    if (!plan) return json(res, 404, { error: "index unavailable" });
    return json(res, 200, plan);
  }

  if (method === "POST" && rebalMatch) {
    const g = await geoCheck(req);
    if (!g.allowed) return json(res, 403, { error: "geo-restricted", geo: g });
    const id = Number(rebalMatch[1]);
    if (!getIndex(db, id)) return json(res, 404, { error: "index not found" });
    const r = await runIndexNow(db, id);
    return json(res, 200, r);
  }

  // --- SSE agent stream ------------------------------------------------------
  if (method === "GET" && p === "/api/agent/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`event: hello\ndata: {"ok":true}\n\n`);
    const onEvent = (e) => { try { res.write(`event: event\ndata: ${JSON.stringify(e)}\n\n`); } catch {} };
    agentBus.on("event", onEvent);
    const hb = setInterval(() => { try { res.write(`: ping\n\n`); } catch {} }, 15_000);
    req.on("close", () => { agentBus.off("event", onEvent); clearInterval(hb); });
    return;
  }

  // --- static / fallback -----------------------------------------------------
  if (method === "GET" || method === "HEAD") return serveStatic(req, res, url.pathname, method === "HEAD");
  return json(res, 404, { error: "not found", path: p });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error("[route error]", req.method, req.url, String(e?.stack || e));
    if (!res.headersSent) json(res, 500, { error: String(e.message || e) });
  });
});

server.listen(PORT, () => {
  console.log(`sovereign-index listening on :${PORT} (exec=${EXECUTION_MODE}, geo=${GEO})`);
  // Seed a demo index on a fresh DB so the deployed dashboard isn't empty.
  if (String(process.env.SOV_SEED_ON_BOOT || "").trim() === "1") {
    maybeSeedDemo().catch((e) => console.error("seed demo failed:", e.message || e));
  }
});

// Start the autonomous rebalancer every 60s.
const agentTimer = setInterval(async () => {
  try { await runSweep(db); } catch (e) { /* surface via bus */ }
}, 60_000);
agentTimer.unref?.();

export { server, db };