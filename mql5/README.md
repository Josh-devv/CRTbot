# CRTbot Exness Sniper EA

MQL5 demo EA for the NQ/ES sniper variant, adapted to Exness `USTECm`.

## Files

- Source: `mql5/Experts/CRTbot_Exness_Sniper.mq5`
- Compiled: `mql5/Experts/CRTbot_Exness_Sniper.ex5`
- Installed in MT5:
  `...\MQL5\Experts\CRTbot\CRTbot_Exness_Sniper.ex5`

## Safety defaults

- **Log-only by default**: `InpTradingEnabled=false`.
- `InpDemoOnly=true`.
- **Quality-based sizing**: low/standard/A/A+ tiers risk roughly 1%/1.5-2%/2.5-3%/3-5% of equity; `InpMaxLot=1.0` hard cap.
- `USTECm` minimum lot is 0.05; 0.01 is impossible.
- Max spread: 2.5 price points.
- One trade per day.
- Pending orders cancelled at 10:30 NY.
- Flat at 12:00 NY.

## First run â€” log only

1. Open Exness MetaTrader 5 and log in to the demo account.
2. Enable **Tools â†’ Options â†’ Expert Advisors â†’ Allow algorithmic trading**.
3. Open a `USTECm` **M1** chart.
4. In Navigator, refresh **Expert Advisors**, then drag
   `CRTbot_Exness_Sniper` onto the chart.
5. Keep `InpTradingEnabled=false`. Click OK.
6. Check the **Experts** tab at:
   - 09:25 NY â€” levels + core limit orders (or intended orders in log-only)
   - 09:30 NY â€” gap-entry check + entry window opens
   - 10:00 NY â€” opening range levels
   - 12:00 NY â€” flat
7. Confirm the logged NY times and levels are sensible before enabling orders.

If you attach after 10:30 NY, the EA logs the levels and the noon exit immediately
and does nothing else that day. This is expected; wait for the next NY day.

## Enable demo execution

Only after the log-only run looks correct:

1. Open the EA properties.
2. Set `InpTradingEnabled=true`.
3. Keep `InpDemoOnly=true`.
4. Keep `InpRiskPercentMin=1.0`, `InpRiskPercentMax=5.0`, and `InpMaxLot=1.0`.
5. Keep `InpAtrMultiplier=0.25` for the balanced variant (0.50 is smoother).
6. Click OK.

The EA must be running before 09:25 NY. If MT5 is closed, it cannot trade.
For 24/7 operation, use a Windows VPS.

## Fixed NY schedule

| Time NY | Action |
|---|---|
| 09:25 | Build prior RTH/week, Asian, London levels; place core limits |
| 09:30â€“10:30 | Entry window; gap-through core levels enter at market |
| 10:00 | Add opening-range high/low |
| 10:30 | Cancel all remaining pending orders |
| 12:00 | Close any open position |

NY time is converted from server time using US Eastern DST rules. The EA logs
the detected server GMT offset at startup. If the NY times are wrong, set
`InpServerGMTOffsetHours` manually instead of `999`.

## Inputs

| Input | Default | Meaning |
|---|---:|---|
| `InpTradingEnabled` | false | false = log only |
| `InpDemoOnly` | true | block real accounts |
| `InpRiskPercentMin` | 1.0 | low-tier risk % of equity |
| `InpRiskPercentMax` | 5.0 | absolute maximum risk % |
| `InpMaxLot` | 1.0 | hard cap for calculated lot |
| `InpSkipLowQuality` | false | true = skip low tier; false = risk 1% |
| `InpAPlusValidated` | false | true = allow A+ above 3% (after validation) |
| `InpAtrMultiplier` | 0.25 | stop buffer = max(2.0, mult Ã— ATR) |
| `InpMaxSpreadPricePoints` | 2.5 | skip entries if spread is wider |
| `InpLimitOffsetPoints` | 0.1 | limit offset beyond level |
| `InpUseProvisionalStop` | true | temporary wide stop while entry M1 forms |
| `InpProvisionalStopAtrMult` | 3.0 | provisional distance in ATRs (min 30 points) |
| `InpUseDailyBias` | false | long only when prior RTH close > open; short only when close < open |
| `InpSkipMonday` | false | no new entries on Monday (NY) |
| `InpMinRewardRisk` | 3.0 | minimum target/risk; 0 = nearest target only |
| `InpPreFilterMinRR` | true | estimate RR before placing limits and skip weak setups |
| `InpServerGMTOffsetHours` | 999 | auto-detect server GMT offset |

**v1.005 quality sizing:** each setup gets a score from level type, side,
planned RR, stop distance, gap status, and Monday. Tiers:

| Tier | Score | Risk | Notes |
|---|---:|---:|---|
| Low | <=2 | 1% | set `InpSkipLowQuality=true` to skip |
| Standard | 3-4 | 1.5-2% | |
| A | 5-6 | 2.5-3% | |
| A+ | >=7 | 3% | 3-5% only if `InpAPlusValidated=true` |

The score is a research hypothesis, not yet fully validated. Pending lots are
sized against the provisional stop or 30 points, whichever is wider, then
rounded down and capped at `InpMaxLot`. After the entry bar closes, actual
dollar risk is checked again and partially closed if it exceeds the 5% maximum.
On a $100 account the 0.05 minimum lot means many setups land around
1.5-2.5% rather than exactly 1%.

The bias and RR filters are strategy changes for **v1.002**. They were added
after the 3-month NQ/ES research pass:

