# Sovereign Index — Submission Kit (Base Builder Quest)

Paste-ready answers for the quest entry. *Verifier: run the commands under each section against the live URL before pasting.*

## Official submission requirements (2026-09-09)
1. **Post a Loom demo on X explaining how the project works, tagging `@buildonbase`.**
2. **Fill the entry form** with the fields below.

## Entry form — filled

| Field | Value |
|---|---|
| **Project Name** | `Sovereign Index` |
| **What does it solve? (1–2 lines)** | `It builds and keeps a personalized, auto-rebalanced index of Coinbase Tokenized Stocks on Base. An autonomous agent manages your exact mix 24/7 on live Chainlink prices, with signed, auditable decisions — diversified onchain stock exposure without a broker or manual rebalancing.` |
| **Demo Video Link (public URL)** | `https://sovereign-index.onrender.com/sovereign-index-demo.mp4` *(served `video/mp4`, playable; also the Loom link once created)* |
| **Live Project Link (URL)** | `https://sovereign-index.onrender.com` |
| **Builder Code** | ⚠️ Your Base **ERC-8021** builder code (format `bc_xxxxxxxx`) — register/log in on **`base.dev`** (connect wallet → builder profile) to receive it; paste it here. Only your wallet can mint it. |

## Verification / replication guide

```
# 1. Live prices (real Chainlink Total-Return on Base mainnet)
curl -s https://sovereign-index.onrender.com/api/prices
#    -> { geo, prices: { NVDAc:{usd, micro, updatedAt}, AAPLc:…, … } }  real USD values

# 2. Landing (marketing) and product (app) both live
curl -s https://sovereign-index.onrender.com/        # landing title
curl -s https://sovereign-index.onrender.com/app     # product app
curl -sI https://sovereign-index.onrender.com/app     # GET/HEAD both 200

# 3. Public playable demo video (200 video/mp4 on GET and HEAD)
curl -sI https://sovereign-index.onrender.com/sovereign-index-demo.mp4

# 4. Create an index from a preset
curl -s -X POST https://sovereign-index.onrender.com/api/indexes \
  -H 'Content-Type: application/json' \
  -d '{"name":"Demo","preset":"Mag-7 Blend","seedUsd":5000}'

# 5. Dry-run decision layer (the agent's EXACT intended orders before it acts)
curl -s https://sovereign-index.onrender.com/api/indexes/<id>/plan

# 6. Immediate DCA deposit (mints paper capital by target weight, signed SOV-)
curl -s -X POST https://sovereign-index.onrender.com/api/indexes/<id>/deposit

# 7. Geo/Reg-S gate (US origin blocked — quest rule)
curl -s https://sovereign-index.onrender.com/api/prices -H 'X-Forwarded-For: 8.8.8.8'
#    -> { geo: { allowed:false, country:"US", reason:"US-origin restricted (Regulation S…)" } }
```

Local run: `node --version` (≥22.5) → `npm run smoke` (**18/18** tests) → `npm start` → open `http://localhost:8080` (landing) / `…/app` (product).

## Verified / unverified matrix

| Claim | Verified (how) | Unverified |
|---|---|---|
| Live on Base mainnet (chain 8453) | `CHAIN_ID=8453`, 13 B20 addresses + feed proxies in `src/config.js`; live `/api/prices` | — |
| Real Chainlink prices | `eth_call latestRoundData()` per feed, live HTTP 200 with real USD values + `updatedAt` | — |
| Landing (`/`) + product (`/app`) split | Live titles + `Back to landing` link present | — |
| Public playable demo video | `GET`+`HEAD` `/sovereign-index-demo.mp4` → `200 video/mp4`, valid `ftyp` | — |
| Autonomy (agent on a schedule) | 60s sweep in `src/agent.js`; `/plan` shows real intended orders; signed `SOV-` manifests observed | — |
| Geo/Reg-S gate | Live `X-Forwarded-For: 8.8.8.8` → US 403 | Full per-jurisdiction B20 allow-list (not enumerated in-app) |
| 18/18 tests | `npm run smoke` green | — |
| Repo public | `github.com/norbert351/sovereign-index`, remote `main` | — |
| **Onchain settlement** | — | **NOT wired** — `simulated` paper at live Chainlink price (disclosed, labeled). No testnet version exists (B20 + feeds are mainnet-only). Verified 2026-09-09 that standard swap tooling (0x, CoW, sugar-sdk/Base MCP) does not route the B20 stock tokens. |
| Demo video | ✅ v2 (68s, new UI) committed `docs/demo/sovereign-index-demo-v2.mp4` + public URL live | — |
| **Builder Code** | — | ⚠️ **yours** — mint on `base.dev` (reg/log in → connect wallet → `bc_…` code) |

## Demo video (public URL + Loom step)

- **Public playable URL (for the form):** `https://sovereign-index.onrender.com/sovereign-index-demo.mp4`
- **Repo copy:** `docs/demo/sovereign-index-demo-v2.mp4` (68s, 720p, narrated)
- **Loom-on-X step:** upload the same MP4 to **Loom** (`loom.com` → Upload) to get a Loom link, then **post it on X tagging `@buildonbase`** with the copy below.

**Suggested X post (tight single post, attach the Loom/video):**
> Built on **@base** — Sovereign Index: your *personal* index of Coinbase tokenized stocks, rebalanced 24/7 by an autonomous agent at live Chainlink prices. Every move signed & auditable. For non-US investors who want US-megacap exposure without a broker. State your mix, it keeps it balanced. sovereign-index.onrender.com · **@buildonbase** #BaseBuilderQuest

*(A longer 4-post thread covering tone / what / does / who-why / how-to-use is in the working notes — ask and I'll re-paste.)*

## Submission deadline

**Sep 9, 2026 11:59pm EST** (03:59 UTC Sep 10). Submit early.