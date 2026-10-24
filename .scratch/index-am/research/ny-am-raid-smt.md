# NY AM Raid + SMT — Index Futures Prototype Research

Date: 2026-10-20
Scope: NQ (Nasdaq-100) and ES (S&P 500), 1-minute bars — one-month Yahoo probe plus 12-month
Dukascopy validation. Status: **prototype only, not validated, not ported to the engine.**

## User brief

"Nasdaq and S&P 500 … the strategy is 8-10am New York + orderflow + SMT and other things you can
think of … test it out with just one month since with this strategy a trade almost happens everyday."

## Data

- Source: Yahoo Finance chart API, `interval=1m`, symbols `NQ=F` / `ES=F`, 7-day `period1/period2`
  chunks, raw (unencoded) symbol in the path, `User-Agent` + `Accept: application/json` headers.
  `range=1mo&interval=1m` and old encoded symbols return HTTP 422. 1m data is capped at the last
  ~30 days, so the oldest chunk is clipped by Yahoo.
- Coverage: 2026-09-21T23:54Z → 2026-10-19T23:45Z. NQ 27,377 bars, ES 27,379 bars; volume > 0 on
  99.9%; 20 sessions with 8–10 ET data; 19 have a usable prior session.
- Files: `data/indices/NQ.json`, `data/indices/ES.json` (`{time, open, high, low, close, volume}`).
- Fetch script: `scratch-fetch-indices.ts` (`npx tsx scratch-fetch-indices.ts [--days 29]`).

### 12-month validation set (Dukascopy)

- Source: Dukascopy datafeed, `USATECHIDXUSD` (NQ) and `USA500IDXUSD` (ES), `BID_candles_min_1.bi5`
  at `https://datafeed.dukascopy.com/datafeed/{SYMBOL}/{YYYY}/{MM 0-based}/{DD}/BID_candles_min_1.bi5`.
- Download: Node `fetch` and `curl.exe` are TLS-blocked/flaky against the datafeed (connect timeout /
  socket hang up); PowerShell `Invoke-WebRequest` works (~1 s/file). `scratch-fetch-duka.ps1` caches
  raw files in `data/indices/duka-raw/{symbol}/{yyyy}/{mm0}/{dd}.bi5`, writes `.missing` markers,
  skips Saturdays.
- Decode: LZMA (`lzma` npm package). 24-byte big-endian records: u32 seconds-from-midnight, u32 open,
  u32 close, u32 low, u32 high (price × 1000), f32 volume. Field order was proven by permutation test
  (open, close, low, high = 1335/1440 valid; wrong orders produce mass rejects) and by validating
  high ≥ max(open, close) ≥ min(open, close) ≥ low.
- Coverage: 2025-10-20 → 2026-10-19, 313 daily files per symbol, 450,720 1-minute bars each, zero
  invalid bars, volume > 0 on 76% of bars (tick volume; maintenance-window/weekend padding is flat).
- Files: `data/indices/NQ-duka.json`, `data/indices/ES-duka.json`. Fetch/parse:
  `scratch-fetch-duka.ts` (`npx tsx scratch-fetch-duka.ts`).
- Caveats: CFD prices, not futures; tick volume is sparse; the only genuine futures sample remains
  the 20-session Yahoo month. Overlap check (Sep 22 – Oct 19): signs agree (both positive), but trade
  counts differ (e.g. NQ 9 Yahoo vs 6 Dukascopy), so level interaction is source-sensitive.

### Data caveats

- No DOM, no bid/ask, no delta/tick data. "Order flow" can only be proxied from OHLCV.
- Yahoo 1m history is 30 days. One month ≈ 20 sessions. This is a smoke test, not evidence.
- Prior-session levels must use the previous *trading* session, not calendar yesterday (otherwise
  Mondays and post-holiday sessions are silently skipped; fixed in the prototype).
- Intra-bar resolution is conservative: if stop and target are both touched in one bar, stop wins.
- Costs modeled as a flat point charge (NQ 1.0, ES 0.5) inside the R result.

## Mechanical model (`scratch-nq.ts`)

