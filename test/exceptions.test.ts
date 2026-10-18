import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dayStandDown,
  exceptionsInPlay,
  foldDay,
  type DayFacts,
} from "../src/exceptions.js";
import { DEFAULT_SESSION_CONFIG, sessionDayStart, sessionOf } from "../src/time.js";
import type { Bar, ExceptionProtocol, StrategyConfig } from "../src/types.js";

/**
 * A session day that starts at 17:00 New York. Every date used here is in January, so 22:00 UTC
 * is the 17:00 boundary through EST.
 */
function dayOf(isoDate: string): number {
  return sessionDayStart(Date.parse(`${isoDate}T22:00:00Z`), DEFAULT_SESSION_CONFIG);
}

function cfg(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  return {
    instrument: "GBPUSD",
    session: DEFAULT_SESSION_CONFIG,
    strategy: { stopDistance: 0.001 },
    risk: { rMultiple: 3, maxTradesPerDay: 1, riskPerTradePct: 0.01 },
    costs: { spread: 0, commission: 0, slippage: 0 },
    initialEquity: 10_000,
    ...overrides,
  };
}

/** A completed day with the given body and, optionally, an explicit range. */
function facts(
  isoDate: string,
  open: number,
  close: number,
  range?: [low: number, high: number],
): DayFacts {
  const low = range?.[0] ?? Math.min(open, close) - 0.001;
  const high = range?.[1] ?? Math.max(open, close) + 0.001;
  return { day: dayOf(isoDate), open, high, low, close };
}

function withAsia(day: DayFacts, low: number, high: number): DayFacts {
  return { ...day, asia: { low, high } };
}

function protocols(completed: DayFacts[], today: DayFacts, config = cfg()): ExceptionProtocol[] {
  return exceptionsInPlay({ completedDays: completed, today, cfg: config }).map((e) => e.protocol);
}

function bar(time: number, o: number, h: number, l: number, c: number): Bar {
  return { time, open: o, high: h, low: l, close: c };
}

/** A bar at the given UTC date and time. */
function b(
  year: number,
  monthIndex: number,
  dayNumber: number,
  hour: number,
  minute: number,
  o: number,
  h: number,
  l: number,
  c: number,
): Bar {
  return bar(Date.UTC(year, monthIndex, dayNumber, hour, minute), o, h, l, c);
}

test("a day folds its bars together, with the Asian window kept apart", () => {
  // Mon 18:30 NY and Tue 01:00 NY both fall in the Asian window of the day starting Mon 17:00 NY.
  const asiaEarly = b(2021, 0, 4, 23, 30, 1.2, 1.201, 1.199, 1.2005);
  const asiaLate = b(2021, 0, 5, 6, 0, 1.2005, 1.202, 1.2002, 1.201);
  const newYork = b(2021, 0, 5, 13, 0, 1.201, 1.204, 1.2, 1.2035);
  const next = b(2021, 0, 5, 22, 30, 1.2035, 1.205, 1.203, 1.204);

  assert.equal(sessionOf(asiaEarly.time, DEFAULT_SESSION_CONFIG), "asia");
  assert.equal(sessionOf(newYork.time, DEFAULT_SESSION_CONFIG), "newYork");

  let day = foldDay(null, asiaEarly, cfg());
  assert.equal(day.day, dayOf("2021-01-04"));
  assert.equal(day.open, asiaEarly.open, "the day opens with its first bar");
  assert.deepEqual(day.asia, { low: 1.199, high: 1.201 }, "and starts its Asian range");

  day = foldDay(day, asiaLate, cfg());
  assert.equal(day.open, asiaEarly.open, "a later bar does not move the day's open");
  assert.equal(day.close, asiaLate.close, "but it does move the close");
  assert.equal(day.high, 1.202);
  assert.deepEqual(day.asia, { low: 1.199, high: 1.202 }, "the Asian range extends");

  day = foldDay(day, newYork, cfg());
  assert.equal(day.day, dayOf("2021-01-04"), "New York belongs to the same session day");
  assert.equal(day.high, 1.204, "the day spans every bar in it");
  assert.equal(day.low, 1.199);
  assert.deepEqual(day.asia, { low: 1.199, high: 1.202 }, "the Asian range stops at the window");

  day = foldDay(day, next, cfg());
  assert.equal(day.day, dayOf("2021-01-05"), "the boundary rolls the day over");
  assert.equal(day.open, next.open, "and the new day opens with its own first bar");
  assert.equal(day.asia, undefined, "a day whose Asian window has not traded has no range");
});

