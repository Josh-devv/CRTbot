# ICT Sniper Entry — Backtest Report

**Date:** 2026-10-22
**Status:** Research prototype. Not deployable.
**Code:** `scratch-ict-sniper.ts`
**Research:** `.scratch/sniper-entries/research/ict-sniper-fib-liquidity.md`

## 1. What was tested

The user's "sniper entry" model:

1. NY AM time macro, primarily the `09:30` equity open.
2. Resting limit orders at prior RTH / prior-week / Asian / London highs and lows.
3. If price sweeps a level, enter at `level +/- 1 tick`.
4. Stop beyond the sweep extreme plus a buffer (`2p` NQ, `1p` ES).
5. Target either:
   - a Fibonacci measured move from the manipulation leg (`1.0`, `1.5`, `2.0`, `2.5`, `3.0`, `3.5`), or
   - the nearest opposing liquidity pool, or
   - a fixed `2R`.
6. Flat by `12:00 ET`.

The Fib projection uses the TradingView convention `P(r) = B + r(A - B)`. For a long after a low sweep:

```text
target = originHigh + k * (originHigh - sweepLow)
```

For a short after a high sweep:

```text
target = originLow - k * (sweepHigh - originLow)
```

The sign convention was verified with `--selftest`.

## 2. Data and method

| Item | Detail |
|---|---|
| NQ/ES | Dukascopy 1-minute bars, `2025-10-20` to `2026-10-19` |
| QQQ/SPY | 1-minute bars, `2021-10-20` to `2026-10-19` |
| Clock | `America/New_York` |
| Entry | Limit at the swept level / gap open |
| Costs | NQ `1.5p`, ES `0.6p`, QQQ/SPY `0.02p` round trip |
| Trade limit | First valid raid per instrument per day |
| Exit | Stop, target, or `12:00 ET` |
| Path assumption | Stop is checked on the entry bar; target is only credited from the next bar |
| Sample | 1-minute OHLCV only; no bid/ask, DOM, footprint, or delta |

The model is a codified approximation. It is not Huddleston's discretionary trading.

## 3. Headline results

### 3.1 NQ, 12 months, limit entry, structural stop, nearest liquidity target

| Metric | Value |
|---|---:|
| Trades | 288 |
| Win rate | 32.6% |
| Net R | **+900.5R** |
| Profit factor | 5.34 |
| Max drawdown | 16.1R |
| Average planned R | 22.3R |
| Average win / loss | 11.79R / -1.07R |
| Expectancy | 3.13R |
| Median trade | -1.02R |
| Top 5 trades | 321.9R = 36% of net |
| Max losing streak | 11 |
| Bootstrap 5th percentile | +585R |

### 3.2 ES, 12 months, same rules

| Metric | Value |
|---|---:|
| Trades | 289 |
| Win rate | 40.1% |
| Net R | **+303.0R** |
| Profit factor | 2.63 |
| Max drawdown | 9.9R |
| Average planned R | 9.1R |
| Average win / loss | 4.21R / -1.07R |
| Expectancy | 1.05R |
| Median trade | -0.60R |
| Top 5 trades | 90.0R = 30% of net |
| Max losing streak | 9 |
| Bootstrap 5th percentile | +203R |

### 3.3 NQ + ES, 3 months (`2026-07-01` to `2026-09-30`)

| Metric | Value |
|---|---:|
| Trades | 145 |
| Win rate | 42.8% |
| Net R | **+425.2R** |
| Profit factor | 5.83 |
| Max drawdown | 10.3R |
| Top 5 trades | 245.7R = 58% of net |

## 4. Fib standard-deviation targets

NQ, 12 months, same entry/stop:

| Target | Trades | Win rate | Net R | PF | Max DD | Top 5 share | Max losing streak |
|---|---:|---:|---:|---:|---:|---:|---:|
| Fib 1.0 | 288 | 18.4% | +1144.7R | 5.48 | 30.8R | 57% | 24 |
| Fib 2.0 | 288 | 16.0% | +1163.3R | 5.41 | 35.5R | 51% | 24 |

The 2.0–3.5 extensions do not add a robust edge over the 1.0 measured move. They increase the lottery profile: fewer wins, larger average win, more dependence on a handful of trades.

