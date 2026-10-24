# 17: Execution completion — entry triggers and FVG/MSS confirmations

**What to build:** §5.1–5.2 of the ruleset for real. Today `axisSystem` fires on *any* confirmed
order block (preferring a purge block) — the trigger set and two of the three confirmations are
missing (ticket 07's follow-ups). Build the trigger→confirmation pipeline: triggers (key-level
reaction, liquidity purge, SMT divergence, at a key time) and confirmations in Sham's preference
order (order-block formation → FVG formation → MSS). Every gate config-selectable, so today's
behaviour stays reproducible.

**Blocked by:** nothing (fixtures exercise it).

**Status:** ready-for-agent

## Acceptance criteria

- [ ] A setup is only armed when one of the three §5.1 triggers is in play at a key time; which
      triggers count is config (default: the spec's "any of"; a purge-only and an SMT-only
      config reproduce the strictest/loosest readings).
- [ ] `fvg.ts`: FVG (3-candle imbalance) detection, entry/stop from the FVG when it is the
      confirmation that fires first (§5.3 placement stays mechanical).
- [ ] MSS confirmation as the last alternative, read off the existing significant points.
- [ ] Confirmation preference: order block first, then FVG, then MSS — never a lower preference
      when a higher one is present on the bar.
- [ ] Fixture tests per trigger and per confirmation; existing tests stay green; the ticket-16
      config reproduces the golden run byte for byte.

## Notes

- Sham rejects MSS/BoS as a *trigger* ("price often does not respect MSS/BoS") but §5.2 lists
  MSS as an acceptable *confirmation*; FVGs are a 2nd-tier key level (PD array hierarchy:
  rejection blocks → order blocks → FVGs → breakers).
- The measurement study (ticket 20) decides the default trigger strictness; this ticket
  implements the switches, not the verdict.
- **CRT-trigger probe measured and refuted (2026-10).** Ticket 21's `requireCrt` +
  `crtLookbackBars` accepts a setup only when the current dealing range carries a CRT on the
  needed side within N H4 candles. With risk>=3 + purgeOnly: 5y 2020–2024 lookback 0/3/6/12/24
  → 28/+0.232R, 44/+0.178R, 46/+0.124R, 46/+0.124R, 47/+0.098R; out-of-sample 2015–2019 →
  21/−0.204R, 33/−0.169R, 36/−0.242R, 39/−0.218R, 39/−0.218R. Without purgeOnly it is negative
  in both eras. So the gate is a small-sample artefact, not an edge.
- The probe only asks that a CRT *exists* and matches the side — not that price actually purged
  its extreme at a key time before the confirmation, which is §5.1's trigger. Key-level
  reaction and SMT triggers, and FVG/MSS confirmations, remain unimplemented (SMT also returned
  no divergences at any arm in the 10y study, so that gate is currently unfalsifiable).
