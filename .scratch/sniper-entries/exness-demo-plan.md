# Exness Demo Test — ICT Sniper ATR

**Goal:** test the exact ATR-scaled sniper rules on Exness USTEC for 3 months or at least ~30 trades, and compare actual fills to the backtest.

**Automation:** the MQL5 EA at `mql5/Experts/CRTbot_Exness_Sniper.mq5` now automates this plan on `USTECm`. Start with `InpTradingEnabled=false` (log only), verify the 09:25/09:30/10:00 logs, then enable it on the demo. See `mql5/README.md`.

**Do not change the rules mid-test.** If you change anything, restart the sample.

**If you are skipping the backtest, start at section 1.**

## Daily checklist

> The EA automates this checklist on `USTECm`. Use it to verify the Experts log.

- **09:25 ET** — mark prior RTH, prior week, Asian, and London highs/lows.
- **09:25 ET** — read ATR(14) on the last closed M5 bar; buffer = max(2.0, 0.25 × ATR).
- **Before 09:30** — place buy limits at lows −0.1 and sell limits at highs +0.1; 0.05 lot.
- **09:30–10:30** — first fill only. Cancel every other order immediately.
- **After the 1m entry bar closes** — set stop at the sweep extreme ± buffer.
- **At entry** — set target at the nearest opposing level at least 1R away.
- **12:00 ET** — close any open trade.
- **After the trade** — fill in one row of `exness-demo-journal.csv`.

## 0. Backtest with Exness prices first

The backtester cannot connect to Exness directly. The bridge is **MT5 history → JSON → backtester**.

1. Install the Python bridge (64-bit Python):

```powershell
pip install MetaTrader5 pandas
```

2. Open Exness MT5 and log in. Make sure **USTEC** is visible in Market Watch.

3. Export as much M1 history as Exness has:

```powershell
python scratch-export-exness.py --symbol USTEC --from 2024-01-01 --to 2026-10-22
```

If your symbol is `USTECm`, export it under the name the backtester expects:

```powershell
python scratch-export-exness.py --symbol USTECm --from 2024-01-01 --to 2026-10-22 --out data/indices/USTEC-exness.json
```

4. Backtest the same ATR rules on Exness USTEC prices:

```powershell
npx tsx scratch-ict-sniper.ts --instrument USTEC --from 2024-01-01 --to 2026-10-22 --entry limit --stop atr --atr-mult 0.25 --leg open --target liq --window judas --levels core
```

Notes:

- The export uses Exness **M1 bid bars**. It does not include tick-by-tick slippage.
- Use the printed **average spread** to set `--cost` if you want a closer cost model.
- This is a historical price test, not a live execution test. The demo in the sections below tests fills and psychology.

## 1. Demo account setup

1. Exness Personal Area → **Open demo account** (or MT5 → File → Open an Account → Exness → Demo).
2. Platform: **MT5**.
3. Account type: **Standard** (use the same type you plan to trade live).
4. Balance: **$100** is the current demo (the plan originally recommended $200; $100 is aggressive but usable for a demo).
5. Leverage: **1:400** is preferred; **1:Unlimited** is acceptable on the demo. Leverage is not the risk control — lot size is.
6. Currency: **USD**.
7. Open **USTECm** (not USTEC_x100). If your account shows `USTEC`, use that symbol.
8. Right-click USTECm → **Specification**. Record:
   - Contract size (confirmed: 1)
   - Minimum volume (confirmed: 0.05)
   - Tick size (may display as `0.00`; the EA reads the real `Point`/`TickSize` from MT5)
   - Current spread (may say **floating**; the EA logs the actual spread and skips above 2.5 price points)
9. Do **not** use USTEC_x100 or US500_x100. They are 100× bigger per lot.
10. Set lot **0.05** in the EA. Do not try 0.01 on USTECm; the broker will reject it.

If you want to see how $50 feels, open a **second** demo with $50. Do not use $10.

## 2. Time zone — do this first

The strategy is **New York time**:

- Raid window: **09:30–10:30 ET**
- Exit: **12:00 ET**

MT5 charts use **server time**, not New York time. Check the server offset and convert:

- October (EDT): 09:30 ET = **13:30 UTC**
- Winter (EST): 09:30 ET = **14:30 UTC**

If Exness server time is GMT+0, use 13:30/14:30. If it is GMT+3, add 3 hours. Confirm with a world clock. Do not guess.

The EA auto-detects the server offset at startup and logs the NY time. Check the Experts tab after attaching. If the logged NY time is wrong, set `InpServerGMTOffsetHours` manually.

## 3. Charts and indicators

> The EA performs sections 3–7 automatically. Use these steps to verify its log output.

- **M1 chart** for levels, entries, stops, and targets.
- **M5 chart** with **ATR(14)** for the stop buffer.
- At 09:30 ET, read the ATR from the **last closed M5 bar** (the 09:25–09:30 bar), not the forming 09:30–09:35 bar.