test("folding a bar from the next day starts a new day instead of joining it", () => {
  const monday = foldDay(null, b(2021, 0, 4, 23, 30, 1.2, 1.201, 1.199, 1.2), cfg());
  const tuesday = foldDay(monday, b(2021, 0, 5, 22, 30, 1.21, 1.212, 1.209, 1.211), cfg());

  assert.equal(monday.day, dayOf("2021-01-04"));
  assert.equal(tuesday.day, dayOf("2021-01-05"));
  assert.equal(tuesday.open, 1.21, "the new day takes its own open");
  assert.equal(tuesday.asia, undefined, "and does not inherit the last day's Asia");
  assert.equal(monday.close, 1.2, "while the completed day is left alone");
});

test("the 4-day protocol needs four consecutive days one way", () => {
  const up = (date: string) => facts(date, 1.2, 1.21);
  const four = [up("2021-01-04"), up("2021-01-05"), up("2021-01-06"), up("2021-01-07")];
  const today = facts("2021-01-08", 1.2, 1.2);

  assert.ok(protocols(four, today).includes("four-day"), "four days up flags counter-move risk");

  const reason = exceptionsInPlay({
    completedDays: [
      facts("2021-01-04", 1.21, 1.2),
      facts("2021-01-05", 1.21, 1.2),
      facts("2021-01-06", 1.21, 1.2),
      facts("2021-01-07", 1.21, 1.2),
    ],
    today,
    cfg: cfg(),
  })[0]!.reason;
  assert.match(reason, /four consecutive days down/);

  const mixed = [...four.slice(0, 3), facts("2021-01-07", 1.21, 1.2)];
  assert.ok(!protocols(mixed, today).includes("four-day"), "one counter day breaks the run");

  const flat = [...four.slice(0, 3), facts("2021-01-07", 1.2, 1.2)];
  assert.ok(!protocols(flat, today).includes("four-day"), "a day that did not move is not a move");

  assert.ok(!protocols(four.slice(0, 3), today).includes("four-day"), "three days is not four");
});

test("the weekly-profile protocol needs a late week and the expansion already delivered", () => {
  // The prior week (from Sunday 27 December) spanned 1.20-1.24.
  const priorWeek = [
    facts("2020-12-27", 1.2, 1.24, [1.2, 1.24]),
    facts("2020-12-28", 1.24, 1.23, [1.21, 1.24]),
  ];
  // This week (from Sunday 3 January) has run 1.20-1.25 by Wednesday.
  const thisWeek = [
    facts("2021-01-04", 1.2, 1.23, [1.2, 1.23]),
    facts("2021-01-05", 1.23, 1.25, [1.22, 1.25]),
    facts("2021-01-06", 1.25, 1.24, [1.24, 1.25]),
  ];

  const thursday = facts("2021-01-07", 1.24, 1.23, [1.22, 1.24]);
  const friday = facts("2021-01-08", 1.23, 1.22, [1.21, 1.23]);

  assert.ok(
    protocols([...priorWeek, ...thisWeek], thursday).includes("weekly-profile"),
    "a week that has already expanded flags counter risk late in the week",
  );
  assert.ok(
    protocols([...priorWeek, ...thisWeek], friday).includes("weekly-profile"),
    "and on the last day of the week",
  );
  assert.ok(
    !protocols([...priorWeek, ...thisWeek.slice(0, 1)], facts("2021-01-05", 1.2, 1.2)).includes(
      "weekly-profile",
    ),
    "but not early in the week",
  );

  const flat = (date: string) => facts(date, 1.2, 1.21, [1.2, 1.21]);
  const quiet = [flat("2021-01-04"), flat("2021-01-05")];
  assert.ok(
    !protocols([...priorWeek, ...quiet], flat("2021-01-07")).includes("weekly-profile"),
    "nor when the week has not reached the previous week's range",
  );
});

test("the Asian-range protocol needs Asia to expand on a recent baseline", () => {
  const quiet = (date: string) => withAsia(facts(date, 1.2, 1.21, [1.2, 1.21]), 1.2, 1.202);
  const history = [
    quiet("2020-12-29"),
    quiet("2020-12-30"),
    quiet("2020-12-31"),
    quiet("2021-01-04"),
    quiet("2021-01-05"),
  ];
  const today = facts("2021-01-06", 1.2, 1.21, [1.2, 1.21]);

  assert.ok(
    protocols(history, withAsia(today, 1.2, 1.204)).includes("asian-range"),
    "Asia at twice its recent average has expanded early",
  );
  assert.ok(
    !protocols(history, withAsia(today, 1.2, 1.2025)).includes("asian-range"),
    "Asia at a quarter more than average has not",
  );
  assert.ok(
    !protocols(history, today).includes("asian-range"),
    "and a day whose Asia has not traded yet cannot have expanded",
  );
  assert.ok(
    !protocols(history.slice(0, 4), withAsia(today, 1.2, 1.24)).includes("asian-range"),
    "with fewer than five days behind it there is no baseline to judge",
  );
});

