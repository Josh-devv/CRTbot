# 11: Exception protocols

**What to build:** The three exception protocols — 4-day, weekly-profile/TGIF, and Asian-range — plus the news-day (NFP/CPI/FOMC) stand-down. When a protocol triggers, the default action is to stand down for the day unless the config overrides it.

**Blocked by:** 07 (First real trade — execution & risk)

**Status:** done

- [x] The 4-day protocol detects four consecutive same-direction days and flags counter-move risk
- [x] The weekly-profile/TGIF and Asian-range conditions are detected
- [x] When a protocol triggers, the engine stands down unless the config overrides it
- [x] News-day (NFP/CPI/FOMC) stand-down is enforced
- [x] Tests cover each protocol and the news-day filter

## Notes

Landed in `src/exceptions.ts`: `foldDay`, `exceptionsInPlay`, `dayStandDown`, `DayFacts`,
`ExceptionInPlay`, `DayStandDown`. `ExceptionProtocol`, `ExceptionConfig` and `NewsConfig` added to
`src/types.ts` with `StrategyConfig.exceptions`, `StrategyConfig.news`, `Decision.exceptions` and
`Decision.newsDay`; `weekdayOf` added to `src/time.ts` (Luxon's 1=Mon…7=Sun).

**Detection and enforcement are two steps (§8, AC1–AC3).** `exceptionsInPlay` reports what the day looks
like — it takes no config switch, so a protocol is detected and reported whatever the configuration then
does with it, and the decisions log always records what the day *was*. `dayStandDown` then decides: an
absent `exceptions` block enforces all three (Sham's own action is to skip the day entirely, §8), and
only an explicit `false` trades through one. Same shape for §9's news days.

**The day's facts.** `foldDay(previous, bar, cfg)` folds one bar into the session day, returning a new
object, and keeps the Asian window's range apart (only `sessionOf(...) === "asia"` bars extend it). The
engine folds one bar at a time and pushes the finished `today` onto `completedDays` at the day boundary,
so no bar is ever re-read and the detectors never see a bar that has not printed.

**The three checks (§8).**
- *4-day* — the four completed days before today all moved the same way, read as body direction
  (close vs open). A flat day (`close === open`) is not a move, so it breaks the run.
- **Weekly-profile/TGIF** — the session day is a Thursday or Friday *and* this week's range has reached
  the previous week's. Weeks are Luxon-Sunday-anchored (`weekStart`), matching the weekly profile; the
  scan is bounded to the last 14 days, which always holds both weeks however long the run is.
- **Asian-range** — the Asian window's range so far, measured against the average of the last five
  completed Asian ranges, at `ASIAN_RANGE_FACTOR = 1.5` (overridable via `exceptions.asianRangeFactor`),
  with five days required before there is any baseline to judge.

**Enforcement (§8, AC3; §9, AC4).** The gate sits in the engine's loop between managing an open trade and
resting-order fills, so a stand-down day still manages and exits an open position — "skip the day
entirely" is about not buying a new one. A pending order still resting is dropped, so nothing can fill on
a stand-down day; the skip is logged once per day as `action: "stand-down"` with every enforced reason
joined, and the detected protocols on `Decision.exceptions`. An absent `exceptions`/`news` block enforces
(§8, §9); an explicit `false` on any protocol or on `news.standDown` trades through it while the log
still records what was detected.

**Tests** (`test/exceptions.test.ts`, 9, plus 4 engine tests in `test/backtest.test.ts`, 87 total): each
protocol detected and rejected on its own edge (a counter day breaks the 4-day run, a flat day is not a
move, three days is not four; early in the week and an unexpanded week are not TGIF; Asia below the
factor and Asia that has not traded are not expanded); the configurable Asian threshold; enforcement by
default and overridden per protocol; news days by default and overridden; every reason collected; day
folding with the Asian window kept apart; and at the seam — a news day stands down with no trade, an
exception protocol skips days without consulting the strategy, a limit resting overnight cannot fill on a
stand-down day, and an early Asian expansion stands its day down.

## Follow-ups

- **§8.2's second half is not a separate trigger.** The ruleset's weekly-profile protocol also fires when
  "a news event (CPI, NFP, FOMC) has already delivered the move". That case is covered by §9's news-day
  stand-down, which is stricter (the whole day is skipped), so no separate trigger was added; if the two
  ever need to be distinguished, this is where it goes.
- **"The weekly profile has already delivered the move" is an interpretation.** It is implemented as this
  week's range having reached the previous week's by Thursday/Friday. The ruleset does not define
  "delivered". Ticket 12's expansion-day test owns weekly-profile *classification* (spec.md L100, Tier B,
  parameterised) and should replace this comparison with whatever it lands, leaving the exception
  protocol as the consumer.
- **"Asia expanded early" is read as a partial window against a whole one.** `today.asia` grows bar by
  bar, so the day flags as soon as the Asian range *so far* reaches 1.5x the average of the previous
  days' complete windows — that is what makes it "early". A gentler rule (only flag while Asia is still
  running) would need the window's end time.
