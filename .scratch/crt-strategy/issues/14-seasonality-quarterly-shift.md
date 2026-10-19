# 14: Seasonality & quarterly-shift

**What to build:** The Tier-B macro directional-context refinement — the quarterly-shift framework and seasonal tendencies — requiring both to agree before a macro bias is produced (otherwise the hypothesis is dumped).

**Blocked by:** 08 (Directional bias layer)

**Status:** done

- [x] Seasonal tendency is computed from ~20–30 years of monthly data
- [x] Quarterly-shift context is computed
- [x] When the two disagree, no macro bias is produced
- [x] Output is visible in the decisions log and tested on known historical windows

## Notes

Landed in the new `src/seasonality.ts`: `SeasonalRead`, `QuarterlyShift`, `MacroContext`,
`seasonalTendency`, `quarterlyShift`, `macroContext`. The three read interfaces sit in
`src/types.ts` beside the other domain shapes (the `ExpansionTest` precedent); `types.ts` also
gained `MacroConfig` and `StrategyConfig.macro`, and `Decision` gained the optional `macro` field.
`dayStandDown` grew a `macro` input and stands the day down while the macro context has no bias,
when `cfg.macro.enforce` is set. `backtest.ts` reads the context at the session-day rollover.

**The readings are this bot's, and they are blunt.** The ruleset names the framework and leaves
the depth open (§15), so the module doc records the readings and each function's doc cites
§3.1.1 beside the rule it implements:

- **Seasonal tendency** is per calendar month: the share of that month's completed history that
  closed up. Above `bullishShare` (default 0.7) it is bullish, below the mirror it is bearish,
  anything between is no tendency. `minYears` defaults to 20 — the bottom of the 20–30 years §13
  says a tendency wants. The ruleset's "best time to be bullish is the start of the month" is a
  timing claim inside a month that monthly candles cannot evidence, so it is deliberately not
  modelled.
- **Quarterly shift** is the last completed quarter's delivery — its close against its own open.
  The ruleset also frames the read as confirmation against the quarter before it; with
  continuously priced months the quarter opens where the previous one closed, so the two are the
  same question and the read is one comparison, not two. That equivalence is what the code leans
  on, so it is written into the function's doc.
- **The macro context** is produced only when the two reads agree. Otherwise the hypothesis is
  dumped: `direction: "none"` — whatever either side said, nothing supports the other. A read
  that has nothing to say (thin history, a flat quarter, an unfinished quarter in the data) is
  also not agreement. Both sides are always published with the verdict, because a dump is only
  explainable if the log shows what each side saw.

**The read is monthly level, so it is computed at a monthly cadence.** Nothing it depends on can
change inside a month — the seasonal history is strictly *completed* months and the quarterly read
is the last *completed* quarter — so the lock is the month bucket: at each session-day rollover the
month is checked and the context recomputed only when it has turned. The crafted seam test's
fixture was already 300 months long, and re-reading per day made it minutes instead of seconds.

**Enforcement is opt-in, and absent readings count as no bias.** `dayStandDown` adds
`no macro bias: …` while `cfg.macro.enforce` is set and the context has no direction, matching how
`expansionDay.enforce` gates ticket 12's test. Unenforced, the read rides on every decision and
nothing else changes. One consequence is documented on `MacroConfig`: with less than `minYears` of
history behind it, enforcement stands virtually every day down — a deliberate reading of "no macro
bias, no hypothesis", not an accident.

**Tests** (`test/seasonality.test.ts`, 7; 108 total). Six unit tests drive the readings directly
over a constructed 25-year "known window": a whole month of one-way months (April bullish,
November bearish), the even split that is no tendency, the configurable bar, insufficient history
saying how much it has, an up and a down quarter, an unfinished and a flat quarter (exact-zero
deltas, since a float epsilon would slip through `<`/`>`), and the agree/disagree matrix with each
side's reason. The seventh is the seam test: the read rides on the decisions log; a disagreement
logs `direction: "none"` *and still trades*; enforced, the crafted April day stands down exactly
once with a `no macro bias` reason and the run produces no trade.

