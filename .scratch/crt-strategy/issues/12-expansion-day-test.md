# 12: Expansion-day test

**What to build:** The anticipatory "is today an expansion day?" gate using the weekly profile, the weekly and daily OHLC framework, and Asian-session behaviour — including the heuristics that a consolidated Asia favours a London expansion and an already-expanded Asia favours a New York expansion.

**Blocked by:** 09 (H4 context layer)

**Status:** ready-for-agent

- [ ] The engine decides "expansion day: yes/no" from the defined inputs
- [ ] The Asia-consolidated → London-expansion heuristic is applied
- [ ] The Asia-already-expanded → NY-expansion heuristic is applied
- [ ] The gate can suppress a day's trading, and its output is visible in the decisions log
