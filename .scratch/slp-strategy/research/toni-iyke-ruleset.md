# Toni Iyke "SLP" Strategy — Ruleset Research (for backtest implementation)

Date: 2026-10-19
Scope: rules research only, no code. Target pairs for the bot: GBPUSD, EURUSD.

All quotes below are from **auto-generated YouTube captions** of class recordings. Captions contain
transcription errors; short clarifications are in [brackets]. Timestamps are caption timestamps.
Speaker attribution for third-party re-uploads is inferred from titles/content; where the speaker
self-identified it is noted. Claims are cited as `<VIDEO-ID> @ <timestamp>`.

## Sources

### PRIMARY (Toni Iyke teaching; some are class recordings re-uploaded by third-party channels)

| Label | ID | Title | Channel | Upload |
|---|---|---|---|---|
| P1 | `hrUak8PxnxU` | HOW TO FIND DIRECTIONAL BIAS FOR AN UPTREND (TONI IYKE) | Toni Iyke (self-identified: "My name is Tony Ike") | 2025-05-18 |
| P2 | `sI25I60QcJ4` | A Brief on Directional Bias (Toni Iyke) | Toni Iyke | 2025-02-04 |
| P3 | `ZoNz7ADqRfI` | TONI IYKE STRATEGY/MARKET STRUCTURE/LIQUIDITY/POI | GILBERTFX (re-upload) | 2025-02-16 |
| P4 | `QWyD0xNeX7I` | TONY IYKE LEAKED COURSE (LIQUIDITY) | FOREX LEAKED COURSES (re-upload) | 2025-01-14 |
| P5 | `Ys7b9IFvZ2c` | TONY IYKE STRATEGY (POINT OF INTEREST) | FOREX LEAKED COURSES (re-upload) | 2025-01-14 |
| P6 | `9NLDcBmPKaA` | TONY IYKE STRATEGY (LEARNING HOW TO ENTER AND EXIT A TRADE USING LIQUIDITY) | FOREX LEAKED COURSES (re-upload) | 2025-01-14 |
| P7 | `HmXQQJaGtYs` | TONI IYKE key tips to avoid SL and picking the perfect entry | PAID FOREX COURSES (re-upload) | 2026-10-08 |
| P8 | `3bS_BaGDrss` | TONY IYKE (FEBRUARY 2026 DIRECTIONAL BIAS) | FOREX LEAKED COURSES (re-upload) | 2026-03-11 |

### SECONDARY (commentary by others; use only for leads/divergence checks)

| Label | Source | Note |
|---|---|---|
| S1 | `vqtLRF71gVA` — "Toni Iyke Forex Strategy \| How He Trades High R:R Setups" (THEYMIANFX) | Presenter's own interpretation; "This is how he does it. It might not be 100%." |
| S2 | `uteJqf65vXo` — "HOW TO ANALYSE THE MARKET (SLP)" (Kingston) | Self-identified as Kingston; uses Fair Value Gaps, which Toni explicitly rejects (P5 @ 00:33:34). Diverges. |
| S3 | `6eZXlCpmZQs` — TradewithArabtheplug SLP explainer | Chaptered explainer (MSS/BOS/MBOS, inducement, OB/breaker). Identified, not used for any rule below. |
| S4 | lilys.ai note of a WATYFOREX video (4H structure, 30m liquidity, 5m CoC+BoS entry, partial at 1:2.5) | Not Toni; excluded from rules. |
| S5 | X (Twitter) profile `https://x.com/toni__iyke` | Bio: "Financial Trader 📊, A connoisseur of Directional Bias". No strategy detail captured. |

URLs: primary videos are `https://www.youtube.com/watch?v=<ID>` for each ID above. X profile as listed.

## Summary

Toni Iyke's method is a top-down SMC continuation model he calls "SLP" (Structure — Liquidity —
Point of Interest). Directional bias is read from a higher timeframe (his main focus is the daily,
sometimes the 4H) as simple HH/HL vs LH/LL structure. The expected weekly/cycle target is the
"last low/high of the last impulsive move" plus opposing liquidity (trendline, equal highs/lows,
long wicks, inducement). Trades are only taken after price reaches a higher-timeframe zone
(daily/4H order block or breaker) and then delivers a localized reversal confirmation on a lower
timeframe: MSS (break of the last opposing swing with a body close), an inducement (the first valid
pullback, retracing at least ~50% of the last move, which must be swept), and then a valid POI
(order block or breaker) that satisfies four rules and is the closest unmitigated POI to the
inducement. Entry is a limit order at the OB/breaker demarcation (body boundary; wick vs body rule),
stop is just beyond the engulfing candle plus a 4–5 pip spread buffer (he personally uses full OB
invalidation; 50% into the OB is an option), and targets are liquidity, not fixed multiples: "clear
the entire trend line liquidity from where it began". The high RR comes from the very tight stop
relative to far structural targets; public examples are 1:4 up to 1:16 (P1, P5). Inducement and
correctional moves are traded too, but each leg is only traded after its own reversal concept at a
higher-timeframe POI. Sessions, risk percentage, break-even/partial/trailing policy, and any explicit
minimum RR are **not defined in the public sources reviewed**.

