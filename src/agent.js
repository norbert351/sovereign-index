// Sovereign Index agent — the autonomous rebalancer.
// Owns the "set-and-forget" mechanism: on its own schedule it reads live Chainlink
// prices, measures drift vs the user's target weights, and executes a self-funding
// rebalance (sells -> buys) whenever drift exceeds threshold. Every decision is
// captured in a deterministic, tamper-evident manifest hash.
import { EventEmitter } from "node:events";
import {
  normalizeWeights, portfolioState, driftBps, maxAbsDriftBps, planRebalance, signManifest,
} from "./engine.js";
import { readFeedAnswer, fetchAllPrices } from "./chainlink.js";
import { assetByTicker, EXECUTION_MODE, MICRO } from "./config.js";
import {
  setPositions, logRebalance, setAgentState, savePriceSnapshot, getIndex, listIndexes,
} from "./db.js";

export const agentBus = new EventEmitter();

export function pricesFromCacheOrFetch() {
  // future: can use fetchAllPrices with cache; here we rely on chainlink's internal cache
  return fetchAllPrices();
}

function qtyString(v) { return String(v); }

export async function evaluateIndex(db, id, prices) {
  const idx = getIndex(db, id);
  if (!idx) return null;
  const targets = idx.weights;
  const positions = idx.positions;
  const state = portfolioState(positions, prices);
  const drift = driftBps(state.weights, targets);
  const maxDrift = maxAbsDriftBps(drift);
  const plan = planRebalance(positions, prices, targets);
  return { idx, state, drift, maxDrift, plan };
}

// Execute a planned rebalance for one index into the paper ledger (simulated at
// live prices) and append the signed manifest + per-order log rows.
export function executePlan(db, id, { state, drift, maxDrift, plan }, prices) {
  const idx = getIndex(db, id);
  const agent = idx.agent;
  const nonce = agent.nonce + 1;
  // apply deltas to positions
  const pos = { ...idx.positions };
  const trades = [];
  for (const o of plan.orders) {
    if (o.action === "BUY") pos[o.ticker] = (pos[o.ticker] || 0n) + o.qty;
    if (o.action === "SELL") pos[o.ticker] = (pos[o.ticker] || 0n) - o.qty;
  }
  // deterministic manifest over the whole plan
  const manifest = signManifest({
    chainId: 8453n,
    indexId: id,
    nonce,
    ts: Date.now(),
    targets: idx.weights,
    prices,
    orders: plan.orders,
  });
  // persist positions
  setPositions(db, id, pos);
  // per-order rows
  for (const o of plan.orders) {
    if (o.action === "BUY" || o.action === "SELL") {
      logRebalance(db, {
        indexId: id, action: o.action, ticker: o.ticker, qty: o.qty,
        usdMicro: o.usdMicro, pxMicro: prices[o.ticker]?.micro ?? 0n,
        ref: manifest.hash, decisionHash: manifest.hash,
      });
    }
  }
  // agent state
  setAgentState(db, id, {
    nonce,
    status: "rebalanced",
    last_run_ts: Date.now(),
    last_rebalance_ts: Date.now(),
    last_drift_bps: Number(maxDrift),
  });
  // broadcast
  agentBus.emit("event", { type: "rebalance", indexId: id, hash: manifest.hash, maxDrift: Number(maxDrift), mode: EXECUTION_MODE });
  return { hash: manifest.hash, executed: trades.length, mode: EXECUTION_MODE };
}

// Run the full sweep across all indexes. force=true executes even if drift < threshold.
export async function runSweep(db, { force = false } = {}) {
  const ids = listIndexes(db).map((r) => r.id);
  if (ids.length === 0) return { scanned: 0, rebalanced: [] };
  const prices = await pricesFromCacheOrFetch();
  savePriceSnapshot(db, JSON.stringify(prices));
  const outcomes = [];
  for (const id of ids) {
    const ev = await evaluateIndex(db, id, prices);
    if (!ev) { continue; }
    setAgentState(db, id, { status: ev.maxDrift > ev.idx.drift_threshold_bps ? "drift" : "within", last_run_ts: Date.now(), last_drift_bps: Number(ev.maxDrift) });
    const rebalanceNow = force || ev.maxDrift > ev.idx.drift_threshold_bps;
    if (rebalanceNow && ev.plan.total > 0n) {
      const r = executePlan(db, id, ev, prices);
      outcomes.push({ indexId: id, rebalanced: true, hash: r.hash, maxDrift: Number(ev.maxDrift), mode: r.mode });
    } else {
      outcomes.push({ indexId: id, rebalanced: false, maxDrift: Number(ev.maxDrift) });
    }
  }
  return { scanned: ids.length, rebalanced: outcomes, mode: EXECUTION_MODE };
}

// Manual trigger for a single index (programmatically callable = software surface).
export async function runIndexNow(db, id) {
  const idx = getIndex(db, id);
  if (!idx) return { error: "index not found" };
  const prices = await fetchAllPrices();
  const ev = await evaluateIndex(db, id, prices);
  if (!ev) return { error: "index unavailable" };
  setAgentState(db, id, { status: ev.maxDrift > ev.idx.drift_threshold_bps ? "drift" : "within", last_run_ts: Date.now(), last_drift_bps: Number(ev.maxDrift) });
  const r = executePlan(db, id, ev, prices);
  return { indexId: id, rebalanced: true, hash: r.hash, maxDrift: Number(ev.maxDrift), mode: r.mode };
}

// The agent loop. Call db via a fresh connection each sweep (sqlite is single-process
// and WAL-safe; reuse the passed db).
export function startAgent(db, intervalMs = 60_000) {
  const h = setInterval(async () => {
    try { await runSweep(db); } catch (e) { agentBus.emit("event", { type: "error", msg: String(e.message || e) }); }
  }, intervalMs);
  return { stop: () => clearInterval(h), bus: agentBus };
}