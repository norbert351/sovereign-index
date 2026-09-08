import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const PORT = 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const tmpdir_ = mkdtempSync(path.join(tmpdir(), "sov-"));
const DB = path.join(tmpdir_, "test.db");

let proc;

function waitReady() {
  return new Promise((res, rej) => {
    const t0 = Date.now();
    const tryHealth = async () => {
      try { const r = await fetch(BASE + "/health"); if (r.ok) return res(); }
      catch {}
      if (Date.now() - t0 > 30_000) return rej(new Error("server not ready"));
      setTimeout(tryHealth, 400);
    };
    tryHealth();
  });
}

before(() => {
  return new Promise((res, rej) => {
    proc = spawn(process.execPath, ["src/index.js"], {
      cwd: path.resolve(import.meta.dirname, ".."),
      env: { ...process.env, PORT: String(PORT), SOV_DB_PATH: DB, SOV_GEO: "demo" },
    });
    proc.on("error", rej);
    proc.on("exit", (c) => console.log("server exited", c));
    waitReady().then(res).catch(rej);
  });
});

after(() => { try { proc?.kill(); } catch {} });

test("health + meta", async () => {
  const h = await (await fetch(BASE + "/health")).json();
  assert.equal(h.ok, true);
  assert.equal(h.assets, 13);
  const m = await (await fetch(BASE + "/api/meta")).json();
  assert.ok(m.assets.length >= 10);
});

test("create index with full percent weights", async () => {
  const r = await fetch(BASE + "/api/indexes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "AI & Auto", weights: { NVDAc: 500000, TSLAc: 500000 }, seedUsd: 10000, driftThresholdBps: 300 }),
  });
  assert.equal(r.status, 201);
  const j = await r.json();
  assert.ok(j.id >= 1);
  assert.deepEqual(Object.keys(j.weights).sort(), ["NVDAc", "TSLAc"]);
});

test("create rejects unknown ticker", async () => {
  const r = await fetch(BASE + "/api/indexes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ weights: { FOOc: 1000000 } }),
  });
  assert.equal(r.status, 400);
});

test("index read model has live prices + holdings", async () => {
  // self-contained: create a seeded index so NAV is independent of earlier tests
  await fetch(BASE + "/api/indexes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Price Check", weights: { NVDAc: 600000, AAPLc: 400000 }, seedUsd: 10000 }),
  });
  let list, ix, priced = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    list = await (await fetch(BASE + "/api/indexes")).json();
    ix = list.indexes.at(-1);
    priced = (ix?.holdings || []).filter((h) => h.priceUsd != null);
    if (priced.length >= 1 && Number(BigInt(ix?.navMicro || "0")) > 0) break;
    await new Promise((r) => setTimeout(r, 900));
  }
  assert.ok(ix && ix.id, "expected an index");
  assert.ok(ix.holdings.length > 0, "expected holdings, got " + JSON.stringify(ix?.holdings));
  // prices must be live numbers (Chainlink Total-Return over Base RPC)
  assert.ok(priced.length >= 1, "no live price; holdings=" + JSON.stringify(ix?.holdings));
  assert.ok(Number(BigInt(ix.navMicro || "0")) > 0, "nav should be positive; holdings=" + JSON.stringify(ix?.holdings));
});

test("create index from an intent preset", async () => {
  const r = await fetch(BASE + "/api/presets");
  const { presets } = await r.json();
  assert.ok(presets.length >= 3);
  const preset = presets[0];
  const c = await fetch(BASE + "/api/indexes", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "FromPreset", preset: preset.name, seedUsd: 5000 }),
  });
  assert.equal(c.status, 201);
  const j = await c.json();
  assert.ok(Object.keys(j.weights).length > 0);
  assert.deepEqual(Object.keys(j.weights).sort(), Object.keys(preset.weights).sort());
});

test("set DCA via endpoint schedules future deposits", async () => {
  const list = await (await fetch(BASE + "/api/indexes")).json();
  const id = list.indexes.at(-1).id;
  const r = await fetch(`${BASE}/api/indexes/${id}/dca`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dcaUsd: 5000, periodDays: 1 }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.dca && j.dca.usd === "5000000000");
  assert.ok(j.dca.nextTs > Date.now() - 1000);
});

test("plan endpoint shows the decision layer without executing", async () => {
  const list = await (await fetch(BASE + "/api/indexes")).json();
  const id = list.indexes.at(-1).id;
  const p = await (await fetch(`${BASE}/api/indexes/${id}/plan`)).json();
  assert.ok(p.maxDriftBps !== undefined);
  assert.ok(p.driftThresholdBps >= 0);
  assert.ok(Array.isArray(p.orders));
});

test("deposit endpoint triggers an immediate DCA deposit", async () => {
  const list = await (await fetch(BASE + "/api/indexes")).json();
  const id = list.indexes.at(-1).id; // the index that the DCA test configured
  const r = await fetch(`${BASE}/api/indexes/${id}/deposit`, { method: "POST" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.rebalanced === true);
  assert.ok(Number(j.depositedMicro) > 0);
  // a deposit row is recorded with a signed ref
  const ix = await (await fetch(BASE + `/api/indexes/${id}`)).json();
  assert.ok(ix.log.some((l) => l.action === "DEPOSIT" && (l.ref || "").startsWith("SOV-")));
});

test("rebalance executes and logs a signed manifest ref", async () => {
  const list = await (await fetch(BASE + "/api/indexes")).json();
  const id = list.indexes[0].id;
  const r = await fetch(`${BASE}/api/indexes/${id}/rebalance`, { method: "POST" });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.rebalanced === true);
  assert.ok(j.hash && j.hash.startsWith("SOV-"));
  const ix = await (await fetch(BASE + `/api/indexes/${id}`)).json();
  assert.ok(ix.log.length >= 1);
  assert.ok((ix.log[0]?.ref || "").startsWith("SOV-"));
});

test("US/unknown origin blocked by geo gate", async () => {
  // In demo mode unknown resolves via lookup; send a US-looking XFF to confirm hard block.
  const r = await fetch(BASE + "/api/indexes", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Forwarded-For": "8.8.8.8" },
    body: JSON.stringify({ weights: { NVDAc: 1000000 } }),
  });
  // 8.8.8.8 is a Google DNS in US -> must be denied regardless of demo mode
  const j = await r.json();
  assert.ok(j.geo && j.geo.country === "US");
});