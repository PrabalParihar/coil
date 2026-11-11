import { OVER_LIMIT_MESSAGE, PEG_BLOCK_MESSAGE, btcCanFallLine } from "./product-copy";

export type QuoteCardInput = {
  /** Factory opensPaused() is true. */
  paused: boolean;
  /** Pool versus oracle gap would fail the open check. */
  pegBlocked: boolean;
  /** The strict open quote would revert, so the numbers are a sample from the same market. */
  illustrative?: boolean;
  /** Deposit or resulting debt is above the factory limit. */
  overLimit: boolean;
  /** Liquidation price already formatted from a quote, or null when no quote exists. */
  liquidationPrice: string | null;
  /** Percent BTC can fall before 110% collateral, from the same quote. */
  dropPercent: number | null;
  /** Fee sentence built from the quote and the chain fee. */
  feeLine: string | null;
};

export type QuoteCardView = {
  badge: "Quote" | "Sample";
  liquidationPrice: string | null;
  dropLine: string | null;
  feeLine: string | null;
  pegMessage: string | null;
  overLimitMessage: string | null;
};

/**
 * The card always has an outcome slot. Opens that the chain would refuse
 * (paused, or the pool/oracle check would fail) are labelled Sample.
 * An over-limit deposit gets its own message, separate from the peg message.
 */
export function quoteCardView(input: QuoteCardInput): QuoteCardView {
  const blocked = input.paused || input.pegBlocked || input.illustrative === true;
  return {
    badge: blocked ? "Sample" : "Quote",
    liquidationPrice: input.liquidationPrice,
    dropLine: input.dropPercent === null ? null : btcCanFallLine(input.dropPercent),
    feeLine: input.feeLine,
    pegMessage: input.pegBlocked ? PEG_BLOCK_MESSAGE : null,
    overLimitMessage: input.overLimit ? OVER_LIMIT_MESSAGE : null,
  };
}

/** True when the typed deposit is above a limit read from the factory. */
export function exceedsFactoryLimit(text: string, collateral: bigint | null, limit: bigint | null): boolean {
  if (limit === null || limit <= 0n) return false;
  if (collateral !== null) return collateral > limit;
  if (!/^\d+(\.\d+)?$/.test(text.trim())) return false;
  const whole = text.trim().split(".")[0] ?? "0";
  try {
    const scale = 10n ** 18n;
    const [units, frac = ""] = text.trim().split(".");
    const padded = (frac + "0".repeat(18)).slice(0, 18);
    const amount = BigInt(units || "0") * scale + BigInt(padded || "0");
    return amount > limit;
  } catch {
    return whole.length > 12;
  }
}

export function quoteFeeLine(coilFeeMusd: string, poolFeeMusd: string, openFeePercent: string | null): string {
  const rate = openFeePercent ? `Coil fee ${openFeePercent}` : "Coil fee";
  return `${rate} (${coilFeeMusd} MUSD on newly minted debt). Pool fee ${poolFeeMusd} MUSD. Exit fee 0.`;
}