## The pipeline, step by step

### 1. Timeframe framework

- Bias is read on the higher timeframe; there is no single mandatory timeframe.
  - P8 @ 00:06:00: "When dealing with directional bias, my main focus is usually the daily time frame."
  - P1 @ 00:02:02: "directional bias is basically like the overall direction of the market on the higher time frame".
  - P1 @ 00:03:14: "I apply all these three market movement um structures to the higher time frames on the 4 hours time frame".
  - P1 @ 00:02:18: "there is no one way of analyzing directional bias on higher time frames. The same analysis you can put on your lower time frames."
  - P7 @ 01:11:00: "There's no subjective time frame that's the best. I look for... if the time frame I'm on does not present me a proper MSS" (he then moves up/down a timeframe).
- He trades roughly 2–3 pairs rather than one: P8 @ 00:16:27: "I don't just focus on one pair. I trade about two or three pairs."
- Captions show execution examples on 30m, 1H, 4H, 15m-adjacent frames. P8 repeatedly says "13 minutes time frame" (P8 @ 00:51:49, 00:52:32) — almost certainly a caption error (see Open questions); do not treat "13m" as a real setting.
- P1 @ 00:02:31 explains why HTF bias matters: a 4H analysis lasts "a whole week" because "six four hours candle makes up a full day".

### 2. Directional bias (HTF)

- Bias = trend, by structure alone: P8 @ 00:10:10: "determine whether market is bullish or bearish on the daily timeframe... the uptrend is made up of a series of higher highs and higher lows. And the downtrend is made up of a series of lower highs and lower lows."
- Needs a series of moves, not one leg: P8 @ 01:00:55: "market needs to be giving you an extensive move of like three bounces... or at least minimum of two".
- He focuses on trend-like patterns, not reversals, for bias: P1 @ 00:01:51: "when it comes to directional bias we don't really focus more on reversals for it. We focus on continuations."
- Bias stays fixed until the HTF cycle completes: P1 @ 00:08:07: "we're not looking for anything sells until the last high in the market gets what? Taken out"; P1 @ 00:08:16: "every single day that I wake up and price has not yet taken out this high. I'm only focused on taking buys."
- Both sides of a trend exist: impulsive (with bias) and correctional (counter-trend), and both can be traded, but only at HTF POIs: P8 @ 00:11:15–00:12:20; P8 @ 00:49:30: "You don't cut the cycle of the trend halfway"; P8 @ 00:34:44: "For each impulsive move, price needs to trigger a daily time frame POI before it happens. For each correctional move, market needs to trigger a daily time frame POI as well."
- At all-time highs, he sticks to impulsive moves because there is no prior price action to locate correction zones: P8 @ 01:01:42–01:02:20.

### 3. Draw on liquidity / cycle target

- The bias's TP is the liquidity of the completed cycle: P8 @ 00:44:14: "each impulsive move will take out the previous low of the market"; P8 @ 00:45:22: "this low is the last low of the last impulsive move... that low is going to be taken out... this is going to be the overall TP for the bias of the market."
- Liquidity sits on the opposite side of every trend: P6 @ 00:02:29: "for every Trend there is liquidity being accumulated on the opposite side of this trend"; P6 @ 00:02:50: "Market must eventually take out liquidity."
- "Market will take out liquidity before going to take out another liquidity on other side and if has not been taken out on both ends there's really not much movement in the market" (P6 @ 00:10:05–00:11:00).

### 4. Structure: MSS, BOS, key level

- MSS flips direction; BOS continues the current trend: P4 @ 00:15:38: MSS is "an indication that the current trend is about to change to the opposite side"; P4 @ 00:16:09: BOS is "a scenario when Market breaks a particular key level in price while still remaining in its current Trend."
- MST/MSS is often described as taking the last swing: P8 @ 00:42:56 (lower timeframe at a daily zone): "the next thing it did was to break the last low that market gave us here, giving us a market structure shift."
- A break is only valid with a body close beyond the level: P5 @ 00:34:30: "the body to break above that structure and close above it. Market has not yet broken structure; you have to wait for the body of the candle to close above [it]"; P7 @ 00:14:15: "MSS has to close first" (see also P7 @ 00:43:14: "the body closure of it, not the wick" — adding "if it closed above the wick, it's good and fine as well", i.e. closing above the wick also counts).
- When the MSS reference candle has a long wick, mark the body, not the wick (secondary but consistent): S1 @ 00:04:00.

