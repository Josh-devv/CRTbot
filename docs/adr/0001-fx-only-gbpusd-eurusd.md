# Instruments are GBPUSD and EURUSD only

The Axis System is a spot-FX, session-driven model — its killzones, SMT pairs and news
calendar are all FX-shaped — so CRTbot trades only GBPUSD and EURUSD. Earlier research had
also swept in NAS100 and SPX500; those instruments are dropped.

**Considered options:** Also cover the indices Sham trades publicly. Rejected because index
sessions, spread/commission structures, tick values and overnight behaviour are materially
different, and SMT would need different correlated references — every one of those is extra
work that does not improve fidelity on the FX pairs the methodology is actually described
against.

**Consequences:** The instrument type is a closed union of two values. Data ingestion,
cost models and SMT pairings only ever need to handle FX majors, and EU/US equity-index
data is out of scope for both the backtester and any future live component. Re-adding an
index later means revisiting the session model, the cost model and the SMT references.
