# 13: Reporting & analysis

**What to build:** The performance report — statistics and equity curve with breakdowns by session, weekday and instrument, plus a cost-sensitivity mode that reruns a backtest under optimistic, mid and pessimistic spread assumptions.

**Blocked by:** 07 (First real trade — execution & risk)

**Status:** done

- [x] The report includes win rate, expectancy, average R, max drawdown, profit factor and trade count
- [x] Breakdowns by session, weekday and instrument are produced
- [x] The cost-sensitivity mode runs optimistic/mid/pessimistic spreads and results worsen monotonically
- [x] A report can be saved and re-read from a run

## Notes

Landed in the new `src/report.ts`: `ReportRun`, `RunSummary`, `BreakdownRow`, `CostPoint`,
`Report`, `buildReport`, `costSensitivity`, `serializeReport`, `parseReport`, `formatReport`.
`src/types.ts` gained `SpreadSensitivity` and the named `Costs` interface (was an inline object
type) with the optional `costs.sensitivity` bounds. `src/cli.ts` gained the `report` command and
`--out` / `--result` / `--sensitivity`; its local `formatReport` was replaced by the module's.

**The report is a pure value.** `buildReport` takes the runs plus the session config and returns
pooled statistics, the pooled equity curve and the three breakdowns; it does no printing and no
I/O, so the CLI's save and re-read paths are the only ones that touch the disk.

**One report may cover several runs.** spec.md L64 asks for results "partitionable by
instrument", so the report holds a `ReportRun[]`, pools every trade, and keeps a `RunSummary`
per run. The pooled curve is the portfolio of running all of them from one balance, so the
report documents that every run is assumed to start from the same one — a run whose balance
differed would need weighting, which nothing asks for yet.

