import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeWeights, portfolioState, driftBps, maxAbsDriftBps, planRebalance, signManifest,
} from "../src/engine.js";

const ONE = 1_000_000n;

const P = {
  NVDAc: { micro: 231_970_000n },
  TSLAc: { micro: 356_080_000n },
  AAPLc: { micro: 318_450_000n },
};

test("normalizeWeights renormalizes to sum 1e6 and keeps remainder", () => {
  const w = normalizeWeights({ NVDAc: 600_000n, TSLAc: 400_000n });
  const sum = Object.values(w).reduce((a, b) => a + b, 0n);
  assert.equal(sum, ONE);
});

test("portfolioState computes NAV and weights from positions + live prices", () => {
  // 1 NVDA @ ~$232 + 1 TSLA @ ~$356
  const pos = { NVDAc: 1n, TSLAc: 1n };
  const st = portfolioState(pos, P);
  assert.equal(st.total, P.NVDAc.micro + P.TSLAc.micro);
  const nvdaW = (P.NVDAc.micro * ONE) / st.total;
  assert.equal(st.weights.NVDAc, nvdaW);
  assert.ok(st.weights.NVDAc + st.weights.TSLAc === ONE || st.weights.NVDAc + st.weights.TSLAc === ONE - 1n || st.weights.NVDAc + st.weights.TSLAc === ONE + 1n);
});

test("driftBps is relative and sign-preserving", () => {
  // weight 60%, target 50% -> +20%
  const d = driftBps({ NVDAc: 600_000n }, { NVDAc: 500_000n });
  assert.equal(d.NVDAc, 2000n);
  const d2 = driftBps({ NVDAc: 400_000n }, { NVDAc: 500_000n });
  assert.equal(d2.NVDAc, -2000n);
});

test("maxAbsDriftBps ignores unpriceable entries", () => {
  assert.equal(maxAbsDriftBps({ A: 1200n, B: null, C: -3500n }), 3500n);
});

test("planRebalance converges to target and is self-funding", () => {
  const pos = { NVDAc: 100n, TSLAc: 0n };
  const targets = { NVDAc: 500_000n, TSLAc: 500_000n };
  const { orders, total } = planRebalance(pos, P, targets);
  assert.ok(total > 0n);
  let buyU = 0n, sellU = 0n;
  for (const o of orders) {
    if (o.action === "BUY") buyU += o.usdMicro;
    if (o.action === "SELL") sellU += o.usdMicro;
  }
  // self-funding: buys never exceed realized sells (whole-token granularity leaves only cash)
  assert.ok(buyU <= sellU, `buys ${buyU} exceed sells ${sellU}`);
  // leftover is unfundable whole-token dust only, not a systematic leak
  assert.ok(sellU - buyU < total / 20n, "leftover cash too large");

  // applying the plan must converge weights close to target (whole-token tolerance)
  const next = { ...pos };
  for (const o of orders) {
    if (o.action === "BUY") next[o.ticker] += o.qty;
    if (o.action === "SELL") next[o.ticker] -= o.qty;
  }
  const st = portfolioState(next, P);
  const tol = 30_000n; // 3% in weight basis
  assert.ok(st.weights.NVDAc >= targets.NVDAc - tol && st.weights.NVDAc <= targets.NVDAc + tol, `NVDAc weight ${st.weights.NVDAc}`);
  assert.ok(st.weights.TSLAc >= targets.TSLAc - tol && st.weights.TSLAc <= targets.TSLAc + tol, `TSLAc weight ${st.weights.TSLAc}`);
});

test("signManifest is deterministic per state, changes with nonce", () => {
  const base = { chainId: 8453n, indexId: 1, nonce: 1, ts: 1000, targets: { NVDAc: 500_000n }, prices: P, orders: [{ ticker: "NVDAc", action: "BUY", qty: 1n, usdMicro: 231n }] };
  const a = signManifest(base);
  const b = signManifest(base);
  assert.equal(a.hash, b.hash);
  const c = signManifest({ ...base, nonce: 2 });
  assert.notEqual(c.hash, a.hash);
});