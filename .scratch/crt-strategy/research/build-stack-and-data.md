# CRTbot — Build Stack & Historical Data Research

> **AMENDED 2026-10-17 (scope change):** Instruments are now **GBPUSD and EURUSD only**.
> **NAS100 and SPX500 are dropped.** All index/CFD/MT5/Stooq-index material below is retained
> for reference only and is **out of scope**. The FX conclusions (HistData M1 → Parquet; Node/TS;
> Luxon; inspect-only indices) stand. Strategy is the **"Axis System"** (see
> `axis-system-ruleset.md`), not the narrow public "3 AM model".

**Date:** 2026-10-17
**Scope:** Implementation stack (language + frameworks) and historical OHLC data sources for a
multi-timeframe price-action bot with backtesting.
**Instruments (CURRENT):** GBPUSD, EURUSD (spot FX).
**Instruments (former, now out of scope):** ~~NAS100, SPX500 (index CFDs)~~.
**Required timeframes:** M15 / M30 / H1 / H4 / D1 (M1 optional, used for data ingestion and finer fills).
**Session logic:** Asia / London / New York with a "3 AM" New York-time model; all session math normalized to
America/New_York.

This document is research only — no bot code. Every claim is linked to a primary source (vendor docs, official
pricing pages, official package pages). Facts marked **[verified]** were tested live on the target machine
(Windows 11, PowerShell 5.1, 2026-10-17).

---

## 0. Environment snapshot (verified on this machine)

| Component | Status | Notes |
|---|---|---|
| OS / Shell | Windows 11, PowerShell 5.1 | win32 platform |
| Node.js | **v24.11.1** | Installed, current LTS-era runtime |
| .NET SDK | **10.0.410** (reported as 10.0.401 via `dotnet --version` family) | Installed |
| Git | 2.55 | Installed |
| Python | **BROKEN** | `python --version` fails: *"The file cannot be accessed by the system"*. PATH resolves to the WindowsApps Store stub at `C:\Users\JOSHUA\AppData\Local\Microsoft\WindowsApps\python.exe`; the `py` launcher is not installed. A real interpreter must be installed from python.org (or uv/conda) before any Python stack is viable. |

> **Headline constraint:** two of the three candidate runtimes (Node, .NET) are ready today; Python is not.
> This tilts the recommendation, and would reverse if Python is reinstalled for research work.

---

## Q1. Python vs Node.js vs .NET for this bot

### 1.1 Python — the deepest quant ecosystem, but it is not installed

Python remains the reference ecosystem for backtesting, and the frameworks are genuinely good:

| Framework | License | Status / notes |
|---|---|---|
| [backtesting.py](https://kernc.github.io/backtesting.py/doc/backtesting/backtesting.html) | AGPL-3.0 | Actively developed; the most direct fit for a bar-based backtest. `Backtest(data, strategy, ...)` accepts `cash`, `spread`, `commission` (float, entry/exit tuple, or callable), `margin`, `trade_on_close`, `finalize`, hedging. Spread is expressed as a **fraction of price** (e.g. `0.0002` for EURUSD) and is charged on both entry and exit. |
| [vectorbt](https://python.financial/guides/python-backtesting-frameworks/) | Apache-2.0 + Commons Clause (source-available) | Blazing-fast vectorized research; PRO is a separate paid product. Good for parameter sweeps, weaker for session-anchored event simulation. |
| backtrader | GPL-3.0 | No upstream release since April 2023 — avoid for new work. |
| [nautilus_trader](https://nautilustrader.io/) | LGPL-3.0 | Institutional-grade event-driven engine; notably it ships FX session utilities (Sydney/Tokyo/London/New York, UTC↔local conversion helpers) that are a useful **reference design** for CRT's session logic. |
| [QuantConnect LEAN](https://www.quantconnect.com/docs/v2/lean-engine/getting-started) | Apache-2.0 (engine) | C# core with Python 3.11 API, Lean CLI, Docker images. Heavy, but the most complete open engine. |

**Pros:** best libraries, fastest research iteration (pandas/polars), most community answers.
**Cons on this project:**
- Python is **broken on the target machine** (§0) — a non-trivial install/repair step before day one.
- backtesting.py's license is **AGPL-3.0**, which infects anything you distribute.
- CRT is mostly *custom* logic (range sweeps, session windows, multi-timeframe candle alignment) — you will write
  80% of the engine yourself regardless of framework; the ecosystem advantage shrinks accordingly.

### 1.2 Node.js / TypeScript — ready today, adequate ecosystem, one language end-to-end

Node v24.11.1 is installed. The trading-specific ecosystem is thinner but real:

- **[backtest-kit](https://www.npmjs.com/package/backtest-kit)** (npm): TypeScript toolkit covering backtest and
  live trading, with a [Pine Script](https://www.tradingview.com/pine-script-reference/) transpiler
  (`@backtest-kit/pinets`) and ccxt integration. Useful if you want Pine-style strategy prototyping, but CRT's
  multi-timeframe session model will outgrow a Pine-shaped API — treat it as optional, not the core.
- **[Tulip Indicators](https://tulipindicators.org/)** (LGPL, ANSI C core, multi-language bindings): 104
  indicators including `atr`, `adx`, `bbands`, `psar`, `stoch`, `rsi`, `macd`. LGPL is commercial-friendly. Most
  CRT logic is raw candle/range math, but ATR-style filters are common, and this gives you vetted primitives
  instead of hand-rolled TA bugs.
- **[Luxon](https://www.npmjs.com/package/luxon)** (MIT, zero dependencies, ~15.7M weekly downloads): first-class
  IANA timezone support via `Intl` — `DateTime.now().setZone("America/New_York")`. Exactly what the session model
  needs (see Q3).
- **[DuckDB Node API](https://www.npmjs.com/package/@duckdb/node-api)** (MIT, official bindings, 738k weekly
  downloads): official Windows x64 binaries, Promise-native, streaming reads, fast Parquet scans (see Q5).
- **[hyparquet](https://www.npmjs.com/package/hyparquet) + [hyparquet-writer](https://www.npmjs.com/package/hyparquet-writer)**
  (MIT): pure-JS Parquet read/write, Snappy default — the storage layer without native build pain.

**Pros:** the runtime you already have; TypeScript types are a real safety net for bar/event state machines;
DuckDB + Parquet is a first-class storage story with zero native build headaches on Windows.
**Cons:** no framework that "does the backtest for you" matches LEAN/nautilus_trader quality; you own the engine
(mitigated: the engine is ~a few hundred lines for a bar-replay CRT simulator).

### 1.3 .NET / C# — LEAN is the strongest engine, at the cost of weight

- [QuantConnect LEAN](https://www.quantconnect.com/docs/v2/lean-engine/getting-started): C# engine with C# and
  Python 3.11 APIs, `dotnet` SDK toolchain, Lean CLI, and Docker images. The most complete open-source event
  engine available, including brokerage models and fee/slippage configurations.
- .NET SDK 10 is already installed on this machine.

**Pros:** LEAN's data model, fee/slippage, and live-trading path are production-grade; C# is a strong fit for a
long-lived bot.
**Cons:** steep project weight (project files, Lean CLI, data-format ceremony) for what is, right now, a research
bot; the learning curve is LEAN-shaped, not strategy-shaped; overkill until/unless you go live with real capital.

### 1.4 Verdict on Q1

**Node.js/TypeScript, with a hand-rolled bar-replay engine, is the right default for CRTbot today.** It matches
the installed toolchain, keeps one language across data pipeline → engine → (future) execution, and the storage
and timezone primitives you need (DuckDB, Parquet, Luxon) are all MIT, actively maintained, and Windows-clean.
.NET/LEAN is the runner-up if the project graduates to live institutional-grade execution. Python (backtesting.py
or vectorbt) is the best *research* environment in a vacuum — but it is not installed here, and its advantage is
largely irrelevant to a bespoke multi-timeframe price-action engine. Full reasoning in the Recommendation.

---

## Q2. Historical data sources (per instrument)

### 2.1 What is actually scarce

CRT needs **M15+ bars with correct session boundaries**, plus D1. The scarce resource is *deep intraday history
for the two index CFDs*; FX has multiple genuinely free deep sources.

| Source | Granularity | Depth (FX) | Depth (indices) | Cost / key / limits | License |
|---|---|---|---|---|---|
| **HistData.com** ([spec](https://www.histdata.com/f-a-q/data-files-detailed-specification/), [downloads](https://www.histdata.com/download-free-forex-data/)) | M1 bars, ticks; ASCII / MT4 / MT5 / Excel / MetaStock / NinjaTrader | **EURUSD & GBPUSD from 2000/May** [verified listing] | CFD-style index files exist but shallow: `NSX/USD` (NASDAQ-100 cash) and `SPX/USD` (S&P 500 cash) and `UKX/GBP` from **2010/Nov** [verified listing] | **Free** CSV zip downloads; optional **$7/mo** for FTP/SFTP or Google-Drive auto-updates | Free for personal use; paid automation tiers |
| **Dukascopy** via [dukascopy-node](https://www.dukascopy-node.app/) (npm) | tick, s1, m1, m5, m15, m30, h1, h4, d1, mn1 | **1990–present** [instrument site] | `usa500idxusd`: d1/mn1 to **1980**, h1/h4 from 2011-09, m1/m5+ from 2011–2012, ticks from 2012 [instrument page]; `usatechidxusd` (US 100 Tech Index) exists with the same family | Free; no key; **but blocked from this machine** — see risk R1 | [Dukascopy ToU](https://www.dukascopy.com/swiss/english/legal-pages/terms-of-use/): non-commercial personal use; no database-building/redistribution |
| **Massive (formerly Polygon.io)** ([pricing](https://massive.com/pricing?product=indices), [indices product](https://massive.com/indices)) | minute + daily aggregates, flat files, websockets | FX available | Indices: **Basic $0** = limited tickers, EOD, 5 req/min, "1+ Year Historical Data"; **Indices Starter $49/mo** = all index tickers, unlimited calls, minute aggregates, flat files; **Advanced $99/mo** = realtime | Free tier too shallow for multi-year backtests; Starter is the entry point | Commercial, individual-use tiers |
| **Twelve Data** ([pricing](https://twelvedata.com/pricing)) | 1m–1d, websocket | available | available | **Free = 8 API credits/min, 800/day, 3 markets** — unusable for a 4-instrument × 6-timeframe historical pull; paid from $29/mo | Paid/commercial terms |
| **Alpha Vantage** ([key page](https://www.alphavantage.co/support/api-key/), [docs](https://www.alphavantage.co/documentation/)) | intraday 1m–monthly | FX + indices | available | **Free = 25 requests/day** (unlimited for verified OSS/educational); intraday back to 25+ years | Free for non-commercial; attribution |
| **yfinance** ([download API](https://ranaroussi.github.io/yfinance/reference/api/yfinance.download.html)) | 1m/2m/5m/15m/30m/60m/90m/1h/1d | `EURUSD=X`, `GBPUSD=X` | `^NDX`, `^GSPC`, `NQ=F`, `ES=F` | Free, no key, **unofficial** — Yahoo can throttle (HTTP 429) and **intraday is limited to roughly the last 60 days**; D1 depth is good | Yahoo ToS — not licensed for redistribution |
| **Stooq** ([free DB](https://stooq.com/db/h/), [CSV endpoint](https://stooq.com/q/d/l/?s=%5Espx&i=d)) | daily, hourly, 5-min zips per region | major FX pairs | `^spx`, `^ndx` daily (indices CFD folder exists) | **Free, no key** — but automated pulls get a JS proof-of-work challenge page [verified 2026-10-17: returns an HTML challenge, not CSV], and an unpublished per-IP daily limit | **No published license** — hobbyist-grade, do not build a product on it |
| **MetaTrader 5** ([tester data help](https://www.metatrader5.com/en/terminal/help/algotrading/test_preparation)) | M1 bars + tick data downloadable from the trading server | deep (broker-dependent) | deep (broker-dependent), including index CFDs you can trade | Free with any MT5 demo account; the most *broker-realistic* bars (your actual symbol specs, spreads, rollovers) | Broker data, for personal trading use |

### 2.2 Recommendation per instrument

| Instrument | Primary | Backup / complement | Why |
|---|---|---|---|
| **GBPUSD** | **HistData.com M1** (from 2000/May) — free, no key, no rate limits | Dukascopy m15/h1/d1 if reachable (tick-level spread history); MT5 demo for broker-realistic bars | 25 years of free M1 is more than CRT needs; aggregate M1→M15/M30/H1/H4/D1 yourself so session cuts are under your control |
| **EURUSD** | **HistData.com M1** (from 2000/May) | same as GBPUSD | identical reasoning; EURUSD is the most liquid pair, cleanest ticks |
| **NAS100** | **MT5 demo** (broker index-CFD bars, M1 + ticks) as the realistic series; **Dukascopy `usatechidxusd`** when reachable for long history | Stooq `^ndx` daily for a free sanity-check series; Massive Indices Starter ($49/mo) if you want flat-file minute bars with an SLA | Free deep intraday for NAS100 is the bottleneck; a demo account costs nothing and matches the spread/rollover you will actually pay |
| **SPX500** | **MT5 demo** (index-CFD bars) + **Dukascopy `usa500idxusd`** (d1 to 1980, h1 from 2011, m1 from 2012) | HistData `SPX/USD` (2010/Nov+, free); Stooq `^spx` daily free; Massive Indices Starter if budget allows | Same bottleneck as NAS100; Dukascopy is the only free source with 15 years of intraday index history — when it is reachable |

### 2.3 Ingestion plan (agnostic of runtime)

1. **FX:** download HistData monthly M1 zips for EURUSD/GBPUSD → validate → aggregate to M15/M30/H1/H4/D1 with
   your own session-cut rules (Q3). Tick data is optional later for spread realism.
2. **Indices:** open an **MT5 demo** with your intended broker, use *Tools → Options → Expert Advisors →
   "Download trading data"* (or the History Center) to pull M1 + tick data for the NAS100/SPX500 CFD symbols.
   Export to CSV. This is the only free path that matches real symbol specs.
3. **Optional depth:** if Dukascopy becomes reachable (different network/VPN — see R1), `dukascopy-node` fills
   the long index history and tick-level spreads:
   `npx dukascopy-node -i usatechidxusd -t m15 -from 2015-01-01 -to 2026-10-01 -o ./data`.
   Note: `--pause-between-retries-ms` is **not** a valid option in the current CLI [verified — rejected as unknown option].
4. Everything lands in Parquet (Q5), CSV is ingest-only.

---

## Q3. Timezone & session normalization

### 3.1 Canonical rule: store UTC, render New York

- **Store every timestamp as UTC** — epoch milliseconds or microsecond `timestamp[us, tz=UTC]` in Parquet.
  Never store exchange-local or "server time" strings as the source of truth.
- The [TradingView Charting Library docs](https://www.tradingview.com/charting-library-docs/latest/connecting_data/time-and-sessions/)
  state the industry pattern explicitly: library timestamps are **milliseconds since the Unix epoch in UTC**, and
  they warn against performing manual UTC conversion before feeding data in — i.e. convert at the display/logic
  edge, not in the storage layer.
- Derive everything session-related (Asia open, London open, NY open, the "3 AM" model, D1 bar cuts) by converting
  UTC → `America/New_York` **with the IANA database**, never with a fixed offset like `-04:00`/`-05:00`. Fixed
  offsets break on the two US DST transitions per year and will silently misplace your D1 cuts and session labels
  for ~8 weeks of every year.

### 3.2 DST-aware session handling in each stack

| Stack | Mechanism |
|---|---|
| **Node (recommended)** | **[Luxon](https://www.npmjs.com/package/luxon)** (MIT): `DateTime.fromMillis(ts, { zone: 'utc' }).setZone('America/New_York')` — DST-correct via the platform `Intl` database, no tz-data files to maintain. `luxon` also gives `DateTime.local(...).setZone('America/New_York', { keepLocalTime: true })` style re-anchoring for session labels. |
| Python | `zoneinfo.ZoneInfo("America/New_York")` (stdlib, 3.9+), or pandas `tz_localize`/`tz_convert`. |
| .NET | `TimeZoneInfo` with the IANA↔Windows mapping, or NodaTime. |
| Reference design | nautilus_trader ships dedicated FX session utilities (Sydney/Tokyo/London/New York open/close, UTC↔local helpers) in its core — read it as a spec even if you do not adopt the library. |

### 3.3 Practical session rules to encode (encode as data, not hard-coded offsets)

- **FX week:** opens Sunday ~5:00 PM New York (= 22:00/21:00 UTC depending on DST), closes Friday ~5:00 PM New
  York. D1 bars for FX should be cut at the **broker/trading-day boundary** you intend to trade — decide explicitly
  whether your D1 cut is NY midnight, 5 PM NY, or broker midnight, and make it a config value, because it changes
  which candle is "today's CRT range."
- **Index CFDs:** RTH vs extended hours; NAS100/SPX500 gap risk across the NY close; the bot's "3 AM" model must
  be defined relative to New York **local** time so it lands on the same wall-clock hour in both EST and EDT.
- Keep a single `sessions.ts` (or equivalent) module as the only place that knows about timezones; everything
  downstream receives UTC instants plus precomputed session labels.

---

## Q4. Spread, commission & slippage modeling

### 4.1 How the reference engines do it

- [backtesting.py](https://kernc.github.io/backtesting.py/doc/backtesting/backtesting.html) models cost as:
  - `spread`: relative to price (e.g. `0.0002` = 2 pips on a 1.0000 pair), charged on **both entry and exit**;
  - `commission`: fixed float, (entry, exit) tuple, or callable, also applied per side;
  - `margin` for leveraged/CFD-style sizing; `trade_on_close` controls fills at bar close vs next open.
  This is the cleanest public spec of the cost model to mirror, even if you write your own engine.
- Broker-published reference spreads (sanity anchors, not backtest inputs): Exness publishes per-instrument average
  spreads in pips plus commission-per-lot-per-side for indices ([Exness indices page](https://www.exness.com/indices/));
  Octa publishes a comparable spread/fee table ([Octa spreads](https://www.octaeu.com/spreads/)).
- If you can get Dukascopy tick data, bid/ask are both carried, so **historical spread is observable** rather than
  assumed — the most honest default for FX.

### 4.2 Sensible defaults to start with (then sensitivity-test)

| Instrument | Spread (model) | Commission | Slippage |
|---|---|---|---|
| GBPUSD, EURUSD | 0.8–1.5 pips (0.00008–0.00015 as a price fraction) typical; stress at 2–3 pips around London/NY overlap and news | $3.5–$7.00 per lot round-turn (i.e. per 100k base notional) if using an ECN-style account | 0 for limit entries at the CRT level; 0.5–1 tick for market/stop entries |
| NAS100 (CFD) | ~1.0–2.5 index points typical; model as points, not percent | $0–$7 per lot round-turn depending on broker | 0.25–1 point for stops on gap-prone opens |
| SPX500 (CFD) | ~0.4–1.5 points typical | same as NAS100 | same as NAS100 |

Run every strategy result three times (optimistic / mid / pessimistic cost) — CRT on H1/D1 has low trade frequency,
so per-trade cost assumptions dominate the equity curve. When in doubt, quote your broker's live spread table on
the exact symbols you will trade rather than generic "typical spread" marketing numbers.

---

## Q5. Local storage format

| Format | Verdict | Evidence |
|---|---|---|
| **Parquet** | **Canonical store.** Columnar, compressed (~10× vs CSV), predicate-pushdown for date-range scans, language-agnostic. | Node: [hyparquet](https://www.npmjs.com/package/hyparquet) (read) + [hyparquet-writer](https://www.npmjs.com/package/hyparquet-writer) (write), both MIT, Snappy default. The [stefan-jansen ML4T storage benchmark](https://github.com/stefan-jansen/machine-learning-for-trading/blob/main/02_financial_data_universe/20_storage_benchmark_file.ipynb) compares CSV/Parquet/Feather/HDF5 on real OHLC workloads — Parquet/Feather/HDF5 all beat CSV decisively on both size and read time; Parquet wins on ecosystem portability. |
| **DuckDB** | **Query layer on top of Parquet**, not a replacement for it. Zero-config analytics (`SELECT ... WHERE ts BETWEEN ...`), reads Parquet natively, official Windows binaries. Keep the database file regenerable; keep Parquet as the durable artifact. | [@duckdb/node-api](https://www.npmjs.com/package/@duckdb/node-api) (MIT, official, 738k weekly DL, Win32 x64 supported). SQL-vs-NoSQL OHLC storage comparison: [Medium/toward-data-science](https://medium.com/towards-data-science/how-to-store-financial-data-a-sql-vs-no-sql-comparison-bbd0d71bfc26). |
| CSV | **Ingest-only.** HistData and MT5 both ship CSV; parse once, write Parquet, never read CSV again in the hot path. | HistData ships zip CSV ([file spec](https://www.histdata.com/f-a-q/data-files-detailed-specification/)). |
| SQLite | Not recommended as primary bar store — row-store overhead vs DuckDB/Parquet for time-series scans. Fine for trade logs / run metadata if you prefer it to JSON files. | — |

**Layout suggestion:** `data/parquet/{symbol}/{timeframe}/year=YYYY/part.parquet`, columns
`(ts_utc timestamp[us, tz=UTC], open, high, low, close double, volume double, spread double nullable)`.
Partitioned by symbol → timeframe → year so backtest range scans touch only the files they need. Derive
higher timeframes from M1 at query/build time rather than storing six copies of the truth.

---

## Recommendation

### Stack

**Primary: TypeScript on Node.js v24** (already installed), with:

| Concern | Choice | Why |
|---|---|---|
| Language | TypeScript (strict) | Installed runtime; types pay for themselves in a bar-replay state machine |
| Backtest engine | **Hand-rolled bar-replay engine** (a few hundred lines: iterate M1/M5 bars, maintain multi-TF candle assembly, fill at bar close/next open, apply spread+commission per side) | CRT's session-anchored, multi-timeframe logic outgrows generic frameworks; backtest-kit's Pine-shaped API is optional sugar, not the core |
| Indicators (optional) | [Tulip Indicators](https://tulipindicators.org/) bindings (LGPL) for ATR/ADX/etc. | Vetted primitives, commercial-friendly license |
| Timezones | [Luxon](https://www.npmjs.com/package/luxon) (MIT) | IANA-correct `America/New_York` conversion, zero deps |
| Storage | [hyparquet-writer](https://www.npmjs.com/package/hyparquet-writer) + [hyparquet](https://www.npmjs.com/package/hyparquet) (MIT) → Parquet; [@duckdb/node-api](https://www.npmjs.com/package/@duckdb/node-api) (MIT) as the query engine | Columnar, compressed, portable, Windows-clean, no native build pain |
| Live-trading bridge (future) | Broker MT5 (via its Python or REST API) or ccxt only if crypto ever enters scope | Keeps execution a separate concern from research |

**Runner-up:** .NET + [QuantConnect LEAN](https://www.quantconnect.com/docs/v2/lean-engine/getting-started) if the
project graduates to live, institutional-grade execution — LEAN's brokerage/fee/slippage models and live engine
are unmatched, and the .NET SDK is already installed.

**Research-only complement:** if/when Python is repaired (real python.org install or `uv`), use
[backtesting.py](https://kernc.github.io/backtesting.py/doc/backtesting/backtesting.html) (mind the **AGPL-3.0**
license — fine for private research, not for distribution) or vectorbt for quick parameter sweeps; do not make it
the production runtime for this bot.

### Exact data source per instrument

| Instrument | Source | Cost | Depth |
|---|---|---|---|
| **GBPUSD** | **HistData.com M1** (aggregate up to M15/M30/H1/H4/D1) | Free | From **2000/May** |
| **EURUSD** | **HistData.com M1** | Free | From **2000/May** |
| **NAS100** | **MT5 demo** broker CFD bars (M1+ticks) as primary realistic series; **Dukascopy `usatechidxusd`** when reachable; Stooq `^ndx` daily as free sanity check | Free (demo account + free sites) | MT5: broker history; Dukascopy: multi-year intraday; Stooq: daily only |
| **SPX500** | **MT5 demo** + **Dukascopy `usa500idxusd`**; HistData `SPX/USD` as free fallback; Stooq `^spx` daily | Free | Dukascopy d1 from **1980**, h1/m1 from **2011–2012**; HistData from 2010/Nov |

Optional paid upgrade if free paths prove insufficient for the indices: **Massive Indices Starter at $49/mo**
([pricing](https://massive.com/pricing?product=indices)) — all index tickers, unlimited calls, minute aggregates,
flat files, SLA.

### Install steps (Node stack)

```powershell
cd C:\Users\JOSHUA\Desktop\CRTbot
npm init -y
npm install luxon hyparquet hyparquet-writer @duckdb/node-api
npm install -D typescript @types/luxon @types/node tsx
npx tsc --init
```

Ingestion:

```powershell
# HistData: download the EURUSD and GBPUSD M1 zips manually from
#   https://www.histdata.com/download-free-forex-data/?/ascii/1-minute-bar-quotes/EURUSD
#   https://www.histdata.com/download-free-forex-data/?/ascii/1-minute-bar-quotes/GBPUSD
# then convert CSV -> Parquet with a small tsx script.

# Dukascopy (ONLY if reachable; see risk R1) — note: m15 is a supported -t value:
npx dukascopy-node -i gbpusd -t m15 -from 2015-01-01 -to 2026-10-01 -o ./data
# NAS100/SPX500: pull M1 + ticks from an MT5 demo account's History Center, export CSV, convert to Parquet.
```

### Top risks

1. **R1 — Dukascopy is unreachable from this machine.** [dukascopy-node](https://www.dukascopy-node.app/) returned
   0-byte files / HTTP `202` errors for every instrument and timeframe tested, and a direct fetch of the
   `datafeed.dukascopy.com` tick endpoint **timed out** [verified 2026-10-17]. Likely bot-protection or network
   blocking on this IP/ISP. **Mitigation:** do not gate the project on Dukascopy; lead with HistData (FX) + MT5
   demo (indices); retry Dukascopy from a different network before relying on it for long index history.
2. **R2 — Python is broken on this machine.** `python` resolves to the inert WindowsApps stub and `py` is not
   installed [verified]. Any plan that assumes a Python backtest stack starts with an interpreter repair, and
   backtesting.py's AGPL-3.0 license constrains redistribution regardless. **Mitigation:** default to the Node
   stack above; install python.org Python (or `uv`) only as a research sidecar.
3. **R3 — Licensing & data-quality landmines.** Dukascopy's [terms](https://www.dukascopy.com/swiss/english/legal-pages/terms-of-use/)
   allow non-commercial personal use only and prohibit building/redistributing databases; Stooq publishes **no
   license at all** and blocks automated CSV pulls with a JS challenge [verified]; Yahoo/yfinance is unofficial
   and throttles; free index-CFD intraday history in general is the scarce, legally-fuzziest asset. **Mitigation:**
   keep all historical data private to this repo/machine, attribute sources in the repo README, prefer
   HistData (explicitly offered free for these use cases) and your own MT5-demo exports (data generated from your
   own account) as the load-bearing sources, and budget $49/mo for Massive Indices if you ever need clean,
   licensed, deep index minute bars.

---

## Appendix — primary sources cited

- [backtesting.py API reference](https://kernc.github.io/backtesting.py/doc/backtesting/backtesting.html)
- [Python backtesting frameworks overview](https://python.financial/guides/python-backtesting-frameworks/)
- [QuantConnect LEAN engine docs](https://www.quantconnect.com/docs/v2/lean-engine/getting-started)
- [backtest-kit (npm)](https://www.npmjs.com/package/backtest-kit)
- [Tulip Indicators](https://tulipindicators.org/)
- [Luxon (npm)](https://www.npmjs.com/package/luxon)
- [@duckdb/node-api (npm)](https://www.npmjs.com/package/@duckdb/node-api)
- [hyparquet-writer (npm)](https://www.npmjs.com/package/hyparquet-writer)
- [dukascopy-node app / instrument coverage](https://www.dukascopy-node.app/)
- [Dukascopy `usa500idxusd` instrument page](https://www.dukascopy-node.app/instrument/usa500idxusd)
- [Dukascopy Terms of Use](https://www.dukascopy.com/swiss/english/legal-pages/terms-of-use/)
- [HistData.com download list (depth per pair verified)](https://www.histdata.com/download-free-forex-data/)
- [HistData file format spec](https://www.histdata.com/f-a-q/data-files-detailed-specification/)
- [Massive (Polygon) pricing incl. Indices tiers](https://massive.com/pricing?product=indices)
- [Massive Indices product](https://massive.com/indices)
- [Twelve Data pricing](https://twelvedata.com/pricing)
- [Alpha Vantage API key / free tier](https://www.alphavantage.co/support/api-key/)
- [Alpha Vantage documentation](https://www.alphavantage.co/documentation/)
- [yfinance `download` API (interval & intraday-window limits)](https://ranaroussi.github.io/yfinance/reference/api/yfinance.download.html)
- [Stooq free historical DB](https://stooq.com/db/h/)
- [MetaTrader 5 — algorithmic trading data preparation](https://www.metatrader5.com/en/terminal/help/algotrading/test_preparation)
- [TradingView Charting Library — time & sessions (UTC-ms convention)](https://www.tradingview.com/charting-library-docs/latest/connecting_data/time-and-sessions/)
- [Exness indices spreads](https://www.exness.com/indices/)
- [Octa spread & fee table](https://www.octaeu.com/spreads/)
- [ML4T storage benchmark (CSV vs Parquet vs Feather vs HDF5)](https://github.com/stefan-jansen/machine-learning-for-trading/blob/main/02_financial_data_universe/20_storage_benchmark_file.ipynb)
- [SQL vs NoSQL for OHLC storage](https://medium.com/towards-data-science/how-to-store-financial-data-a-sql-vs-no-sql-comparison-bbd0d71bfc26)
