// Chainlink V3 Total-Return price reads for Coinbase Tokenized Stocks on Base.
// Reads latestRoundData() on the per-asset feed proxy via Base mainnet JSON-RPC.
// Total-Return feed reports USD value per B20 token (auto-applies multiplier).
import { SIG, ASSETS, assetByAddress } from "./config.js";

const CACHE_TTL_MS = Number(process.env.SOV_CACHE_MS || 30_000);
export const RPC_URLS = (process.env.SOV_RPC_URLS || [
  "https://mainnet.base.org",
  "https://base-rpc.publicnode.com",
  "https://1rpc.io/base",
].join(",")).split(",").map((s) => s.trim()).filter(Boolean);

const cache = new Map(); // key -> { ts, micro, answer, updatedAt }
const inflight = new Map(); // asset addr -> shared promise for concurrent readers

async function rpcCall(method, params) {
  let lastErr = null;
  for (const rpc of RPC_URLS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(rpc, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`rpc ${res.status} ${rpc}`);
          await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
          continue;
        }
        if (!res.ok) { lastErr = new Error(`rpc http ${res.status}`); break; }
        const j = await res.json();
        if (j.error) { lastErr = new Error(`rpc err ${j.error.message || JSON.stringify(j.error)}`); break; }
        return j.result;
      } catch (e) {
        lastErr = e;
        await new Promise((r) => setTimeout(r, 150));
      }
    }
  }
  throw lastErr || new Error("all rpc endpoints failed");
}

// decode latestRoundData() tuple: (uint80, int256 answer, uint256, uint256, uint80)
function decodeRound(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const word = (i) => BigInt("0x" + (clean.slice(i * 64, i * 64 + 64) || "0"));
  let answer = word(1);
  if (answer & (1n << 255n)) answer -= 1n << 256n;
  return { answer, updatedAt: Number(word(3)) };
}

export async function readFeedAnswer(asset) {
  const key = `a:${asset.addr}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now - hit.ts < CACHE_TTL_MS) return hit;

  // coalesce concurrent readers of the same asset into one RPC read
  if (inflight.has(asset.addr)) return inflight.get(asset.addr);
  const task = (async () => {
    const res = await rpcCall("eth_call", [{ to: asset.feed, data: SIG.latestRoundData }, "latest"]);
    const { answer, updatedAt } = decodeRound(res);
    // Total-Return answer is USD×1e8 per 1 token -> micro-USD per token = answer/100
    const micro = answer / 100n;
    const out = { micro, answer, updatedAt, decimals: 8 };
    cache.set(key, { ts: Date.now(), ...out });
    return out;
  })().finally(() => inflight.delete(asset.addr));
  inflight.set(asset.addr, task);
  return task;
}

export async function readTokenDecimals(addr) {
  const a = assetByAddress(addr);
  const res = await rpcCall("eth_call", [{ to: a.addr, data: SIG.decimals }, "latest"]);
  return Number(BigInt(res));
}

// Value of `rawBalance` token units in micro-USD at the live feed price.
export function valueMicro(rawBalance, price) {
  return BigInt(rawBalance) * price.micro;
}

// Sequentially fetch current prices for all assets (avoids public-RPC 429).
// Returns { ticker: { micro, answer, updatedAt } | { error } }.
export async function fetchAllPrices() {
  return fetchPrices(ASSETS.map((a) => a.ticker));
}

// Fetch prices for a subset of tickers with bounded concurrency (default 4).
// Shares the module cache so concurrent callers reuse live reads.
export async function fetchPrices(tickers) {
  const out = {};
  const pool = 4;
  let i = 0;
  const worker = async () => {
    while (i < tickers.length) {
      const tk = tickers[i++];
      const a = ASSETS.find((x) => x.ticker === tk);
      if (!a) { out[tk] = { error: "unknown ticker" }; continue; }
      try {
        const p = await readFeedAnswer(a);
        out[tk] = { micro: p.micro, answer: p.answer.toString(), updatedAt: p.updatedAt };
      } catch (e) {
        out[tk] = { error: String(e.message || e) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(pool, tickers.length) }, worker));
  return out;
}

export function _clearCache() {
  cache.clear();
}