### 5. Inducement (liquidity)

- Definition: P3 @ 00:23:52: "an inducement is the first valid pullback that markets makes after a [market structure shift or break of structure]"; P3 @ 00:23:41: "I said my inducement is my liquidity."
- It is engineered liquidity and its purpose is to be swept: P3 @ 00:27:05: "your inducement is a trap it is not your entry... inducing early traders"; P3 @ 00:27:19: "it has to come out and take out that inducement... before going to trigger the main point of interest."
- Valid pullback = at least ~50% retracement of the last move (can be one candle or many): P3 @ 00:32:31: "has to push market up close to at least 50% of where this last move stopped"; P3 @ 00:32:02: "it does not matter whether it's a one candle pull back or multiple candle [pullbacks] as long as a valid pullback."
- One candle can be the inducement: P4 @ 01:09:54: "this candle is just a one single candle but it's actually a pull back."

### 6. Point of Interest (POI)

- Only two POIs: order blocks and breaker blocks. No FVG: P5 @ 00:33:34: "I don't look at fair value gaps I don't include that in my strategy." P4 @ 00:29:48: OBs are "those zones in the market where there are a lot of institutional orders... where they place their limit orders."
- Order block shapes: P4 @ 00:30:36: bullish OB = "you see a bearish candle and then you see a bullish candle kind of engulf it"; bearish OB = bullish candle engulfed by a bearish candle (P4 @ 00:31:31). (P3 @ 00:42:45 same definition.)
- Breaker block: P5 @ 00:00:45: "a breaker block is a failed order block"; i.e. an OB that price broke through and that then acts as a mitigation/supply-demand zone (P4 @ 00:29:48 lists "breaker blocks SL mitigation blocks").
- Mitigation = price tapping the POI after the structure event: P5 @ 00:04:23: "mitigation is after market [taps] into a point of interest"; P5 @ 00:05:04: "mitigation only happens after market break structure" — hence an unmitigated POI is one not tapped since the MSS/BOS.
- The four rules for a valid POI (P5 @ 00:02:11 onward):
  1. It caused the MSS/BOS: P5 @ 00:03:03: "the point of Interest needs to trigger... a break of structure or a market structure shift" (P5 @ 00:14:26).
  2. It has liquidity/inducement protecting it: P5 @ 00:03:03: "it has to have liquidity or inducement protecting [it]" (P5 @ 00:14:29).
  3. It is unmitigated since that MSS/BOS: P5 @ 00:06:32 / 00:18:16.
  4. It is the closest POI to the inducement/liquidity: P5 @ 00:06:36: "the point of interest is closest to liquidity" (P5 @ 00:14:59).
- Breaker vs OB selection: P5 @ 00:08:54: "breaker block as is an entry is when the inducement did not mitigate the breaker block but if the inducement mitigated the breaker block... [use the order block]"; P5 @ 00:20:33: "if your breaker block was mitigated... if your breaker block was unmitigated you have to pick your entry from the breaker block."
- Breaker entry is from the body; only the body must be mitigated: P5 @ 00:32:09: "the breaker block you always start from the body"; P5 @ 00:33:00: "the breaker block body has to be mitigated not the wick."

### 7. Entry

- Entry is placed at the OB/breaker "demarcation" (the boundary between the two candles): P4 @ 00:32:22: "you take your trade from this demarcation right here"; P4 @ 00:32:31: "place your sell order here".
- Wick vs body rule: P4 @ 00:34:19: "if the wick of the other block is smaller and shorter than the body of the other block you pick your entry from the wick but if the wick of the other block is longer than the body pick your entry from the body."
- He uses a resting limit order and then watches: P4 @ 00:42:18: "I set limit entry and I start watching my chart." Note the secondary re-explainer (S1 @ 00:09:00) warns "don't just start pending any order... watch the market closely," which may reflect a stricter, confirmation-based variant (unverified against primary).
- No "wait for a close at the POI" confirmation is stated; the POI tap plus the earlier reversal concept is the trigger.

### 8. Stop placement

- Stop just beyond the OB/engulfing candle: P4 @ 00:32:35: "put your stop loss just below the invalidation of that particular candle that you picked your entry from."
- Add a 4–5 pip spread buffer: P4 @ 00:32:49: "if because of spread you can put it like four [pips] below or five [pips] below just to be safe from spread."
- Alternative: 50% into the OB. His personal choice is 100% of the OB: P4 @ 01:06:44: "you want to keep... my stop slightly [beyond] the candle I pick my entry from... I either do the 100% of the other block or the 50% but I do the 100"; P4 @ 01:07:12: "taking a sell keep above the candle that engulfed; taking a buy I'll keep it below the candle that engulf."
- If the OB is very large he covers the entire OB (reducing size) or drops to a lower timeframe to find a tighter zone: P5 @ 00:31:38: "sometimes I just adjust my stop loss to cover the entire other block then you just reduce your risk."

