// Sovereign Index agent — the autonomous rebalancer + DCA scheduler.
// Owns the "set-and-forget" mechanism: on its own schedule it reads live Chainlink
// prices, measures drift vs the user's target weights, executes a self-funding
// rebalance when drift exceeds threshold, and mints scheduled DCA deposits by
// target weight. Every decision is captured in a deterministic, tamper-evident
// manifest hash. Per-index execution is serialized so concurrent callers never
// read stale positions or collide manifest nonces.
import { EventEmitter } from "node:events";
import {
  portfolioState, driftBps, maxAbsDriftBps, planRebalance, signManifest, ONE,
} from "./engine.js";
import { fetchAllPrices } from "./chainlink.js";
import { EXECUTION_MODE } from "./config.js";
import {
  setPositions, logRebalance, setAgentState, savePriceSnapshot, getIndex, listIndexes, updateDca,
} from "./db.js";

export const agentBus = new EventEmitter();

// Per-index execution queue: serializes evaluate+execute so a 60s sweep and a
// manual rebalance can't interleave on the same ledger.
const queues = new Map();
function withIndexLock(id, fn) {
  const prev = queues.get(id) || Promise.resolve();
  const next = prev
    .then(fn, fn)
    .then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));
  queues.set(id, next.catch(() => {})); // keep queue alive across a rejected run
  return next.then((r) => (r.ok ? r.v : Promise.reject(r.e)));
}

export function pricesFromCacheOrFetch() {
  return fetchAllPrices();
}

function numDrift(d) {
  return Object.values(d).filter((v) => v != null).reduce((m, v) => { const a = v < 0n ? -v : v; return a > m ? a : m; }, 0n);
}

// Evaluate one index against a price set (read-only decision layer).
export async function evaluateIndex(db, id, prices) {
  const idx = getIndex(db, id);
  if (!idx) return null;
  const state = portfolioState(idx.positions, prices);
  const drift = driftBps(state.weights, idx.weights);
  const maxDrift = numDrift(drift);
  const plan = planRebalance(idx.positions, prices, idx.weights);
  return { idx, state, drift, maxDrift, plan };
}

// Execute a planned rebalance into the paper ledger at live prices and append
// the signed manifest + per-order log rows. Call inside withIndexLock.
function executePlan(db, id, { state, maxDrift, plan }, prices) {
  const idx = getIndex(db, id);
  const agent = idx.agent;
  const nonce = agent.nonce + 1;
  const pos = { ...idx.positions };
  for (const o of plan.orders) {
    if (o.action === "BUY") pos[o.ticker] = (pos[o.ticker] || 0n) + o.qty;
    if (o.action === "SELL") pos[o.ticker] = (pos[o.ticker] || 0n) - o.qty;
  }
  const manifest = signManifest({
    chainId: 8453n, indexId: id, nonce, ts: Date.now(), targets: idx.weights, prices, orders: plan.orders,
  });
  setPositions(db, id, pos);
  for (const o of plan.orders) {
    if (o.action === "BUY" || o.action === "SELL") {
      logRebalance(db, {
        indexId: id, action: o.action, ticker: o.ticker, qty: o.qty,
        usdMicro: o.usdMicro, pxMicro: prices[o.ticker]?.micro ?? 0n,
        ref: manifest.hash, decisionHash: manifest.hash,
      });
    }
  }
  setAgentState(db, id, {
    nonce, status: "rebalanced", last_run_ts: Date.now(), last_rebalance_ts: Date.now(), last_drift_bps: Number(maxDrift),
  });
  agentBus.emit("event", { type: "rebalance", indexId: id, hash: manifest.hash, maxDrift: Number(maxDrift), mode: EXECUTION_MODE });
  return { hash: manifest.hash, executed: plan.orders.filter((o) => o.action === "BUY" || o.action === "SELL").length, mode: EXECUTION_MODE };
}

// Execute a scheduled DCA deposit: mint `dcaUsdMicro` of new paper capital by
// target weight at live prices. Increments the manifest nonce (no collisions
// with a following rebalance) and schedules the next deposit. Call in-lock.
// Returns { depositedMicro } or null when not due.
export function depositDue(db, id, prices) {
  const idx = getIndex(db, id);
  if (!idx?.dca || !idx.dca.usd_micro || Number(idx.dca.usd_micro) <= 0) return null;
  if (!idx.dca.next_ts || Date.now() < Number(idx.dca.next_ts)) return null;
  const amount = BigInt(idx.dca.usd_micro);
  const period = Number(idx.dca.period_days || 7);
  const targets = idx.weights;
  const nonce = idx.agent.nonce + 1;
  const pos = { ...idx.positions };
  const orders = [];
  let deposited = 0n;
  for (const [tk, w] of Object.entries(targets)) {
    const p = prices[tk];
    if (!p || p.micro == null) continue;
    const usdForTk = (amount * w) / ONE;
    const qty = usdForTk / BigInt(p.micro);
    if (qty <= 0n) continue;
    pos[tk] = (pos[tk] || 0n) + qty;
    orders.push({ ticker: tk, action: "DEPOSIT", qty, usdMicro: qty * BigInt(p.micro) });
    deposited += qty * BigInt(p.micro);
  }
  if (deposited <= 0n) return null;
  const manifest = signManifest({
    chainId: 8453n, indexId: id, nonce, ts: Date.now(), targets, prices, orders,
  });
  setPositions(db, id, pos);
  for (const o of orders) logRebalance(db, {
    indexId: id, action: "DEPOSIT", ticker: o.ticker, qty: o.qty,
    usdMicro: o.usdMicro, pxMicro: prices[o.ticker]?.micro ?? 0n,
    ref: manifest.hash, decisionHash: manifest.hash,
  });
  updateDca(db, id, { dcaUsdMicro: amount, dcaPeriodDays: period }); // schedules next
  setAgentState(db, id, { nonce, status: "deposited", last_run_ts: Date.now() });
  agentBus.emit("event", { type: "deposit", indexId: id, amount: deposited.toString(), next_ts: Date.now() + period * 86_400_000 });
  return { depositedMicro: deposited, orderCount: orders.length };
}

