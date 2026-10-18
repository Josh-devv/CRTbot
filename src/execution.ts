import type { StrategyResult, Strategy, StrategyContext } from "./strategy.js";
import type { OrderBlock } from "./types.js";

/**
 * The Axis System execution layer (ruleset §5).
 *
 * Trigger + confirmation: an order block confirmed on this bar — the CRT purge being the
 * primary qualifying behaviour. Placement: entry at the block's open, stop at the block's
 * extreme, take profit a fixed 3R away (§5.3). Setups are only proposed inside a killzone.
 *
 * The engine carries out the rest of the risk rules: at most one trade a day, and never
 * moving the stop or target.
 */
export function axisSystem(): Strategy {
  return {
    name: "axis-system",
    decide(ctx: StrategyContext): StrategyResult {
      if (ctx.killzone === null) return { reason: "outside a killzone" };

      // Prefer the purge/CRT block; otherwise any confirmed block is confirmation enough.
      const block: OrderBlock | undefined =
        ctx.orderBlocks.find((candidate) => candidate.behaviours.includes("purge")) ??
        ctx.orderBlocks[0];
      if (block === undefined) return { reason: "no order block confirmed" };

      const entry = block.open;
      const stop = block.direction === "long" ? block.bottom : block.top;
      const risk = Math.abs(entry - stop);
      if (risk === 0) return { reason: "degenerate order block (zero risk)" };

      // The engine derives the fixed-3R target from these prices (ADR-0003).
      return {
        direction: block.direction,
        reason: `order block (${block.behaviours.join(" + ")})`,
        entry,
        stop,
      };
    },
  };
}
