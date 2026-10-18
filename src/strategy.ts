import type {
  BiasDirection,
  ContextSnapshot,
  Direction,
  KillzoneName,
  LiquidityEvent,
  OrderBlock,
  SessionName,
  SmtDivergence,
  StrategyConfig,
  StructureSnapshot,
  Trade,
} from "./types.js";

/** Everything the strategy can see at the current bar. */
export interface StrategyContext {
  index: number;
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  openTrade: Trade | null;
  tradesToday: number;
  isNewDay: boolean;
  session: SessionName;
  killzone: KillzoneName | null;
  /** The directional bias governing the session day. */
  bias: BiasDirection;
  /** The H4 context map (dealing range, key level, CRT), or null before the London open. */
  context: ContextSnapshot | null;
  /** SMT divergence against the correlated instrument, when one is flagged (§7.3). */
  smt: SmtDivergence | null;
  structure: StructureSnapshot | null;
  liquidity: LiquidityEvent | null;
  /** Order blocks confirmed on this bar. */
  orderBlocks: OrderBlock[];
}

export interface Signal {
  direction: Direction;
  reason: string;
  /**
   * Limit entry — the order-block open. When omitted the engine enters at market on the
   * signal bar (used by the walking-skeleton tests).
   */
  entry?: number;
  /** Protective stop — the order-block extreme. */
  stop?: number;
}

/** A deliberate no-trade: recorded in the decisions log with its reason. */
export interface Wait {
  reason: string;
}

/** A strategy either proposes a trade, declines with a reason, or says nothing. */
export type StrategyResult = Signal | Wait | null;

export interface Strategy {
  readonly name: string;
  decide(ctx: StrategyContext): StrategyResult;
}

/**
 * Placeholder strategy for the walking skeleton only.
 * Enters long once per UTC day, on the day's first bar. Replaced by the real
 * Axis System execution layer in later tickets.
 */
export function placeholderLong(cfg: StrategyConfig): Strategy {
  return {
    name: "placeholder-long",
    decide(ctx) {
      if (ctx.openTrade) return null;
      if (ctx.tradesToday >= cfg.risk.maxTradesPerDay) return null;
      if (!ctx.isNewDay) return null;
      return { direction: "long", reason: "placeholder: first bar of day, long" };
    },
  };
}
