# Sovereign Index — Technical Reference

## Stack & runtime

- **Node.js ≥ 22.5** (uses built-in `node:sqlite`), ESM (`"type": "module"`), **zero runtime dependencies** (`"dependencies": {}`).
- **SQLite** persistence via `node:sqlite` (`DatabaseSync`).
- **Base mainnet** JSON-RPC (`eth_call`) for Chainlink feed reads — no web3 SDK needed.
- **Server-Sent Events** for the live agent-decision stream.
- Deploy: Render free-tier web service (`render.yaml`), one origin serves UI + API.

## Data model (`src/db.js`)

| Table | Key fields |
|---|---|
| `indexes` | id, name, weights (JSON: ticker → micro ×1e6), drift_threshold_bps, seed_usd_micro, dca_usd_micro, dca_period_days, dca_next_ts |
| `positions` | indexId, ticker, qty (BigInt raw units) |
| `agent_state` | indexId, nonce, status, last_run_ts |
| `log` | indexId, action (DEPOSIT/REBALANCE), ticker, qty, usd_micro, px_micro, ref (SOV- hash), decision_hash, created_ts |

All money in **integer micro-USD** (`1_000_000n = $1`); weights are micro-of-1e6 (`500_000n = 50%`). No floats.

## Core algorithm: drift-triggered, self-funding rebalance

1. **Value holdings** — `valueMicro(rawBalance, price) = rawBalance × price.micro` per position, where `price.micro` comes from the live Chainlink Total-Return feed (USD ×1e8 answer → `/100` = micro-USD per token; the feed already includes the B20 multiplier, so no separate dividend/split math on our side).
2. **Compute NAV + drift** — `navMicro = Σ valueMicro`. For each holding, `weight = valueMicro / NAV`, then `driftBps = (weight − target) × 10_000 / target`.
3. **Trigger** — when `maxDriftBps > driftThresholdBps` (default 300 = 3%), rebalance.
4. **Plan (self-funding)** — `planRebalance` builds BUY/SELL orders such that **buys ≤ realized sells** (no external cash needed): total buy budget = amount from selling over-weights, floored to **whole tokens**; leftover is honest cash dust. Whole-token granularity means exact target weights may be off by a fractional token — a test asserts `buy ≤ sell`, never exact equality.
5. **Sign** — every decision is hashed into `SOV-<sha256(chainId ‖ indexId ‖ nonce ‖ targets ‖ prices ‖ orders)>`. Deterministic per state; changing the nonce changes the hash → replay/tamper-evident. The same nonce discipline is shared by DCA deposits (a deposit increments the nonce so no `SOV-` collision with a following rebalance).

## Chains / addresses (Base mainnet, `CHAIN_ID = 8453`)

The 13 constituent **Coinbase Tokenized Stock (B20)** contracts and their **Chainlink Total-Return feed proxies** are hard-coded in `src/config.js` (matched against `base.org/stocks`):

| Ticker | B20 contract | Chainlink feed proxy |
|---|---|---|
| NVDAc | `0xb200…8C` | `0x04689a41629776563E6822F76f2e57D148d28513` |
| METAc | `0xb200…7C` | `0x6526aE6797A76123638b863AeE4dD27Ba4E4b27D` |
| AAPLc | `0xb200…fb` | `0x787f13dEa48Db0897CbCDD985de77809D837F988` |
| GOOGLc | `0xb200…B7` | `0x5bF49E0ffA937CE2FfF033c739aD7C634c4D34F2` |
| AMZNc | `0xb200…E8` | `0x06A8E4b3aBB3B7543d8396FB2B763d22820cB295` |
| MSFTc | `0xB200…2B` | `0xeB10A6c9aa7E537aEd766C08c35Dae35B321b18c` |
| MSTRc | `0xb200…3d` | `0xB3cE282CD188b35DA0E38D8Bc7d58e33173D202a` |
| SNDKc | `0xb200…c5` | `0x388b0dC46C0Fb05A74BeE0994fa5b02c6Fcca2eA` |
| SPCXc | `0xb200…B5` | `0x6A634B235903C4ad6376892180d6fF8612e3Fa68` |
| TSLAc | `0xb200…D0` | `0xFaf869185383a24F8cb00e27BdA6b63B9905DCb4` |
| COINc | `0xb200…fb` | `0x408e44f504A7371a345F03a73dDC96A4b48e8aa7` |
| CRCLc | `0xB200…4D` | `0x0231cF2635D1E17bB5c2462cc7504Ba1fBd61f33` |
| INTCc | `0xB200…BC` | `0xAB657C39bac0D5886250D70849e2E3E008F2EECB` |

### Chainlink read path (`src/chainlink.js`)

