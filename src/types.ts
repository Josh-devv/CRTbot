export type Instrument = "GBPUSD" | "EURUSD";

export type Direction = "long" | "short";

export type Timeframe = "M15" | "H4" | "D1" | "W1" | "MN1";

export type SessionName = "asia" | "london" | "newYork" | "other";

export type KillzoneName = "london" | "newYork";

/** The directional-bias read: which way price is delivering, or `"none"` when it is unclear. */
export type BiasDirection = "bullish" | "bearish" | "none";

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

/**
 * SMT divergence between correlated instruments (§7.3).
 *
 * A divergence is only ever reported when all three criteria held — aligned with the HTF bias,
 * formed at an HTF key level, formed at a key time — so a flagged divergence is already the
 * qualified kind. It still does not trade on its own: `confirmedBy` must name the follow-on
 * valid CSD or valid order block that validates it.
 */
export interface SmtDivergence {
  /** The side whose liquidity was taken. */
  side: LiquiditySide;
  /** The instrument that took the liquidity. */
  took: Instrument;
  /** The correlated instrument that failed to take it. */
  failed: Instrument;
  /** The lower-timeframe confirmation (§7.3), or null while the divergence is unconfirmed. */
  confirmedBy: "csd" | "order-block" | null;
}

/** Which instruments count as correlated, and whether DXY is used as the dollar reference. */
export interface SmtConfig {
  enabled: boolean;
  /** Instrument pairs treated as correlated (§7.3). */
  pairs: [Instrument, Instrument][];
  /** DXY as a dollar reference — off in v1 (ADR-0001). */
  useDxy: boolean;
}

/**
 * One of the three recognised exception protocols (§8): a day whose bias is unreliable, where
 * Sham's action is to skip the day entirely.
 */
export type ExceptionProtocol = "four-day" | "weekly-profile" | "asian-range";

/** Which exception protocols are enforced as a stand-down, on top of being detected (§8). */
export interface ExceptionConfig {
  /** Four consecutive days one way — the next day tends to counter (§8.1). */
  fourDay: boolean;
  /** Late week with the expansion already delivered — TGIF (§8.2). */
  weeklyProfile: boolean;
  /** The Asian range expanded early — London and New York tend to counter (§8.3). */
  asianRange: boolean;
  /** How many times its recent average an Asian range counts as expanded. */
  asianRangeFactor?: number;
}

/** Whether a configured news day is skipped (§9). The dates live in `SessionConfig.newsDays`. */
export interface NewsConfig {
  standDown: boolean;
}

/**
 * One session day, as the day itself is forming: its OHLC so far plus, once the Asian window has
 * traded inside it, that window's range. Shared by the exception protocols (§8) and the
 * expansion-day test (§10), both of which read a day's shape rather than its bars.
 */
export interface DayFacts {
  /** Epoch ms of the session day's start. */
  day: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** The Asian window's range, once that window has traded inside this session day. */
  asia?: { high: number; low: number };
}

/**
 * The day reads judge a session day from: every session day strictly behind it, the day itself
 * as it stands, and the config to judge it under. Shared by the exception protocols (§8) and the
 * expansion-day test (§10).
 */
export interface DayRead {
  /** Every session day strictly before the one being read. */
  completedDays: DayFacts[];
  /** The day being read, as it stands on this bar. */
  today: DayFacts;
  cfg: StrategyConfig;
}

/** Which session the expansion-day test expects to deliver the move (§10). */
export type ExpansionSession = "london" | "newYork" | "neither";

/**
 * The verdict of the expansion-day test (§10): whether today is an expansion day, which session
 * the expansion is expected in, and the read to show for it.
 */
export interface ExpansionTest {
  isExpansionDay: boolean;
  session: ExpansionSession;
  reason: string;
}

/**
 * The expansion-day test (§10). Sham's reaction to a day that is not an expansion day is to be
 * selective, so this stands the day down only when explicitly enforced.
 */
export interface ExpansionConfig {
  /** Stand the day down when it is not an expansion day. */
  enforce: boolean;
  /** Asia at or below this multiple of its average is consolidating — London expansion likely. */
  consolidationFactor?: number;
  /** Asia at or above this multiple of its average has already expanded — New York expands. */
  expansionFactor?: number;
  /** How many completed days a range is averaged over. */
  lookbackDays?: number;
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
  /** Correlated-instrument divergence (§7.3). Absent means disabled. */
  smt?: SmtConfig;
  /** Exception protocols that stand the day down (§8). Absent enforces all three. */
  exceptions?: ExceptionConfig;
  /** News-day stand-down (§9). Absent enforces it whenever `session.newsDays` lists the day. */
  news?: NewsConfig;
  /** The expansion-day test (§10). Absent leaves the verdict logged but suppresses nothing. */
  expansionDay?: ExpansionConfig;
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

/** A dealing range as recorded on a snapshot: the framing prices and their midpoint. */
export interface RangeView {
  high: number;
  low: number;
  equilibrium: number;
}

/** The structural read at a point in time, as recorded on a decision. */
export interface StructureSnapshot {
  range: RangeView;
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

/**
 * The H4 context map (ruleset §4): the dealing range aligned to the HTF bias, with the key
 * level and the CRT inside it.
 */
export interface ContextSnapshot {
  timeframe: "H4";
  range: RangeView;
  position: PricePosition;
  /** The level within the range the bias trades off: the discount low, or the premium high. */
  keyLevel: number;
  /** The CRT formed inside the dealing range on the current H4 candle, if any. */
  crt: LiquidityEvent | null;
  /** True when the premium/discount location agrees with the bias direction. */
  aligned: boolean;
}

/** The qualifying behaviour an order block's candle shows (ruleset §6). */
export type ObBehaviour = "purge" | "fill" | "generate";

export interface OrderBlock {
  /** Index of the last candle in the block. */
  index: number;
  time: number;
  direction: Direction;
  /** The block's open — the entry price when the block is traded (§5.3). */
  open: number;
  /** Price zone of the block after body-vs-wick resolution. */
  top: number;
  bottom: number;
  /** Whether the zone is the candle body or the whole candle (wick). */
  part: "body" | "wick";
  behaviours: ObBehaviour[];
  /** Index of the candle that engulfed the block. */
  engulfedBy: number;
  /** Number of consecutive candles in the block; 1 for a single candle. */
  candles: number;
  /** Formed by testing a previous order block. */
  propulsion: boolean;
}

/** The four high-probability conditions (ruleset §6), all required. */
export interface OrderBlockScore {
  highProbability: boolean;
  biasAligned: boolean;
  discountOrPremium: boolean;
  formedAtKeyTime: boolean;
  testedAtKeyTime: boolean;
}

export interface Decision {
  time: number;
  action: "enter" | "exit" | "wait" | "stand-down";
  direction?: Direction;
  reason: string;
  session?: SessionName;
  killzone?: KillzoneName | null;
  /** The directional bias governing the day. */
  bias?: BiasDirection;
  /** The H4 context map the bias is executed against. */
  context?: ContextSnapshot;
  /** SMT divergence against the correlated instrument, when one is flagged (§7.3). */
  smt?: SmtDivergence;
  /** The exception protocols detected for this session day (§8), when any are in play. */
  exceptions?: ExceptionProtocol[];
  /** Set when this session day is one of the configured news days (§9). */
  newsDay?: boolean;
  /** The expansion-day verdict for this session day (§10). */
  expansionTest?: ExpansionTest;
  bucket?: { timeframe: Timeframe; time: number };
  structure?: StructureSnapshot;
  liquidity?: LiquidityEvent;
  orderBlocks?: OrderBlock[];
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
