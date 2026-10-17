# TypeScript/Node with a hand-rolled engine and a single backtest seam

CRTbot is written in TypeScript on Node (ESM, strict), with a hand-rolled bar-replay
backtester rather than an off-the-shelf framework, and the whole replay is reached through
one function: `runBacktest(series, cfg, options) → { trades, equityCurve, stats, decisions,
configHash }`.

**Considered options:** A Python stack (backtrader / vectorbt / pandas) is the obvious
default for backtesting, and existing frameworks would remove a lot of plumbing. Rejected
for two reasons. First, the Axis System's mechanics are highly bespoke — session-anchored
candle aggregation, purge-versus-CSD disambiguation, order-block engulfment rules — and
bending a general framework to model them costs more than writing the replay loop directly.
Second, this machine's Python installation is a broken Windows Store stub, so a Python
toolchain would have to be provisioned from scratch before any work could start, whereas
Node is already present and working.

**Consequences:** We own the replay loop, the fill/cost model and the statistics. The
single seam keeps the strategy pluggable behind a narrow interface and makes the whole
engine testable from one entry point; it also means every new mechanic lands as a value
flowing through that seam rather than as a framework hook. Performance work, if it is ever
needed, is ours to do.