// Dry-run plan for one index (decision layer, no execution).
export async function planIndex(db, id, prices) {
  const ev = await evaluateIndex(db, id, prices);
  if (!ev) return null;
  return {
    maxDriftBps: ev.maxDrift.toString(),
    driftThresholdBps: ev.idx.drift_threshold_bps,
    orders: ev.plan.orders.map((o) => ({ ticker: o.ticker, action: o.action, qty: o.qty.toString(), usdMicro: (o.usdMicro ?? 0n).toString() })),
    navMicro: ev.state.total.toString(),
  };
}

// Immediate deposit (programmatic/simulation trigger) for a demo or an agent call.
export async function runDepositNow(db, id) {
  const idx = getIndex(db, id);
  if (!idx) return { error: "index not found" };
  const prices = await pricesFromCacheOrFetch();
  return withIndexLock(id, async () => {
    if (!idx.dca?.usd_micro || Number(idx.dca.usd_micro) <= 0) {
      return { rebalanced: false, reason: "no DCA schedule — set one via /api/indexes/:id/dca first" };
    }
    // force-due then deposit once
    db.prepare("UPDATE indexes SET dca_next_ts = ? WHERE id=?").run(Date.now() - 1000, id);
    const res = depositDue(db, id, prices);
    if (!res) {
      return { rebalanced: false, reason: "amount too small to deploy even one whole token of a constituent" };
    }
    return { rebalanced: true, depositedMicro: res.depositedMicro.toString(), orderCount: res.orderCount, mode: EXECUTION_MODE };
  });
}

// Run the full sweep across all indexes: DCA deposits first, then drift rebalance.
export async function runSweep(db, { force = false } = {}) {
  const ids = listIndexes(db).map((r) => r.id);
  if (ids.length === 0) return { scanned: 0, rebalanced: [] };
  const prices = await pricesFromCacheOrFetch();
  savePriceSnapshot(db, JSON.stringify(prices));
  const outcomes = [];
  for (const id of ids) {
    const out = await withIndexLock(id, async () => {
      try {
        const ev = await evaluateIndex(db, id, prices);
        if (!ev) return { rebalanced: false, error: "missing" };
        depositDue(db, id, prices); // scheduled DCA first
        const state = portfolioState(getIndex(db, id).positions, prices);
        const drift = driftBps(state.weights, ev.idx.weights);
        const maxDrift = numDrift(drift);
        setAgentState(db, id, { status: maxDrift > ev.idx.drift_threshold_bps ? "drift" : "within", last_run_ts: Date.now(), last_drift_bps: Number(maxDrift) });
        const rebalanceNow = force || maxDrift > ev.idx.drift_threshold_bps;
        if (rebalanceNow && ev.plan.total > 0n) {
          const plan = planRebalance(getIndex(db, id).positions, prices, ev.idx.weights);
          const r = executePlan(db, id, { state, maxDrift, plan }, prices);
          return { rebalanced: true, hash: r.hash, maxDrift: Number(maxDrift) };
        }
        return { rebalanced: false, maxDrift: Number(maxDrift) };
      } catch (e) {
        return { rebalanced: false, error: String(e.message || e) };
      }
    });
    outcomes.push({ indexId: id, ...out });
  }
  return { scanned: ids.length, rebalanced: outcomes, mode: EXECUTION_MODE };
}

// Manual trigger for a single index (programmatically callable = software surface).
export async function runIndexNow(db, id) {
  if (!getIndex(db, id)) return { error: "index not found" };
  const prices = await pricesFromCacheOrFetch();
  return withIndexLock(id, async () => {
    const ev = await evaluateIndex(db, id, prices);
    if (!ev) return { error: "index unavailable" };
    const plan = planRebalance(getIndex(db, id).positions, prices, ev.idx.weights);
    if (plan.total <= 0n) return { rebalanced: false, reason: "no holdings" };
    setAgentState(db, id, { last_run_ts: Date.now(), last_drift_bps: Number(ev.maxDrift) });
    const r = executePlan(db, id, { state: ev.state, maxDrift: ev.maxDrift, plan }, prices);
    return { indexId: id, rebalanced: true, hash: r.hash, maxDrift: Number(ev.maxDrift), mode: EXECUTION_MODE };
  });
}

// The agent loop. Call db via a fresh connection each sweep (sqlite is single-process
// and WAL-safe; reuse the passed db).
export function startAgent(db, intervalMs = 60_000) {
  const h = setInterval(async () => {
    try { await runSweep(db); } catch (e) { agentBus.emit("event", { type: "error", msg: String(e.message || e) }); }
  }, intervalMs);
  return { stop: () => clearInterval(h), bus: agentBus };
}