### 9. Targets (take profit = liquidity, not fixed RR)

Target type menu (P6, throughout; P6 @ 00:27:03 summary):

1. Trendline liquidity: clear the entire trendline from its origin. P6 @ 00:04:37: "my take profit would now be to Target and clear the entire trend line liquidity from here from where it began"; P6 @ 00:07:26: "[market] has to clear this entire [trendline] liquidity first before you reverse."
2. Equal highs/lows (double top/bottom): P6 @ 00:07:59–00:08:49: "equal highs and equal lows liquidity what people call... double top and double bottom... Market eventually come out and take this equal high"; take profit at that resting liquidity.
3. Long wick liquidity: P6 @ 00:14:51: "long wick liquidity happens when there's too much volatility in the market... during news"; he held a GJ buy to clear a long wick (P6 @ 00:15:20–00:16:30).
4. Inducement: P6 @ 00:17:10: "your target will be this inducement right here for your take profit"; P6 @ 00:18:10: if there is an inducement below that must be swept before your sell's continuation, TP there.
5. A valid opposing POI (must itself pass the four POI rules): P6 @ 00:20:50: "you can before you can consider using that other block as your take profit... first thing you check is does this other block... trigger shift in Market structure... if it has liquidity... if it's unmitigated"; P6 @ 00:28:00.
6. The HTF cycle target (last low/high of the last impulsive move) as the overall bias TP: P8 @ 00:45:22–00:46:12; P1 @ 00:08:07.

- Bias-aligned trades target the cycle low/high; correctional trades target the nearest higher-timeframe zone / lower-timeframe liquidity: P8 @ 00:52:50–00:53:45: "take the correctional move and you target... the nearest zone that market may buy to for the impulsive move to happen next... take your TP level with the lower time frame types of liquidities."
- Continuation entries (multiple breaker structure + inducement + POI) are used to re-enter in the bias direction until the cycle target: P8 @ 01:06:36-01:07:00.

### 10. Risk, R:R, expectancy, trade frequency

- No fixed RR target; targets are structural. Public examples:
  - P5 @ 00:25:45: "since my risk to reward ratio is high... if I'm risking $200 it means ... I'm targeting 1:6 risk to reward"; "this I for example is 1:4 reward ratio"; "if I [risk] $100 on this I make $800" (1:8).
  - P1 @ 00:09:58 (three consecutive GJ buys in one HTF cycle): "this trade was 1 is to 16 risk-to-reward ratio. The second one 1 is to 8. The third one 1 is to 5.6."
- Small losses, big wins is the stated expectancy model: P7 @ 01:03:24: "I take stop losses too... your risk to reward matters a lot as well so when you lose you lose small when you win you win high, so even if you take two losses and one TP it will cover up everything with more profit."
- Risk per trade percentage is not stated in any reviewed source; only "manage your risk" (P7 @ 01:09:03). Lot sizing is discussed qualitatively (P5 @ 00:25:45: "calculate the lot size equivalent").
- He takes multiple trades in the same direction per cycle: P1 @ 00:08:23–00:09:45 (three GJ buys); P6 @ 00:22:50 (three consecutive gold buys); P8 @ 01:06:36 (continuation entries until the HTF target).

### 11. News

- No news blackout stated. He trades through NFP when his technicals agree: P3 @ 00:43:27: "this trade was during NFP"; P3 @ 00:43:37: "if you're correct with your technicals trust me news mostly confluences technical analysis except few cases"; the same video shows two NFP trades (P3 @ 00:44:54). P6 @ 00:24:13 notes a news spike pushed price down but "my stop [did] not get [hit]."

### 12. Sessions

- No session or killzone rule appears in any reviewed primary source. Class times are evening sessions; examples span gold, BTC, GBPJPY; no London/NY timing filter is taught.

## Definitions table