| Variant | Trades | Win rate | Net | Avg win | Max losing streak |
|---|---:|---:|---:|---:|---:|
| Baseline | 132 | 49.2% | +213.1R | ~4.5R | 10 |
| Daily bias only | 118 | 53.4% | +190.7R | 3.99R | 7 |
| **Bias + skip Monday + min 3R** | **60** | **48.3%** | **+165.6R** | **6.94R** | **5** |
| Bias + skip Monday + min 5R | 41 | 43.9% | +134.7R | 8.98R | 7 |
| Fixed 5R target | 92 | 38.0% | +99.4R | 4.65R | 12 |

However, the 12-month rerun (`2025-10-20..2026-10-19`) did **not** confirm the
bias or Monday filters:

| Variant | Trades | Win rate | Net | Avg win | Max losing streak | Max DD |
|---|---:|---:|---:|---:|---:|---:|
| Baseline | 518 | 43.2% | +633.8R | 4.29R | 11 | 12.9R |
| **Min 3R only** | **463** | **37.1%** | **+764.4R** | **6.42R** | **12** | **13.7R** |
| Min 3R + daily bias | 321 | 35.8% | +462.3R | 6.13R | 13 | 13.4R |
| Min 3R + bias + skip Monday | 224 | 36.2% | +285.7R | 5.59R | 9 | 15.7R |
| Min 5R + bias + skip Monday | 145 | 29.0% | +199.1R | 7.65R | 12 | 11.4R |
| Fixed 5R + bias + skip Monday | 337 | 29.7% | +199.2R | 4.65R | 17 | 21.2R |

- Min 3R alone was the strongest variant: **+764.4R**, 37.1% wins, avg win
  6.42R, and 171/463 wins at **>=2R** (one 1R-2R win, no scratches).
- Adding daily bias cut net from +764.4R to +462.3R. Adding Monday skip cut it
  further to +285.7R; Monday alone accounted for **+176.6R** over the year.
- Min 5R as a floor was lower net but better DD and avg win. A **fixed** 5R
  target was much worse: 337 trades, 29.7%, PF 1.75, 17-loss streak, 21.2R DD.
- The 3-month result was window-specific. v1.005 now defaults bias/Monday to
  **false** and keeps the 3R floor, matching the stronger 12-month min-3R-only
  result. Confirm on demo/out-of-sample before trusting the forward result.

All min-3R/min-5R wins were at least +2R, except one 1R-2R trade in the 12-month
min-3R-only run; there were no scratch wins.

All distances are **price points** (1.0), not MT5 points (0.01).

## Validation run

A Strategy Tester sanity check on `USTECm` M1, `2026.07.01` to `2026.10.20`,
$100 deposit, 0.05 lot, 1-minute OHLC model:

- **12 closed trades**, 3 wins / 9 losses; final balance **$92.05**
- Wins: +$5.54, +$1.81, +$1.32 = **+$8.67**
- Losses: **−$16.62**
- All trades occurred in two clusters: July 1–7 and October 12–20;
  **no trades in August–September** because tester history was missing
- No runtime errors

This is a runtime/data sanity check, not a fair 3.7-month performance test. It
uses Exness M1 OHLC, not tick data, and the gap-entry approximation differs from
the Dukascopy backtest. The missing August–September history must be fixed before
this balance means anything.

## Known differences from the backtest

- The backtest skipped setups with no opposing level at least 1R away. Live,
  the limit has already filled, so the EA closes at market if no target exists.
- With `InpMinRewardRisk > 0`, the EA requires the nearest opposing level to be
  at least that many R away. The pre-entry check uses an estimated risk; the
  actual stop is rechecked after the entry M1 bar closes. If the actual target
  is below the minimum, the EA closes at market instead of taking a weak trade.
- `InpUseDailyBias` uses the prior RTH 09:30–16:00 candle: close above open is
  bullish (longs only), close below open is bearish (shorts only). Neutral bias
  allows both sides.
- `InpSkipMonday` blocks new entries on Monday NY; existing positions still
  follow the normal stop/target/noon-exit rules.
- Floating spread and slippage are not modeled. The max-spread filter skips
  entries when the spread is wider than 2.5 price points.
- Pending orders that are too close to market are skipped by the broker/EA.
- A provisional wide stop (`max(3 x ATR, 3 x buffer, 30 points)`) is used while the entry M1
  bar is forming; the backtest assumed the structural stop was applied after the
  bar closed.
- If a core level is already through the market at 09:30 (gap), the EA enters at
  market instead of skipping it. A resting limit would have filled at the open;
  the market fill can differ by spread/slippage.
- If two nearby limits fill on the same tick, the EA keeps the earliest position
  (lowest position ID) and closes the extras at market; that extra close can add
  slippage.
- If the EA starts after the first raid, it may miss that trade.
- No CSV journal is written yet; the Experts log is the source of truth.

## Troubleshooting

- **`RISK SKIP`** â€” the minimum lot would exceed the 5% risk maximum; skip or widen the max lot/history check.
- **`account is not a demo account`** â€” use the demo account.
- **`terminal auto-trading is disabled`** â€” enable Algo Trading in MT5.
- **`EA auto-trading is disabled`** â€” check â€œAllow Algo Tradingâ€ in EA properties.
- **`SPREAD TOO WIDE`** â€” the EA skipped entries; record actual spread.
- **No levels logged** â€” load M1 history by scrolling the `USTECm` chart back.
- **No trades** â€” `InpTradingEnabled` is still false, or the window has passed.