**The seam fixture trades on purpose.** A monthly-history-only series has no killzone bars, so the
set-up day was appended to it — after a probe established that the default strategy trades the
monthly bars themselves, and that the four-day protocol stands the crafted day down, which is why
the fixture disables the exception protocols (they are ticket 11's business). Query month April
2021, last completed quarter Q1 2021.

## Follow-ups

- **The harness re-reads the whole prefix once per session day.** `biasSnapshot` aggregates the
  entire series slice at every day rollover, which is quadratic in the bar count: the 300-month
  fixture cost ~60s a run, which is why the seam test keeps three years and lowers `minYears`.
  Ticket 02's multi-year M1 data will not survive this — the reads want an incremental (rolling)
  aggregate before that data lands, and the macro read added here inherits the same shape
  (monthly cadence, but still a full-slice aggregate).
- **The "known historical windows" are constructed.** AC4's windows are the fixture's, not real
  GBPUSD/EURUSD months; the real windows arrive with ticket 02's data, and the seasonal defaults
  (20 years, 0.7 share) should be calibrated on them.
- **The quarterly confirmation leg is degenerate by construction.** "Closed above its open" and
  "closed above the previous quarter" are one question only while months chain without gaps or
  jumps; a dataset with a discontinuity would need the confirmation implemented for real.
- **The month-start/end timing claim is unmodelled.** The ruleset's bullish-start/bearish-end
  month saying needs intra-month evidence (daily closes within the month), not monthly candles.
- **`minYears` defaults to the bottom of §13's range.** 20 may still be too generous a bar for a
  "tendency" on FX; 30 is the conservative end and nothing is calibrated yet.
- **GLOSSARY.md does not carry the new terms yet.** Seasonal tendency, quarterly shift and macro
  directional context are domain vocabulary now; a `domain-modeling` pass should add them.

## Review

Two-axis review of the working tree at `20bcb00` (Standards + Spec), both axes run as parallel
sub-agents and reported separately.

- *Standards (fixed):* the `expansionTest`/`macro` fields in `Decision` had regressed to 4-space
  indentation against the file's 2-space house style (no formatter catches it).
- *Standards (fixed):* `dayStandDown`'s doc still enumerated three stand-down reasons; the macro
  reason is now listed with its § reference.
- *Standards (fixed):* over-length lines rewrapped across `seasonality.ts`, `types.ts`,
  `backtest.ts` and the test; `seasonalTendency`'s doc now cites §3.1.1 like its neighbours.
- *Standards (fixed):* the two test fixture builders each hand-rolled the same Bar shape; both
  now call one `monthCandle`. The nested ternary choosing the dump reason is an if-chain now, the
  `macroToday`/`macroMonth` pair became `macroToday`/`macroMonthStart`, and the doubled
  `macroToday ?? undefined` became one `macroRead` local.
- *Standards (accepted):* per-file test fixtures stay as they are — the repo's demonstrated
  pattern, already recorded as a follow-up on ticket 13.
- *Spec (fixed):* AC1 asks for a tendency "computed from ~20–30 years of monthly data" and the
  default was 10 (the ruleset's evidence for the start/end-of-month saying, a different claim);
  `DEFAULT_MIN_YEARS` is 20 now.
- *Spec (fixed):* the module doc still described the quarterly read as two conditions ("confirmed
  by where it closed against the quarter before it") after the implementation had collapsed them
  into one question; the doc now states the equivalence the code leans on.
- *Spec (accepted, recorded above):* enforcement is a config switch rather than always-on —
  disagreement always dumps the read but only stands the day down under `cfg.macro.enforce`,
  mirroring ticket 12's `expansionDay.enforce`; a merely absent read counts as no bias under
  enforcement; and the "known historical windows" are constructed pending ticket 02's data.
