# ICT Sniper Entries — Primary-Source Dossier

**Status:** Research dossier. No strategy code changed.
**Date:** 2026-10-21
**Instruments:** GBPUSD, EURUSD
**Question:** What do ICT's own materials actually specify about precision entries built from Fibonacci standard-deviation targets, Turtle Soup, Judas Swing/time macros, liquidity algorithms, and volatility — and what is the cleanest falsifiable backtest for CRTbot?

**Evidence labels used below:**

- **[PRIMARY]** — ICT's own video, transcript, or XWiki lecture page.
- **[SECONDARY]** — third-party guide, indicator, or transcript summary. Useful for corroboration, not authority.
- **[ACADEMIC]** — peer-reviewed paper or working paper. Tests a mechanism, not ICT's named model.
- **[SYNTHESIS]** — our design choice for CRTbot. Not an ICT rule.
- **[UNVERIFIED]** — asserted but not confirmed in an accessible primary source.

> **Scope note.** "Sniper entry" is our umbrella term, not a phrase ICT defines as a single model. The primary sources describe several overlapping entry families: Judas Swing / NY AM raid, Silver Bullet, and Turtle Soup, with Fibonacci standard-deviation projections used for targets. This dossier separates what is stated from what we are adding.

---

## Five-bullet answer

1. **The common core is a liquidity sweep, not a pattern name.** ICT's Judas/NY AM model is a time-boxed raid on a reference high/low followed by a reversal; the primary example uses an order block/FVG, but does not state a mandatory MSS rule ([Ep17, 07:00–10:00 FX](https://pickscribe.com/v/5WIqHJDQ_p4), [Ep17, 08:30 recalibration](https://pickscribe.com/v/5WIqHJDQ_p4)).
2. **Turtle Soup is the tightest literal entry.** In the 2024 lecture, the base rule is a limit at the swept old high **+1 tick** (short) or old low **−1 tick** (long), stop beyond the reference candle high/low, target the draw on liquidity ([Lecture08, 2:54–3:03](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)). The 2024-06-24 example also adds at a rejection block; that is an add-on, not the base trigger ([Turtle example, 2:53–3:01](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-06-24-NQ-Turtle-Soup-Short/)).
3. **Fib "standard deviation" is geometric, not statistical.** The exact linear convention is `P(r) = B + r(A − B)`, with `r = 0` at the second anchor `B`, `r = 1` at the first anchor `A`, and negative `r` extending beyond `B` ([TradingView Fib Retracement documentation](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/)). For an up-leg `A = L, B = H`: `P(−k) = H + k(H − L)`. For a down-leg `A = H, B = L`: `P(−k) = L − k(H − L)`.
4. **The primary Fib targets are 1.0 and 1.5 of the leg range**, with a midpoint if the exact level is unclear and a quarter-range fallback ([Lecture05, 0:59:56–1:01:58](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/), [Lecture08, 2:44:40](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)). The 2.0–4.0 levels appear only in a secondary indicator, not in the primary lectures ([FibAlgo, secondary](https://www.tradingview.com/script/YOVDkfKm-FibAlgo-ICT-Standard-Deviation-Targets/)).
5. **The cleanest first backtest is the confirmation variant, not the literal 1-tick limit.** Use the NY AM sweep + M5 reclaim + M1 MSS + first M1 FVG retrace, with a structural stop and a 1.0/1.5 projection target. The literal Turtle Soup limit is the falsification baseline; its 1-tick stop is not credible on GBPUSD/EURUSD retail spreads.

---

## 1. What "sniper entry" means in this dossier

We use **sniper entry** to mean an entry that tries to buy or sell at a specific, pre-defined price after a liquidity event, with a stop close enough to produce a high reward-to-risk ratio. It is not a single ICT model.

The primary sources contain three related but distinct models:

| Model | Time box | Trigger | Primary target logic |
|---|---|---|---|
| **Judas Swing / NY AM raid** | NY killzone, 07:00–10:00 ET for FX; 08:30–11:00 ET for indices | Sweep of a reference high/low, then reversal | Draw on liquidity / opposing pool |
| **Silver Bullet** | 03:00–04:00, 10:00–11:00, 14:00–15:00 ET | Entry inside an FVG during the window | 5-handle partial, 10-handle framework (indices); 15 pips FX |
| **Turtle Soup** | Not explicitly time-boxed in the 2024 lecture | Limit at a swept old high/low; optionally at a rejection block | Initial draw / opposing pool; Fib 1.0/1.5 projections |

**Why they get conflated.** All three can involve a sweep and a reversal. But they are not synonyms:

- **Judas** is the *time-window manipulation* concept.
- **Turtle Soup** is the *entry at the swept level*.
- **Silver Bullet** is a *time-based FVG entry* model.

The 2024 lecture explicitly says Turtle Soup can be part of an existing price run, and can occur inside an FVG, which widens the term beyond a classic "stop hunt at an old high" ([Lecture08, 2:25–2:46](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)). That broad usage is useful conceptually but dangerous operationally: it can label almost any FVG trade as Turtle Soup. We therefore define the **classic Turtle Soup** narrowly in §3.

---

## 2. Time models

### 2.1 Judas Swing / NY AM raid

**Primary time rules.** The NY killzone is `07:00–10:00 ET` for FX and `08:30–11:00 ET` for indices ([Ep17, opening](https://pickscribe.com/v/5WIqHJDQ_p4)). The `09:30–10:00` period is the **opening range**; ICT explicitly says there is no separate 15-minute opening range ([Lecture05, 1:04–1:06](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)).

**Midnight open and 08:30 recalibration.** The midnight open is the "true day open." At `08:30 ET`, ICT recalibrates: if the opening price is lower at 08:30, that lower price is used as the threshold for shorts; if higher, the higher price is used for longs ([Ep17](https://pickscribe.com/v/5WIqHJDQ_p4)). This is a reference-price rule, not a separate indicator.

**Judas definition.** Ep17 describes the Judas Swing as a protraction against the intended direction — the manipulation phase before distribution ([Ep17](https://pickscribe.com/v/5WIqHJDQ_p4)). The primary example uses a swing failure, then an order block/FVG entry. It does **not** state a generic mandatory MSS rule in the quoted passage. MSS is our confirmation addition, not a primary Judas rule.

**Operational constraints.**

- FX entries generally stop after 10:00 ET except news-driven setups; indices can run to 10:40–10:45 ET ([Ep17](https://pickscribe.com/v/5WIqHJDQ_p4)).
- No new FX trade after 10:00 is a *primary preference*, not a hard statistical rule.
- The `09:30–10:00` opening range is an equities/indices concept. Do not apply it blindly to GBPUSD/EURUSD.

### 2.2 Silver Bullet

**Primary windows.** `03:00–04:00`, `10:00–11:00`, and `14:00–15:00 ET` ([Silver Bullet 2023](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2023/ICT-YT-2023-05-15-ICT-Mentorship-ICT-Silver-Bullet-Time-Based-Trading-Model/)).

**Minimum framework.** `10 handles / 40 ticks` on indices, `15 pips` on FX ([Silver Bullet 2023](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2023/ICT-YT-2023-05-15-ICT-Mentorship-ICT-Silver-Bullet-Time-Based-Trading-Model/)).

**Entry.** Enter inside the FVG during the window; the model is time-based, not a generic "wait for a break of structure" model ([Silver Bullet 2023](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2023/ICT-YT-2023-05-15-ICT-Mentorship-ICT-Silver-Bullet-Time-Based-Trading-Model/)). The transcript does **not** require MSS in the quoted passage. Secondary guides often add MSS/OB; do not attribute that to the primary Silver Bullet rule.

**Management.** Partial at 5 handles on indices; the trade can be held beyond the one-hour window; targets include prior session highs/lows, NWOG, OTE, and FVG ([Silver Bullet 2023](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2023/ICT-YT-2023-05-15-ICT-Mentorship-ICT-Silver-Bullet-Time-Based-Trading-Model/)).

**Caveat.** ICT's claim that a setup forms "every day" is a rhetorical claim, not a verified frequency ([Silver Bullet 2023](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2023/ICT-YT-2023-05-15-ICT-Mentorship-ICT-Silver-Bullet-Time-Based-Trading-Model/)). Treat it as `[UNVERIFIED]`.

### 2.3 Turtle Soup

**Origin.** ICT presents Turtle Soup as a classic pattern adapted to his liquidity framework ([Lecture08, 2:20–2:26](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)). The original source material was not read for this dossier; the rules below are ICT's adaptation, not the original book's rules.

**Core idea.** Turtle Soup is a **run on liquidity**, not merely "price went above an old high." ICT explicitly says it does not always have to be above an old high or below an old low; it can be part of an existing directional run ([Lecture08, 2:20–2:27](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)).

**Base rule in the 2024 lecture.**

| Element | Short | Long | Source |
|---|---|---|---|
| Reference | Old candle high; also FVG candle high, breaker, rejection block | Old candle low; also FVG candle low, breaker, rejection block | [Lecture08, 2:46–2:57](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/) |
| Entry | `reference high + 1 tick` | `reference low − 1 tick` | [Lecture08, 3:03](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/) |
| Stop | Above the reference candle high | Below the reference candle low | [Lecture08, 2:57](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/) |
| Target | Initial draw / opposing liquidity | Initial draw / opposing liquidity | [Lecture08, 2:57–3:01](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/) |
| Risk cap | `1%` maximum (ICT to his son) | `1%` maximum | [Lecture08, 2:26:55](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/) |

**Why the stop is so tight.** The entry is one tick beyond the reference high; the stop is just above that same high. The literal risk is a few ticks plus spread, not a structural swing. ICT says, "too far is going above this candle high — that's a stop loss" ([Lecture08, 2:57:37](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)). He also says he does not want to see the candle's high "booked" after entry; if it trades there, price has to go two ticks above to book that price ([Lecture08, 3:03](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)). This is a **microstructure entry**, not a swing-trading stop.

**The 2024-06-24 example.** The NQ short uses an old high, an inversion FVG, and an initial draw on the low. The base short is at the old high area with a stop above the high; the example also adds a short at a rejection block/volume imbalance ([Turtle example, 2:53–3:01](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-06-24-NQ-Turtle-Soup-Short/)). The add-on does not replace the base limit rule. This resolves the apparent conflict in the sources: **base = limit at the swept level; confirmation = optional add.**

**Turtle Soup vs FVG.** In the 2024 lecture ICT says, "anytime you're trading in a fair value gap, you're literally trading in turtle soup" because you are shorting above an old high ([Lecture08, 2:46:16](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)). This is a broad pedagogical usage. It does **not** mean every FVG is a classic Turtle Soup; the classic pattern still needs a reference level that was swept.

**Breakers.** ICT says breakers often produce Turtle Soups in a changing directional run ([Lecture08, 2:55:28](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)). So the reference can be a breaker, not only an old high/low.

**What the primary lecture does not specify.**

- No minimum sweep depth in pips/ticks.
- No exact time window for Turtle Soup.
- No exact maximum hold time.
- No exact stop buffer beyond "above the high."
- No mandatory MSS or displacement filter in the base rule.
- No statistical validation.

Those are gaps, not permission to invent rules and call them ICT's.

---

## 3. Fibonacci standard deviations — exact formula

### 3.1 The convention

TradingView's linear Fib Retracement tool uses:

```text
P(r) = B + r(A − B)
```

where:

- `A` = first anchor (the start of the measurement),
- `B` = second anchor (the end of the measurement),
- `r = 0` at `B`,
- `r = 1` at `A`,
- negative `r` extends beyond `B`, away from `A`.

Source: [TradingView Fib Retracement documentation](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/).

This is the convention to use. A formula that puts `0` at the start and `1` at the end will put negative extensions on the wrong side unless the anchors are reversed.

### 3.2 Up-leg and down-leg forms

Let `R = H − L`.

**Up-leg** — measure from the low to the high: `A = L`, `B = H`.

```text
P(−k) = H + k(H − L) = H + kR
```

- `−1.0` → `H + 1.0R`
- `−1.5` → `H + 1.5R`

**Down-leg** — measure from the high to the low: `A = H`, `B = L`.

```text
P(−k) = L − k(H − L) = L − kR
```

- `−1.0` → `L − 1.0R`
- `−1.5` → `L − 1.5R`

**Worked example.** `H = 1.2000`, `L = 1.1900`, so `R = 0.0100`.

- Up-leg `−1.0` = `1.2000 + 0.0100 = 1.2100`.
- Up-leg `−1.5` = `1.2000 + 0.0150 = 1.2150`.
- Down-leg `−1.0` = `1.1900 − 0.0100 = 1.1800`.
- Down-leg `−1.5` = `1.1900 − 0.0150 = 1.1750`.

### 3.3 What "standard deviation" means here

It is a **geometric projection**, not a statistical standard deviation. There is no mean, sample, or variance calculation. ICT measures the leg range, duplicates it, and uses 1.0/1.5 multiples ([Lecture05, 0:59:56–1:01:22](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)). Calling it "standard deviation" is ICT's vocabulary; the arithmetic is a measured move.

### 3.4 Primary target management

- **1.0** is the measured move / first objective; ICT uses it for partials.
- **1.5** is the extension / runner.
- If the exact level is unclear, use the **midpoint** between the two projections ([Lecture05, 1:00:58](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)).
- **Quarter-range fallback:** for a short, `L − 0.25R`; for a long, `H + 0.25R` ([Lecture08, 2:44:40](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)).
- ICT describes these as "low threshold" / "low hanging fruit" targets, not high-probability precision guarantees ([Lecture05, 1:01:58–1:03:52](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)).

**Target hierarchy `[SYNTHESIS]`:** opposing liquidity first; 1.0 SD partial; 1.5 SD runner; quarter-range fallback. Do not use 2.0+ in the first test. The 2.0–4.0 levels come from a secondary indicator, not the primary lectures ([FibAlgo, secondary](https://www.tradingview.com/script/YOVDkfKm-FibAlgo-ICT-Standard-Deviation-Targets/)).

### 3.5 Common errors

1. **Sign error.** Measuring `L→H` and expecting negative levels below `L`. Negative levels are beyond the second anchor, so `L→H` gives levels above `H`.
2. **Wrong anchor order.** TradingView's `0` is the second click, not the first. Reverse the anchors if the extension lands on the wrong side.
3. **Treating 1.0 as a statistical probability.** It is a measured move, not a 68% confidence band.
4. **Using the full leg after a sweep.** If the reference leg is a wick, decide whether `H/L` includes the wick. Be explicit and backtest both.
5. **Using a 2.0+ target without liquidity confirmation.** A projection is not a draw on liquidity.

---

## 4. Liquidity, IPDA, and the algorithmic narrative

**What ICT claims.** The market is governed by an algorithm that seeks liquidity. The key constructs are:

- **Interbank dealing range** — the active range between significant highs/lows.
- **External range liquidity** — old highs/lows outside the current range.
- **Internal range liquidity** — FVGs, order blocks, imbalance inside the range.
- **Weekly PO3** — accumulation, manipulation, distribution across the week.
- **Algorithmic signatures** — repeated time/price patterns that reveal the algorithm's hand.

Source: [IPDA 2020](https://info.quagmyre.com/xwiki/bin/view/Forex/ICT-Youtube-Series-2020/ICT-YT-2020-09-17-ICT-Forex-Price-Action-Lesson-Advanced-IPDA-Insights-srt/). The XWiki transcript renders "IPDA" as "IPTA" in places; treat that as a transcription artifact.

**What is testable.** The useful part is the **level selection**: prior highs/lows, session extremes, FVGs, and the current dealing range. Those are observable and can be coded.

**What is not testable as stated.** "The algorithm" is an unfalsifiable narrative. There is no published specification, no data source, and no independent verification. Do not build a backtest that assumes a sentient algorithm; build one that tests whether the observable levels predict reversals.

**Academic proxy.** Osler (2003) is the closest evidence for the mechanism: take-profit orders cluster at round numbers (producing reversals), while stop-loss orders cluster just beyond round numbers (producing acceleration) ([Osler 2003](https://doi.org/10.1111/1540-6261.00588), [NY Fed PDF](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr125.pdf)). That supports a **stop-run/round-number** mechanism, not the full IPDA cosmology.

---

## 5. Volatility and displacement

**Primary statements.**

- Without medium/high-impact news, the market can be choppy/aimless; with external stimuli it can produce large runs ([Lecture05, 1:34:29–1:35:37](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)).
- High-impact news creates liquidity below/above; ICT says there is no need for a relative equal high/low in that case ([Lecture08, 3:39](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)).
- Displacement is the strong, impulsive move that creates an FVG; not every displacement has to return to the FVG, and it is better if it does not; if it returns, the move may be deferred ([Lecture05, 0:56:02–0:56:31](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)).

**What is missing.** There is **no numeric ATR threshold, volatility percentile, or minimum displacement size** in the primary material reviewed. Any such gate is our addition `[SYNTHESIS]`, not an ICT rule.

**Operational proxies `[SYNTHESIS]`.**

- Tag each day with a high-impact news flag; run the model with and without a news filter.
- Compute `ATR(14, M5)` at entry; use it only for stop sizing, not as a signal filter, in the first test.
- Record displacement size as `FVG height / ATR`; test whether larger displacement improves expectancy.
- Avoid claiming "ICT said to skip low-volatility days." The sources do not.

---

## 6. Synthesis: the three candidate models

| Variant | Entry | Stop | Target | Main weakness |
|---|---|---|---|---|
| **A. Literal Turtle Soup** | Limit at swept high `+1 tick` / low `−1 tick` | Just beyond the reference candle high/low | Initial draw; 1.0/1.5 SD | 1-tick stop is not credible on FX retail spreads; fill sequence ambiguous |
| **B. Turtle Soup confirmation** | M5 reclaim + M1 MSS + first M1 FVG retrace | Beyond the sweep extreme + buffer | Opposing pool; 1.0/1.5 SD | More filters, fewer trades; MSS/FVG are our additions |
| **C. Judas / Silver Bullet** | Time-window sweep + displacement + FVG | Beyond the sweep extreme | Prior session level / 1.0–1.5 SD | Different model; do not conflate with Turtle Soup |

### 6.1 Recommendation

**Test Variant B first.** It preserves the primary logic (sweep → reversal → draw on liquidity) while replacing the untradeable 1-tick stop with a structural stop. It also uses only closed-bar information, so it is reproducible on M1 FX data.

**Keep Variant A as the falsification baseline.** If A works after realistic costs, the edge is in the literal micro-limit; if A fails but B works, the confirmation filter is adding value. If both fail, the model is not supported on GBPUSD/EURUSD in this sample.

**Do not start with Variant C.** Silver Bullet is a separate time-based model. Mixing it into the first test confounds the result.

### 6.2 Variant B — exact test specification

All thresholds below are `[SYNTHESIS]` unless marked otherwise.

**Data and clock**

- GBPUSD and EURUSD, M1 bid or mid bars; resample to M5, M15, H1, D1.
- Timezone: `America/New_York`; all session times in ET.
- Use completed bars only; no intrabar look-ahead.
- Prior day: `00:00–00:00 ET` to match the midnight open. Also test `17:00–17:00 ET` as an ablation.
- Asian range: `19:00–03:00 ET`; London range: `03:00–07:00 ET` `[SYNTHESIS]`.
- NY AM window: `07:00–10:00 ET` (primary FX killzone) ([Ep17](https://pickscribe.com/v/5WIqHJDQ_p4)).

**Signal**

1. At `07:00 ET`, mark the nearest untapped liquidity pool above and below: prior-day high/low, Asian high/low, London high/low, midnight open. At `08:30 ET`, add the recalibrated open.
2. Wait for price to trade beyond one pool by at least `1 pip` `[SYNTHESIS]`.
3. Require an M5 close back inside the pool within `6` M5 bars `[SYNTHESIS]`.
4. On M1, require an MSS in the reversal direction: a close below the most recent confirmed 3-bar fractal low for shorts, or a close above the most recent confirmed 3-bar fractal high for longs `[SYNTHESIS]`.
5. After the MSS, take the first M1 FVG in the reversal direction; entry at the `50%` level of that FVG `[SYNTHESIS]`.
6. Cancel the setup if the FVG does not form within `10` M1 bars after the MSS `[SYNTHESIS]`.
7. One trade per pair per day; first valid setup only.

**Risk and target**

- Stop: beyond the sweep extreme by `max(2 pips, 0.25 × ATR(14, M5))` `[SYNTHESIS]`.
- Target: nearest opposing pool at least `1R` away; hard cap at `1.5 ×` the measured range; if the cap is below `1R`, skip `[SYNTHESIS]`.
- Partial: `50%` at the `1.0` SD projection if it occurs before the final target; move stop to breakeven after the partial `[SYNTHESIS]`.
- Time stop: flat by `12:00 ET` `[SYNTHESIS]`.
- Risk: `1%` of equity per trade; this matches ICT's stated maximum for his son ([Lecture08, 2:26:55](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)).
- Costs: `0.8 pip` round trip base case; also run `0.5` and `1.2` pip sensitivity `[SYNTHESIS]`.
- If stop and target are both touched in the same M1 bar, assume stop first `[SYNTHESIS]`.

**Metrics**

- Net R, expectancy, profit factor, win rate, average win/loss, max drawdown, trade count.
- MFE/MAE distributions by R.
- Results by pair, year, session, news flag, and volatility quartile.
- Bootstrap confidence intervals; report the full distribution, not just the mean.
- Out-of-sample: reserve the last 30% of the sample chronologically; do not tune on it.

**Ablations**

- No M5 reclaim.
- No MSS.
- No FVG retrace (enter at MSS close).
- No time filter (all day).
- Sweep depth `0` vs `1` vs `3` pips.
- Stop buffer `0` vs `2` pips vs `0.25 ATR`.
- Target `1.0` only vs `1.5` only vs opposing pool.
- News filter on/off.
- Prior-day definition `00:00` vs `17:00`.

**Placebos**

- Random entries inside the same window with the same stop/target distribution.
- Random sweep levels (not prior highs/lows).
- Shuffled time windows (e.g., 12:00–15:00) to test whether the NY AM clock matters.

### 6.3 Why not the literal 1-tick limit?

On GBPUSD/EURUSD, a `1-tick` stop is inside typical retail spread and slippage. The entry and stop can both be touched by the spread without any real price movement. A backtest that assumes a clean 1-tick fill will overstate the edge. Variant A is still useful as a **falsification baseline**: if the literal rule cannot survive realistic costs, the model needs the confirmation filter or should be rejected.

---

## 7. Academic evidence

| Study | Design | Finding | Relevance to ICT | Caveat |
|---|---|---|---|---|
| **Holmberg, Lönnbark & Lundström (2013)** | Opening range breakout on crude oil futures, 1983–2011 | ORB returns significantly above zero and a higher success rate; results driven by the most recent high-volatility period and not robust across subperiods | Supports time-of-day range breaks, weakly | Commodity futures, not FX; cost sensitivity; unstable over time ([DOI](https://doi.org/10.1016/j.frl.2012.09.001)) |
| **Gao, Han, Li & Zhou (2018)** | S&P 500 index/ETF intraday momentum, 1993–2013 | First half-hour return predicts last half-hour return; stronger on high-volatility, high-volume, recession, and macro-news days; economically meaningful after costs | Supports time-of-day/volatility interaction, not a specific entry model | Equity ETF, not FX; a return-predictability result, not a complete trading model ([DOI](https://doi.org/10.1016/j.jfineco.2018.05.009)) |
| **Osler (2003)** | Actual FX order data | Take-profit orders cluster at round numbers and produce reversals; stop-loss orders cluster just beyond round numbers and produce acceleration | Direct support for the stop-run/round-number mechanism behind liquidity sweeps | Dealer-specific order data; round numbers, not ICT's exact levels ([DOI](https://doi.org/10.1111/1540-6261.00588), [PDF](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr125.pdf)) |
| **Tsinaslanidis, Guijarro & Voukelatos (2021)** | Fibonacci retracement levels in three equity markets | No evidence that Fibonacci levels outperform random levels; zones around levels matter more than exact prices | Challenges Fib precision claims | Equities, not FX; tests retracements, not negative extensions ([DOI](https://doi.org/10.1016/j.eswa.2021.115893)) |
| **Shanaev & Gibson (2022)** | Fibonacci retracements on international indices and FX | Certain Fibonacci levels (0, 38.1, 50, 61.2, 100) have predictive power; a Fibonacci-based S&P 500 strategy produces alpha; other levels reduce predictive power | Mixed evidence; some Fib levels may matter | Working paper, not peer-reviewed; tests retracements, not ICT's 1.0/1.5 projections ([SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4212430)) |

**Interpretation.**

- The academic literature supports **time-of-day effects, volatility clustering, round-number stop clusters, and range breakouts** as real phenomena.
- It does **not** directly test ICT's named models, his Fibonacci extensions, or his Turtle Soup rules. No such peer-reviewed test was found in the sources reviewed.
- The Fibonacci evidence is genuinely mixed. Do not present 1.0/1.5 projections as scientifically established.
- The strongest bridge is Osler: liquidity sweeps around round numbers are consistent with a stop-run mechanism. That is a mechanism, not proof that ICT's exact entry rules are profitable.

---

## 8. Known unknowns and limitations

1. **2023 Turtle Soup video inaccessible.** [Pickscribe link](https://pickscribe.com/v/g_yqVwNI6RU) failed authentication. The dossier relies on the 2024 mentorship lecture and the 2024-06-24 example. The 2023 video may contain refinements not captured here. `[UNVERIFIED]`
2. **Exact stop buffer unspecified.** The lecture says stop above the reference high; it does not state a pip/point buffer. The literal entry implies a very tight stop, but the exact number is not given. `[PRIMARY GAP]`
3. **Exact sweep depth unspecified.** No minimum penetration in pips/ticks. Our `1 pip` threshold is synthesis.
4. **Exact Turtle Soup time window unspecified.** The 2024 lecture is not time-boxed like Silver Bullet. Our `07:00–10:00 ET` window comes from the NY AM model, not from Turtle Soup itself.
5. **MSS is not a primary Judas/Silver Bullet requirement.** The primary examples use order blocks/FVGs. MSS is a confirmation filter we added for reproducibility.
6. **Fib anchor order on ICT's charts is not machine-readable.** The formula is clear; which exact swing he anchors on a given example is not. The dossier's examples are explicit about `A` and `B`.
7. **"Standard deviation" is not statistical.** No variance/mean calculation is specified. Treat it as a measured move.
8. **IPDA's algorithm is not independently verifiable.** The observable levels are testable; the narrative is not.
9. **Original Turtle Soup source material was not read.** The dossier covers ICT's adaptation, not the original book or course.
10. **Broker execution, spread, and slippage are not modeled in the primary sources.** Variant B uses explicit assumptions; results will be broker-dependent.
11. **News calendar source is unspecified.** Use a consistent high-impact calendar and tag, not a discretionary "news day" judgment.
12. **Session definitions are ours.** Midnight open is primary; Asian/London range hours are synthesis and should be ablated.

---

## 9. Source ledger

### Primary ICT sources

| Source | URL | Used for | Limitations |
|---|---|---|---|
| **ICT 2024 Mentorship — Lecture 05** | [XWiki](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/) | Fib measurement, 1.0/1.5 targets, midpoint, quarter-range, displacement/FVG, volatility comments, opening range | Auto-generated transcript; timestamps approximate; chart annotations not visible |
| **ICT 2024 Mentorship — Lecture 08** | [XWiki](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/) | Turtle Soup base rules, entry/stop, existing-run nuance, breakers, 1% risk, standard-deviation exits | Auto-generated transcript; exact stop buffer not specified |
| **ICT 2024-06-24 — NQ Turtle Soup Short** | [XWiki](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-06-24-NQ-Turtle-Soup-Short/) | Worked Turtle Soup example; inversion FVG; rejection-block add-on; initial draw | Chart annotations not machine-readable; example is NQ, not FX |
| **ICT 2024-06-24 — Turtle Soup Short summary** | [XWiki summary](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-06-24-NQ-Turtle-Soup-Short-summary/) | Cross-check for example sequence | Summary page; not a substitute for the lecture |
| **ICT 2023 Silver Bullet** | [XWiki](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2023/ICT-YT-2023-05-15-ICT-Mentorship-ICT-Silver-Bullet-Time-Based-Trading-Model/) | Time windows, FVG entry, 10-handle/15-pip framework, 5-handle partial, hold-beyond-window | Auto-generated transcript; "every day" claim unverified |
| **ICT 2020 Advanced IPDA** | [XWiki](https://info.quagmyre.com/xwiki/bin/view/Forex/ICT-Youtube-Series-2020/ICT-YT-2020-09-17-ICT-Forex-Price-Action-Lesson-Advanced-IPDA-Insights-srt/) | Interbank dealing range, external/internal liquidity, weekly PO3, algorithmic narrative | Auto-generated transcript; "IPTA" transcription artifact; unfalsifiable claims |
| **Pickscribe — Ep17** | [Pickscribe](https://pickscribe.com/v/5WIqHJDQ_p4) | NY killzone times, midnight open, 08:30 recalibration, Judas definition, index times | Transcript; no video frames |
| **Pickscribe — Ep22** | [Pickscribe](https://pickscribe.com/v/QKc_i90chVg) | Secondary time/context checks | Transcript; not heavily used |
| **Pickscribe — Ep6** | [Pickscribe](https://pickscribe.com/v/Bkt8B3kLATQ/) | ICT's rejection of indicator/momentum/MA readings | Transcript; not a complete model |
| **ICT Deep Dive Into Institutional Order Flow** | [YouTube](https://www.youtube.com/watch?v=vN2BkfyRWE4) / [summary](https://videohighlight.com/v/vN2BkfyRWE4) | Order flow = price-action/PD arrays, not DOM/footprint | Summary, not full transcript |
| **ICT 2023 Turtle Soup video** | [YouTube](https://www.youtube.com/watch?v=g_yqVwNI6RU) | Intended primary source | **Not accessible**; Pickscribe auth failure |

### Secondary sources

| Source | URL | Used for | Limitations |
|---|---|---|---|
| **TradingView Fib Retracement docs** | [TradingView](https://www.tradingview.com/support/solutions/43000518158-fibonacci-retracement-drawing-tool/) | Exact linear formula and anchor convention | Tool documentation, not ICT |
| **FibAlgo — ICT Standard Deviation Targets** | [TradingView script](https://www.tradingview.com/script/YOVDkfKm-FibAlgo-ICT-Standard-Deviation-Targets/) | 1.0/1.5/2.0/2.5/3.0/4.0 levels; 2.0–2.5 reaction; 4.0 max expansion | Third-party indicator; not ICT primary; do not treat levels as verified |
| **Inner Circle Trader — Turtle Soup guide** | [Guide](https://innercircletrader.net/tutorials/ict-turtle-soup-pattern/) | Secondary confirmation sequence: return inside range + MSS + FVG/OB | Third-party; adds rules not in the 2024 primary lecture |

### Academic sources

| Source | URL | Used for |
|---|---|---|
| **Holmberg, Lönnbark & Lundström (2013)** | [DOI](https://doi.org/10.1016/j.frl.2012.09.001) | ORB profitability and instability |
| **Gao, Han, Li & Zhou (2018)** | [DOI](https://doi.org/10.1016/j.jfineco.2018.05.009) | Intraday momentum and volatility/news interaction |
| **Osler (2003)** | [DOI](https://doi.org/10.1111/1540-6261.00588) / [PDF](https://www.newyorkfed.org/medialibrary/media/research/staff_reports/sr125.pdf) | Stop-loss/take-profit clustering around round numbers |
| **Tsinaslanidis, Guijarro & Voukelatos (2021)** | [DOI](https://doi.org/10.1016/j.eswa.2021.115893) | Fibonacci retracement skepticism |
| **Shanaev & Gibson (2022)** | [SSRN](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=4212430) | Mixed evidence for Fibonacci levels |

---

## Appendix A — key quotes and paraphrases

Short quotes are reproduced for identification; long passages are paraphrased to avoid misattribution. Timestamps are approximate.

- **"When we're talking about Turtle Soup, we're talking about a run on liquidity."** — Lecture08, ~2:20. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)
- **Paraphrase:** Turtle Soup does not always require a sweep above an old high or below an old low. — Lecture08, ~2:27. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)
- **"Anytime you're trading in a fair value gap, you're literally trading in turtle soup."** — Lecture08, ~2:46:16. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)
- **Paraphrase:** breakers often produce Turtle Soups in a changing directional run. — Lecture08, ~2:55:28. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)
- **"Too far is going above this candle high. That's a stop loss."** — Lecture08, ~2:57:37. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)
- **Paraphrase:** the entry starts at the reference price plus one tick. — Lecture08, ~3:03. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)
- **"He can't risk more than 1%."** — Lecture08, ~2:26:55. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)
- **Paraphrase:** a quarter of the range projected below the low is the lowest-threshold target. — Lecture08, ~2:44:40. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)
- **Paraphrase:** measure the low-to-high distance, duplicate it, and use the negative 1.5 level. — Lecture05, ~0:59:56–1:01:22. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)
- **"I like to find the midpoint between that."** — Lecture05, ~1:00:58. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)
- **Paraphrase:** this is a very low-threshold targeting method. — Lecture05, ~1:01:58. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)
- **"Targets where I know they're absolutely low hanging fruit."** — Lecture05, ~1:03:52. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)
- **NY killzone:** FX `07:00–10:00 ET`; indices `08:30–11:00 ET`; `09:30–10:00` opening range; no 15-minute range. — Ep17 / Lecture05, paraphrased. [Ep17](https://pickscribe.com/v/5WIqHJDQ_p4), [Lecture05](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-09-ICT-2024-Mentorship-Lecture-05/)
- **Silver Bullet windows:** `03:00–04:00`, `10:00–11:00`, `14:00–15:00 ET`; 10 handles/40 ticks indices; 15 pips FX; entry inside FVG; 5-handle partial. — Silver Bullet 2023, paraphrased. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2023/ICT-YT-2023-05-15-ICT-Mentorship-ICT-Silver-Bullet-Time-Based-Trading-Model/)
- **Turtle Soup base:** entry at old high `+1 tick` / old low `−1 tick`; stop beyond the reference high/low; target initial draw. — Lecture08, paraphrased. [Link](https://info.quagmyre.com/xwiki/bin/view/Forex/The-Inner-Circle-Trader/ICT-Youtube-Series-2024/ICT-YT-2024-08-14-ICT-2024-Mentorship-Lecture-08/)

---

## Appendix B — formula quick card

```text
Convention: P(r) = B + r(A - B)
r = 0 at B; r = 1 at A; negative r extends beyond B.

Up leg (A = L, B = H):
  R = H - L
  P(-1.0) = H + 1.0R
  P(-1.5) = H + 1.5R

Down leg (A = H, B = L):
  R = H - L
  P(-1.0) = L - 1.0R
  P(-1.5) = L - 1.5R

Do not use a formula with 0 at the start and 1 at the end
unless you reverse the anchors. That is the usual sign error.
```

---

*End of dossier.*
