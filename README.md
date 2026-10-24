# CRTbot

Research and demo-trading code for an ICT sniper model on NQ/ES proxies and
Exness `USTECm`.

## What is in this repo

- `src/`, `test/` — the original CRTbot strategy engine for GBPUSD/EURUSD.
- `scratch-ict-sniper.ts` — the NQ/ES sniper backtester.
- `mql5/Experts/CRTbot_Exness_Sniper.mq5` — the MetaTrader 5 demo EA (v1.005).
- `mql5/README.md` — EA inputs, schedule, safety notes, and known limitations.
- `.scratch/sniper-entries/` — the research, backtest report, demo plan, and journal.

## Requirements

- Node.js 22+
- npm
- MetaTrader 5 with an Exness demo account (for the EA only)

## Backtest setup

```powershell
npm install
npm test
npm run typecheck
```

The market data is intentionally not committed (`data/` is ignored). The
Dukascopy download/parse scripts are included:

```powershell
powershell -ExecutionPolicy Bypass -File .\scratch-fetch-duka.ps1 -From 2024-10-20 -To 2026-10-23
npx tsx scratch-fetch-duka.ts
```

The local NQ/ES files currently contain roughly two years of M1 data. A true
ten-year NQ/ES test needs a separate ten-year M1 history.

## Reproduce the 12-month backtest

```powershell
npx tsx scratch-ict-sniper.ts --instrument both --from 2025-10-20 --to 2026-10-19 --entry limit --stop atr --atr-mult 0.25 --leg origin --target liq --window am --levels core --min-plan 3
```

Expected reference result: **463 trades, 37.1% win rate, +764.4R**, subject to
the same data and version.

## MetaTrader 5 EA

1. Open Exness MT5 and use a **demo** account.
2. Copy `mql5/Experts/CRTbot_Exness_Sniper.mq5` into
   `MQL5\Experts\CRTbot\`.
3. Compile it in MetaEditor.
4. Open a `USTECm` **M1** chart and attach the EA.
5. Keep `InpDemoOnly=true`.
6. Start with `InpTradingEnabled=false` and check the Experts log for the
   09:25/09:30/10:00 NY messages.
7. Only then set `InpTradingEnabled=true`.

`InpMaxLot` must match the account: `1.0` for a ~$100 account, `40` for a
~$23k account. Do not use this on a live account.

## Status

The 12-month NQ/ES backtest is strong. The quality-score tiers in v1.005 are
still a hypothesis, A+ risk above 3% is locked behind `InpAPlusValidated`, and
longer-horizon validation is incomplete. Treat the EA as a demo experiment,
not a proven production system.

## Sharing

This repository is private. Do not add broker credentials, terminal logs,
account numbers, `.env`, or `node_modules/` to it.