| Term | Definition (as taught) | Citation |
|---|---|---|
| Uptrend / Downtrend | HH + HL / LH + LL series | P8 @ 00:10:41; P1 @ 00:00:56 |
| Ranging market | Support-to-resistance oscillation | P1 @ 00:01:19 |
| Directional bias | Overall HTF direction; join continuations, not reversals | P1 @ 00:01:51; P8 @ 00:06:00 |
| Impulsive vs correctional move | With-bias leg vs counter-trend retracement; both tradeable at HTF POIs | P8 @ 00:11:15, 00:34:44 |
| Draw on liquidity | The cycle target: last low/high of the last impulsive move | P8 @ 00:44:14, 00:45:22 |
| Trendline liquidity | Stops accumulated under a trendline / at its origin | P6 @ 00:04:37, 00:07:26 |
| Equal highs/lows liquidity | Double top/bottom resting orders | P6 @ 00:07:59 |
| Long wick liquidity | Volatility spike wick (e.g. news) left uncleared | P6 @ 00:14:51 |
| Inducement | First valid pullback after MSS/BOS; the liquidity that must be swept before the POI; a trap | P3 @ 00:23:52, 00:27:05 |
| Valid pullback | Retraces at least ~50% of the last move; one or many candles | P3 @ 00:32:02, 00:32:31 |
| Key level | Significant support/resistance whose break is a BOS | P4 @ 00:16:09; P4 @ 00:58:23 |
| MSS (market structure shift) | Break of last swing against the trend, flipping direction; needs body close | P4 @ 00:15:38; P5 @ 00:34:30; P8 @ 00:42:56 |
| BOS (break of structure) | Break of a key level continuing the current trend | P4 @ 00:16:09 |
| Order block | Zone of institutional limit orders; bearish candle engulfed by bullish (bullish OB) or bullish engulfed by bearish (bearish OB) | P4 @ 00:29:48, 00:30:36, 00:31:31 |
| Breaker block | Failed order block (broken OB now acting as mitigation zone) | P5 @ 00:00:45 |
| Mitigation | Price tapping a POI after the MSS/BOS | P5 @ 00:04:23, 00:05:04 |
| Unmitigated POI | Not tapped since the MSS/BOS | P5 @ 00:18:16 |
| Demarcation | Entry line at the OB/breaker body boundary | P4 @ 00:32:22 |
| POI validity | 4 rules: caused MSS/BOS; protected by inducement/liquidity; unmitigated; closest to inducement | P5 @ 00:02:11–00:06:43 |
| Reversal concept | MSS + inducement + POI tap at a HTF zone; the confirmation to trade a leg | P8 @ 00:08:11, 01:03:53 |
| Continuation entry | Multiple breaker structure + inducement + POI, traded with the bias until cycle target | P8 @ 00:36:58, 01:06:36 |
| FVG | Explicitly NOT used | P5 @ 00:33:34 |

## Parameter table

| Parameter | Value in sources | Status |
|---|---|---|
| Bias timeframe | Daily (main focus, Feb 2026) / 4H also used | P8 @ 00:06:00; P1 @ 00:03:14 |
| Confirmation timeframe | Lower TF than bias: 1H, 30m, "13 minutes" (caption; likely 15m), also 45m and 5m mentioned by secondary | P8 @ 00:46:41, 00:51:49; P1 @ 00:06:41; S1 @ 00:01:13 |
| Structure confirmation | Body close beyond level | P5 @ 00:34:30; P7 @ 00:14:15 |
| Inducement validity | >= ~50% retrace of last move | P3 @ 00:32:31 |
| POI types | Order block, breaker block only (no FVG) | P4 @ 00:29:48; P5 @ 00:33:34 |
| POI selection | 4 rules; closest unmitigated to inducement | P5 @ 00:02:11–00:06:43 |
| Entry | Limit at OB/breaker demarcation; wick if wick<body, body if wick>body | P4 @ 00:32:22, 00:34:19 |
| Stop | Beyond engulfing candle/OB invalidation + 4–5 pips spread buffer; full OB (his default) or 50% into OB | P4 @ 00:32:35, 00:32:49, 01:06:44 |
| Stop sizing for large OB | Cover entire OB and reduce size, or drop timeframe for tighter zone | P5 @ 00:31:38 |
| Targets | Liquidity: trendline, equal highs/lows, long wick, inducement, valid opposing POI, HTF cycle low/high | P6 entire class; P8 @ 00:45:22 |
| RR | No fixed target; examples 1:4, 1:5.6, 1:6, 1:8, 1:16 | P5 @ 00:25:45; P1 @ 00:09:58 |
| Risk % | Not defined | P7 @ 01:09:03 only "manage your risk" |
| Sessions | Not defined | none found |
| News | Trades NFP when technicals agree; no blackout | P3 @ 00:43:27 |
| Pairs | GBPJPY, gold, BTC examples; "two or three pairs" | P1 @ 00:02:06; P6 @ 00:22:50; P8 @ 00:16:27 |

## Codability for a GBPUSD/EURUSD backtest