## 5. Falsification tests

### 5.1 Random levels — the "verified levels" are not the edge

The same model with every level shifted by a deterministic random amount:

| Test | Trades | Win rate | Net R | PF | Top 5 share | Max losing streak |
|---|---:|---:|---:|---:|---:|---:|
| Real levels, NQ, 12m, liq target | 288 | 32.6% | +900.5R | 5.34 | 36% | 11 |
| Random levels +/-0.25%, NQ, 12m | 312 | 17.9% | +1200.9R | 5.41 | 58% | 28 |
| Random levels +/-1.0%, NQ, 12m, liq target | 311 | 31.5% | +815.8R | 4.73 | 38% | 11 |

**Conclusion:** the specific prior highs/lows are not the source of the edge. Random levels perform the same or better.

### 5.2 Time window — 09:30 matters

| Window | Trades | Win rate | Net R | PF | Top 5 share | Bootstrap 5th pct |
|---|---:|---:|---:|---:|---:|---:|
| 09:30–10:30, exit 12:00 | 288 | 32.6% | +900.5R | 5.34 | 36% | +585R |
| 12:00–15:00, exit 16:00 | 287 | 12.9% | +82.2R | 1.28 | 162% | -45R |

**Conclusion:** the 09:30 window is doing real work. The later window is weak and depends entirely on a few trades.

### 5.3 Confirmation entry fails

The dossier's recommended confirmation variant: M5 reclaim + M1 MSS + first M1 FVG retrace.

| Variant | Trades | Win rate | Net R | PF | Max DD |
|---|---:|---:|---:|---:|---:|
| Limit at sweep | 288 | 32.6% | +900.5R | 5.34 | 16.1R |
| M5 + MSS + FVG confirmation | 173 | 34.1% | -11.7R | 0.89 | 27.0R |

**Conclusion:** waiting for confirmation destroys the edge. The entry must be the limit at the sweep, not a later retrace.

### 5.4 Fixed 2R fails

| Target | Trades | Win rate | Net R | PF | Bootstrap 5th pct |
|---|---:|---:|---:|---:|---:|
| Nearest liquidity | 288 | 32.6% | +900.5R | 5.34 | +585R |
| Fixed 2R | 288 | 35.8% | -17.0R | 0.91 | -54R |

**Conclusion:** the edge requires the convex liquidity/measured-move target. A fixed R target cuts the winners too early.

### 5.5 Out-of-sample ETF tests fail

Same rules, `09:30–10:30`, target nearest liquidity:

| Instrument | Period | Trades | Win rate | Net R | PF | Max DD |
|---|---|---:|---:|---:|---:|---:|
| NQ | 12m | 288 | 32.6% | +900.5R | 5.34 | 16.1R |
| ES | 12m | 289 | 40.1% | +303.0R | 2.63 | 9.9R |
| QQQ | 12m | 143 | 29.4% | -2.6R | 0.98 | 17.3R |
| QQQ | 5y | 432 | 23.8% | -104.8R | 0.69 | 119.0R |
| SPY | 5y | 263 | 24.3% | -85.4R | 0.58 | 85.4R |

**Conclusion:** the result does not generalize to QQQ/SPY over five years. The NQ/ES 12-month result is instrument- and/or regime-specific. The ETF tests are not a perfect apples-to-apples comparison — ETF opening mechanics and point volatility differ from index futures — but the failure is a strong warning.

### 5.6 ATR-scaled stop — the realistic-stop test

The fixed `2p` NQ / `1p` ES buffer was replaced with:

```text
buffer = max(fixed buffer, atr_mult * ATR(14, M5))
stop   = sweep extreme +/- buffer
```

NQ + ES, 12 months, nearest-liquidity target:

| ATR multiplier | Trades | Win rate | Net R | PF | Max DD | Avg stop | Median stop | Max losing streak | Bootstrap 5th pct |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0.15 | 577 | 37.1% | **+783.4R** | 3.05 | 16.0R | 14.4p | 6.0p | 16 | +575R |
| 0.25 | 577 | 38.8% | **+594.1R** | 2.62 | 14.4R | 15.7p | 7.1p | 15 | +442R |
| 0.50 | 577 | 42.1% | **+368.1R** | 2.09 | 11.8R | 19.2p | 9.7p | 15 | +273R |

