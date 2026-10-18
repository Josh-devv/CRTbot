# 12: Expansion-day test

**What to build:** The anticipatory "is today an expansion day?" gate using the weekly profile, the weekly and daily OHLC framework, and Asian-session behaviour — including the heuristics that a consolidated Asia favours a London expansion and an already-expanded Asia favours a New York expansion.

**Blocked by:** 09 (H4 context layer)

**Status:** done

- [x] The engine decides "expansion day: yes/no" from the defined inputs
- [x] The Asia-consolidated → London-expansion heuristic is applied
- [x] The Asia-already-expanded → NY-expansion heuristic is applied
- [x] The gate can suppress a day's trading, and its output is visible in the decisions log

## Notes

Landed in the new `src/profiles.ts`: `asianProfile`, `weekHasExpanded`, `expansionTest`,
`AsianProfile`. `src/types.ts` gained `ExpansionSession`, `ExpansionTest`, `ExpansionConfig`,
`StrategyConfig.expansionDay` and `Decision.expansionTest`, and took ownership of `DayFacts`
(previously in `exceptions.ts`) plus the new `DayRead`. `src/time.ts` gained `isLateWeek`.
`src/exceptions.ts` now consumes `asianProfile`/`weekHasExpanded` instead of carrying its own
copies of §8.2 and §8.3's arithmetic.

**Detection and enforcement are two steps, as in ticket 11.** `expansionTest` always returns a
verdict (which the decisions log records on every decision), and `dayStandDown` only acts on it
when `cfg.expansionDay?.enforce` is set — §10's own line is "not every day expands, be
selective", so an absent config suppresses nothing and a verdict alone is information.

**The three inputs §10 names, and how each enters.**
- *Weekly profile* — `weekHasExpanded`, the week in play's range against the prior week's, both
  built from their daily candles; Sunday-anchored via `weekStart`.
- *Weekly and daily OHLC framework* — the same comparison (it *is* daily OHLC read at week
  granularity). A separate daily-range test was deliberately not written: while only Asia has
  traded the day's range is just the Asian range, so it would be a noisier copy of the Asian read
  — and §8.1's four-day protocol already encodes "the daily run has already happened".
- *Asian-session behaviour* — `asianProfile`, today's Asian window against the average of the
  last five completed windows. `ratio ≤ 0.75` → consolidated → **London**; `ratio ≥ 1.5` →
  already expanded → **New York**; in between, or no baseline yet, → not an expansion day.

**Order: week, then Asia, then the two heuristics.** A week that has delivered ends the day's
claim before Asia is read; §8.1's counter-move reading and §8.2's TGIF have their own say through
`exceptionsInPlay`. The verdict is one of `london` / `newYork` / `neither` with the reason to show.

**Late week only.** §10 names no late-week condition, but a delivered week only says something
late in it, so `expansionTest` gates the weekly read on `isLateWeek` (Thursday/Friday) — the same
window §8.2 uses, now shared rather than repeated.

**Per-bar evaluation.** The test runs once per bar like the rest of the day's reads. Asia grows
bar by bar, so the verdict firms up through the Asian window and is settled by its close (02:00)
— ahead of the London killzone, which is when it would matter.

**Tests** (`test/profiles.test.ts`, 8; 95 total): the Asian profile's range/average/ratio and its
null paths (no history, short history, no baseline, Asia not traded) and configurable lookback;
the week-vs-week read and its no-prior-week case; both heuristics; neither-way and not-yet-traded
days; the late-week veto and its early-week absence; configurable thresholds; and at the seam — a
7-day series where five days set the baseline and the sixth/seventh are consolidated/expanded:
the control trades all seven, the enforced run trades exactly two, the five skips each carry the
verdict and the reason, and an unenforced run matches the control while still logging it.

## Follow-ups

