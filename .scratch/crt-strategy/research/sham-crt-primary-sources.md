# Sham CRT — Primary-Source Research Dossier

> **SUPERSEDED IN PART (2026-10-17):** The project owner supplied Sham's private **"Axis Circle"**
> mentorship (Ch1–8). Where this public-source dossier and `axis-system-ruleset.md` disagree, the
> ruleset wins. Notable corrections: TP is a **fixed 3R** (the public "50 % / opposing end" target
> is superseded); bias is the full M/W/D top-down (not merely counter-purge); SMT is now defined.
> Instruments are now **GBPUSD + EURUSD only** — the NAS100/SPX500 SMT pairing below is out of scope.

**Subject:** "Sham" (@SpeculatorFL on X; YouTube `@SpeculatorFL`; Telegram `t.me/ShamSpeculatorFL`) and his strategy **CRT — Candle Range Theory**.
**Purpose:** Document the method with enough operational precision for a developer to implement and backtest it on GBPUSD, EURUSD (and NAS100/SPX500 as an SMT-correlated pair).
**Method:** Direct retrieval of Sham's own X threads as mirrored on Rattibha (fetched 2026-10-17 via `r.jina.ai` reader; direct rattibha requests return HTTP 403). Mirrors preserve the tweet text faithfully; chart images attached to tweets could NOT be read as text, so any rule that exists only inside a chart image is marked as **not recoverable from public text**.
**Source-class key:** `[PRIMARY]` = Sham's own words. `[PRIMARY-CREDITED]` = another author's thread that explicitly credits Sham ("Credits: @SpeculatorFL") — treated as near-primary but second-hand. `[SECONDARY]` = third-party explainer. `[LEAKED/PAYWALLED]` = paid-course material; existence noted, content not relied on.

Codability labels used throughout: **[CODABLE AS-IS]**, **[CODABLE w/ PARAMETERS]** (implementable once a numeric parameter is chosen), **[DISCRETIONARY]** (requires human judgment he never formalized).

---

## 1. Origin & definition of CRT