test("the Asian-range threshold is configurable", () => {
  const quiet = (date: string) => withAsia(facts(date, 1.2, 1.21, [1.2, 1.21]), 1.2, 1.202);
  const history = [
    quiet("2020-12-29"),
    quiet("2020-12-30"),
    quiet("2020-12-31"),
    quiet("2021-01-04"),
    quiet("2021-01-05"),
  ];
  // Asia running 1.2x its recent average.
  const today = withAsia(facts("2021-01-06", 1.2, 1.21, [1.2, 1.21]), 1.2, 1.2024);
  const lenient = cfg({
    exceptions: { fourDay: true, weeklyProfile: true, asianRange: true, asianRangeFactor: 1.1 },
  });

  assert.ok(
    protocols(history, today, lenient).includes("asian-range"),
    "a lower bar counts it as expanded",
  );
  assert.ok(
    !protocols(history, today, cfg()).includes("asian-range"),
    "the default bar does not",
  );
});

test("a detected protocol is enforced unless the config overrides it", () => {
  const today = facts("2021-01-08", 1.2, 1.2);
  const four = [
    facts("2021-01-04", 1.2, 1.21),
    facts("2021-01-05", 1.2, 1.21),
    facts("2021-01-06", 1.2, 1.21),
    facts("2021-01-07", 1.2, 1.21),
  ];
  const detected = exceptionsInPlay({ completedDays: four, today, cfg: cfg() });
  assert.ok(detected.length > 0, "the fixture is in play");

  const byDefault = dayStandDown({ exceptions: detected, newsDay: false, cfg: cfg() });
  assert.equal(byDefault.standDown, true, "an absent block takes the ruleset's action");
  assert.match(byDefault.reasons[0]!, /four-day protocol/);

  const off = cfg({ exceptions: { fourDay: false, weeklyProfile: false, asianRange: false } });
  const overridden = dayStandDown({ exceptions: detected, newsDay: false, cfg: off });
  assert.equal(overridden.standDown, false, "an explicit false trades through the protocol");
  assert.deepEqual(overridden.reasons, []);
});

test("news days stand down, unless the config overrides it", () => {
  const byDefault = dayStandDown({ exceptions: [], newsDay: true, cfg: cfg() });
  assert.equal(byDefault.standDown, true, "no trading on NFP/CPI/FOMC days");
  assert.match(byDefault.reasons[0]!, /news day/);

  const newsCfg = cfg({ news: { standDown: false } });
  const overridden = dayStandDown({ exceptions: [], newsDay: true, cfg: newsCfg });
  assert.equal(overridden.standDown, false);
  assert.deepEqual(overridden.reasons, []);

  const quiet = dayStandDown({ exceptions: [], newsDay: false, cfg: cfg() });
  assert.equal(quiet.standDown, false, "an ordinary day stands down for nothing");
});

test("a stand-down lists every reason in play", () => {
  const today = withAsia(facts("2021-01-08", 1.2, 1.21, [1.2, 1.21]), 1.2, 1.206);
  const history = [
    withAsia(facts("2020-12-31", 1.2, 1.21), 1.2, 1.202),
    withAsia(facts("2021-01-04", 1.2, 1.21), 1.2, 1.202),
    withAsia(facts("2021-01-05", 1.2, 1.21), 1.2, 1.202),
    withAsia(facts("2021-01-06", 1.2, 1.21), 1.2, 1.202),
    withAsia(facts("2021-01-07", 1.2, 1.21), 1.2, 1.202),
  ];

  const detected = exceptionsInPlay({ completedDays: history, today, cfg: cfg() });
  assert.ok(detected.some((e) => e.protocol === "four-day"), "four days up");
  assert.ok(detected.some((e) => e.protocol === "asian-range"), "and Asia expanded early");

  const plan = dayStandDown({ exceptions: detected, newsDay: true, cfg: cfg() });

  assert.equal(plan.standDown, true);
  assert.equal(plan.reasons.length, detected.length + 1, "every protocol plus the news day");
  assert.match(plan.reasons.join("; "), /news day/);
});