- **`ExpansionTest.session` is not yet consumed.** Nothing gates the London killzone when Asia
  has already expanded (§10's operative "London is low-probability"), nor favours New York. The
  verdict is published on every `Decision` for exactly that purpose; the execution layer is the
  consumer, and it does not exist yet.
- **The weekly-profile classification is only half of spec.md L100.** The *comparison* moved to
  `profiles.ts` (consuming ticket 11's follow-up) but stays a bare `>=` over `TWO_WEEKS` days.
  "Parameterised" means giving that a config block; the Asia factors are parameterised, the week's
  is not.
- **No separate daily-range test.** Recorded above under Notes as a deliberate reading of §10's
  "weekly and daily OHLC framework". If a daily read is ever added it belongs beside
  `weekHasExpanded`, and the degenerate case (Asia traded, day range == Asian range) must be
  handled explicitly rather than by a veto that fires before the Asia heuristics.
- **Warm-up days stand down.** With `enforce: true` the first `lookbackDays` session days have no
  baseline, so their verdict is "Asia has not given a read yet" and they are skipped. Correct, but
  it means a fresh backtest silently buys nothing for its first five days.
- **`expansionDay.lookbackDays` also sets §8.3's baseline.** `exceptionsInPlay` now reads the
  same `asianProfile`, so §10's lookback knob moves the Asian-range protocol's average too. Two
  config blocks sharing one number; give §8.3 its own knob or move the lookback if that ever
  bites.
- **1.5 appears twice** — `ASIAN_RANGE_FACTOR` (§8.3) and `EXPANSION_FACTOR` (§10) are both 1.5.
  Kept separate on purpose: same reading, different consequences and different config knobs.
- **`AsianProfile` and `DayRead` are not glossary terms.** Code shapes, like `RangeView` and
  `StructureSnapshot`, which the glossary does not carry either. The glossary already has
  *Expansion day*.
- **The verdict is read live, so it can flip inside Asia** (0.74 → 0.76 across two bars). Harmless
  today because the gate only stands a day down from the first bar of it, but a rule that acted
  late in the day would see a different verdict from one that acted early.

## Review

Two-axis review of the working diff at `390df79` (Standards + Spec), both axes run as parallel
sub-agents and reported separately.

- *Hard (fixed):* `ExpansionTest.expansionDay` named its own type and read as
  `!expansion.expansionDay` — renamed to `isExpansionDay`, and the `Decision` field renamed
  `expansionDay` → `expansionTest` so it never reads as the config block of the same name.
- *Hard (fixed):* three lines over the 100-char house limit (the `dayStandDown` doc and two test
  fixtures) rewrapped; the `bucket:` line already at `HEAD:150` was left alone as out of scope.
- *Hard (fixed):* `profiles.ts`'s doc claimed the rest of §10's OHLC framework was discretionary
  and "out of v1", while §13 (L284) lists it as Tier B, codable. Rewritten to say what actually
  happened and why.
- *Hard (fixed):* the `exceptions.ts` and `dayStandDown` docs still described only §8/§9 after
  §10 landed. Both reworded; `isLateWeek`'s citation extended to §10.
- *Judgement (fixed):* `{ completedDays, today, cfg }` travelled through four functions with the
  field docs duplicated at each — bundled into `DayRead` in `types.ts`.
- *Judgement (fixed):* §8.2's `weekday === 4 || weekday === 5` was inline and §10 needed the same
  late-week question — extracted to `isLateWeek` in `time.ts`, and §10's weekly read now honours
  it (it did not, so a week that had already expanded could veto a Monday).
- *Judgement (accepted):* the week-level veto applies on all days of the run, not just Thu/Fri —
  gated to late week now, which is what this fix established; `AsianProfile`/`DayRead` left out of
  the glossary (code shapes); the shared `{completedDays, today, cfg}` bundle left as a type
  rather than a value object of behaviour.
- *Spec partials accepted and recorded above:* no daily OHLC range test; the week comparison not
  parameterised; `session` published but unconsumed; and the verdict being per-bar rather than
  fixed before the day opens.