- **Authorship:** Sham states unequivocally that CRT was created by **@Romeotpt ("R")**, and that aside from R "the only secondary source for CRT is @SpeculatorFL [Me] and few chefs"; "Anyone else claiming to know anything about CRT is fully lying." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604))
- **Core definition:** "The fundamental theory and concept of CRT can be summarized as **'Every single candle is a range.'** Each candle, similar to a conventional range, possesses both H/L along with fixed O/C prices." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604))
- **Key property — objectivity:** "Unlike other typical ranges, where there may be some subjectivity in selecting the appropriate high or low, candle ranges are entirely objective… **Your lower-timeframe range is a higher-timeframe candle.** It follows exactly all the rules of a typical range." ([PRIMARY](https://en.rattibha.com/thread/1780825580789014848))
- **How it is drawn:** A CRT is the H/L box of one closed HTF candle, projected onto a lower timeframe. H4 candles "formed at 0100, 0500 and 0900" are the named exemplars ([PRIMARY](https://en.rattibha.com/thread/1780950720969117795)); the framework maps M15-CRT→M1, H4-CRT→M15, Daily-CRT→H1, Weekly-CRT→H4 for scalp/intraday/swing/position ([PRIMARY](https://en.rattibha.com/thread/1807846346528821278)).
- **Internal structure:** "according to CRT every candle harbors its own **PO3 [Power of 3] or AMD**" — Accumulation, Manipulation (TS), Distribution ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604), [PRIMARY](https://en.rattibha.com/thread/1790141530461622525)).
- **CRT subsumes ICT concepts:** "CRT integrates: MMXM (a thing of the past now), AMD or PO3, OHLC or OLHC…", ([PRIMARY tweet, mirrored index](https://en.rattibha.com/SpeculatorFL/recent/page/3) — full text only in image).
- **3-candle anatomy (community restatement, consistent with Sham's usage):** Candle 1 = range/accumulation; Candle 2 = manipulation/purge (ideally closes back inside); Candle 3 = distribution/expansion to opposite side. ([SECONDARY](https://github.com/psion2/CRT_Trading_Bot/blob/master/RULES.md); Sham's own threads consistently reference trading "the 2nd candle" and "the 3rd candle" ([PRIMARY](https://en.rattibha.com/thread/1791040543633658036), [PRIMARY](https://en.rattibha.com/thread/1794311615535518154)).)

**Codability:** Definition is **[CODABLE AS-IS]** (a CRT = high/low of a specified closed HTF candle). The HTF→LTF mapping is **[CODABLE w/ PARAMETERS]** (timeframe pairs are stated; which pairs to run on GBPUSD/EURUSD is a config choice). PO3 sub-phases are **[DISCRETIONARY]** (see §4/§7 — never given explicit bar-level definitions in text).

---

## 2. CRT selection protocols (his filters)

Sham lists protocols in two overlapping enumerations. From the master thread, "these are some of the most intricate and significant protocols": LTF CRT within HTF CRT; inside bars within CRT; CRT formed at specific times; key levels around CRT; pairing different CRT; market profile with CRT ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)). From the selection thread: PD Array; LTF CRT within HTF CRT; timing of CRT; timing of purge of CRT; inside bars ([PRIMARY](https://en.rattibha.com/thread/1794311615535518154)). Consolidated list:

1. **Inside bars within the CRT.** "Inside bar candles inside Candle ranges represent 'accumulation of interest'… The greater the number of inside bars, the better the CRT." ([PRIMARY](https://en.rattibha.com/thread/1780950720969117795), [PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) — **[CODABLE AS-IS]** (count of bars with high<prev high and low>prev low inside the range; "better" quality weighting is **[CODABLE w/ PARAMETERS]**).
2. **Key levels / HTF PD arrays around the CRT.** Hierarchy of key levels, highest→lowest quality: **Rejection blocks → Orderblocks → Fair value gaps → Breakers** ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)). Timeframe coupling rule: "If you're using H4 for finding CRT, then you must use the daily timeframe for coupling key levels with it. Similarly, if you're using the daily for finding CRT, then… the weekly timeframe." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) "There must be an HTF PD array around CRT to be considered correct and valid." ([PRIMARY](https://en.rattibha.com/thread/1794311615535518154)) — **[CODABLE w/ PARAMETERS]** for OB/FVG/breaker (each has ICT-standard definitions); **[DISCRETIONARY]** for Rejection Blocks (Sham never defines them in public text) and for what counts as "around" (no distance threshold given).
3. **CRT formed at a specific time.** "Time > Price… there are key times that you should use to find the most accurate CRT." Named exemplars: H4 candles at 0100/0500/0900; "Monday's candle range"; week-of-month / day-of-week / time-of-day, "coupling all of them together." ([PRIMARY](https://en.rattibha.com/thread/1780950720969117795)) — **[CODABLE w/ PARAMETERS]** (the specific time windows in §7 are stated; the general "key times" universe is not exhaustive).
4. **Purge at a key time.** "Just as high-quality CRTs form at specific times, high-quality purges of CRT ranges also occur at specific times… We can apply the 159 and 369 analogy here." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) — the concrete purge windows are **[CODABLE w/ PARAMETERS]** (3–4 AM for the 3 AM model; 2–5 AM for London LOTD; 8:30–9:30 for NY — see §7); the "159/369 analogy" is **[DISCRETIONARY]** (never defined in his public text).
5. **Purge tests an HTF key level.** "The purge should test a higher timeframe key level." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187)) Related signature: price forms a low just above a key level → purges an opposing high → takes out that low and tests the key level → "You'll always find a CRT there." ([PRIMARY](https://en.rattibha.com/thread/1835623705424388241)) — **[CODABLE w/ PARAMETERS]** (touch test = wick into level; thresholds unstated).
6. **Alignment with HTF draw on liquidity.** "The CRT must be aligned with the higher timeframe draw on liquidity." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187)) — **[DISCRETIONARY]** at the top level (DOL selection, §3), **[CODABLE AS-IS]** once DOL is given (same-side direction check).
7. **Range large enough for RR.** "The CRT should have a range large enough to offer a favorable RR edge." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187)) — **[CODABLE w/ PARAMETERS]** but the threshold is NOT stated publicly; needs an ATR- or pip-based parameter.
8. **Pairing different CRTs (macro + micro) on the same timeframe.** "In this example, we observe a macro CRT where one side has already been purged, providing us with a bias and DOL towards the opposing end… As we approach this opposing end, we can search for micro CRTs within it and exploit it. CSD could also confirm the purge." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) — **[DISCRETIONARY]** (macro/micro nesting has no size ratio).
9. **LTF CRT within HTF CRT.** "You wait for a big bulky candle on the LTF to confirm a HTF CRT, and then that candle becomes your LTF CRT, which you can trade on a further lower timeframe." ([PRIMARY](https://en.rattibha.com/thread/1794311615535518154)) — **[DISCRETIONARY]** ("big bulky candle" is undefined).
10. **Market profile with CRT** (ranging / manipulation / expansion profiles; OHLC & OLHC candle-shape profiles). ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604), [PRIMARY](https://en.rattibha.com/thread/1806046738425270534), [PRIMARY-CREDITED](https://en.rattibha.com/thread/1860564754869236074) "OHLC / OLHC of H4 5am candle") — **[DISCRETIONARY** / partially **[CODABLE w/ PARAMETERS]]** (OHLC vs OLHC ordering is codable; "profile" classification is not formalized in text).
11. **Conformational vs Advanced CRT (his two selection methods).** "Conformational CRT: requires confirmation before trading… you only trade the 3rd candle… wait for the 2nd candle to close, and then trade the 3rd candle after the 2nd candle confirms the CRT." "Advanced CRT… You trade without confirmation… you trade both the 2nd and 3rd candles… requires more intuition, chart time, and experience." "a high-quality CRT follows at least 3-4 protocols to be considered correct." ([PRIMARY](https://en.rattibha.com/thread/1794311615535518154)) — Conformational mode is **[CODABLE AS-IS]**; Advanced mode is **[DISCRETIONARY]**.
12. **Scoring heuristic (loose):** "Each protocol added, further increases the margin of quality and probability by 11%"; CSD-on-lower-TF "alone increases the probability by a 50% margin." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) — marketing numbers, **not** a codable weighting; treat as flavor text.

---

## 3. HTF bias / Draw on Liquidity (DOL)

Sham's "daily bias" thread defines bias and DOL derivation as a logical IF/THEN framework ([PRIMARY](https://en.rattibha.com/thread/1789657142191890597)):

- **Daily bias** = "the anticipated direction in which the current daily could potentially close." Tools: Structure; PD Array Matrix; OHLC-OLHC; Last Candle Profile; Weekly Profiles; CRT.
- **Structure (his non-subjective variant):** "Is price breaking highs and rejecting lows? Is price breaking lows and rejection highs? Is price stuck between a high and a low?" Bullish = breaking highs and rejecting lows; "price can definitely go below lows but it can't break them… price can't close twice below the lows" (mirrored for bearish). ([PRIMARY](https://en.rattibha.com/thread/1789657142191890597)) — **[CODABLE w/ PARAMETERS]** ("close twice below" is a concrete, implementable rule; "rejecting" is not).
- **PD Array Matrix:** measure whether price is in discount / premium / equilibrium of the dealing range and match with a PD array. Bullish structure + premium + premium PD array → expect retracement to discount/equilibrium before higher; bullish + already in discount inside a PD array → expect expansion higher without retracement; equilibrium → expansion. (Bearish mirrored.) ([PRIMARY](https://en.rattibha.com/thread/1789657142191890597)) — **[CODABLE w/ PARAMETERS]** (equilibrium band width unspecified).
- **OHLC cycle:** "Open (accumulation) → manipulation (price forms the low or high) → distributed/expands to opposing end → Close." "Even if the price structure is bullish… we won't buy straight away. Instead, we'll wait for the price to form the low of the day during a specific time and then enter." ([PRIMARY](https://en.rattibha.com/thread/1789657142191890597))
- **Last Candle Profile:** "looking at the last daily candle and seeing whether it was a ranging candle or an expansion candle and then based on those factors determining whether today's daily candle could be an expansion, ranging, retracement or reversal candle." ([PRIMARY](https://en.rattibha.com/thread/1789657142191890597)) — **[DISCRETIONARY]** (no thresholds).
- **Mechanical beginner DOL (from the 3 AM model):** bias = counter-direction of the purge; DOL = "the opposing 50% of the range and the opposing end of the range." ([PRIMARY](https://en.rattibha.com/thread/1791750924664537322)) — **[CODABLE AS-IS]**. Sham warns: "you should only use these mechanical rules if you're a beginner… You could use the daily bias concept to determine your bias and draw on liquidity." ([PRIMARY](https://en.rattibha.com/thread/1791750924664537322))
- **Simple daily-DOL model:** "Determine the HTF DOL using the daily timeframe → Select a CRT on the H4 timeframe that aligns with the HTF DOL → Wait for the CRT to be purged at a key time → Wait for a Model-1 entry to form → Execute." ([PRIMARY](https://en.rattibha.com/thread/1829049011929591925)) — **[CODABLE AS-IS]** as a pipeline (each step's internals per above).
- **Pre-session routine:** "1. Determine the higher timeframe draw on liquidity. 2. Mark the weekly opening and closing times. 3. Mark the daily opening and closing times. 4. Select a candle range or wait for one to form. The rest of the time is spent waiting for the candle range to be purged at a key time." ([PRIMARY](https://en.rattibha.com/thread/1876569563879342199))
- **DOL types (credited-to-Sham thread, chart-only details):** short-term DOL; long-term DOL; DOL as candle-range highs/lows; previous day/week highs/lows; IRL↔ERL; with rules "close above = higher prices / close below = lower prices / wick above = lower prices / wick below = higher prices / closed inside" for PDH/PDL interaction. ([PRIMARY-CREDITED](https://en.rattibha.com/thread/1852583858325323825)) — the wick/close interaction rules are **[CODABLE AS-IS]**; the rest is largely image-based.

---

## 4. Purge / manipulation

- **Definition (operational, from usage):** a purge = price trades *through* one extreme (high or low) of a CRT range — a liquidity sweep / turtle soup of that side — and the expected reaction is a move toward the opposite side. "When one side of the CRT is purged, your first target should be the 50% level of the opposing end." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604))
- **Purge vs real break:** Sham rejects MSS/BoS as a framework: "The price often does not respect market structure shifts or Break of Structure (BoS). More often than not, the price usually takes out liquidity in the form of a turtle soup and then reverses… Looking at price in terms of market-structure-shifts and BoS is a faulty perspective." ([PRIMARY](https://en.rattibha.com/thread/1806046738425270534)) For CRT purposes a *purge* is the sweep that leads to reversal/continuation toward the opposing end; he does **not** publish a mechanical wick-vs-close test for "purge vs breakout" in any thread fetched. ([DISCRETIONARY** in general; the *conformational* mode's "wait for the 2nd candle to close [back inside], then trade the 3rd" ([PRIMARY](https://en.rattibha.com/thread/1794311615535518154)) is an implicit codable rule: **purge confirmed = candle 2 closed back inside candle 1's range**.)
- **Confirmation via CSD:** "waiting for a CSD to occur on the timeframe below the one where you've identified the CRT. This step confirms your bias and DOL." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) In the 3 AM model: "You must wait for a LTF CSD to occur on the LTF before confirming your bias and draw on liquidity. (If there is no CSD on the LTF then you won't be taking any trade.)" ([PRIMARY](https://en.rattibha.com/thread/1791750924664537322)) — CSD itself (**Change of State/Delivery**) is never textually defined by Sham; **[DISCRETIONARY]** in general, though the community/secondary reading is a displacement candle closing through the other side of a range ([SECONDARY](https://github.com/psion2/CRT_Trading_Bot/blob/master/RULES.md)).

---

## 5. Entry models

Sham: "Within a CRT, you can have three potential trading opportunities: 1- Orderblock entry. 2- OTE entry. 3- KOD entry… The two highest probability entries within a CRT: 1- Orderblock Entry. 2- Kiss of Death Entry." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187))

### 5.1 Orderblock entry (highest-probability, confirmation-based)
- Trigger: "This is a confirmation-based entry that occurs after the price **engulfs the candle purging the CRT**… Typically forms in the **first half** of the CRT." Steps: "Purge at a key time → Wait for the candle that purged the CRT to be engulfed → Entry at the orderblock's open." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187))
- Stop loss: "SL should be placed below or above the orderblock" / "Stoploss above orderblock's high." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187))
- Target: "The first target is set at 50%, followed by the opposing end of the range." / "Target CRT low." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187))
- Variant from the 3 AM model: "After the purge, wait for a CSD to occur. Take the entry at the order block formed. Stop loss above/below the swing formed respectively… above the swing high formed after the CSD." ([PRIMARY](https://en.rattibha.com/thread/1791750924664537322))
- **Codability: [CODABLE w/ PARAMETERS]** — needs: (a) precise engulfing-candle definition (body-through-body? full range?); (b) which OB (the purge candle itself vs the last opposite-close candle before displacement — Sham's text implies the candle whose close engulfs the purge candle *is* the orderblock); (c) "first half of the CRT" time bound (50% of the CRT's elapsed duration — codable). Community restatement agrees: entry at open of model/OB, SL beyond the model candle ([SECONDARY](https://github.com/psion2/CRT_Trading_Bot/blob/master/RULES.md)).

### 5.2 Kiss of Death (KOD) entry
- Definition: "The **final counter move or turtle soup before the CRT target or draw on liquidity is reached**. It is one of the most reliable turtle soup entries… Forms in the **second half** of the CRT." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187))
- Trigger: "Price almost reaches the draw on liquidity but forms a counter move for the last time. Take entry at the last turtle soup." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187)) Alternative: "you may wait for an orderblock entry" after the KOD turtle soup. ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187))
- Stop loss: "Stoploss at the FVG's high/low." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187))
- Target: "Target CRT low" (opposing end). ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187))
- "When trading the 3rd candle, the highest probability trade is trading the KOD." ([PRIMARY](https://en.rattibha.com/thread/1791040543633658036))
- **Codability: [DISCRETIONARY / ambiguous]** — "almost reaches the DOL," "the last turtle soup," and "final counter move" are inherently retrospective judgments. "Second half of the CRT" is codable as a time gate. The FVG-referenced stop needs a defined FVG selection rule. This is the single biggest implementability gap in the entry set.

### 5.3 OTE entry
- Listed as one of three opportunities but **never given a standalone mechanical spec in any public thread fetched** ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187)). His TSQ sequence places OTE after CSD/continuation ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)); "New York = OTE continuation" session role ([PRIMARY](https://en.rattibha.com/thread/1829828457519362491)); "For catching the New York OTE/Continuation, aim for a 1-hour CRT purge between 8-10 AM, specifically at 9 AM or 8 AM." ([PRIMARY](https://en.rattibha.com/thread/1795136317203861971)) The 60–75% fib zone definition appears only in secondary summaries ([SECONDARY](https://github.com/psion2/CRT_Trading_Bot/blob/master/RULES.md)).
- **Codability: [CODABLE w/ PARAMETERS]** only by importing the community-standard 0.62–0.79 retracement-of-displacement definition; Sham himself does not specify it publicly.

### 5.4 Model-1 entry
- Sham references Model-1 repeatedly as the execution trigger: "Wait for a Model-1 entry to form. Execute." ([PRIMARY](https://en.rattibha.com/thread/1829049011929591925)); "Wait for the purge between 2-5 AM and look for a model-1 entry there" ([PRIMARY](https://en.rattibha.com/thread/1795136317203861971)); "CRT … c) Model-1 entry" as a catch-expansions ingredient ([PRIMARY](https://en.rattibha.com/thread/1829073740631601598)).
- **Definition is not given in Sham's public text.** Secondary sources define it: a candle that stabs above an old high with a thick up-close body then closes back below it (bearish) / mirror for bullish; "Entry: Below the model-1 candle; Stop Loss: Above the model-1 candle; Target: Lows one by one"; "Wait for close below/above that candle → trigger." ([SECONDARY](https://github.com/psion2/CRT_Trading_Bot/blob/master/RULES.md))
- **Codability: [DISCRETIONARY** pending]** — codable *once* "thick candle" body-ratio threshold and "old high/low" lookback are parameterized; Sham's own public posts do not supply them. High-value open question (§13).

### 5.5 Ideal format per CRT
"When trading the 2nd candle, wait for CSD and enter at OB. When trading the 3rd candle, the highest probability trade is trading the KOD. Timing and key level must be considered too." ([PRIMARY](https://en.rattibha.com/thread/1791040543633658036)) — **[CODABLE AS-IS]** as a mode selector (trade candle 2 via CSD+OB; trade candle 3 via KOD).

---

## 6. Turtle soup (TS) and how it nests inside CRT

- **Definition per Sham's usage:** a turtle soup = a sweep of a prior high/low (liquidity grab) that traps breakout traders and precedes reversal: "the price usually takes out liquidity in the form of a turtle soup and then reverses in the opposite direction." ([PRIMARY](https://en.rattibha.com/thread/1806046738425270534))
- **TSQ (The Sequence) phases:** CRT Turtle Soup → CSD → OTE → Continuation → KOD → Turtle Soup. "Everything begins with a TS, everything ends with a TS." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604), [PRIMARY](https://en.rattibha.com/thread/1790141530461622525))
- **Nesting inside CRT:** the purge of a CRT side *is* the turtle soup of that side; a purged CRT "often leads to the top or bottom being formed there, especially when integrated with turtle soup and market profiles." ([PRIMARY](https://en.rattibha.com/thread/1806046738425270534)) KOD is explicitly "one of the most reliable turtle soup entries." ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187))
- **Best-turtle-soup filter:** "1- CRT. 2- Key level or pd array. 3- Key time or killzone. 4- Occur at the distribution phase. 5- Previous day/week high." ([PRIMARY](https://en.rattibha.com/thread/1817955157046374490)) — **[CODABLE w/ PARAMETERS]** (items 1,2,3,5 codable; "distribution phase" **[DISCRETIONARY]**).

---

## 7. Key times / timing

**Timezone:** Sham never states a timezone in any public thread text fetched. All clock times (1 AM, 3 AM, 5 AM, 9 AM, 9 PM, London lunch 5–7 AM) are New-York/EST-style references — consistent with secondary sources that label the H4 1am/5am candles "EST" ([SECONDARY](https://tradingwyckoff.com/en/crt)) and community threads writing "159 am EST" ([SECONDARY](https://en.rattibha.com/hashtag/Forex)). For a bot: **assume US Eastern (EST/EDT, i.e. America/New_York with DST)** — this is an inference, not a Sham quote. **[CODABLE w/ PARAMETERS]** (timezone config).

- **Session model:** "Asia = Accumulation or Range. London = High/Low of the day. New York = OTE continuation." ([PRIMARY](https://en.rattibha.com/thread/1829828457519362491))
- **The 3 AM Model** ([PRIMARY](https://en.rattibha.com/thread/1791750924664537322)):
  - Timeframes: HTF = H4, LTF = M5.
  - CRT formation times: H4 candles **5 PM and 9 PM**.
  - Purge window: **3:00–4:00 AM** — "If the purge happens outside this time window then you don't take any trade and wait for another day."
  - Bias: counter to purge direction; DOL = opposing 50% then opposing end.
  - Mandatory LTF CSD confirmation; "no CSD → no trade."
  - Entry: orderblock formed after CSD; SL beyond post-CSD swing; targets 50% and opposing end.
  - Claimed stats: "at least a 50-60% win rate with an average 3RR." Video: [youtube.com/watch?v=4cTusaAoM4I](https://www.youtube.com/watch?v=4cTusaAoM4I)
  - **Codability: [CODABLE AS-IS]** — this is the most fully specified public model, usable as the bot's primary strategy.
- **London LOTD / NY continuation timing:** "For catching the London LOTD, using the **9 PM H4 CRT** is optimal. Wait for the purge between **2-5 AM** and look for a model-1 entry there. For catching the New York OTE/Continuation, aim for a **1-hour CRT purge between 8-10 AM, specifically at 9 AM or 8 AM**. Make sure to take profits before the London close, as it often forms the opposing end of the range and can result in a reversal or retracement profile." ([PRIMARY](https://en.rattibha.com/thread/1795136317203861971)) — **[CODABLE AS-IS]**.
- **NY purge band:** "Wait for the purge between **8:30 and 9:30**. Entry at an OB or FVG. Explosive expansion right away. Time > Price." ([PRIMARY](https://en.rattibha.com/thread/1814278675648667729)) — **[CODABLE AS-IS]**.
- **H4 anchor candles:** "H4 candles formed at 0100, 0500 and 0900." ([PRIMARY](https://en.rattibha.com/thread/1780950720969117795))
- **London lunch:** "London lunch time = 5:00 Am - 7:00 Am" (in the 5 AM CRT thread's London-lunch profile: Asia+London consolidate → lunchtime manipulates into key level → expands toward DOL). ([PRIMARY-CREDITED](https://en.rattibha.com/thread/1860564754869236074)) — Note the internal inconsistency: 5–7 AM New York time is ~10–12 UTC, i.e. London *morning*, not lunch; the label "London lunch" for 5–7 AM ET is his wording but the mapping to London lunch is questionable. **Flag for developer.**
- **Intraday profiles at the 5 AM / 9 AM candles** ([PRIMARY-CREDITED](https://en.rattibha.com/thread/1860564754869236074), [PRIMARY-CREDITED](https://en.rattibha.com/thread/1866057354032419064)): London lunch low/high of day; NY continuation (1 AM creates H/L of day, 5 AM continues; or 5 AM creates H/L, 9 AM continues — wait for H1 CRT or LTF purge in that case); NY reversal (1 AM + 5 AM build a range, 9 AM purges it, taps key level, expands to daily DOL); "NY Reversal 1.2" (image-only). — **[DISCRETIONARY]**: these are chart-pattern narratives, largely image-based.
- **Week-of-month / day-of-week:** "Key time & macro: a) Week of the month. b) Day of the week. c) Time of the day." ([PRIMARY](https://en.rattibha.com/thread/1829073740631601598)); "Monday's candle range" as preferred ([PRIMARY](https://en.rattibha.com/thread/1780950720969117795)). The weekly-phase mapping (week 1 = accumulation, week 2 = manipulation, week 3+ = distribution) exists only in secondary sources ([SECONDARY](https://github.com/psion2/CRT_Trading_Bot/blob/master/RULES.md)) — **[DISCRETIONARY** / secondary**]**.
- **Expected CRT lifetimes** ([PRIMARY](https://en.rattibha.com/thread/1865339006403129379)): Daily CRT: 1 week to engineer, 2–3 days to play out; 4H: 1 day to form, 8–12 hours to play out; Hourly: 6 hours to form, 2–4 hours to play out; 15m: 2 hours to form, 0.5–1 hour to play out. — **[CODABLE w/ PARAMETERS]** (useful as trade-timeout windows).
- **"159 and 369 analogy":** referenced for purge timing ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) but never defined. Community usage implies :59-minute marks (1:59, 3:59, 9:59) and 3/6/9 o'clock hours ([SECONDARY](https://en.rattibha.com/hashtag/Forex)). **[DISCRETIONARY]**.

---

## 8. Targets

- **Primary target after purge: the 50% (mean-threshold) of the *opposing* leg.** "When one side of the CRT is purged, your first target should be the 50% level of the opposing end." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604), [PRIMARY](https://en.rattibha.com/thread/1790141530461622525)); the 3 AM model: "Aim for 50% of the range and the opposing end of the range." ([PRIMARY](https://en.rattibha.com/thread/1791750924664537322)) — **[CODABLE AS-IS]**.
- **Secondary/full target: the opposing end of the CRT range** ("Target CRT low" for a long off a high purge). ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187))
- **When to hold longer:** "If the CRT is of high quality, based on the protocols followed, you may opt to hold the trade longer toward the opposing end." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) — quality-gated runner, **[DISCRETIONARY]**.
- **Hard TP timing rule:** "Make sure to take profits before the London close, as it often forms the opposing end of the range and can result in a reversal or retracement profile." ([PRIMARY](https://en.rattibha.com/thread/1795136317203861971)) — **[CODABLE AS-IS]** (session-clock TP cutoff).
- **DOL as extension target:** bias/DOL can be an HTF liquidity pool beyond the CRT end ([PRIMARY](https://en.rattibha.com/thread/1789657142191890597), DOL types in [PRIMARY-CREDITED](https://en.rattibha.com/thread/1852583858325323825)) — **[CODABLE w/ PARAMETERS]** once the DOL-selection function is fixed.
- **Contradiction:** secondary summaries say "Always partial at 50%; Full target: Opposite end; 50% is the minimum guaranteed target" ([SECONDARY](https://github.com/psion2/CRT_Trading_Bot/blob/master/RULES.md)), while the brief's claimed "no partials" rule (§10) says the opposite. Sham's own public text is compatible with **either** (50% is a "target," not explicitly a partial-take). Flag.

---

## 9. Confluence / conjunction protocols

- **Stacking rule:** "The more protocols that you use to find a CRT the higher would be the quality… Use all the protocols in a sound logical manner with all the other market profiles." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)); "a high-quality CRT follows at least 3-4 protocols to be considered correct." ([PRIMARY](https://en.rattibha.com/thread/1794311615535518154)) — a minimum-protocol-count gate is **[CODABLE AS-IS]** (count the satisfied protocols ≥3 or ≥4).
- **LTF CRT within HTF CRT:** "wait for a big bulky candle on the LTF to confirm a HTF CRT, and then that candle becomes your LTF CRT." ([PRIMARY](https://en.rattibha.com/thread/1794311615535518154)) — nesting/fractal confirmation; "big bulky" **[DISCRETIONARY]**.
- **Pairing macro/micro CRTs on one timeframe** (see §2 item 8) — **[DISCRETIONARY]**.
- **CSD confirmation on the TF below** (see §4) — mandatory in the 3 AM model, "conjunction" elsewhere.
- **SMT:** used as a first-class CRT-selection ingredient: "4H Key level + Candle range + SMT" (from his X profile description, [X profile](https://x.com/SpeculatorFL)); SMT confluence appears in the 5 AM/9 AM models as "SMT London lunch with London", "London lunch with NY", "NY with London" — i.e. SMT *across sessions* (previous-session extremes vs current), details image-only. ([PRIMARY-CREDITED](https://en.rattibha.com/thread/1860564754869236074), [PRIMARY-CREDITED](https://en.rattibha.com/thread/1866057354032419064)) — **[DISCRETIONARY**/image-only**]**.
- **"CRT integrates all of ICT's concepts into the most sophisticated and objective form"** — MMXM, AMD/PO3, OHLC/OLHC ([PRIMARY tweet index](https://en.rattibha.com/SpeculatorFL/recent/page/3)).

---

## 10. Risk & trade management

What Sham's **public** text actually says:

- **Framework by trader type:** "Scalper = M15 CRT – M1 entries. Intraday trader = H4 CRT – M15 entries. Swing trader = Daily CRT – H1 entries. Position trader = Weekly CRT – H4 entries." ([PRIMARY](https://en.rattibha.com/thread/1807846346528821278)) — **[CODABLE AS-IS]**.
- **RR targets by style:** "Intraday Trading: 2-3R is optimal. Swing Trading: Aim for 4R+ ideally. Compensate for the lower trade frequency on higher timeframes with a better RRR." ([PRIMARY](https://en.rattibha.com/thread/1858098538627875095)) — **[CODABLE w/ PARAMETERS]**.
- **3 AM model:** "at least a 50-60% win rate with an average 3RR"; "Backtest this as much as you can and journal each of your entries"; "you can make adjustments, but you cannot change the fundamental rules, such as the purge must happen at the 3 AM candle." ([PRIMARY](https://en.rattibha.com/thread/1791750924664537322))
- **Per-entry stops/targets:** §5 (OB stop beyond OB; KOD stop at FVG extreme; Model-1 stop beyond model candle [secondary]; targets 50% then opposing end).
- **Take-profit timing:** before London close ([PRIMARY](https://en.rattibha.com/thread/1795136317203861971)).

What the brief attributes to him — **"Win = 3R / Loss = -1R, no partials, no trailing, no breakeven"** — **could not be found in any public thread fetched.** No public Sham post states "no partials / no trailing / no breakeven." Public evidence cuts the other way in places: his own 50%-first-target language (§8) and the secondary "always partial at 50%" ([SECONDARY](https://github.com/psion2/CRT_Trading_Bot/blob/master/RULES.md)). The fixed 3R/−1R framing is most consistent with his paid Telegram/CPI course ([LEAKED/PAYWALLED — existence of "The Candle Range Theory - Sham CPI.pdf (116 pages)" referenced by [SECONDARY repo](https://github.com/torOxO/CRT-EA-V2/blob/main/01_CRT_EA_Specification.md); Scribd host [CRT - Sham CPI Notes](https://www.scribd.com/document/878080422/CRT-Sham-CPI-Notes); Reddit students describe the paid "Axis Circle" course](https://www.reddit.com/r/Daytrading/comments/1qfdd57/anyone_here_studied_axis_circle_cpi_crt_sham)). **Judgment: the fixed-fractional 3R/−1R, no-management rule set is [DISCRETIONARY/UNVERIFIED] from public sources** — a defensible backtest parameterization is: fixed 1R risk, TP = min(3R, opposing CRT end), SL = model/OB stop, no partials, no trailing, session-close flatten. Sizing: no public Kelly/percent-risk statement found; only the implicit "risk fixed R per trade" convention. **[CODABLE w/ PARAMETERS]** (risk % = parameter).

---

## 11. SMT / correlated pairs

Public primary evidence is thin and mostly chart-embedded:

- Sham's X profile advertises selection via "4H Key level + Candle range + **SMT**" ([X profile](https://x.com/SpeculatorFL)).
- The credited 5 AM CRT model includes "6- SMT: London lunch with London / London lunch with NY / NY with London" — SMT comparisons *between session extremes across time*, details in images. ([PRIMARY-CREDITED](https://en.rattibha.com/thread/1860564754869236074))
- The credited DOL thread includes "IRL ERL + CRT + SMT" as an integration recipe, image-only. ([PRIMARY-CREDITED](https://en.rattibha.com/thread/1852583858325323825))
- **No fetched Sham text names GBPUSD vs EURUSD or NAS100 vs SPX500 as an SMT pair.** The classic ICT pairings (EURUSD/GBPUSD; US30/NAS100 or NAS100/SPX500) are community/secondary knowledge ([SECONDARY](https://github.com/kmshdev/traders-knowledge-kit/blob/master/concepts/16-smt-divergence/correlated-pairs-smt.md)). S⟁TYA's credited CRT reviews use EURUSD & XAUUSD. ([SECONDARY](https://en.rattibha.com/thread/1799103845492277653))
- **Codability: [DISCRETIONARY]** for Sham's session-SMT; **[CODABLE w/ PARAMETERS]** if the bot implements generic ICT SMT divergence (one instrument sweeps a swing the twin does not, at matched session/killzone times) on GBPUSD+EURUSD and NAS100+SPX500 — the parameter choices (swing lookback, tolerance, which pairs) are ours, not Sham's.

---

## 12. Terminology glossary

| Term | Definition (as used in Sham's corpus) | Codability |
|---|---|---|
| **CRT** | Candle Range Theory: every closed HTF candle is a range (H/L liquidity, O/C) traded via its AMD/PO3 phases. ([PRIMARY](https://en.rattibha.com/thread/1780825580789014848)) | AS-IS |
| **Candle range** | The H/L box of one candle, treated exactly like a conventional range but objective. ([PRIMARY](https://en.rattibha.com/thread/1780825580789014848)) | AS-IS |
| **Purge** | Sweep of one CRT side (liquidity grab / turtle soup of that side); expected reaction = toward opposite side. ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) | w/ params |
| **TS (Turtle Soup)** | Taking a prior high/low then reversing — "everything begins with a TS, ends with a TS." ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) | w/ params |
| **TSQ (The Sequence)** | CRT Turtle Soup → CSD → OTE → Continuation → KOD → Turtle Soup. ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) | w/ params |
| **CSD** | Change of State/Delivery; LTF structural confirmation of a purge/bias. Never textually defined by Sham; mandatory in 3 AM model. ([PRIMARY](https://en.rattibha.com/thread/1791750924664537322)) | discretionary |
| **DOL** | Draw on Liquidity: the liquidity pool price is expected to be drawn to after a purge (50%, opposing CRT end, or HTF pool). ([PRIMARY](https://en.rattibha.com/thread/1789657142191890597)) | w/ params |
| **KOD** | Kiss of Death: final counter-turtle-soup before CRT target/DOL; forms in 2nd half of CRT. ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187)) | discretionary |
| **OTE** | Optimal Trade Entry: retracement entry; in his corpus tied to NY continuation; fib zone only secondary. ([PRIMARY](https://en.rattibha.com/thread/1829828457519362491)) | w/ params (imported) |
| **OB** | Orderblock: entry after the purge candle is engulfed; entry at OB open, SL beyond OB. ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187)) | w/ params |
| **FVG** | Fair Value Gap: 3-candle imbalance PD array; KOD stop reference; 2nd-tier key level. ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) | w/ params |
| **Rejection block** | Highest-quality key level in his hierarchy; never defined in public text. ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) | discretionary |
| **Breaker** | Lowest-tier key level in his hierarchy; standard ICT invalidation-block concept. ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) | w/ params |
| **PD array** | Premium/discount array (OB, FVG, breaker, rejection block…); "There must be an HTF PD array around CRT." ([PRIMARY](https://en.rattibha.com/thread/1794311615535518154)) | w/ params |
| **PD Array Matrix** | Premium/discount/equilibrium location matched to PD array for expansion legs. ([PRIMARY](https://en.rattibha.com/thread/1789657142191890597)) | w/ params |
| **PO3 / AMD** | Power of 3 / Accumulation-Manipulation-Distribution, the intra-candle cycle. ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) | discretionary |
| **OHLC / OLHC** | Daily open-high-low-close vs open-low-high-close candle-shape profiles for bias. ([PRIMARY](https://en.rattibha.com/thread/1789657142191890597)) | w/ params |
| **Model-1** | The stair-entry model (stab into old high/low, close back, enter against). Not defined in Sham's public text; used as trigger. ([PRIMARY](https://en.rattibha.com/thread/1829049011929591925)) | discretionary (secondary definition) |
| **MSS / BoS** | Market Structure Shift / Break of Structure — concepts he explicitly rejects as primary triggers. ([PRIMARY](https://en.rattibha.com/thread/1806046738425270534)) | n/a |
| **SMT** | Smart Money Tool: divergence between correlated instruments/sessions; selection confluence. ([X profile](https://x.com/SpeculatorFL)) | discretionary |
| **IRL / ERL** | Internal Range Liquidity / External Range Liquidity (DOL destinations). ([PRIMARY-CREDITED](https://en.rattibha.com/thread/1852583858325323825)) | w/ params |
| **LOTD** | London Open/High-Low of The Day (session extremum). ([PRIMARY](https://en.rattibha.com/thread/1795136317203861971)) | w/ params |
| **Killzone** | ICT session window for high-quality purges. ([PRIMARY](https://en.rattibha.com/thread/1817955157046374490)) | w/ params |
| **159 / 369** | Time numerology for purge timing; referenced, never defined. ([PRIMARY](https://en.rattibha.com/thread/1784493604473618604)) | discretionary |
| **Time alignment** | Aligning CRT formation-time with purge-time ("both align → most accurate CRT"). ([PRIMARY](https://en.rattibha.com/thread/1794311615535518154)) | w/ params |
| **Timeframe alignment** | HTF CRT ↔ LTF entry TF coupling (e.g., H4 CRT→M15 entries). ([PRIMARY](https://en.rattibha.com/thread/1807846346528821278)) | AS-IS |
| **Conformational / Advanced CRT** | Wait-for-close-3rd-candle mode vs trade-candle-2-no-confirmation mode. ([PRIMARY](https://en.rattibha.com/thread/1794311615535518154)) | AS-IS / discretionary |
| **AxisModel / Axis Circle** | Sham's paid course brand (Telegram card: "Author of the 'AxisModel'"). ([PRIMARY](https://en.rattibha.com/thread/1834858387064111187)) | paywalled |

---

## 13. Codability assessment & open questions

### What is directly codable (the bot's skeleton)
1. **CRT object:** closed HTF candle c with (H,L,O,C); box = [L,H]. Timeframe pairs per §7/§10. **AS-IS.**
2. **Purge detection:** candle wicks beyond H (sell-side setup) or below L (buy-side setup) of the CRT. **AS-IS** (wick test) — with the conformational variant requiring close-back-inside. **AS-IS.**
3. **Time gates:** 3 AM model (H4 5PM/9PM CRT, purge ∈ [03:00,04:00) NY); London LOTD (9PM H4 CRT, purge ∈ [02:00,05:00]); NY (purge ∈ [08:30,09:30], H1 purge ∈ {8AM,9AM}); hard no-trade outside windows. **AS-IS** (with NY-timezone assumption).
4. **Bias after purge:** counter to purge side; **DOL = opposing 50% then opposing CRT end**. **AS-IS.**
5. **Confirmation:** LTF (M5) CSD required (no CSD = no trade) in the 3 AM model. **AS-IS provided CSD is defined as displacement-close through the purge-side swing** — this definition is the community default, not a Sham quote.
6. **Entry:** post-CSD orderblock open; **SL** beyond OB/post-CSD swing; **TP1** 50% of opposing leg, **TP2** opposing CRT end; optional HTF-DOL extension. **AS-IS / w/ params.**
7. **Mode switch:** trade candle 2 (CSD+OB) or candle 3 (KOD); conformational-only for a first bot. **AS-IS.**
8. **Filters:** inside-bar count ≥ N; ≥3 selection protocols satisfied; HTF PD array (OB/FVG/breaker) within distance D of the CRT; range ≥ R pips/ATR; key-level hierarchy weighting. **w/ PARAMS.**
9. **Lifecycle timeout** per timeframe from the high-probability CRT table. **w/ PARAMS.**
10. **Risk:** fixed fractional risk per trade; RR floor (2R intraday / 4R swing); TP cutoff before London close. **w/ PARAMS.**

### Top gaps / ambiguities blocking a *literal* implementation
- **Timezone never stated.** All clock rules depend on inferring America/New_York (EST/EDT). DST handling for "3 AM" is unstated.
- **CSD is never defined in text.** Mandatory gate for the flagship model; definition must be imported (community: displacement candle closing beyond the prior opposite swing).
- **Model-1 is never defined in text.** Used as an execution trigger in three separate threads; "thick candle" body ratio and "old high/low" lookback are unstated.
- **KOD is irreducibly discretionary** ("almost reaches DOL," "the last turtle soup," "final counter move") — retrospective; a bot needs a proxy (e.g., final pullback ≥ X bars before TP2 touch).
- **"Purge testing a HTF key level":** no distance/tolerance rule ("around" = how close?).
- **Rejection blocks** rank first in his key-level hierarchy but are never defined.
- **"Range large enough for favorable RR":** no numeric minimum.
- **OTE has no public spec** (fib zone only appears in secondary sources).
- **The "159/369" purge-timing doctrine** is referenced but undefined.
- **SMT mechanics:** all concrete SMT content (session-SMT, IRL/ERL+SMT) is chart-image-only; no GBPUSD/EURUSD or NAS100/SPX500 pairing is stated by Sham in public text.
- **Risk-management claim in the brief ("Win=3R/Loss=−1R, no partials/trailing/BE") is unverified publicly** and partially contradicted by his 50%-first-target language; likely paywalled (private Telegram `t.me/ShamSpeculatorFL`, paid "Axis Circle / CPI" course, referenced "Sham CPI.pdf (116 pages)"). Also contradicted by secondary "always partial at 50%."
- **Contradiction — London lunch:** labeled 5–7 AM (NY time), which is London morning; unclear whether he means NY-time London-morning or an actual lunch profile.
- **Self-contradiction — probability arithmetic:** "+11% per protocol," "+50% for CSD," "50–60% WR at 3RR" are marketing claims with no measurement basis; do not encode.
- **Advanced CRT (trade candle 2 without confirmation)** is explicitly intuition-based — excluded from a literal bot.
- **Image-only content:** many operative rules (intraday profiles, OHLC/OLHC schematics, SMT session pairs, "NY Reversal 1.2") exist only in chart images on the mirrored threads and could not be extracted as text.

### Recommended literal-bot specification (defensible from public sources only)
Run the **3 AM Model** as v1: symbols GBPUSD/EURUSD (and NAS100/SPX500 for SMT filtering); H4 CRT candidates opening 17:00 & 21:00 NY; purge of either CRT extreme between 03:00–04:00 NY; bias = counter-purge; require M5 CSD (imported definition); entry at post-CSD OB open; SL = OB extreme (fallback: post-CSD swing); TP1 = 50% of opposing leg, TP2 = opposing CRT end; flatten before London close; fixed fractional risk; optional filters: inside bars ≥1, HTF (Daily) PD array within configurable distance, range ≥ configurable ATR multiple, SMT agreement (sweep divergence vs correlated twin). Everything else in this dossier is either a parameter, a discretionary overlay, or paywalled.

---

## Sources

**Primary (Sham, @SpeculatorFL — via Rattibha mirrors):**
1. CRT: Candle Ranges Theory (master thread) — https://en.rattibha.com/thread/1784493604473618604
2. Candle range theory: every candle a range (definition) — https://en.rattibha.com/thread/1780825580789014848
3. Choosing precise/feasible candle ranges (early protocols) — https://en.rattibha.com/thread/1780950720969117795
4. Candle Range Theory: Choose the best CRT candle (@TraderFlameseN credit-compilation twin) — https://en.rattibha.com/thread/1790141530461622525
5. Daily bias framework — https://en.rattibha.com/thread/1789657142191890597
6. How to Select a CRT Correctly (protocols; conformational vs advanced) — https://en.rattibha.com/thread/1794311615535518154
7. The 3 AM Model — https://en.rattibha.com/thread/1791750924664537322 (video: https://www.youtube.com/watch?v=4cTusaAoM4I)
8. Ideal CRT format (2nd/3rd candle) — https://en.rattibha.com/thread/1791040543633658036
9. London LOTD / NY OTE timing — https://en.rattibha.com/thread/1795136317203861971
10. Why MSS failed: turtle soup + CRT — https://en.rattibha.com/thread/1806046738425270534
11. Specialist framework (1 HTF, 1 CRT, 1 level, 1 LTF model) — https://en.rattibha.com/thread/1818683887192551803
12. Best turtle soup locations — https://en.rattibha.com/thread/1817955157046374490
13. Trader-type timeframe framework — https://en.rattibha.com/thread/1807846346528821278
14. NY purge 8:30–9:30 / OB-FVG entry — https://en.rattibha.com/thread/1814278675648667729
15. Asia/London/NY session model — https://en.rattibha.com/thread/1829828457519362491
16. Catching expansions (CRT + HTF levels + model-1 + macros) — https://en.rattibha.com/thread/1829073740631601598
17. Simple daily-DOL model — https://en.rattibha.com/thread/1829049011929591925
18. How to trade CRT correctly (OB/OTE/KOD entries; trading protocols) — https://en.rattibha.com/thread/1834858387064111187
19. How price reacts at key levels — https://en.rattibha.com/thread/1835623705424388241
20. RR by style (2–3R intraday / 4R+ swing) — https://en.rattibha.com/thread/1858098538627875095
21. High-probability CRT lifetimes — https://en.rattibha.com/thread/1865339006403129379
22. Pre-session routine — https://en.rattibha.com/thread/1876569563879342199
23. Profile index (all threads) — https://en.rattibha.com/SpeculatorFL (pages 2–3 under `/recent/page/2`, `/recent/page/3`)

**Primary-credited (Mado @Im_Speculator, "Credits: @SpeculatorFL"):**
24. How to trade the 5:00 AM CRT — https://en.rattibha.com/thread/1860564754869236074
25. How to trade the 9:00 AM CRT — https://en.rattibha.com/thread/1866057354032419064
26. How to determine DOL — https://en.rattibha.com/thread/1852583858325323825

**Primary-adjacent (Sham's own channels):**
27. X profile @SpeculatorFL — https://x.com/SpeculatorFL
28. YouTube @SpeculatorFL (12 videos, 25.2K subs) — https://www.youtube.com/@SpeculatorFL

**Secondary (clearly labeled):**
29. psion2 CRT_Trading_Bot RULES.md (community rule consolidation incl. Model-1, KOD, weekly phases) — https://github.com/psion2/CRT_Trading_Bot/blob/master/RULES.md
30. torOxO CRT-EA-V2 spec (references paid "Sham CPI.pdf, 116 pages") — https://github.com/torOxO/CRT-EA-V2/blob/main/01_CRT_EA_Specification.md
31. TradingWyckoff CRT explainer (EST labeling, 4H 1am/5am candles) — https://tradingwyckoff.com/en/crt
32. traders-knowledge-kit SMT correlated pairs — https://github.com/kmshdev/traders-knowledge-kit/blob/master/concepts/16-smt-divergence/correlated-pairs-smt.md
33. S⟁TYA CRT EURUSD/XAUUSD credited review — https://en.rattibha.com/thread/1799103845492277653
34. Reddit: Axis Circle / CPI / CRT paid-course students — https://www.reddit.com/r/Daytrading/comments/1qfdd57/anyone_here_studied_axis_circle_cpi_crt_sham
35. ThreadReaderApp mirror of master thread — https://threadreaderapp.com/thread/1784493604473618604.html