- `rpcCall("eth_call", [{to: feed, data: SIG.latestRoundData /* 0xfeaf968c */}, "latest"])` against public Base mainnet RPCs, with **endpoint failover** (`SOV_RPC_URLS`: `mainnet.base.org`, `base-rpc.publicnode.com`, `1rpc.io/base`), **429/5xx backoff** (3 attempts), and a 10s abort.
- ABI decode of the returned tuple `(uint80 roundId, int256 answer, uint256, uint256 updatedAt, uint80)` — takes `word(1)` as the signed 256-bit answer (USD ×1e8).
- **Per-asset inflight coalescing** (one shared promise per address, deleted in `.finally()`) + 30s TTL cache → concurrent readers reuse a single RPC read; a 13-feed sweep is ~4–12s, a 2-ticker subset ~0.4s. `SOV_CACHE_MS` tunes TTL.
- `mainnet.base.org` 429s on parallel bursts — hence bounded concurrency (pool = 4) + failover.

## Agent loop (`src/agent.js`)

- **60s sweep** (`DEFAULT_REBALANCE_INTERVAL_MS`) over all indexes: check DCA due → `depositDue()` mints paper capital by target weight (increments nonce, schedules next), then check drift → rebalance.
- **`withIndexLock`** serializes evaluate→execute per index so a manual `/rebalance` and the sweep can't double-apply or collide on a nonce.
- `POST /api/indexes/:id/rebalance` forces a rebalance; `POST /api/indexes/:id/deposit` triggers an immediate DCA deposit (demo/agent call); `POST /api/indexes/:id/plan` runs the **dry-run decision layer** (drift + exact orders, no write) so judges see the agent's intent before it acts.
- Execution is `simulated` at the live Chainlink price — the honest, labeled seam where an authorized-venue B20 router would be called (0x/CoW return "no route" for B20, verified).

## Geo-gate (`src/geogate.js`)

- Per-request IP → country via `freeipapi.com/api/json/<ip>` (5s abort, 5-min cache).
- **BLOCKLIST = {US}** → `403 { allowed:false, reason:"US-origin restricted (Regulation S — non-US eligible only)" }`.
- `SOV_GEO=strict` also denies unknown/local IPs; `demo` allows unknown but still hard-blocks US.
- Internal/loopback networks (`10.`, `127.`, `192.168.`, `172.16-31`, `::1`) return `LK` (loopback).

## Test suite — 18/18 passing

- **`test/engine.test.js`** — engine maths: weight normalization, drift bps, self-funding `planRebalance` (asserts `buy ≤ sell`), deterministic `signManifest` (nonce changes the hash).
- **`test/dca.test.js`** — DCA deposit unit (in-memory `node:sqlite`, synthetic prices, no network): mints by target weight, increments nonce, schedules next.
- **`test/server.test.js`** — live server e2e against **real Chainlink prices** on Base mainnet: presets, create-by-preset, create-by-weights, DCA, plan (dry-run), deposit, rebalance (signed `SOV-`), and the **US/unknown geo-block** (403).

Run: `npm run smoke`.

## Deployment (`render.yaml`)

- Free-tier web service (long-lived process — the SSE stream + 60s sweep need it), `runtime: node`, `buildCommand: ""`, `startCommand: node src/index.js`, `healthCheckPath: /health`, `NODE_VERSION: 22`.
- **Static routing:** `/` serves the marketing `landing.html`; `/app` serves the product `app.html`; both **GET and HEAD** are supported for static files (so link-previewers/validators get correct headers). A publicly-served demo video lives at **`/sovereign-index-demo.mp4`** (`video/mp4`) so the quest form's "Demo Video Link" is a stable, playable URL.
- `SOV_GEO=demo`, `SOV_EXEC=simulated`, `SOV_SEED_ON_BOOT=1` (a fresh deploy seeds a demo index so the dashboard isn't empty for judges).
- A keep-alive job pings `/health` every ~10m so Render free-tier never cold-sleeps an active link.
- CSS/JS fonts load from Fontshare + Google Fonts via CDN (Zodiak serif display, General Sans body, JetBrains Mono data).

## Known, honest limits

- **Onchain settlement is not wired** — B20 transfer policy is allow-list/authorized-venue only, and this is not merely a `0x` limitation. **Verified (2026-09-09):** general aggregators (0x, 1inch, CoW) return "no route", AND the official Base/Aerodrome swap tooling (`sugar-sdk` v0.4.0, the Base MCP Aerodrome plugin) does **not resolve the B20 stock token as a routable token** (`USDC→NVDAc` → `token not found`, while the WETH/USDC control pair resolves fine). Real settlement would require a **custom, pool-direct integration against an authorized Aerodrome venue** on Base mainnet plus real mainnet capital — there is **no testnet version** of these assets to develop against. This is why execution ships as a disclosed, labeled simulation at the live Chainlink price. Not a hidden gap.
- **SQLite runtime state is ephemeral on Render** — the DB is git-ignored and wiped on redeploy; `SOV_SEED_ON_BOOT=1` re-seeds a clean demo index. Not a bug — a judge arriving after a redeploy sees a fresh seeded index.
- **24/5 prices** — Chainlink equity feeds hold last close on weekends/holidays (standard market-data behavior), so weekend NAV is flat at the last close.