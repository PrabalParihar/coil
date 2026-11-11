import {
  BLOCKED_CARD_LABEL,
  DEPOSIT_NOT_A_NUMBER,
  DEPOSIT_NOT_POSITIVE,
  EMPTY_DEPOSIT_HELPER,
  LIVE_CARD_LABEL,
  btcCanFallLine,
  depositLimitMessage,
  leastDepositMessage,
  mostDepositMessage,
  priceCheckStatus,
  slippageMessage,
} from "./product-copy";

export const BTC_WEI = 10n ** 18n;

/** Format a 18-decimal token amount without rounding the limit away. */
export function formatLimitAmount(wei: bigint): string {
  const sign = wei < 0n ? "-" : "";
  const abs = wei < 0n ? -wei : wei;
  const whole = abs / BTC_WEI;
  const frac = (abs % BTC_WEI).toString().padStart(18, "0").replace(/0+$/, "");
  return frac ? `${sign}${whole.toString()}.${frac}` : `${sign}${whole.toString()}`;
}

export type DepositLimits = {
  /** Smallest amount the chain or factory will accept, in wei. Null skips the check. */
  minWei?: bigint | null;
  /** Largest deposit the factory published, in wei. Null skips the check. */
  maxWei?: bigint | null;
};

export type DepositClassification =
  | { ok: true; wei: bigint }
  | { ok: false; message: string };

/**
 * Classify a deposit field. Limits are passed in from chain config or factory policy.
 * A positive amount finer than 1 wei uses minWei, or 1 wei when the caller did not publish a larger minimum.
 */
export function classifyDeposit(raw: string, limits: DepositLimits = {}): DepositClassification {
  const text = raw.trim();
  if (!text) return { ok: false, message: EMPTY_DEPOSIT_HELPER };
  if (!/^-?\d+(\.\d+)?$/.test(text)) return { ok: false, message: DEPOSIT_NOT_A_NUMBER };
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [wholeRaw, fracRaw = ""] = body.split(".");
  const whole = wholeRaw.replace(/^0+(?=\d)/, "") || "0";
  let wei: bigint;
  let finerThanWei = false;
  try {
    if (fracRaw.length > 18) {
      const head = fracRaw.slice(0, 18);
      const dust = fracRaw.slice(18);
      wei = BigInt(whole) * BTC_WEI + BigInt(head || "0");
      finerThanWei = /[1-9]/.test(dust);
    } else {
      const padded = (fracRaw + "0".repeat(18)).slice(0, 18);
      wei = BigInt(whole) * BTC_WEI + BigInt(padded || "0");
    }
  } catch {
    return { ok: false, message: DEPOSIT_NOT_A_NUMBER };
  }
  if (negative || (wei <= 0n && !finerThanWei)) return { ok: false, message: DEPOSIT_NOT_POSITIVE };
  if (finerThanWei && wei === 0n) {
    const min = limits.minWei && limits.minWei > 0n ? limits.minWei : 1n;
    return { ok: false, message: leastDepositMessage(formatLimitAmount(min)) };
  }
  if (limits.minWei && limits.minWei > 0n && wei < limits.minWei) {
    return { ok: false, message: leastDepositMessage(formatLimitAmount(limits.minWei)) };
  }
  if (limits.maxWei && limits.maxWei > 0n && wei > limits.maxWei) {
    return { ok: false, message: mostDepositMessage(formatLimitAmount(limits.maxWei)) };
  }
  return { ok: true, wei };
}

export type QuoteCardInput = {
  /** Factory opensPaused() is true. */
  paused: boolean;
  /** Pool versus BTC price feed gap would fail the open check. */
  pegBlocked: boolean;
  /** The strict open quote would revert, so the numbers are a sample from the same market. */
  illustrative?: boolean;
  /** A connected account's quote is still loading or failed, so the numbers are only a sample. */
  displayOnly?: boolean;
  /** Deposit text the chain will not accept. Hides the risk label and the result numbers. */
  inputError?: string | null;
  /** Plain reason a sample is on screen instead of an account quote. */
  sampleReason?: string | null;
  /** Deposit or resulting debt is above the factory limit. */
  overLimit: boolean;
  /** maxCollateral formatted in BTC, when the factory published one. */
  limitBtc?: string | null;
  /** Live pool-versus-feed gap, already formatted as a percent. */
  gapPercent?: string | null;
  /** Live open bound, already formatted as a percent. */
  withinPercent?: string | null;
  /** User slippage, formatted as a percent. Used only for a real slippage miss. */
  slippagePercent?: string | null;
  /** Strict quote missed the user's slippage while the open bound still allows it. */
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
  showRisk: boolean;
  showResults: boolean;
  inputError: string | null;
  sampleReason: string | null;
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
 * as a preview sample. An invalid deposit hides the risk label and the result numbers.
 */
export function quoteCardView(input: QuoteCardInput): QuoteCardView {
  const invalid = Boolean(input.inputError);
  const blocked = !invalid && (input.paused || input.pegBlocked || input.illustrative === true || input.displayOnly === true);
  const pegMessage = !invalid && input.pegBlocked && input.gapPercent && input.withinPercent
    ? priceCheckStatus(input.gapPercent, input.withinPercent)
    : null;
  const sampleReason = invalid ? null : input.sampleReason ?? null;
  return {
    badge: invalid ? "" : blocked ? BLOCKED_CARD_LABEL : LIVE_CARD_LABEL,
    blocked,
    showRisk: !invalid && input.displayOnly !== true,
    showResults: !invalid,
    inputError: input.inputError ?? null,
    sampleReason,
    liquidationPrice: invalid ? null : input.liquidationPrice,
    dropLine: invalid || input.dropPercent === null ? null : btcCanFallLine(input.dropPercent),
    feeLine: invalid ? null : input.feeLine,
    feeCapLabel: input.feeCapLabel ?? null,
    pegMessage,
    overLimitMessage: !invalid && input.overLimit && input.limitBtc ? depositLimitMessage(input.limitBtc) : null,
    slippageMessage: !invalid && input.slippageMiss && !input.pegBlocked && input.slippagePercent ? slippageMessage(input.slippagePercent) : null,
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
