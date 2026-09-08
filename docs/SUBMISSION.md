# Sovereign Index — Submission Kit (Base Builder Quest)

Paste-ready answers for the quest entry. *Verifier: run the commands under each section against the live URL before pasting.*

## Project

- **Name:** Sovereign Index
- **One-line pitch:** *Tell it your mix (tickers + weights, or a one-click preset); the Sovereign Index agent builds and keeps your personalized index of Coinbase Tokenized Stocks on Base balanced 24/7 — autonomously, on live Chainlink prices, with every decision auditable.*
- **Live URL:** https://sovereign-index.onrender.com
- **Repo (public):** https://github.com/norbert351/sovereign-index
- **Theme aligned to:** Base's **"Request for Builders: Tokenized Stocks"** design lane **#2 — Personalized Index Creation** (with the autonomy/memes-and-agents lane as the presentational angle: "an agent that allocates into tokenized stocks on its own").

## Text description (project)

Sovereign Index is a self-custodied, set-and-forget personalized index of Coinbase Tokenized Stocks (B20) on Base mainnet. The user states exactly what they want to own — target tickers + weights, or a one-click preset (Mag-7 Blend, Megacap Core, AI & Semis, Crypto Equities, Innovation Mix) — and an autonomous agent maintains it 24/7: it reads **live Chainlink Total-Return prices** for every holding, measures drift from the target, and **self-rebalances** (selling over-weights to fund under-weights, no external cash) on a 60-second sweep under its own identity. Recurring **DCA** mints new capital into the index by target weight on a scheduled cadence. Every decision is recorded in a deterministic, tamper-evident `SOV-` manifest, and a `/plan` dry-run layer shows the exact orders the agent will execute before it acts. The engine is a software-callable surface (REST), so the index runs autonomously and can be driven by wallets/agents.

Honest scope: execution runs against a **paper ledger at the live Chainlink price** and is labeled `simulated` everywhere — B20 settlement is policy-gated to authorized venues (general DEX aggregators return "no route"), which is the disclosed seam where a real authorized-venue router slots in. Prices, weights, drift and all decisions are real (verified live on Base mainnet); token movement is simulated and clearly labeled. **No US users** — Reg-S geo-gating is enforced at the app layer (403) mirroring the token's onchain policy.

## Verification / replication guide

```
# 1. Live prices (real Chainlink Total-Return on Base mainnet)
curl -s https://sovereign-index.onrender.com/api/prices
#    -> { geo, prices: { NVDAc:{usd, micro, updatedAt}, AAPLc:…, … } }  real USD values

# 2. Intent presets
curl -s https://sovereign-index.onrender.com/api/presets

# 3. Create an index from a preset
curl -s -X POST https://sovereign-index.onrender.com/api/indexes \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo","preset":"Mag-7 Blend","seedUsd":5000}'
#    -> { id, weights, subset }

# 4. Dry-run decision layer (see the agent's EXACT intended orders before it acts)
curl -s https://sovereign-index.onrender.com/api/indexes/<id>/plan

# 5. Trigger an immediate DCA deposit (mints paper capital by target weight)
curl -s -X POST https://sovereign-index.onrender.com/api/indexes/<id>/deposit

# 6. Geo/Reg-S gate (US origin is blocked — quest rule)
curl -s https://sovereign-index.onrender.com/api/prices -H 'X-Forwarded-For: 8.8.8.8'
#    -> { geo: { allowed:false, country:"US", reason:"US-origin restricted (Regulation S…)" } }
```

Local run: `node --version` (≥22.5) → `npm run smoke` (**18/18** tests) → `npm start` → open `http://localhost:8080`.

## Verified / unverified matrix

| Claim | Verified (how) | Unverified |
|---|---|---|
| Live on Base mainnet (chain 8453) | `CHAIN_ID=8453`, 13 B20 addresses + feed proxies in `src/config.js` match `base.org/stocks`; live `/api/prices` | — |
| Real Chainlink prices | `eth_call latestRoundData()` per feed, live HTTP 200 with real USD values + `updatedAt` | — |
| Autonomy (agent on a schedule) | 60s sweep in `src/agent.js`; `/plan` shows real intended orders; signed `SOV-` manifests observed |
| Geo/Reg-S gate | Live `X-Forwarded-For: 8.8.8.8` → US 403 | Full per-jurisdiction B20 allow-list (not enumerated in-app) |
| 18/18 tests | `npm run smoke` green | — |
| Repo public | `github.com/norbert351/sovereign-index`, remote `main` | — |
| **Onchain settlement** | — | **NOT wired** — `simulated` paper at live Chainlink price (disclosed, labeled) |
| Demo video | — | Not yet recorded (recommended before submit) |

## Demo video (recommended before submit)

Record a short live screencast of the working URL — create an index from a preset, hit `/plan` (show the intended orders), trigger `/deposit` (watch NAV rise + a `SOV-` manifest return), and show the US geo-block — then host it (YouTube preferred) and add the link here + to the README.

## Submission deadline

**Sep 9, 2026 11:59pm EST** (03:59 UTC Sep 10). Submit early.