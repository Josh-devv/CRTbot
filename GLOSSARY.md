# CRTbot

An automated implementation of Sham's (@SpeculatorFL) **Axis System** for spot FX on
GBPUSD and EURUSD: a top-down directional bias, an intermediate context map, and a
lower-timeframe execution model. This glossary fixes the vocabulary the code, the spec
and the issues all share.

## Language

### The three layers

**Directional bias**:
The top-down Monthly → Weekly → Daily read of which way the market is delivering, derived
from structure, narrative and market profile.
_Avoid_: Trend, direction

**Context**:
The intermediate layer (H4) that maps the dealing range, the key level and the CRT within
it, aligned to the directional bias.
_Avoid_: Setup, zone map

**Execution**:
The lower-timeframe (M15) layer that turns a context into a trigger, an entry confirmation
and an order.
_Avoid_: Entry model, trigger layer

**Axis System**:
Sham's complete three-layer methodology — directional bias, context, execution — of which
CRT is the core mechanic.
_Avoid_: Strategy, system, method

### Structure & narrative

**Swing**:
A local turning point in price used as the raw material of structure.
_Avoid_: Pivot, tip

**Significant high / significant low**:
A swing that qualifies as structurally meaningful — a high that tested an HTF key level or
led to a low being broken; a low that purged liquidity, reacted to a key level, filled an
FVG, or showed SMT.
_Avoid_: Major high, key swing

**Dealing range**:
The active range between the most recent significant high and the most recent significant
low, built from the most recent expansion swing.
_Avoid_: Range, bracket

**Premium / discount**:
The upper / lower half of the dealing range. A short is taken from premium; a long from
discount.
_Avoid_: Overbought/oversold, high/low

**Key level**:
The specific level within the dealing range that acts as the catalyst price reacts to.
_Avoid_: Level, zone

**DOL (Draw On Liquidity)**:
The liquidity pool that price is drawn toward — the destination of the narrative.
_Avoid_: Target, magnet

**Long-term DOL / short-term DOL**:
The further-reaching liquidity pool that frames the higher-timeframe narrative, and the
nearer pool the current swing is drawn toward.
_Avoid_: HTF target, LTF target

**Narrative**:
The line connecting origin to destination — the reason the directional bias points where it
does.
_Avoid_: Story, thesis

### Liquidity

**Liquidity**:
Resting orders (stops and pending orders) that price is drawn toward and consumes.
_Avoid_: Volume, depth

**Liquidity purge / sweep**:
A wick that drives through a level, takes the resting liquidity, and rejects.
_Avoid_: Fakeout, stop hunt

**Filling liquidity**:
Price testing a key level.
_Avoid_: Mitigation

**Generating liquidity**:
Producing a CRT that itself later becomes liquidity that gets purged.
_Avoid_: —

**IRL / ERL (Internal / External Range Liquidity)**:
Liquidity inside the dealing range versus liquidity at its extremes.
_Avoid_: Inner/outer liquidity

### Mechanics

**CRT (Candle Range Theory)**:
A candle range whose wick purges liquidity and whose body then continues — the core
mechanic of the Axis System.
_Avoid_: Candle theory, range theory

**CSD (Change of State of Delivery)**:
A structural shift that occurs **after** the relative DOL is reached, at a key time, often
coupled with SMT.
_Avoid_: Choch, reversal

**MSS (Market Structure Shift)**:
A raw chart pattern of structure shifting; on its own it cannot separate a real shift from
noise, so it is weaker than CSD.
_Avoid_: Structure break, BOS

**Relative DOL**:
The DOL that the current parcel of price is being delivered toward, used to judge whether a
rejection happened before or after the destination.
_Avoid_: Local target, near DOL

**Order block**:
A candle or group of candles that shows one of the qualifying behaviours — purging
liquidity, filling liquidity, or generating liquidity — **and** is engulfed by a candle. A
candle that merely engulfs is not an order block.
_Avoid_: Supply/demand zone, block

