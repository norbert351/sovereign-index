// Sovereign Index engine — pure integer math, no money as float.
// weights are micro-of-1e6 (sum = 1_000_000); values are micro-USD (1e6 = $1).
import crypto from "node:crypto";

export const ONE = 1_000_000n; // weight basis (1e6)

// Renormalize user target weights (micro-of-1e6, sum need not be 1e6) to sum 1e6.
export function normalizeWeights(weights) {
  const sum = Object.values(weights).reduce((a, b) => a + BigInt(b), 0n);
  if (sum <= 0n) throw new Error("target weights must sum > 0");
  const out = {};
  for (const [tk, w] of Object.entries(weights)) out[tk] = (BigInt(w) * ONE) / sum;
  // re-add any remainder to the largest entry so sum === ONE exactly
  const now = Object.values(out).reduce((a, b) => a + b, 0n);
  if (now !== ONE) {
    const top = Object.keys(out).sort((a, b) => (out[b] > out[a] ? 1 : -1))[0];
    out[top] += ONE - now;
  }
  return out;
}

// Given positions {ticker: rawBalance} and prices {ticker: {micro: BigInt}},
// compute per-asset value, total NAV and current weight (micro-of-1e6).
export function portfolioState(positions, prices) {
  const value = {};
  let total = 0n;
  let missing = 0;
  for (const [tk, bal] of Object.entries(positions)) {
    const p = prices[tk];
    if (!p || p.micro == null) { value[tk] = null; missing++; continue; }
    const v = BigInt(bal) * p.micro;
    value[tk] = v;
    total += v;
  }
  const weights = {};
  if (total > 0n) {
    for (const [tk, v] of Object.entries(value)) {
      weights[tk] = v == null ? null : (v * ONE) / total;
    }
  }
  return { value, total, weights, missing };
}

// Relative drift of each asset vs its target, in bps (target > 0).
// driftBps[tk] = (weight - target) / target * 1e4  (integer bps, sign-preserving)
export function driftBps(weights, targets) {
  const out = {};
  for (const [tk, target] of Object.entries(targets)) {
    const w = weights[tk];
    if (w == null || target == null || target <= 0n) { out[tk] = null; continue; }
    out[tk] = ((w - target) * 10_000n) / target;
  }
  return out;
}

export function maxAbsDriftBps(drift) {
  return Object.values(drift)
    .filter((v) => v != null)
    .reduce((m, v) => (v < 0n ? -v : v) > m ? (v < 0n ? -v : v) : m, 0n);
}

// Build a rebalance order set that converges positions toward target weights
// within the current NAV. Self-funding by construction: the cash freed by sells
// is the budget that funds buys (clamped to total need), so no external cash is
// ever required and no value is created or destroyed beyond floor dust.
// order: { ticker, action: 'BUY'|'SELL', qty: BigInt, usdMicro: BigInt }
export function planRebalance(positions, prices, targets) {
  const { total } = portfolioState(positions, prices);
  const sells = [];       // {ticker, delta<0, qty, freedUsd, price}
  const needs = [];       // {ticker, delta>0, needUsd, price}
  let freed = 0n, needSum = 0n;
  for (const [tk, target] of Object.entries(targets)) {
    const p = prices[tk];
    if (!p || p.micro == null || p.micro <= 0n) { sells.push({ ticker: tk, action: "SKIP_NO_PRICE" }); continue; }
    const targetVal = (total * target) / ONE;
    const desiredQty = targetVal / p.micro;
    const cur = BigInt(positions[tk] || 0n);
    const delta = desiredQty - cur;
    if (delta > 0n) { const need = delta * p.micro; needs.push({ ticker: tk, action: "BUY", delta, price: p.micro, needUsd: need }); needSum += need; }
    else if (delta < 0n) { const freedUsd = (-delta) * p.micro; sells.push({ ticker: tk, action: "SELL", qty: -delta, usdMicro: freedUsd, price: p.micro }); freed += freedUsd; }
    else sells.push({ ticker: tk, action: "HOLD", qty: 0n, usdMicro: 0n });
  }
  // Distribute the sell-budget across buys proportional to need (deterministic order).
  const budget = freed < needSum ? freed : needSum;
  let allocated = 0n;
  for (const n of needs.sort((a, b) => (a.ticker < b.ticker ? -1 : 1))) {
    if (budget <= 0n) break;
    const share = (n.needUsd * budget) / (needSum || 1n);
    // ensure the very last buyer gets exactly the remainder so sum == budget
    const last = n === needs[needs.length - 1] && budget > 0n ? budget - allocated : share;
    const qty = last / n.price;
    const usdMicro = qty * n.price;
    sells.push({ ticker: n.ticker, action: "BUY", qty, usdMicro, price: n.price });
    allocated += usdMicro;
  }
  return { orders: sells, total };
}

// Deterministic, tamper-evident decision hash over the ordered plan.
export function signManifest({ chainId, indexId, nonce, ts, targets, prices, orders }) {
  const canonical = {
    chainId: chainId.toString(),
    indexId: String(indexId),
    nonce: String(nonce),
    ts,
    targets: Object.fromEntries(Object.entries(targets).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, v.toString()])),
    prices: Object.fromEntries(Object.keys(prices).sort().map((k) => [k, prices[k]?.micro?.toString() ?? null])),
    orders: orders
      .sort((a, b) => (a.ticker < b.ticker ? -1 : 1))
      .map((o) => ({ t: o.ticker, a: o.action, q: o.qty.toString(), u: o.usdMicro?.toString() ?? "0" })),
  };
  const json = JSON.stringify(canonical); // no whitespace
  return { hash: "SOV-" + crypto.createHash("sha256").update(json).digest("hex"), json };
}