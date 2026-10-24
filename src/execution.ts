import { biasVetoes } from "./bias.js";
import { contextVetoes } from "./context.js";
import type { StrategyResult, Strategy, StrategyContext } from "./strategy.js";
import type { ExecutionFilters, OrderBlock, SmtDivergence } from "./types.js";

/** One pip, for the filter floors. Both traded instruments are USD majors. */
const PIP = 0.0001;

/**
 * The Axis System execution layer (ruleset §5), under the measured edge filters (ticket 21).
 *
 * Trigger + confirmation: an order block confirmed on this bar — the CRT purge being the
 * primary qualifying behaviour. Placement: entry at the block's open, stop at the block's
 * extreme, take profit a fixed 3R away (§5.3). Setups are only proposed inside a killzone, and
 * never against the day's directional bias.
 *
 * The filters gate the candidate blocks rather than the bar: a block that fails them is not
 * offered, but another block on the same bar that passes still can be. The engine carries out
 * the rest of the risk rules: at most one trade a day, and never moving the stop or target.
 */
export function axisSystem(filters: ExecutionFilters = {}): Strategy {
  return {
    name: "axis-system",
    decide(ctx: StrategyContext): StrategyResult {
      if (ctx.killzone === null) return { reason: "outside a killzone" };

      const candidates = ctx.orderBlocks.filter((block) => passes(block, filters));
      // Prefer the purge/CRT block; otherwise any confirmed block is confirmation enough.
      const block: OrderBlock | undefined =
        candidates.find((candidate) => candidate.behaviours.includes("purge")) ?? candidates[0];
      if (block === undefined) {
        return {
          reason:
            ctx.orderBlocks.length === 0
              ? "no order block confirmed"
              : `all confirmed blocks filtered out (${filterSummary(filters)})`,
        };
      }

      // The bias first, then the map it is executed against (§4.2), then the divergence that
      // can stand in for that map when it is confirmed (§7.3).
      const veto =
        biasVetoes(ctx.bias, block.direction) ?? contextVetoes(ctx.context, ctx.smt);
      if (veto !== null) return { reason: veto };

      // §5.1's liquidity-purge trigger: the setup must be trading a CRT of the dealing range,
      // and it must have purged the side the trade is taken from.
      if (filters.requireCrt === true) {
        const crt = ctx.context?.recentCrt ?? null;
        if (crt === null) return { reason: "no CRT in the dealing range" };
        const needed = block.direction === "long" ? "low" : "high";
        if (crt.side !== needed) {
          return { reason: `CRT purged the ${crt.side} side, not the ${needed} side` };
        }
      }

      const entry = block.open;
      const stop = block.direction === "long" ? block.bottom : block.top;
      const risk = Math.abs(entry - stop);
      if (risk === 0) return { reason: "degenerate order block (zero risk)" };
      if (filters.minRiskPips !== undefined && risk < filters.minRiskPips * PIP) {
        return {
          reason:
            `order block risk ${(risk / PIP).toFixed(1)} pips is under the ` +
            `${filters.minRiskPips} pip floor`,
        };
      }

      // The engine derives the fixed-3R target from these prices (ADR-0003).
      return {
        direction: block.direction,
        reason: triggerReason(block, ctx.smt),
        entry,
        stop,
      };
    },
  };
}

/** Whether a block clears the configured filters. */
function passes(block: OrderBlock, filters: ExecutionFilters): boolean {
  if (filters.blockPart !== undefined && block.part !== filters.blockPart) return false;
  if (filters.purgeOnly === true && !(block.behaviours.length === 1 && block.behaviours[0] === "purge")) {
    return false;
  }
  return true;
}

/** What the filters demanded, for the rejection reason. */
function filterSummary(filters: ExecutionFilters): string {
  const bits: string[] = [];
  if (filters.blockPart !== undefined) bits.push(`part must be ${filters.blockPart}`);
  if (filters.purgeOnly === true) bits.push("behaviour must be purge only");
  return bits.join("; ");
}

/** What got the trade over the line: a confirmed divergence, or the order block alone. */
function triggerReason(block: OrderBlock, smt: SmtDivergence | null): string {
  const blockReason = `order block (${block.behaviours.join(" + ")})`;
  if (smt === null || smt.confirmedBy === null) return blockReason;
  return `${blockReason}, SMT divergence confirmed by a ${smt.confirmedBy}`;
}
