# Spec: CRTbot — Sham "Axis System" Backtest Engine (GBPUSD + EURUSD)

Status: ready-for-agent
Feature slug: `crt-strategy`
Date: 2026-10-17

> Grounding: this spec is derived from the private *Axis Circle* mentorship (Ch1–8), captured
> in `.scratch/crt-strategy/research/axis-system-ruleset.md`. The public-source dossier
> (`sham-crt-primary-sources.md`) and the stack/data research (`build-stack-and-data.md`) are
> supporting references. Where they disagree, the ruleset wins.

---

## Problem Statement

I follow Sham's "Axis System" on GBPUSD and EURUSD, but the method is built for a human who can
watch four timeframes, wait through the London and New York kill zones, and judge order blocks,
CSDs and SMT by eye. I cannot do that reliably by hand, and I cannot do it at all across 25 years
of history. As a result I have no idea whether the system is actually profitable, on which days it
works, or how sensitive it is to the judgment calls I have to make manually — and I keep breaking
the discipline rules (fixed 3R, one trade per day, no moving stops) precisely because I'm
improvising in real time.

## Solution

A deterministic, backtestable rule engine that codifies the Axis System exactly as the mentorship
defines it, replays historical GBPUSD/EURUSD data through it, and reports trades, equity and
performance statistics — so I can *see* whether the system works before risking money, and so the
same decision engine can later drive a live bot. Every rule is a named, configurable, tested
component; the strategy's judgment calls become explicit parameters instead of hidden vibes.

---

## User Stories