1. **Levels** — overnight high/low (18:00 → 08:00 ET), prior RTH high/low/open/close (09:30–16:00
   ET), overnight and prior-RTH volume-profile POC/VAH/VAL (70% value area), and the last two
   confirmed 15m and 30m swing highs/lows. Each level is raidable once per day. `--levels
   all|session|profile|swing` isolates a level family.
2. **Raid** — inside the scan window (default 09:30–10:00 ET), price trades beyond a level by at
   least `--penetration` points, then closes back inside within 5 bars. Raid extreme = wick.
   Deepest level crossed on the raid bar wins.
3. **SMT** — `--smt-mode level` (default): the correlated index (NQ↔ES) must fail to take its
   equivalent session level (exactly one index raids). `--smt-mode swing`: same test against the
   local 30-bar swing high/low (structural divergence). `--no-smt` for the A/B.
4. **Bias gate** — `--bias session` (default): price vs prior RTH close; `prior`: prior RTH candle
   direction (close vs open); `none`. Bullish → long raids only; bearish → short raids only.
5. **Order-flow proxies** — `--ofilter volume`: raid bar volume ≥ 1.5× trailing 60-bar mean;
   `reject`: closing bar closes in the far 40% of its range; `either` (default); `none`.
6. **Entry** — `reclaim` (default): enter at the close of the bar that reclaims the level;
   `leg`: 1m MSS through the 3-bar micro swing before the wick; `range`: MSS through the pre-raid
   10-bar range (widest, chasing); `limit`: limit back at the swept level.
7. **Stop** — beyond the raid extreme + `--buffer` points (NQ 4, ES 1.5 by default).
8. **Target** — fixed `--target-r` R multiple (default 1) or, when 0, the nearest opposite liquidity
   pool (overnight low/high, prior RTH low/high, prior close) worth ≥ `--min-r`; `--max-r` caps it.
9. **Management** — one position at a time, `--time-stop` minutes (default 15), max one per side/day,
   max two per day, flat 15:55 ET.

Reproduce:

```
npx tsx scratch-nq.ts [--source yahoo|duka] [--from 9:30] [--to 10:00] [--monthly]
                      [--entry reclaim|leg|range|limit] [--bias session|prior|none]
                      [--smt-mode level|swing] [--no-smt] [--ofilter either|volume|reject|none]
                      [--levels all|session|profile|swing]
                      [--target-r 1] [--min-r 1] [--max-r 2] [--time-stop 15]
                      [--penetration 0] [--buffer 4] [--cost 1]
```

## One-month results (2026-09-22 → 2026-10-19, 20 sessions)

### Phase 1 — as specified (8–10 window, far liquidity target, minR 1.5)

| Config | Instr | Trades | Wins | NetR | AvgR | Notes |
|---|---|---|---|---|---|---|
| reclaim + level SMT + either | NQ | 7 | 0 | −7.4 | −1.05 | all stops |
| reclaim + level SMT + either | ES | 5 | 0 | −5.7 | −1.15 | all stops |
| leg MSS | NQ | 7 | 0 | −7.2 | −1.03 | risk up to 100 pts |
| range MSS | NQ | 7 | 1 | −3.3 | −0.47 | stop = whole raid leg |
| limit at level | NQ | 6 | 0 | −6.7 | −1.12 | median planned 14R |

Diagnosis: two failure modes. (a) Premarket (08:00–09:30) raids are tick-pokes on thin volume:
ES stops of 2–4 pts sit inside one bar's noise. (b) The MSS entries enter after the move has
already retraced, so risk becomes the entire raid leg + retrace (up to 100 NQ pts) while the
far-pool target stays 4–25R away.

### Phase 2 — 2R target cap (MFE study: winners-to-be ran 2–3R then reversed)

| Config (2R cap, minR 1) | Instr | Trades | Wins | NetR | AvgR | PF | MFE ≥2R |
|---|---|---|---|---|---|---|---|
| 8–10 window | NQ | 7 | 1 | −4.4 | −0.63 | 0.31 | 1/7 |
| 8–10 window | ES | 5 | 3 | +3.3 | +0.65 | 2.38 | 3/5 |
| 9:30–10:00 | NQ | 5 | 3 | **+3.8** | +0.76 | 2.86 | 3/5 |
| 9:30–10:00 | ES | 2 | 1 | +0.6 | +0.29 | 1.53 | 1/2 |

