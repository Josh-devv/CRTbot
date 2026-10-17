import type { EquityPoint, Stats, Trade } from "./types.js";

export function maxDrawdown(curve: EquityPoint[]): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const point of curve) {
    if (point.equity > peak) peak = point.equity;
    if (peak > 0) {
      const dd = (peak - point.equity) / peak;
      if (dd > worst) worst = dd;
    }
  }
  return worst;
}

export function computeStats(trades: Trade[], equityCurve: EquityPoint[]): Stats {
  const tradeCount = trades.length;
  const drawdown = maxDrawdown(equityCurve);

  if (tradeCount === 0) {
    return {
      tradeCount: 0,
      winRate: 0,
      avgR: 0,
      expectancyR: 0,
      maxDrawdown: drawdown,
      profitFactor: 0,
    };
  }

  const rs = trades.map((t) => t.rMultiple ?? 0);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const sumR = rs.reduce((a, b) => a + b, 0);
  const avgR = sumR / tradeCount;

  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor =
    grossLoss === 0 ? (grossWin > 0 ? Number.POSITIVE_INFINITY : 0) : grossWin / grossLoss;

  return {
    tradeCount,
    winRate: wins.length / tradeCount,
    avgR,
    expectancyR: avgR,
    maxDrawdown: drawdown,
    profitFactor,
  };
}
