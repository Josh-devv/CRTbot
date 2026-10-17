export type Instrument = "GBPUSD" | "EURUSD";

export type Direction = "long" | "short";

export interface Bar {
  /** Epoch milliseconds, UTC. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface BarSeries {
  instrument: Instrument;
  bars: Bar[];
}

export interface StrategyConfig {
  instrument: Instrument;
  /** IANA timezone the session logic is anchored to. */
  sessionTz: string;
  strategy: { stopDistance: number };
  risk: { rMultiple: number; maxTradesPerDay: number; riskPerTradePct: number };
  costs: { spread: number; commission: number; slippage: number };
  initialEquity: number;
}

export interface Decision {
  time: number;
  action: "enter" | "exit" | "wait" | "stand-down";
  direction?: Direction;
  reason: string;
}

export interface Trade {
  instrument: Instrument;
  direction: Direction;
  entryTime: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  size: number;
  riskAmount: number;
  exitTime?: number;
  exitPrice?: number;
  pnl?: number;
  rMultiple?: number;
  reason: string;
}

export interface EquityPoint {
  time: number;
  equity: number;
}

export interface Stats {
  tradeCount: number;
  winRate: number;
  avgR: number;
  expectancyR: number;
  maxDrawdown: number;
  profitFactor: number;
}

export interface BacktestResult {
  trades: Trade[];
  equityCurve: EquityPoint[];
  stats: Stats;
  decisions: Decision[];
  configHash: string;
}