The positive cell is the NQ opening-window subset: 09-29, 09-30, 10-05 wins; 09-28, 10-12 losses.
Not one outlier; but only five trades.

### Ablations on the 9:30–10:00 / 2R cell

| Variant | NQ trades | NQ netR | ES trades | ES netR |
|---|---|---|---|---|
| level SMT (baseline) | 5 | +3.8 | 2 | +0.6 |
| no SMT | 6 | +2.7 | 6 | −3.7 |
| swing SMT | 4 | +1.9 | 3 | −3.2 |
| ofilter none | 5 | +3.8 | 2 | +0.6 |

- The order-flow proxy **filtered nothing** at 09:30 (identical trade set) — it is inert in the
  window that matters. It cannot be validated further without DOM/delta.
- SMT adds to NQ and flips ES from losing to flat-ish; sample too small to claim it as the cause.
- Buffer sensitivity: 2 / 4 / 6 pts → NQ +3.7 / +3.8 / +3.8R. Structurally stable.

## V4 — precision scalp model (owner refinement, 2026-10-20)

Owner reframed the target: "wait for liquidity to get taken out, SMTs to form, key levels being
hit in the 15 or 30 mins, with an idea of the bias for the day or session … market profiles …
even if it's just scalping 10-15 min trades … RR doesn't matter, precision matters."

Changes:

- **Level set** now includes overnight + prior-RTH **volume-profile POC/VAH/VAL** (70% value area,
  volume spread across each 1m bar's range) and the last two confirmed **15m / 30m swing highs and
  lows**. Total ≈ 12 highs + 12 lows per session. Each level can be raided once per day.
- **Bias gate** (`--bias`): `session` = current price vs prior RTH close; `prior` = prior RTH candle
  direction (close vs open); `none`. Bullish bias only takes **long** raids (sweep of lows +
  reclaim), bearish only shorts.
- **Precision target**: `--target-r` (default 1R) instead of the far liquidity pool. `--target-r 0`
  restores the pool ladder.
- **Time stop**: `--time-stop` minutes (default 15), exit at market if neither stop nor target.
- Default window moved to **09:30–10:00**; default entry **reclaim**.

### Results (09:30–10:00, reclaim, 1R target, 15m time stop, level SMT)

| Variant | NQ trades | NQ precision | NQ netR | ES trades | ES precision | ES netR |
|---|---|---|---|---|---|---|
| bias session | 9 | 66.7% | +3.7 | 4 | 75.0% | +1.5 |
| bias none | 16 | 68.8% | +6.9 | 10 | 60.0% | +2.8 |
| bias prior | 10 | 90.0% | +7.4 | 3 | 100% | +2.5 |
| no SMT (session bias) | 16 | 50.0% | +0.8 | 17 | 35.3% | −3.6 |
| no SMT (prior bias) | 14 | 57.1% | +1.4 | 14 | 78.6% | **+7.0** |
| ofilter none (session bias) | 9 | 66.7% | +3.7 | 5 | 60.0% | +0.3 |
| target 0.75R (session bias) | 9 | 77.8% | +4.0 | 4 | 100% | +2.5 |
| target 0.75R (prior bias) | 10 | 90.0% | +5.1 | 3 | 100% | +1.8 |
| target 1.25R (session bias) | 9 | 55.6% | +3.0 | 4 | 25.0% | −2.2 |
| time stop 10 / 30 (session) | 9 | 66.7% | +3.8 / +4.0 | 4 | 75.0% | +1.5 |
| buffer 2 (session) | 9 | 66.7% | +3.7 | 4 | 75.0% | +2.0 |
| buffer 6 (session) | 9 | 66.7% | +3.8 | 4 | 0.0% | −2.8 |
| 08:30–10:00 (session) | 6 | 66.7% | +1.6 | 4 | 75.0% | +3.0 |

### What this does and does not show

- The precision shape is real *in this month*: at 1R targets, NQ hits 2/3 to 9/10; ES is smaller and
  borderline. MFE confirms most NQ trades reach ≥1R (6/9 to 9/10), often 1.3–5R.
- **SMT is not consistently additive**: with session bias it helps a lot (NQ 50%→67%, ES 35%→75%);
  with prior bias it *hurts* ES (+7.0R without vs +2.5R with). Small samples are doing the talking.
- **Order-flow proxy remains inert**: `--ofilter none` produces the same NQ trade set and one extra
  ES trade. It cannot be validated without DOM/delta data.
- ES is fragile: a 6-pt buffer wipes it (0/4); a 1.5–2 pt buffer works. NQ is buffer-insensitive.
- Statistical reality: 12/13 wins looks great, but it is the best of ~15 configurations on 20
  sessions. Under a 50% null that cell is p≈0.002, yet the multiple-testing / selection effect
  swamps it. **No out-of-sample evidence. Do not trade or port.**

## V5 — 12-month validation (Dukascopy, 2025-10-20 → 2026-10-19)

313 sessions per symbol; reclaim entry, 1R target, 15 min time stop, costs 1.0/0.5 pts, max two
trades/day, one per side.

### Bias × SMT (level SMT)

| Config | NQ n | NQ prec | NQ netR | NQ avgR | ES n | ES prec | ES netR | ES avgR |
|---|---|---|---|---|---|---|---|---|
| session + SMT | 65 | 49.2% | +2.5 | +0.04 | 63 | 66.7% | +15.4 | +0.24 |
| session, no SMT | 247 | 49.0% | +6.7 | +0.03 | 245 | 51.8% | +13.7 | +0.06 |
| prior + SMT | 87 | 52.9% | +10.0 | +0.12 | 71 | 59.2% | +7.4 | +0.10 |
| prior, no SMT | 198 | 51.5% | +18.9 | +0.10 | 202 | 55.0% | +24.3 | +0.12 |

### Structure ablations (prior bias, no SMT)

| Variant | NQ n | NQ prec | NQ netR | ES n | ES prec | ES netR |
|---|---|---|---|---|---|---|
| reclaim (base) | 198 | 51.5% | +18.9 | 202 | 55.0% | +24.3 |
| entry leg (MSS) | 174 | 25.3% | −32.3 | 174 | 23.6% | −33.2 |
| entry range (MSS) | 152 | 23.7% | −20.5 | 149 | 22.1% | −16.9 |
| entry limit | 189 | 48.1% | −12.0 | 191 | 57.1% | +6.8 |
| window 08:30–10:00 | 194 | 42.8% | −6.5 | 204 | 39.2% | −11.1 |

Other: `--target-r 0.75` (session + SMT) → NQ 65 trades 60.0% +1.9R, ES 63 74.6% +11.3R.
`--target-r 1.5` (ES prior/no SMT) → 36.1% +15.6R. ES buffer 2 → 53.0% +22.0R (vs +24.3R).
`--ofilter none` reproduced the same or better results (NQ +8.7R / ES +16.9R vs +2.5/+15.4) —
the proxy is inert at this resolution, again.

### Level family (prior bias, no SMT)

| Levels | NQ n | NQ prec | NQ netR | NQ avgR | ES n | ES prec | ES netR | ES avgR |
|---|---|---|---|---|---|---|---|---|
| all | 198 | 51.5% | +18.9 | +0.10 | 202 | 55.0% | +24.3 | +0.12 |
| session only | 88 | 52.3% | +14.3 | +0.16 | 78 | 48.7% | +1.7 | +0.02 |
| profile only | 162 | 43.2% | −7.0 | −0.04 | 181 | 49.2% | +6.4 | +0.04 |
| 15m/30m swing only | 139 | 48.2% | +7.5 | +0.05 | 137 | 54.7% | +16.2 | +0.12 |

### Monthly consistency (prior bias, no SMT)

- ES: 9/12 months positive, but June (+8.8R) and December (+5.8R) dominate; most months ≈ +1R;
  the last three reads are July −0.0, September −0.4, October −1.8 (partial month).
- NQ: 7/12 positive; February −4.8R, March −5.4R, October −2.3R; May +9.6R, August +5.7R.
- Read: a weak positive drift, not a stable precision edge; concentration in a few months is
  consistent with noise around a small mean.

### What the 12-month test changed

- The one-month 65–90% precision did **not** hold. At 1R, precision is 49–59% depending on filters,
  and expectancy is +0.02 to +0.24R per trade.
- SMT acts as a **selectivity filter, not an edge**: it cuts trade count ~4× with roughly unchanged
  total R (ES +15.4 with vs +13.7 without; NQ +2.5 vs +6.7). Per-trade ES quality improves
  (+0.24R), NQ does not.
- Reclaim entry is the load-bearing mechanic; delaying entry to an MSS (leg/range) is catastrophic
  (−0.18R/trade), and the 08:30 start dilutes the edge.
- No level family is a precision engine: profile levels are the weakest (NQ negative), session
  levels are best for NQ per-trade, 15m/30m swings are best for ES per-trade. This is the opposite
  of a clean "profile + SMT" thesis.
- ES is the better instrument over the year (larger total R, higher precision), reversing the
  one-month NQ impression — a direct example of small-sample noise.

## V6 — Alpaca 5-year ETF validation (2021-10-20 → 2026-10-19)

Data: Alpaca Basic (free), SIP historical 1m, SPY and QQQ. Ten-year pull: SPY 2,167,187 bars,
QQQ 2,093,322; 5-year slice: SPY 1,046,744, QQQ 1,083,680, zero gaps. Buffer 0.15 / 0.10 and cost
0.02 / 0.03 (real ETF spreads; the previous 0.05 cost was ~10% of R and materially understated
expectancy). Fetcher: `scratch-fetch-alpaca.ts`; 5-year slice: `scratch-slice.ts` (source `alpaca5`).

Frozen config: 15-minute opening range (09:30–09:45 ET), scan 09:45–10:30, reclaim entry, fixed 1R,
30-minute time stop, no bias/SMT/orderflow filter, max two trades/day, one per side.

| Config | Trades | Precision | NetR | AvgR | PF |
|---|---|---|---|---|---|
| SPY, no bias | 1,089 | 57.6% | +148.0 | +0.136 | 1.33 |
| SPY, prior-day bias | 545 | 59.8% | +100.3 | +0.184 | 1.47 |
| QQQ, no bias | 1,047 | 55.3% | +77.1 | +0.074 | 1.16 |

SPY by calendar year (no bias): 2022 +19.0R, 2023 +18.0R, 2024 +47.3R, 2025 +29.2R, 2026 YTD
+32.5R. Worst month: June 2023 −10.0R. Drawdown clusters: Nov–Dec 2022 ≈ −16.4R, May–Jul 2023
≈ −21.9R. The edge is broad across regimes, not carried by one year.

### Reading

- The **opening-range sweep-reclaim** is the first component that survives real, multi-year data.
  It is the only validated piece; SMT, profile levels and OHLCV order-flow proxies remain
  unsupported.
- Entry timing is load-bearing: MSS/leg entries were catastrophic (−0.18R/trade), 1.5R targets cut
  precision to ~36%, and the 15-minute time stop truncated too many trades (30 min is better).
- Prior-day bias raises precision and per-trade expectancy (0.184R vs 0.136R) but halves trade
  count. No-bias maximizes total R; bias maximizes quality per trade.
- Cost correction alone added ~0.07R/trade — spreads matter more than any filter tested.
- QQQ is positive but weaker; **SPY/ES is the primary instrument**.

## Honest verdict (updated)

- **DROP** SMT + profile levels + OHLCV order-flow as edge sources. They did not survive.
- **KEEP** the NY opening-range sweep-reclaim on SPY (ES proxy): 5 years, 1,089 trades, 57.6% at 1R,
  +0.136R/trade, PF 1.33, positive every calendar year. This is a real but modest edge.
- It is **not a $10–50 live strategy**. PDT limits margin accounts under $25k to 3 day trades per 5
  days; fractional shares cannot be shorted (≈half the signals); cash accounts face T+1 settlement;
  and risking 1R on $50 is ruinous. The edge is a signal, not a funding decision.
- Do not port to the engine yet (engine untouched, 137/137 green).

## Next step

1. Run this frozen config on an **Alpaca paper account** for 3–6 months / 50–100 trades. Compare
   fills, slippage and missed signals against the backtest. Paper trading is free and honest.
2. Only after that, consider live with a few hundred dollars (fractional, long-only SPY) or $2–3k
   for MES; never risk more than 1–2% per trade.
3. Do not add more filters or parameters before paper results arrive. The baseline is frozen.

