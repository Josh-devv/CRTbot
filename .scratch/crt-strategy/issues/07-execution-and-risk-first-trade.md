# 07: First real trade — execution & risk

**What to build:** The execution layer — entry triggers (key-level reaction, liquidity purge, SMT divergence), entry confirmations (order block first, then FVG formation, then MSS), and order placement (entry at the order-block open, stop at the order-block extreme, fixed 3R target) — combined with the risk rules (maximum one trade per day, killzones only, no moving stop/target, no scaling). The result is the first verified CRT trade end-to-end.

**Blocked by:** 06 (Order blocks)

**Status:** done

- [x] A crafted CRT scenario produces exactly one trade with the expected entry, stop and target
- [x] The target is always exactly 3R from entry; the stop is at the order-block extreme
- [x] No more than one trade is taken per day
- [x] No trade is taken outside a killzone
- [x] The stop and target are never modified during a trade
- [x] The decisions log states the rejection reason when no trade is taken

## Notes

Landed in `src/execution.ts` (`axisSystem`), with the engine reworked in `src/backtest.ts` and
the strategy contract widened in `src/strategy.ts`.

**Strategy contract.** `StrategyResult = Signal | Wait | null`. `Signal` gained optional
`entry`/`stop`: when a strategy supplies them the engine rests a limit order at `entry`; when it
does not, the walking-skeleton path (market entry at the bar close, stop from
`strategy.stopDistance`, target at `risk.rMultiple`) is preserved. `Wait` carries a reason that
the engine writes to the decisions log. `StrategyContext` now exposes `session`, `killzone`,
`structure`, `liquidity`, `orderBlocks` and the day-rollover state.

The take profit is **never** passed in as a signal field — the engine always derives it as
`entry ± rMultiple × risk`, so the fixed-3R invariant (ADR-0003, spec line 143) cannot be
bypassed by a strategy.

**Execution (`axisSystem`).** Declines outside a killzone ("outside a killzone"), when no order
block was confirmed, and on a degenerate zero-risk block. It prefers the block carrying the
`purge` behaviour — the CRT — and otherwise takes the first confirmed block. Placement:
`entry = block.open`, `stop = long ? block.bottom : block.top`; the engine then adds the fixed
3R target (§5.3). The killzone rule lives in the strategy, not the engine: it is a setup-selection
rule, while the engine owns only the trade-record invariants (the daily cap, and SL/TP never
moving).


**Pending limit orders.** A priced signal arms a resting order keyed to the session day; it
fills when a later bar trades to the entry (`low <= entry` for a long, `high >= entry` for a
short), at `entry ± (halfSpread + slippage)`. The fill bar is then checked for an exit, stop
before target (conservative — intrabar order is unknown). Unfilled setups expire at the session
rollover and log "setup expired with the day"; the daily trade counter resets on the session day,
not UTC midnight.

**Killzone gating.** Enforced by `axisSystem` via `ctx.killzone`. An engine-level
`risk.killzonesOnly` flag was prototyped during review and removed: it defaulted to `false`
(weakening a rule the spec states unconditionally) and duplicated the strategy's own check.

**Tests** (`test/execution.test.ts`, 4): a crafted CRT fixture (bearish purge at index 7
sweeping the significant low 8.8, engulfed by index 8 → block open 9.5 / extreme 8.7, retrace to
9.5 at index 9, target 11.9 hit at index 12) covers AC1/AC2/AC5; a non-killzone run covers AC4;
a second same-day setup covers AC3.

## Follow-ups

- Entry triggers for key-level reaction and SMT divergence are still unimplemented (§5.1);
  `axisSystem` currently fires on any confirmed block.
- Entry confirmations are order block only — FVG formation and MSS are pending.
- The fixture is degenerate (1-minute synthetic bars) by design; a real-data run is blocked on
  ticket 02.
- Costs are modelled at a flat commission per side; per-lot commission is a ticket-01 finding
  still open.