| Rule | Codability |
|---|---|
| HTF trend from HH/HL vs LH/LL | [CODABLE] swing detection needed; swing lookback is a free parameter |
| Bias held until cycle target (last swing low/high) | [CODABLE] last confirmed swing before bias start |
| MSS/BOS with body close | [CODABLE] define swing points; require candle close beyond |
| Inducement = first pullback >=50% | [CODABLE w/ PARAMETERS] 50% threshold; how to measure "last move" (swing-to-swing); allow 1..n candles |
| Inducement must be swept before POI | [CODABLE] trade only if the inducement extreme is taken before POI tap |
| OB detection (engulf) | [CODABLE] bearish candle fully engulfed by bullish body etc.; includes wick? sources show body engulf |
| Breaker = failed OB | [CODABLE] OB broken by body close, then re-tap |
| POI 4 rules | [CODABLE w/ PARAMETERS] "closest" metric (price distance vs pip distance) needs fixing; "unmitigated" needs exact-touch definition (wick vs body) |
| Entry at demarcation, wick/body rule | [CODABLE] exact |
| Stop: OB invalidation + buffer | [CODABLE w/ PARAMETERS] buffer 4–5 pips (source is XAU/GJ examples); currency-pair buffer needs decision; full-OB vs 50% choice |
| Targets: trendline/equal highs/lows/long wick/inducement/opposing POI | [CODABLE w/ PARAMETERS] each liquidity type needs a detector; ranking/preference not specified |
| Multiple entries per cycle | [CODABLE] continuation re-entries after new MSS/inducement/POI in bias direction |
| NFP/news handling | [DISCRETIONARY] no rule |
| Trade management (partials/BE/trailing) | [DISCRETIONARY / NOT DEFINED] no evidence in sources; expect full position to TP or SL |
| Session filter | [DISCRETIONARY / NOT DEFINED] |
| Risk % per trade | [NOT DEFINED] only "manage your risk" |
| Minimum RR filter | [NOT DEFINED]; structure decides targets; examples 1:4–1:16 result from tight stop |

## Not defined in public sources (do not invent)

1. Session/killzone times or days.
2. Risk percentage per trade, max daily risk, max concurrent positions.
3. Partials, break-even moves, trailing stops; hold-to-target appears to be the model (P7 @ 01:03:24) but is not stated as a rule.
4. Minimum acceptable RR before taking a setup.
5. Exact numeric definition of "closest POI to inducement" (ticks? pips? structural proximity?).
6. Exact "unmitigated" touch rules (wick vs body) for general OBs (only the breaker body rule is stated, P5 @ 00:33:00).
7. Handling when multiple HTF POIs stack (he marks several, waits for the one that gives a reversal concept: P8 @ 00:35:33–00:36:17).
8. Whether the bias timeframe should be strictly daily or 4H (both used in different classes).
9. Caption "13 minutes" (P8 @ 00:51:49, 00:52:32) — unknown whether 15m, 5m, or a personal chart interval; verify with tier-1 source.
10. Stop buffer for FX pairs (4–5 pips figure comes from gold/GJ examples).
11. Whether continuation entries re-use the same cycle target or partial targets.

## Bot implications (proposed mechanical ruleset for GBPUSD/EURUSD)

Proposed naive-but-faithful mapping (to be tuned by backtest):

1. **Bias**: On D1 (primary) or H4, classify trend via last N swings: HH/HL = bullish, LH/LL = bearish. Require >=2 completed legs (P8 @ 01:00:55).
2. **Bias target**: last confirmed swing low (bullish) / high (bearish) = cycle TP (P8 @ 00:44:14).
3. **HTF zones**: mark all unmitigated D1/H4 OBs (engulf definition) and breakers; these are the only places to look for entries (P8 @ 00:34:44).
4. **Trigger on lower TF**: when price taps an HTF zone, require on H1/M30: (a) MSS with body close of last opposing swing; (b) inducement = first pullback retracing >=50% of the MSS impulse; (c) inducement swept; (d) enter on the first valid unmitigated POI (breaker preferred if its body was not mitigated by the inducement; otherwise OB) that is the closest such POI to the inducement (P5 @ 00:02:11–00:06:43, P8 @ 00:41:04).
5. **Entry**: limit at POI demarcation; wick if wick < body else body (P4 @ 00:34:19).
6. **Stop**: beyond the engulfing candle (100% OB) + buffer (calibrate; 4–5 pips from source examples) (P4 @ 00:32:35, 01:06:44).
7. **Targets**: rank liquidity pools ahead of price: equal highs/lows, trendline-origin liquidity, long wicks, unswept inducements, valid opposing POIs, then the HTF cycle swing (P6 entire; P8 @ 00:45:22). High RR comes from far targets vs tight stops, not from a fixed RR constant.
8. **Same-direction re-entries**: after TP/stop, keep taking continuation setups (new MSS+inducement+POI) until the cycle target is hit or bias flips (P8 @ 01:06:36; P1 @ 00:08:16).
9. **Management**: no partials/BE in sources; backtest hold-to-target vs simple management as an open experiment.
10. **News/session filters**: none from source; treat as free parameters in optimization, not as rules.

### Divergence from the lost prototype (must document in the backtest writeup)

The first naive prototype lost money and did NOT implement the above. Its rules were:

- Bias from **H4 structuralBias** only (source uses D1 primary/4H, and requires swing sequences, not a single classifier).
- POI = **last opposing M15 candle** (source uses D1/4H engulf-based OB and breaker, with four validity rules and bank-of-POIs selection).
- Entry apparently **market-on-touch / confirmation** (source: limit at demarcation; wick/body rule).
- Stop = generic / nearest-swing (source: beyond engulfing candle + 4–5 pip buffer; full-OB default).
- Target = **nearest M15 swing with min 2R** (source: liquidity-based targets, trendline origin/equal highs/lows/long wick/inducement/opposing POI; no min-RR constant; observed RR 1:4–1:16).

None of the prototype's design choices matches the documented ruleset; a re-implementation should start from the pipeline above, then iterate with the backtest harness.

## Open questions for the strategy owner

1. Bias timeframe: strictly D1, or H4 acceptable? Does it change for GBPUSD/EURUSD vs gold/BTC?
2. Confirm the "13 minutes" caption (P8) — which chart timeframe is meant?
3. Ordinary OB "unmitigated": wick touch or body touch disqualifies?
4. "Closest POI to inducement": proximity measured how (pips, bars, structural order)?
5. Stop buffer for GBPUSD/EURUSD: fixed pips or ATR/spread-based?
6. Target selection priority when several liquidity pools exist; any partial close at the nearest pool?
7. Risk per trade and any portfolio caps for a 2-pair bot.
8. Should the bot take correctional (counter-bias) trades, and with what reduced target rule?
9. Minimum data resolution for MSS confirmation: is a body close required on the confirmation TF, or intrabar break acceptable?
10. Broker/session data standard (GMT offset, spread assumptions), given he emphasizes spread buffers and notes chart differences between brokers (P8 @ 00:31:17, 01:14:05).

## Prototype validation — `scratch-slp2.ts` (GBPUSD, 2024)

A second prototype was built directly from this document. What it implements:

- Bias: last two confirmed D1 swings (HH/HL, LH/LL), `--d1-width` sets D1 swing width; optional
  `--h4-confirm` additionally requires the H4 HH/HL read to agree.
- Anchor: unmitigated H4 engulf OB tapped within the last day of M15 bars, in the bias direction.
- Trigger: M15 body close through the last confirmed M15 swing (MSS) while anchored.
- Inducement: first M15 bar retracing >= 50% of the impulse (origin = last confirmed opposite M15
  swing) within 30 bars, must not invalidate the origin.
- POI: the last opposing M15 candle before the MSS; limit at the demarcation (wick if wick < body
  else body), 2-day life, invalidated by a close beyond the stop.
- Stop: full OB (wick extreme) + 2 pips; spread charged on entry only; no partials/BE.
- Targets: `--target cycle` = last confirmed D1 swing beyond entry; `nearest` = closest untaken M15
  swing; `menu` = nearest untaken M15 swing worth >= `--menu-min-r` (default 3), else cycle.
- Trades are independent (multiple re-entries per cycle, as the source does).

Results (GBPUSD):

| Window | Config | Trades | Win% | avgR | netR | PF | avg planned RR |
|---|---|---|---|---|---|---|---|
| Dec 2024 | cycle | 8 | 12.5% | −0.713 | −5.7 | 0.19 | 9.70 |
| Dec 2024 | nearest | 10 | 20.0% | −0.466 | −4.7 | 0.42 | 2.26 |
| Dec 2024 | menu (3R) | 10 | 0.0% | −1.000 | −10.0 | 0.00 | 3.69 |
| Dec 2024 | cycle, d1-width 2 | 8 | 12.5% | −0.713 | −5.7 | 0.19 | 11.20 |
| Dec 2024 | nearest + h4-confirm | 1 | 0.0% | −1.000 | −1.0 | 0.00 | 0.75 |
| 2024 full | nearest | 86 | 37.2% | −0.114 | −9.8 | 0.82 | 1.82 |
| 2024 full | nearest + h4-confirm | 32 | 40.6% | +0.042 | +1.3 | 1.07 | 1.97 |

Findings:

1. **No edge at prototype fidelity.** Full-year 2024 sits at breakeven-to-negative on GBPUSD; the
   only positive cell (H4-confirmed, +1.3R over 32 trades) is noise-level.
2. **Bias lag is structural.** December 2024 GBPUSD fell ~200 pips while the D1 HH/HL read stayed
   bullish (the November rally kept HH/HL until the last swing low broke near month end). The
   method's own flip rule (cycle target taken) is why; H4 confirmation is the only thing that cut
   the failed long cluster — at the cost of two-thirds of the setups.
3. **Target selection is the biggest fidelity gap.** Planned RR averages ~1.8-2R versus the source's
   observed 1:4-1:16. `nearest` M15 fractals are far too near (the source targets significant
   liquidity: equal highs/lows, session/HTF swings, long wicks, opposing POIs), while `cycle`
   (9.7-28R) is far too far to ever hit. A faithful target menu of *significant* pools has not
   yet been implemented.
