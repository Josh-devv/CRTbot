export type Instrument = "GBPUSD" | "EURUSD";

export type Direction = "long" | "short";

export type Timeframe = "M15" | "H4" | "D1" | "W1" | "MN1";

export type SessionName = "asia" | "london" | "newYork" | "other";

export type KillzoneName = "london" | "newYork";

/** A clock window as "HH:mm", interpreted in the session timezone. */
export interface Window {
  start: string;
  end: string;
}

export interface SessionConfig {
  /** IANA timezone all session logic is anchored to. */
  tz: string;
  /** Time-of-day (in tz) at which the trading day rolls over. */
  dayBoundary: { hour: number; minute: number };
  sessions: Record<Exclude<SessionName, "other">, Window>;
  killzones: Record<KillzoneName, Window>;
  /** Key macro times as "HH:mm" in tz. */
  keyMacros: string[];
  /** Stand-down dates as "yyyy-MM-dd" in tz. */
  newsDays: string[];
}

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
  session: SessionConfig;
  /** Structural significance tuning. */
  structure?: { swingWidth: number };
  strategy: { stopDistance: number };
  risk: { rMultiple: number; maxTradesPerDay: number; riskPerTradePct: number };
  costs: { spread: number; commission: number; slippage: number };
  initialEquity: number;
}

/** Premium is the upper half of the dealing range, discount the lower half. */
export type PricePosition = "premium" | "discount" | "equilibrium";

/** Draw On Liquidity — where price is drawn to. */
export interface Dol {
  longTerm: number;
  shortTerm: number;
}

/** The structural read at a point in time, as recorded on a decision. */
export interface StructureSnapshot {
  range: { high: number; low: number; equilibrium: number };
  position: PricePosition;
  dol: Dol | null;
}

/** The side of the market whose liquidity a sweep takes: below a low, or above a high. */
export type LiquiditySide = "low" | "high";

/** A rejection before the relative DOL is a mere purge; at or after it, a CSD. */
export type RejectionKind = "purge" | "csd";

export interface LiquidityEvent {
  side: LiquiditySide;
  /** The level whose liquidity was taken. */
  level: number;
  /** The wick extreme that took it. */
  extreme: number;
  /** Whether the same bar's body continued after the purge (a CRT). */
  isCrt: boolean;
  /** Classification against the relative DOL, or null when no further pool is known. */
  kind: RejectionKind | null;
}

export interface Decision {
  time: number;
  action: "enter" | "exit" | "wait" | "stand-down";
  direction?: Direction;
  reason: string;
  session?: SessionName;
  killzone?: KillzoneName | null;
  bucket?: { timeframe: Timeframe; time: number };
  structure?: StructureSnapshot;
  liquidity?: LiquidityEvent;
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
