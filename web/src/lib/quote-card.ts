import {
  BLOCKED_CARD_LABEL,
  LIVE_CARD_LABEL,
  btcCanFallLine,
  depositLimitMessage,
  priceCheckStatus,
  slippageMessage,
} from "./product-copy";

export type QuoteCardInput = {
  /** Factory opensPaused() is true. */
  paused: boolean;
  /** Pool versus oracle gap would fail the open check. */
  pegBlocked: boolean;
  /** The strict open quote would revert, so the numbers are a sample from the same market. */
  illustrative?: boolean;
  /** Deposit or resulting debt is above the factory limit. */
  overLimit: boolean;
  /** maxCollateral formatted in BTC, when the factory published one. */
  limitBtc?: string | null;
  /** Live pool-versus-oracle gap, already formatted as a percent. */
  gapPercent?: string | null;
  /** Live open bound, already formatted as a percent. */
  withinPercent?: string | null;
  /** User slippage, formatted as a percent. Used only for a real slippage miss. */
  slippagePercent?: string | null;
  /** Strict quote missed the user's slippage while the oracle open bound still allows it. */
  slippageMiss?: boolean;
  /** Liquidation price already formatted from a quote, or null when no quote exists. */
  liquidationPrice: string | null;
  /** Percent BTC can fall before 110% collateral, from the same quote. */
  dropPercent: number | null;
  /** Fee sentence built from the chain fee and the contract cap. */
  feeLine: string | null;
  /** "Max 0.5%, set on-chain", with the percent formatted from the cap. */
  feeCapLabel?: string | null;
};

export type QuoteCardView = {
  badge: string;
  blocked: boolean;
  liquidationPrice: string | null;
  dropLine: string | null;
  feeLine: string | null;
  feeCapLabel: string | null;
  pegMessage: string | null;
  overLimitMessage: string | null;
  slippageMessage: string | null;
};

/**
 * The card always has an outcome slot. Opens the chain would refuse are labelled
 * as a preview sample. An over-limit deposit and a real slippage miss stay separate.
 */
export function quoteCardView(input: QuoteCardInput): QuoteCardView {
  const blocked = input.paused || input.pegBlocked || input.illustrative === true;
  const pegMessage = input.pegBlocked && input.gapPercent && input.withinPercent
    ? priceCheckStatus(input.gapPercent, input.withinPercent)
    : null;
  return {
    badge: blocked ? BLOCKED_CARD_LABEL : LIVE_CARD_LABEL,
    blocked,
    liquidationPrice: input.liquidationPrice,
    dropLine: input.dropPercent === null ? null : btcCanFallLine(input.dropPercent),
    feeLine: input.feeLine,
    feeCapLabel: input.feeCapLabel ?? null,
    pegMessage,
    overLimitMessage: input.overLimit && input.limitBtc ? depositLimitMessage(input.limitBtc) : null,
    slippageMessage: input.slippageMiss && !input.pegBlocked && input.slippagePercent ? slippageMessage(input.slippagePercent) : null,
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
