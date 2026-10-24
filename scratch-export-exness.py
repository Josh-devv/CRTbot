#!/usr/bin/env python3
"""Export Exness MT5 M1 history to the JSON format used by scratch-ict-sniper.ts.

Requirements:
    pip install MetaTrader5 pandas

Open Exness MT5 and log in first. Then run from the repo root:

    python scratch-export-exness.py --symbol USTEC --from 2024-01-01 --to 2026-10-22
    python scratch-export-exness.py --symbol USTEC --from 2024-01-01 --to 2026-10-22 --out data/indices/USTEC-exness.json

If your account uses USTECm, export it under the name the backtester expects:

    python scratch-export-exness.py --symbol USTECm --from 2024-01-01 --to 2026-10-22 --out data/indices/USTEC-exness.json

Then run:

    npx tsx scratch-ict-sniper.ts --instrument USTEC --from 2024-01-01 --to 2026-10-22 --entry limit --stop atr --atr-mult 0.25 --leg open --target liq --window judas --levels core
"""

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import MetaTrader5 as mt5
    import pandas as pd
except ImportError as exc:
    print("Missing dependency:", exc)
    print("Install with: pip install MetaTrader5 pandas")
    raise SystemExit(1)


def parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=timezone.utc)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbol", default="USTEC")
    parser.add_argument("--from", dest="from_date", default="2024-01-01")
    parser.add_argument(
        "--to",
        dest="to_date",
        default=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    )
    parser.add_argument("--out", default=None)
    parser.add_argument(
        "--terminal",
        default=None,
        help=r"Path to terminal64.exe if auto-connect fails, e.g. C:\Program Files\Exness\terminal64.exe",
    )
    args = parser.parse_args()

    ok = mt5.initialize(args.terminal) if args.terminal else mt5.initialize()
    if not ok:
        print("MT5 initialize failed:", mt5.last_error())
        print("Open Exness MT5, log in, and try again.")
        print(r"If you have multiple terminals: --terminal C:\path\to\terminal64.exe")
        return 1

    try:
        info = mt5.symbol_info(args.symbol)
        if info is None:
            print(f"Symbol {args.symbol!r} not found. Matching symbols:")
            for symbol in mt5.symbols_get():
                if "USTEC" in symbol.name or "US500" in symbol.name:
                    print("  ", symbol.name)
            return 1

        if not info.visible:
            mt5.symbol_select(args.symbol, True)

        point = float(info.point)
        print(f"Symbol: {info.name}")
        print(f"  contract size: {info.trade_contract_size}")
        print(f"  min volume:    {info.volume_min}")
        print(f"  volume step:   {info.volume_step}")
        print(f"  point:         {point}")
        print(f"  tick size:     {info.trade_tick_size}")
        print(f"  current spread: {info.spread} points = {info.spread * point:.2f} price points")

        from_dt = parse_utc(args.from_date)
        to_dt = parse_utc(args.to_date) + pd.Timedelta(days=1) - pd.Timedelta(milliseconds=1)

        rates = mt5.copy_rates_range(args.symbol, mt5.TIMEFRAME_M1, from_dt, to_dt)
        if rates is None or len(rates) == 0:
            print("No M1 bars returned:", mt5.last_error())
            print("Try a shorter range, or load more history in MT5 (History Center / scroll the M1 chart back).")
            return 1

        df = pd.DataFrame(rates)
        df["time"] = df["time"].astype("int64") * 1000  # seconds -> milliseconds
        df["volume"] = df.get("tick_volume", 0)

        out = df[["time", "open", "high", "low", "close", "volume"]].copy()
        out = out.sort_values("time").drop_duplicates("time").reset_index(drop=True)

        out_path = Path(args.out) if args.out else Path("data/indices") / f"{args.symbol}-exness.json"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out.to_json(out_path, orient="records")

        first = pd.to_datetime(out["time"].iloc[0], unit="ms", utc=True)
        last = pd.to_datetime(out["time"].iloc[-1], unit="ms", utc=True)
        print(f"Wrote {len(out):,} bars to {out_path}")
        print(f"  {first.isoformat()} .. {last.isoformat()}")
        if "spread" in df.columns:
            avg_spread = float(df["spread"].mean()) * point
            print(f"  average spread: {avg_spread:.2f} price points")
            print(f"  use --cost {avg_spread:.2f} in the backtester if you want to match it")

        print("\nRun:")
        print(
            f"  npx tsx scratch-ict-sniper.ts --instrument {args.symbol} "
            f"--from {args.from_date} --to {args.to_date} "
            "--entry limit --stop atr --atr-mult 0.25 --leg open "
            "--target liq --window judas --levels core"
        )
        return 0
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