**Groups that never traded are absent.** A breakdown lists only the sessions, weekdays and
instruments that produced a trade; empty rows would read as "this session lost nothing" rather
than "this session is not in the data". Sessions are ordered as the ruleset walks them
(asia → london → newYork → other), weekdays Monday-first (Luxon's numbering), instruments
alphabetically. A trade's session comes from its entry time, its weekday from its *session day*
— the same boundary that ends the trading day, so a 19:00 New York entry is Monday's if Monday
has not rolled over yet.

**Cost sensitivity is a mode, not a default.** `costSensitivity` returns null when
`costs.sensitivity` is absent (nothing to sweep against) and otherwise reruns the scenario three
times — optimistic, the configured spread as the mid, pessimistic — sharing the series, config
and options so only the spread differs. The bounds are validated to run optimistic ≤ mid ≤
pessimistic: without that, a swapped pair would be silently *labelled* well when it had run
badly, and the monotonicity the ticket asks for would only hold for a well-behaved config.
Results worsen strictly under the fixture: the 3R target is fixed, so every extra pip of spread
comes straight off a winner.

**Saved reports round-trip exactly.** `serializeReport` writes pretty JSON; JSON cannot hold a
non-finite number, and a run with no losing trades has an infinite profit factor, which
`JSON.stringify` would have written as `null` and read back as a number — so the three
non-finite values are written as their names and revived on the way in. No report field can hold
one of those names as text, so the revival is unambiguous. `parseReport` validates the shape it
prints by (statistics, curve, runs with statistics, breakdown rows with keys) and throws
`not a CRTbot report: …` otherwise.

**CLI.** `backtest [--out <file>] [--result <file>] [--sensitivity]` prints the report to stdout
and saves whichever file was asked for — `--out` the report, `--result` the raw run so the
decisions log (US34's rejection reasons) stays inspectable; both messages go to stderr, keeping
stdout exactly the report. `report --in <file>` re-reads a saved report and prints it; feeding it
a raw run file is refused as not a report, by design.

**The demo scenario had to change.** The old 3×96 drift bars produced *zero* trades: no
engulfment, no CSD, nothing for `axisSystem()` to fire on, so the report was always empty and the
ticket's save-and-re-read acceptance criterion could only ever have been demonstrated on nothing.
The demo now replays the execution tests' crafted set-up three days running (the length that
fixture is proven at), one trade a day inside the London killzone.

**Tests** (`test/report.test.ts`, 6; 101 total): statistics and curve of a single run against
hand-computed values (profit factor infinite, drawdown 0); the three breakdowns over two
instruments and five weekdays, including that each partition sums to the pooled count; two runs
pooling into one report with a hand-computed portfolio drawdown (100/10300) and a time-ordered
curve; the sweep's labels, spreads and strict worsening, its null path and its refusal of
inverted bounds; the save/re-read round trip including a revived infinity and four rejected
malformed files; and end-to-end through two CLI spawns — `backtest --out --result --sensitivity`
then `report --in`, asserting the re-read report prints byte-identically.

## Follow-ups

- **`dataHash` is still missing.** spec.md L152/L180 say the result records `configHash` *and*
  `dataHash`; ticket 01 deferred it, so a saved report certifies its config but not its dataset.
  Belongs with ticket 02 (real data), and then on `RunSummary`.
- **`summarise` duplicates the shape of `computeStats`.** Each breakdown row recomputes win rate
  and average R from `rMultiple`s, the same arithmetic as `stats.ts` over a bigger set. A shared
  per-group core would remove the second copy, but the rows deliberately carry no drawdown or
  profit factor, so it is not a straight reuse.
- **`costSensitivity` reruns the mid case the caller already ran.** The report's own run is the
  mid case; the sweep recomputes it. Deterministic and cheap, but the mode could take the mid
  result as an input rather than re-running it.
- **Test helpers are per-file copies.** `bar`, `approx`, `baseConfig` and the `T0`/`M15`/`DAY`
  constants are repeated across test files, and `risingDayBars` now exists twice with different
  signatures (`backtest.test.ts`, `report.test.ts`). The repo's pattern is per-file helpers;
  a shared fixtures module is the cleaner end state.
- **The demo scenario's later days do not trade.** Three days is what the crafted set-up is
  proven at; a fourth and fifth day of the same shape trade nothing (the repeated pattern stops
  producing a significant low to purge). Understood as fixture behaviour, not strategy behaviour,
  and the demo asks for nothing beyond the three.
- **Breakdowns carry no drawdown or profit factor**, so a session that wins often but wildly is
  indistinguishable from a steady one at row level; the pooled report has both metrics.
- **`formatReport` is a fixed text layout** with no column widths beyond `padEnd(10)`/`padEnd(11)`
  — a long session or instrument name would run the columns together. Session and weekday names
  are bounded; an instrument name is not.

## Review

Two-axis review of the staged diff at `bf2e4b0` (Standards + Spec), both axes run as parallel
sub-agents and reported separately.

- *Standards (fixed):* `export { maxDrawdown }` was dead — nothing imports it from `report.js`,
  and it was the one export without a doc comment. Removed, with its import.
- *Standards (fixed):* the file-top doc block floated unattached above the first export; it is
  `Report`'s doc now, and `RunSummary`'s fields got the docs `ReportRun`'s already had.
- *Standards (fixed):* seven lines over the 100-char house limit rewrapped (four in `report.ts`,
  `cli.ts`'s import, two test lines).
- *Standards (fixed):* `Costs`' doc said commission is "per trade" while `realise` charges it
  per side, twice over the round trip — the doc now matches the code.
- *Spec (fixed):* `--out` had silently taken over the old flag's job of dumping the raw result,
  which left the decisions log (US34's rejection reasons) unsaveable — restored as
  `--result <file>`, and the CLI test now asserts the dump carries its decisions.
- *Spec (fixed):* nothing enforced the sweep's ordering, so a swapped pair of bounds would have
  been mislabelled as an optimistic/pessimistic sweep; `costSensitivity` now refuses bounds that
  do not run optimistic ≤ mid ≤ pessimistic.
- *Spec (fixed):* `isReport` checked only top-level fields, so a plausible file with a run
  missing its statistics passed and then threw a raw `TypeError` from `formatReport` instead of
  the promised "not a CRTbot report". Runs and breakdown rows are now validated for what the
  printer dereferences; two tests cover it.
- *Spec (accepted, recorded above):* the CLI demo scenario was rewritten (the old one traded
  nothing, so the acceptance criterion had nothing to save); a report may pool several runs,
  which serves L64's "partitionable by instrument" — with the equal-balance assumption written
  into the module doc.
- *Judgement (accepted):* `summarise`'s overlap with `computeStats`; the sweep's duplicate mid
  run; duplicated test helpers; `dataHash` still deferred to ticket 02.
