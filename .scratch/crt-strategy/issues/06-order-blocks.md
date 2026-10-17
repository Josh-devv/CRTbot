# 06: Order blocks

**What to build:** Order-block detection using the full definition — a qualifying behaviour (purging liquidity, filling liquidity, or generating liquidity) **and** engulfment — plus body-vs-wick resolution, multi-candle grouping, propulsion blocks, and high-probability scoring (HTF-bias alignment, premium/discount location, formed at a key time, tested at a key time).

**Blocked by:** 05 (Liquidity — purge, CRT, CSD vs purge)

**Status:** ready-for-agent

- [ ] An order block requires both a qualifying behaviour and engulfment; missing either means it is not an order block
- [ ] Body-vs-wick resolution matches how price closes through the candle
- [ ] Consecutive candles closed through as a whole are grouped into a single order block
- [ ] Propulsion blocks (an order block formed by testing a prior order block) are recognised
- [ ] High-probability scoring applies the four conditions
