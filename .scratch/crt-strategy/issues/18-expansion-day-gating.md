# 18: Expansion-day verdict consumed by execution

**What to build:** Ticket 12's follow-up. `ExpansionTest.session` is computed and logged on every
decision but nothing acts on it. Consume it in the execution layer: when Asia has already
expanded, the London killzone is low-probability (Sham's operative read), and the session the
verdict names is the one to favour. Config-gated so the ungated engine stays reproducible.

**Blocked by:** nothing.

**Status:** ready-for-agent

## Acceptance criteria

- [ ] With the gate on: no entries in the London killzone on Asia-expanded days, and New York
      entries are the intended path (decision reasons say so).
- [ ] With the gate off: behaviour byte-identical to today (golden run unaffected).
- [ ] Fixture days where the verdict flips behaviour, and days where it does not.
- [ ] The verdict's effect is visible in the decisions log (reason strings).

## Notes

- The expansion test already carries `session: "london" | "newYork" | "neither"`; "neither"
  means no preference and gates nothing.
- Whether this helps expectancy is measured in ticket 20, not assumed here.