Per instrument at `0.25`:

| Instrument | Trades | Win rate | Net R | PF | Max DD |
|---|---:|---:|---:|---:|---:|
| NQ | 288 | 34.4% | +318.1R | 2.65 | 14.4R |
| ES | 289 | 43.3% | +276.0R | 2.60 | 8.3R |

**Conclusion:** the NQ/ES edge survives a realistic, volatility-scaled stop. The result is not a knife-edge: every multiplier from `0.15` to `0.50` is positive, with the expected trade-off between R and drawdown. This is stronger evidence than the fixed-buffer result. The QQQ/SPY 5-year tests still fail, so the edge remains instrument- and/or regime-specific.

## 6. Practical constraints for a $10 account

| Version | Avg stop | 0.01 lot at $0.01/point | 0.01 lot at $0.10/point |
|---|---:|---:|---:|
| NQ, fixed buffer | 22.9p | $0.23 (2.3% of $10) | $2.29 (22.9%) |
| ES, fixed buffer | 4.2p | $0.04 (0.4%) | $0.42 (4.2%) |
| NQ+ES, ATR 0.25 | 15.7p | $0.16 (1.6%) | $1.57 (15.7%) |
| NQ+ES, ATR 0.50 | 19.2p | $0.19 (1.9%) | $1.92 (19.2%) |

The ATR averages are combined across NQ and ES; NQ is the wider side. At 1% risk, the target loss per trade is `$0.10`. NQ at 0.01 lot almost certainly exceeds that unless the broker's point value is unusually small. ES is more plausible, but the brokerage specs must be confirmed.

The NQ fixed-buffer variant had an **11-trade losing streak**; the ATR variants had **15–16**. At 1% risk that is roughly a 15–16% drawdown; at 2% risk it is roughly 30%. The strategy is not compatible with a minimum-lot size that forces more than ~2% risk per trade.

## 7. Verdict

**Do not deploy live. The ATR-scaled version is a credible forward-test candidate.**

What the data supports:

- There is a **09:30 ET convexity effect** in NQ/ES over this 12-month sample.
- The effect comes from entering at the sweep with a structural stop and holding for a liquidity/measured-move target until noon.
- It does **not** come from the "verified levels": random levels perform the same or better.
- The literal 1-tick stop is not tradable after costs; the structural stop is the only viable version.
- The confirmation entry and fixed-R exits fail.
- The fixed-buffer result is **low-win-rate and tail-driven**. The ATR-scaled version is materially more stable: 37–42% wins, PF 2.1–3.1, 12–16R max drawdown, and positive across `0.15`, `0.25`, and `0.50` ATR.
- The edge still does **not** survive on QQQ/SPY over five years. The NQ/ES sample is only one year.
- The $10 account remains the binding constraint: NQ at 0.01 lot may risk 15–23% per trade.

The honest description is: **a time-of-day convex bet that survives a realistic stop on NQ/ES over one year**, not a validated liquidity-level edge and not yet a live strategy.

## 8. Recommended next steps

1. **Forward demo test.** Trade the ATR `0.25` or `0.50` version on a demo account for three months with 1% risk and record actual fills/slippage. Do not use live money before that.
2. **Broker specification check.** Confirm the NAS100/US500 CFD point value and margin per 0.01 lot. If NQ 0.01 lot risks more than ~2% of $10, trade ES only or do not trade it at this size.
3. **More NQ/ES history.** Acquire five years of 1-minute NQ/ES data and rerun. The one-year sample is too short for a tail-driven strategy.
4. **Choose the ATR multiplier by objective.** `0.15` = highest R / highest drawdown; `0.25` = balanced; `0.50` = smoothest equity curve and highest win rate.

## 9. Files

- `scratch-ict-sniper.ts` — prototype with limit/confirmation entries, fixed/structural/ATR stops, Fib/liquidity/fixed-R targets, placebo levels, QQQ/SPY support, bootstrap and streak stats.
- `.scratch/sniper-entries/research/ict-sniper-fib-liquidity.md` — primary-source dossier.
- No production engine files were changed. `npm run typecheck` passes.
