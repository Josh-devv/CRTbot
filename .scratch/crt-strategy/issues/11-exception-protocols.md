# 11: Exception protocols

**What to build:** The three exception protocols — 4-day, weekly-profile/TGIF, and Asian-range — plus the news-day (NFP/CPI/FOMC) stand-down. When a protocol triggers, the default action is to stand down for the day unless the config overrides it.

**Blocked by:** 07 (First real trade — execution & risk)

**Status:** ready-for-agent

- [ ] The 4-day protocol detects four consecutive same-direction days and flags counter-move risk
- [ ] The weekly-profile/TGIF and Asian-range conditions are detected
- [ ] When a protocol triggers, the engine stands down unless the config overrides it
- [ ] News-day (NFP/CPI/FOMC) stand-down is enforced
- [ ] Tests cover each protocol and the news-day filter
