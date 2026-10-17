# 02: Real market data ingestion

**What to build:** An `ingest` CLI command that reads HistData M1 CSV files for GBPUSD and EURUSD, validates them (gaps, duplicates, OHLC consistency, non-positive prices), writes Parquet partitioned by symbol and year with UTC timestamps, and lets the backtester load a real date range and run.

**Blocked by:** 01 (Walking skeleton & seam)

**Status:** ready-for-agent

- [ ] Ingesting HistData M1 files for GBPUSD and EURUSD produces Parquet data
- [ ] Invalid rows (duplicates, OHLC violations, non-positive prices) are detected and reported, not silently stored
- [ ] A backtest runs over a real multi-year date range for both instruments
- [ ] Stored timestamps are UTC and round-trip correctly
- [ ] Tests cover the validation rules with crafted bad input