1. As the strategy owner, I want the bot to load 25 years of GBPUSD and EURUSD M1 bars from local files, so that I can backtest deep history without depending on a live feed.
2. As the strategy owner, I want ingested data validated (gaps, duplicates, zero/negative prices, OHLC consistency), so that a silent data corruption cannot poison a backtest.
3. As the strategy owner, I want M1 bars aggregated into M15, H4, D1, W1 and MN1 candles using session-anchored boundaries, so that the timeframe alignment reflects how Sham actually reads candles.
4. As the strategy owner, I want every timestamp stored in UTC and rendered/derived in `America/New_York`, so that session and killzone logic is DST-correct year-round.
5. As the strategy owner, I want configurable session and killzone windows (London open, New York open, the 3:00 AM and 9:00 AM macros), so that I can tune timing without code changes.
6. As the strategy owner, I want the bot to compute the **directional bias** top-down (Monthly → Weekly → Daily) from structure and narrative, so that trades only go in the direction the system permits.
7. As the strategy owner, I want the bot to derive a **dealing range** from the defined significant-high/significant-low rules, so that premium/discount positioning is objective.
8. As the strategy owner, I want the bot to identify the **long-term and short-term DOL**, so that the bot knows the destination price is drawn toward.
9. As the strategy owner, I want the bot to detect **liquidity purges** (wick through a level that rejects), so that CRT sweeps are recognised.
10. As the strategy owner, I want the bot to detect the **CRT** (candle range whose wick purges, body continues), so that the core trigger is available to the execution layer.
11. As the strategy owner, I want the bot to distinguish a **CSD from a mere liquidity purge** using the relative-DOL rule, so that it doesn't treat every sweep as a reversal.
12. As the strategy owner, I want the bot to detect **order blocks** using the full definition (purge/fill/generate-liquidity behaviour + engulfment, body-vs-wick, multi-candle grouping, propulsion blocks), so that the primary entry mechanism is faithful.
13. As the strategy owner, I want the bot to score order blocks by the four high-probability conditions (HTF-bias alignment, premium/discount location, formed at a key time, tested at a key time), so that marginal OBs are filtered.
14. As the strategy owner, I want the bot to compute **SMT divergence** between EURUSD and GBPUSD against the three SMT criteria, so that correlated divergence becomes a usable trigger.
15. As the strategy owner, I want SMT confirmed by a follow-on valid CSD or valid order block, so that divergence alone never fires a trade.
16. As the strategy owner, I want the bot to build **H4 context** (bias-aligned dealing range, key level, CRT) only from the London open onward, so that execution matches the mentorship sequence.
17. As the strategy owner, I want the bot to evaluate **entry triggers** (key-level reaction, liquidity purge, SMT divergence) at a key time, so that monitoring starts for the right reason.
18. As the strategy owner, I want the bot to evaluate **entry confirmations** (order block formation first, then FVG formation, then MSS), so that the entry selection order matches Sham's preference.
19. As the strategy owner, I want orders placed with **entry at the order-block open, stop at the order-block extreme, and take-profit at a fixed 3R**, so that the placement rules are exact.
20. As the strategy owner, I want the bot to **never move the stop, never move the take-profit, and never scale**, so that the management rules are enforced by construction.
21. As the strategy owner, I want a hard **maximum of one trade per day**, so that the discipline rule cannot be violated.
22. As the strategy owner, I want entries restricted to the **London and New York kill zones**, so that out-of-window signals are ignored.
23. As the strategy owner, I want a **news-day filter** (NFP, CPI, FOMC) that makes the bot stand down, so that exception days are respected.
24. As the strategy owner, I want **exception protocols** (4-day, weekly-profile/TGIF, Asian-range) implemented, so that the system's explicit exceptions are honoured.
25. As the strategy owner, I want an **expansion-day test** using the weekly profile and weekly/daily OHLC framework, so that "is today an expansion day?" gates trading.
26. As the strategy owner, I want a **bar-replay backtester** that fills entries and exits with realistic spread and commission on both sides, so that results are not optimistic.
27. As the strategy owner, I want a **trade log** (entry/exit time and price, direction, reason, R-multiple, session), so that I can audit every trade.
28. As the strategy owner, I want an **equity curve and statistics** (win rate, expectancy, average R, max drawdown, profit factor, trade count, per-session and per-day-of-week breakdown), so that I can judge the system.
29. As the strategy owner, I want results **partitionable by instrument**, so that I can compare GBPUSD vs EURUSD.
30. As the strategy owner, I want a **cost sensitivity mode** (optimistic / mid / pessimistic spread), so that I can see how fragile the edge is to costs.
31. As the strategy owner, I want a **config file** for every parameter (timeframes, killzones, tolerances, risk %, news list, cost model), so that tuning needs no code edits.
32. As the strategy owner, I want **deterministic, reproducible runs** (same data + config → identical result, with a config/data hash recorded), so that results are trustworthy and shareable.
33. As the strategy owner, I want the **decision engine separated from the simulator**, so that the same rules can later drive live execution without being rewritten.
34. As the strategy owner, I want **clear rejection reasons** when no trade is taken, so that I can debug why the bot sat out a setup.
35. As the strategy owner, I want a **CLI** to ingest data, run a backtest, and print/save a report, so that I can operate it without editing code.
36. As a developer, I want the strategy rules covered by **fast fixture-based tests** over crafted candle series, so that I can change a rule without silently breaking another.
37. As a developer, I want the whole system behind **one high seam** (`runBacktest`), so that tests exercise real end-to-end behaviour instead of mocks.
38. As a developer, I want **typed configuration and results**, so that illegal configs are caught at compile time.
39. As a developer, I want the codebase to use the project **glossary vocabulary**, so that domain terms stay consistent as the system grows.
40. As a developer, I want an **ADR** recording the choice to drop index instruments and to build TS/Node, so that future contributors understand the constraints.

---

## Implementation Decisions