- **News dates live in `SessionConfig.newsDays`, not `news.dates`.** spec.md L126 puts the dates inside
  the `news` block; `time` already owns news days (spec.md L95) and `isNewsDay` reads them, so the config
  is split: dates in `session`, the verdict in `news.standDown`. Unify when the CLI loads a config file.
- **`Decision.exceptions` names detected protocols, not enforced ones.** The log records what the day
  looked like, so an overridden protocol still appears. Deliberate, but it means the log alone cannot
  tell you whether a day was skipped *by* that protocol — the `stand-down` line's reasons can.
- **A dropped resting order on a stand-down day is not logged as "setup expired with the day".** The
  stand-down line explains the day instead. Fine while the stand-down is the louder event; worth
  revisiting if order-level auditability matters.
- **The protocols are re-evaluated every bar.** Cheap (the scans are bounded to 4/14/5 days) and needed
  because the Asian window grows intra-day, but §8.1 and §8.2 are day-constant and could be read once at
  rollover if a profile ever shows this as hot.

## Review

Two-axis review of the working diff at `d35b4c9` (Standards + Spec), both axes run as parallel
sub-agents and reported separately.

- *Hard (all fixed):* the stand-down gate sat **after** the resting-order fill, so a limit armed the day
  before could fill on a stand-down day — a new end-to-end test covers exactly that, and the gate now
  runs before the fill and drops any pending; `ASIAN_RANGE_FACTOR`/`ASIAN_AVERAGE_DAYS` were exported but
  used only inside the module; a comment line over the 100-char house limit.
- *Hard (reverted, not mine to change):* my edit had silently changed the day-rollover bias read from
  `slice(0, i + 1)` to `slice(0, i)`. The Spec axis caught it as scope creep outside ticket 11's
  acceptance criteria; reverted to the pre-existing timing and the original comment.
- *Judgement (fixed):* the engine originally rebuilt every completed day from scratch on each rollover
  (`dayFacts(bars.slice(0, i))`) — an O(n²) walk over the whole series, and `exceptionsInPlay` scanned
  the full day history per bar. Now completed days accumulate one per rollover and the weekly scan is
  bounded to two weeks, so the loop stays O(n) for ticket 02's real data. The `dayFacts` array helper came
  out entirely (the engine folds incrementally, the tests exercise `foldDay` directly). Test tidy-up: a
  `sessionDayOf` key helper replacing repeated `sessionDayStart` calls, and over-long lines rewrapped.
- *Judgement (accepted, recorded above):* the branch in `exceptions.ts` that owns §9's verdict while
  `time` owns the dates; per-bar re-evaluation; `Decision.exceptions` reporting detected protocols.
- *Spec partials accepted and recorded above:* §8.2's news-event half, the invented TGIF comparison, the
  partial-window reading of "early", `news.dates` vs `session.newsDays`, and
  `exceptions.asianRangeFactor` being an unasked-for extra key (spec.md L125 lists three booleans).