**Propulsion block**:
An order block formed by testing a previous order block.
_Avoid_: Re-block, nested OB

**Breaker**:
A key level left by a failed order block, used after a shift.
_Avoid_: Failed block

**Mitigation**:
A return to a prior imbalance or level.
_Avoid_: Retest

**FVG (Fair Value Gap)**:
An imbalance left in price that can be returned to or filled.
_Avoid_: Imbalance, gap

**PO3 / AMD (Accumulation → Manipulation → Distribution)**:
The three-phase sequencing of a delivery: quiet accumulation, a manipulative sweep, then the
real distribution.
_Avoid_: Wyckoff, phases

**Market profile**:
The character of a stretch of price — ranging, manipulation, expansion, or retracement.
_Avoid_: Regime, mode

**Expansion**:
The real, directional move; the delivery leg whose extremes frame the dealing range.
_Avoid_: Impulse, run

**Expansion day**:
A day anticipated to deliver a true expansion, judged before trading from the weekly
profile, the weekly and daily OHLC framework, and Asian-session behaviour.
_Avoid_: Trend day, big day

### Divergence

**SMT (Smart Money Technique)**:
Divergence between correlated instruments, where one takes the liquidity and the other
fails to.
_Avoid_: Divergence, SMT divergence

**Correlated instruments**:
The pairs compared for SMT — EURUSD with GBPUSD, and EURUSD with DXY as the dollar
reference.
_Avoid_: Peers, crosses

### Time

**Killzone**:
One of the two windows in which trades are taken — the London open and the New York open.
_Avoid_: Session, window

**Key macro**:
One of the recurring key times (3:00 AM and 9:00 AM New York) at which triggers,
confirmations and tests are expected.
_Avoid_: Time window, session time

**Key time**:
Any window of opportunity — a killzone or a key macro — in which a mechanic must occur to
count.
_Avoid_: Timing

**Timed range**:
A configurable 4H candle window whose specific hours are private to Sham and treated as
configuration rather than fixed rules.
_Avoid_: Session range

**Session day**:
The trading day as measured from the configured day boundary (17:00 New York), not from
midnight.
_Avoid_: Trading day, calendar day

### Risk & trade management

**R (risk multiple)**:
One unit of the distance from entry to stop.
_Avoid_: Risk unit

**Fixed 3R target**:
The take profit is always three times the risk, and is never changed.
_Avoid_: 50 % target, opposing-end target

**Order-block open / order-block extreme**:
The entry plane (the order block's open) and the stop plane (the order block's low for a
long, high for a short).
_Avoid_: Entry price, stop price

**One trade per day**:
At most a single trade may be entered in a session day.
_Avoid_: Daily cap

**Exception protocol**:
One of the three recognised reasons the bias is unreliable on a given day — the 4-day
protocol, the weekly-profile protocol (including TGIF), and the Asian-range protocol.
_Avoid_: Filter, overrides

### Domain objects

**Instrument**:
A tradable pair; this project covers GBPUSD and EURUSD only.
_Avoid_: Symbol, ticker, asset

**Bar**:
A single OHLC data unit at a given timeframe.
_Avoid_: Candle (as the name of the data unit), `Candle`

**Candle bucket**:
The session-aligned period a bar belongs to, identified by its timeframe and its start
time — not by any OHLC values.
_Avoid_: Candle, slot

**Bar series**:
An ordered set of bars for one instrument at one timeframe.
_Avoid_: Feed, stream

**Trade**:
A single entered position with its entry, stop, target, size, exit and outcome.
_Avoid_: Position, fill

**Decision**:
One logged engine choice — enter, exit, wait or stand down — with its reason and its time
context.
_Avoid_: Signal, log entry

**Equity curve**:
The running equity after each trade.
_Avoid_: Balance series

**Config hash**:
The deterministic fingerprint of the full configuration a backtest ran under.
_Avoid_: Config id, checksum