### Language & platform
- **TypeScript (strict) on Node.js v24** (already installed). Hand-rolled bar-replay engine; no third-party backtest framework (their session/multi-timeframe models don't match the Axis System).
- **Luxon** (MIT) for IANA timezone handling (`America/New_York`), **hyparquet + hyparquet-writer** (MIT) for Parquet. No DuckDB: a range scan through hyparquet is all the loader needs, and it keeps a native dependency out of the tree.
- Python is **not** used (broken on this machine; see stack research).

### Data
- Source: **HistData.com M1** CSV for **GBPUSD and EURUSD**; ingested once, converted to Parquet, never read as CSV in the hot path.
- Storage layout: `data/parquet/{INSTRUMENT}/{year}.parquet`, columns `(time, open, high, low, close)` — `time` as INT64 UTC milliseconds. Volume is not stored: HistData's FX volume is a tick count, and the seam's `Bar` carries none.
- Canonical timestamp: **UTC**. HistData's EST-without-DST stamps are shifted the fixed five hours **once, at ingest**; session logic converts UTC to `America/New_York` via Luxon, with **no fixed offsets in the trading logic**.
- Higher timeframes are **derived by aggregation** from M1 using session-anchored cuts, not stored as separate truths.

### Modules (deep modules; each hides its internals behind a narrow interface)
- `market-data` — ingest, validate, persist, load bar series.
- `candles` — aggregate M1 → M15/H4/D1/W1/MN1 with session-anchored boundaries.
- `time` — killzones, key macros, news days, DST-safe conversion, session labels.
- `structure` — swings, significant highs/lows, dealing range, premium/discount, DOL.
- `liquidity` — purge detection, CRT detection, CSD-vs-purge classification.
- `order-blocks` — detection (behaviour + engulfment), body/wick resolution, multi-candle grouping, propulsion blocks, high-probability scoring.
- `smt` — divergence between EURUSD and GBPUSD (DXY optional, off by default in v1).
- `profiles` — expansion-day test and weekly-profile classification (Tier B, parameterised).
- `exceptions` — 4-day, weekly-profile/TGIF, Asian-range protocols.
- `bias` — top-down M/W/D directional bias (structure + narrative).
- `context` — H4 dealing range / key level / CRT, built from London open.
- `execution` — triggers, confirmations, order placement.
- `strategy` — orchestrates the three layers into a per-bar decision.
- `risk` — fixed-3R sizing, one-trade-per-day enforcement.
- `backtest` — bar replay, fills, spread/commission, results assembly.
- `report` — statistics and equity curve.
- `cli` — `ingest`, `backtest`, `report` commands.

### Interfaces (the architecture seam)
The single architectural seam is the backtest runner. Everything the outside world touches is a
small set of types. Decisive shapes (trimmed to decision-rich parts):

```ts
type Instrument = "GBPUSD" | "EURUSD";

interface StrategyConfig {           // all judgment calls become explicit parameters
  instrument: Instrument;
  killzones: { london: Window; newYork: Window };
  keyMacros: TimeOfDay[];            // e.g. 03:00, 09:00
  sessionTz: "America/New_York";
  obEngulfment: "body" | "wick";     // resolved per-OB, but default selectable
  smt: { enabled: boolean; pairs: [Instrument, Instrument][]; useDxy: boolean };
  exceptions: { fourDay: boolean; weeklyProfile: boolean; asianRange: boolean };
  news: { standDown: boolean; dates: string[] };  // NFP/CPI/FOMC
  risk: { rMultiple: 3; maxTradesPerDay: 1; riskPerTradePct: number };
  costs: { spreadPips: number; commissionPerLot: number; slippagePips: number };
  tier: "A" | "A+B";                 // which layers are active
}

interface Decision {                 // per-bar output of `strategy`
  action: "enter" | "wait" | "stand-down";
  direction?: "long" | "short";
  reason?: string;                   // human-readable, also used for rejection reasons
  orderBlock?: OrderBlockRef;
}

interface Trade {
  instrument: Instrument;
  direction: "long" | "short";
  entryTime: string; entryPrice: number;
  stopPrice: number; targetPrice: number;   // invariant: |target-entry| == 3 * |entry-stop|
  exitTime?: string; exitPrice?: number; rMultiple?: number;
  session: "london" | "newYork"; reason: string;
}

interface BacktestResult {
  trades: Trade[];
  equityCurve: { time: string; equity: number }[];
  stats: Stats;                      // winRate, expectancy, avgR, maxDD, profitFactor, bySession, byWeekday, byInstrument
  configHash: string; dataHash: string;
}

// The seam:
function runBacktest(dataset: BarSeries[], config: StrategyConfig): BacktestResult;
```

### Layer/rule decisions (from the ruleset)
- Bias: M/W/D top-down; **quarterly-shift + seasonality must agree** (Tier B); validate with market
  structure + liquidity metrics; refine with market profile (Tier B). Daily bias governs the day.
- Dealing range: from significant H/L per the defined rules; premium/discount derived from it.
- CSD: rejection after relative DOL = CSD; before = purge.
- Order block: behaviour (purge/fill/generate liquidity) **and** engulfment required; body-vs-wick per
  close; consecutive candles grouped when closed through as a whole; propulsion block = OB formed by
  testing a prior OB.
- Entry: OB open. Stop: OB extreme. Target: fixed 3R. No moving SL/TP, no scaling, no trailing.
- Max **one trade per day**; killzones only; stand down on NFP/CPI/FOMC.
- Exception protocols: 4-day, weekly-profile/TGIF, Asian-range — each configurable, defaulting to
  "stand down" when triggered (Sham's own action).

### Phasing
- **v1 (Tier A):** data + candles + time/sessions + structure + liquidity + order-blocks + CSD +
  bias (M/W/D mechanics) + context + execution + risk + backtest + report + CLI, on GBPUSD/EURUSD.
- **v1.1 (Tier B):** seasonality/quarterly-shift, market-profile refinement, expansion-day test,
  SMT, cost-sensitivity sweep.
- **Later:** live execution adapter reusing the same `strategy` decision engine.

### Determinism
- Runs are deterministic; the result records a `configHash` and `dataHash`. No wall-clock or
  randomness in the hot path.

---

## Testing Decisions

- **Good tests describe external behaviour, not implementation.** Tests feed a candle series and a
  config into the seam and assert on the resulting `Decision`s / `Trade`s / `stats` — never on
  private helpers or intermediate data structures.
- **Primary seam tested:** `runBacktest`. Covers strategy + risk + simulator end-to-end.
- **Fixtures:** hand-crafted synthetic candle sequences that encode each textbook scenario
  (a clean bullish CRT, a post-DOL CSD, a purge-before-DOL, a valid vs invalid order block,
  a propulsion block, a body-vs-wick resolution, a multi-candle OB, an SMT divergence, an
  exception-protocol day, a news day, a second-trade-same-day attempt).
- **Invariant/property tests:** target is always exactly 3R; at most one trade per entry day;
  no trade outside a killzone; no trade on a stand-down day; SL/TP never modified mid-trade;
  same input → identical output (determinism).
- **Regression tests:** a stored "golden" scenario set; results must not change unless a rule
  change is intended.
- **Cost tests:** the same scenario under optimistic/mid/pessimistic spreads yields monotonically
  worse results.
- **Prior art:** none — this is greenfield; these tests establish the repo's testing pattern.
  Tooling: Node's built-in test runner (`node:test`) + `tsx`, so there is no extra framework to
  install.

---

## Out of Scope

- **NAS100 and SPX500** (owner dropped them).
- Live broker execution / order routing (architecture must allow it later, but not in v1).
- DXY-based SMT (supported in shape, off by default in v1).
- Discretionary elements Sham keeps private or unformalised: market-profile classification by eye,
  "the appropriate key level" selection heuristics, private 4H timed-range hours, KOD/OTE.
- Machine learning, parameter optimisation beyond simple manual/swept configs.
- Redistribution of the mentorship transcripts (source material stays private).
- Multi-user/broker-account management, position sizing across accounts.

---

## Further Notes

- **Open questions** (from the ruleset, to settle during implementation; each becomes a config
  default, not a blocker):
  1. Timezone assumed `America/New_York`; DST handled by Luxon — confirm no broker-time offset needed.
  2. Exact 4H "timed range" hours are private → configurable list.
  3. Risk % per trade unspecified → configurable constant, default to be chosen.
  4. DOL tie-breaking when multiple pools qualify → documented default rule.
  5. Whether DXY is a third series in v1 → off by default.
- **Data-honesty note:** all historical data remains private to this machine; sources attributed
  in the README; Dukascopy is unreachable from this machine so HistData is the load-bearing FX source.
- **Vocabulary:** a root `GLOSSARY.md` should be created (via domain-modeling) from the ruleset's
  terminology table; an ADR should record the instrument-scope decision and the TS/Node choice.