Buffer:

```text
buffer = max(2.0 points, 0.25 * ATR(14, M5))
```

All distances are **price points** (1.0), not broker pips (0.1).

## 4. Daily levels

At 09:25 ET, mark these on USTEC:

- Prior RTH high / low (09:30–16:00 ET previous day)
- Prior week high / low
- Asian high / low (20:00–02:00 ET)
- London high / low (02:00–05:00 ET)
- At 10:00 ET, add the 09:30–10:00 opening range high / low

Use the **first valid raid** in 09:30–10:30 ET. If multiple levels are swept, use the highest-priority level:

1. Prior RTH
2. Prior week
3. Asian
4. London
5. Opening range

## 5. Entry

For each low level:

```text
BUY LIMIT at level - 0.1
```

For each high level:

```text
SELL LIMIT at level + 0.1
```

- Use **0.05 lot** on USTEC.
- Place limits at the core levels before 09:30.
- After the **first fill**, cancel every other pending order.
- **One trade per day.** No second trade, even if another setup appears.
- If no level is swept by 10:30, no trade.

## 6. Stop

For a long:

```text
stop = sweep low - buffer
```

For a short:

```text
stop = sweep high + buffer
```

The backtest uses the **entry bar’s final extreme**. In the demo:

- Wait for the **1-minute entry bar to close**.
- Set the stop at that bar’s low/high ± buffer.
- If price is already beyond that stop when the bar closes, exit at market and record the slippage.
- Do **not** widen the stop after it is set.
- The EA uses a temporary wide stop (at least 30 points) while the entry M1 bar is forming, then replaces it with the structural stop. That is a safety placeholder, not a manual widening.

## 7. Target

For a long, target = nearest opposing level **at least 1R above entry**.
For a short, target = nearest opposing level **at least 1R below entry**.

Use the same core levels, plus the midnight open and 09:30 open if they are at least 1R away. If no valid target exists, skip the trade.

- Place a take-profit order at the target.
- If neither stop nor target is hit, **close at 12:00 ET**.

## 8. Risk in dollars

At 0.05 USTEC, **$0.05 per point**:

```text
1R = risk points * $0.05
```

Examples:

| Stop distance | 1R dollars |
|---:|---:|
| 5 points | $0.25 |
| 10 points | $0.50 |
| 15.7 points | $0.79 |
| 25 points | $1.25 |
| 44 points | $2.20 |

Record the actual risk for every trade. Do not assume every trade is $0.79.

## 9. Journal

The EA logs levels, intended orders, fills, stops, targets, and exits to the MT5 **Experts** tab. The CSV journal is still manual for now; copy each trade from the Experts log into the spreadsheet.

Use a spreadsheet with these columns:

```text
date
day_of_week
news_event
level_name
side
09:30_open
ATR14_M5
buffer
entry_time
entry_price
stop_price
target_price
risk_points
risk_dollars
planned_R
fill_slippage
spread_at_entry
exit_time
exit_price
exit_reason (stop/target/time)
net_R
net_dollars
max_adverse_excursion
max_favorable_excursion
rule_violation
notes
screenshot
```

## 10. What to review

Weekly:

- Number of valid signals vs trades taken
- Missed trades (and why)
- Rule violations
- Average spread and slippage
- Win rate, average win, average loss, expectancy
- Current losing streak

Backtest benchmark (NQ+ES, ATR 0.25, 12 months):

| Metric | Backtest |
|---|---:|
| Trades/year | 577 |
| Trades/month | ~48 |
| Win rate | ~39 per 100 |
| Average win | 4.29R |
| Average loss | 1.04R |
| Expectancy | +1.03R per trade |
| Max drawdown | 14.4R |
| Max losing streak | 15 |

Your demo does not need to match exactly. It needs to be in the same ballpark after **100+ trades**.

## 11. Stop / continue rules

- **Do not stop after 3 losses.** The backtest’s edge requires taking the signals. A 10–15 loss streak is normal.
- If you miss trades because you are not at the screen, the demo is not comparable. Be present 09:30–10:30 ET.
- If you break a rule, log it. Too many violations means restart.
- If the demo has a 15-loss streak and you cannot continue, that is useful information: the strategy may not fit your psychology.
- After **3 months or at least ~30 trades** (one trade/day max), review. The backtest rate would suggest more, but Exness signal frequency is lower; do not loosen the rules to force trades. If expectancy is positive and drawdown is within roughly 1.5× the backtest, consider a small live account.
- Do not go live with $10. The minimum lot makes each trade too large. Use **$150–250** minimum.

## 12. Live transition

Only after the demo:

1. Confirm USTEC min lot and point value in your live account.
2. Start with **0.05 lot** and **$200**.
3. Risk target: **1% or less per trade**.
4. Keep at least **$150–200** as a buffer. Withdraw only profits above that.
5. Never martingale.
