// Sovereign Index — configuration
// Coinbase Tokenized Stocks on Base = B20 tokens (ERC-20 extension).
// Canonical token list: https://www.base.org/stocks
// Chainlink feed proxies: Base "Tokenized Stocks on Base" B20 spec
//   (Total-Return USD per token; 8 decimals; auto-applies the B20 multiplier).

export const CHAIN_ID = 8453n; // Base

// Public Base mainnet RPC (works over IPv4).
export const RPC_URL = process.env.SOV_RPC_URL || "https://mainnet.base.org";

// USD is expressed in micro-units (1e6 = $1) in the ledger.
export const MICRO = 1_000_000n;

// Feed decimals (Chainlink V3 answers) and the scaled price per raw token unit.
export const FEED_DECIMALS = 8n;

// Chainlink AggregatorV3Interface selectors.
export const SIG = {
  latestRoundData: "0xfeaf968c",
  decimals: "0x313ce567",
};

// Thresholds
export const DEFAULT_DRIFT_THRESHOLD_BPS = 300;   // 3.00% drift triggers a rebalance
export const DEFAULT_REBALANCE_INTERVAL_MS = 60_000; // agent checks every 60s (demo)
export const DCA_DAILY_MICRO = 0n; // optional standing DCA deposit, default off

// Geo-gating: Base's stock tokens are Reg-S, available only OUTSIDE the US.
// SOV_GEO=strict blocks US + unknown; demo allows unknown to be treated as eligible
// but still hard-blocks US.
export const GEO = process.env.SOV_GEO || "strict";

// EXECUTION_MODE=simulated (default, paper trade at live Chainlink price) | live
// Live execution is policy-gated on B20 (authorized venues only); the seam is
// the honest place where a real authorized-venue router would be called.
export const EXECUTION_MODE = process.env.SOV_EXEC || "simulated";

// ---------------------------------------------------------------------------
// Asset registry: token address -> { ticker, name, feed }
// All 1:1-backed Coinbase Tokenized Stocks (B20) with their Total-Return feeds.
// ---------------------------------------------------------------------------
export const ASSETS = [
  { addr: "0xb20000000000000000000078ee7ce2fE4908108C", ticker: "NVDAc", name: "NVIDIA",        feed: "0x04689a41629776563E6822F76f2e57D148d28513" },
  { addr: "0xb2000000000000000000008bC8786B856E61707C", ticker: "METAc", name: "Meta",          feed: "0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D" },
  { addr: "0xb200000000000000000000C2e324d24d7eEcd1fb", ticker: "AAPLc", name: "Apple",         feed: "0x787f13dEa48Db0897CbCDD985de77809D837F988" },
  { addr: "0xb2000000000000000000002D0BA3164cc74f58B7", ticker: "GOOGLc",name: "Alphabet",      feed: "0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2" },
  { addr: "0xb200000000000000000000d9192b6B456483C2E8", ticker: "AMZNc", name: "Amazon",        feed: "0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295" },
  { addr: "0xB200000000000000000000Ab99cFa739E253872B", ticker: "MSFTc", name: "Microsoft",     feed: "0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c" },
  { addr: "0xb2000000000000000000004884b426556b92883d", ticker: "MSTRc", name: "MicroStrategy", feed: "0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a" },
  { addr: "0xb200000000000000000000397293Cb8cda9a10c5", ticker: "SNDKc", name: "SanDisk",       feed: "0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA" },
  { addr: "0xb2000000000000000000007b9fcbd005511aCBd5", ticker: "SPCXc", name: "SpaceX",        feed: "0x6A634B235903C4ad6376892180d6fF8612e3Fa68" },
  { addr: "0xb2000000000000000000001e800a7f5189430cD0", ticker: "TSLAc", name: "Tesla",         feed: "0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4" },
  { addr: "0xb200000000000000000000c85a31389D71F3ecfb", ticker: "COINc", name: "Coinbase",      feed: "0x408e44f504A7371a345F03a73dDC96A4b48e8aa7" },
  { addr: "0xB20000000000000000000019f6E7C675b73C2e4D", ticker: "CRCLc", name: "Circle",        feed: "0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33" },
  { addr: "0xB2000000000000000000004AFF16039bA04bdFBc", ticker: "INTCc", name: "Intel",         feed: "0xAB657C39bac0D5886250D70849e2E3E008F2EECB" },
].map((a) => ({ ...a, addr: a.addr.toLowerCase(), feed: a.feed.toLowerCase() }));

export function assetByAddress(addr) {
  return ASSETS.find((a) => a.addr === String(addr).toLowerCase());
}

export function assetByTicker(t) {
  return ASSETS.find((a) => a.ticker.toLowerCase() === String(t).toLowerCase());
}

// Intent presets — one-click "describe your mix" starting points (weights in micro, sum 1e6).
export const PRESETS = {
  "AI & Semis": { NVDAc: 500_000n, TSLAc: 250_000n, MSFTc: 250_000n },
  "Mag-7 Blend": { NVDAc: 250_000n, TSLAc: 200_000n, AAPLc: 150_000n, MSFTc: 150_000n, AMZNc: 100_000n, GOOGLc: 100_000n, METAc: 50_000n },
  "Megacap Core": { AAPLc: 250_000n, MSFTc: 250_000n, GOOGLc: 200_000n, AMZNc: 150_000n, METAc: 150_000n },
  "Crypto Equities": { COINc: 400_000n, MSTRc: 400_000n, NVDAc: 200_000n },
  "Innovation Mix": { NVDAc: 400_000n, TSLAc: 300_000n, MSTRc: 300_000n },
};

export function presetList() {
  return Object.entries(PRESETS).map(([name, weights]) => ({
    name,
    weights: Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v.toString()])),
  }));
}