4. **Bias direction dominates P&L** far more than entry mechanics: nearly every losing cluster is a
   bias-locked direction into a delivery against it.
5. Not yet implemented from the pipeline above: breakers vs OBs, the four POI validity rules, the
   "closest POI to inducement" selection, the liquidity target menu, session/HTF liquidity levels,
   and re-entry discipline after a stop.

Verdict: the prototype neither validates nor refutes SLP as the source trades it — fidelity gaps
2-5 above are material, and 2024 GBPUSD is one market. Any further investment should go into the
target menu and breaker/POI selection first, then a 5-year multi-pair test before touching the
engine strategy.

## Prototype v3 — `scratch-slp3.ts` (owner additions: HTF-verified direction, 4H anchor, untouched POIs, liquidity targets)

Owner-directed additions, all implemented:

1. Direction first, verified by HTF key levels: D1 HH/HL bias, and the bias's protective D1 swing
   must hold (longs need price above the last confirmed D1 low, shorts below the last D1 high).
2. 4H is the anchor frame: HH/HL read must agree with D1, and a 4H MSS/BOS (body close through the
   last confirmed 4H swing) in the bias direction is the trigger event (leg origin = last confirmed
   4H swing; inducement = first M15 pullback >= 50% of that leg).
3. POI: the closest-to-the-inducement untouched (unmitigated since the event) order block or
   breaker on **4H / 3H / 1H / 45m / 30m**, sitting beyond the inducement, in the bias direction.
   Breaker entries from the body; OB entries use the wick/body rule. Zones converted to breakers on
   a body close through them; one fill per zone.
4. Targets: nearest significant untaken liquidity pool beyond the leg extreme from a pool map
   (H4 swings, H1 swings, D1 swings, day highs/lows), floored by `--min-r` (default 2R) so a draw
   too close to the entry is not counted; D1 cycle level as fallback.

Q4 2024 GBPUSD (Oct 1 - Dec 31, loaded from Sep 1):

| Config | Events | Inducements | Gated | POI setups | Fills | Trades | Win% | netR | planned RR min/med/max |
|---|---|---|---|---|---|---|---|---|---|
| additions (4H structure gate on) | 116 | 73 | 13 | 13 | 5 | 3 | 33.3% | +2.2 | 4.2 / 10.4 / 12.6 |
| gate off (`--no-h4-structure`) | 116 | 73 | 26 | 26 | 13 | 10 | 10.0% | −4.8 | 2.3 / 5.7 / 17.0 |

Findings:

1. **RR geometry now matches the source** (planned 4.2-12.6R with 8-21 pip stops) once targets come
   from significant pools (H4/H1/D1 swings, day extremes) instead of M15 fractals — the earlier
   0.02R readings were a target-picking bug, not the method.
2. **All fills were on breaker zones** (30m-3H), none on plain OBs — breakers survived the
   "untouched since the event" test far more often.
3. The 4H HH/HL gate is doing real work: it removed 7 trades that all lost in this window.
4. n=3 trades (gate on) is far too small for a verdict; the funnel is tight by design.

Verdict: geometry faithful, sample not yet meaningful. Next candidates: more 3-month windows,
EURUSD, and loosening the entry funnel (7 of 13 gate-on POI setups died by shallow touches that
missed the demarcation).

### Full-year 2024, both pairs (the decisive sample)

| Config | Pair | Trades | Win% | avgR | netR | PF | planned RR med |
|---|---|---|---|---|---|---|---|
| additions, limit entry | GBPUSD | 22 | 4.5% | −0.708 | −15.6 | 0.26 | 8.0 |
| additions, limit entry | EURUSD | 14 | 0.0% | −1.000 | −14.0 | 0.00 | 3.4 |
| additions, confirm entry | GBPUSD | 22 | 9.1% | −0.553 | −12.2 | 0.39 | 3.3 |
| additions, confirm entry | EURUSD | 14 | 14.3% | −0.451 | −6.3 | 0.47 | 2.9 |
| additions, limit, Q4 only | GBPUSD | 3 | 33.3% | +0.731 | +2.2 | 2.10 | 10.4 |

At median targets of 3–8R the setup needs a 15–30% win rate; every full-year cell delivers 0–14%.
The Q4 +2.2R cell was n=3 noise.

**Conclusion (mechanical SLP, 2024, GBPUSD+EURUSD):** the owner additions produce the source's RR
geometry (4–17R planned, 5–26 pip stops, breaker entries) but the entries are systematically run
over. Combined with prototype v2 (GBPUSD 2024: 86 trades, 37% win, −0.114R; H4-confirmed 32 trades,
+0.042R), no mechanical configuration tested shows a positive edge beyond noise. The method as
taught is discretionary ("watch the market closely", live POI selection, news context); the
mechanical approximation does not survive on FX 2024.
