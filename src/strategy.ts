import type { StrategyConfig, Trade } from "./types.js";

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
}

export interface Signal {
  direction: "long" | "short";
  reason: string;
}

export interface Strategy {
  readonly name: string;
  decide(ctx: StrategyContext): Signal | null;
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
