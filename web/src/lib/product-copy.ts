/**
 * User-facing product copy. Percentages are passed in from chain reads
 * or the contract fee cap. Do not embed a live fee, user count, or TVL here.
 */

export const HERO_TITLE = "Leverage your BTC in one transaction.";

export const HERO_SUBLINE =
  "Coil borrows MUSD against your bitcoin, buys more BTC on Mezo Pools and posts it back, all in one transaction, inside an account only you control. A protection keeper can only make your position safer.";

export function heroEyebrow(chainId: number): string {
  return `Mezo testnet · chain ${chainId} · not audited`;
}

export const HERO_PRIMARY = "Preview a position";
export const HERO_SECONDARY = "How protection works";

export const PROOF_OPEN = "1 transaction to open";
export const PROOF_EXIT_FEE = "Rescue and exit: 0% Coil fee";
export const PROOF_KEEPER_LIVE = "Keeper heartbeat: live";

export const MOAT_TITLE = "Why Coil";
export const MOAT_SUBTITLE = "Leverage and protection, in one account you own.";

export const MOAT_CARDS = [
  {
    title: "One transaction in, one transaction out.",
    body: "Coil borrows the extra BTC, adds it to your position and pays it back with MUSD, all in one transaction. Closing works the same way.",
  },
  {
    title: "A keeper that can only make you safer.",
    body: "It may repay from your reserve or sell just enough BTC to reach your target ratio. It cannot open leverage, withdraw, close or change your settings.",
  },
  {
    title: "Rescues are free. Tips only when it worked.",
    body: "Coil charges 0% on protection, repay, de-lever, unwind and close. A keeper earns your MEZO tip only if your ratio actually rose, at most once per block. MEZO is the token at Mezo's MEZO precompile. You fund the tip from your balance, and your account pays the caller from that balance, up to the amount you set, only when protection raises the ratio.",
  },
  {
    title: "Every fill checked against the BTC price feed.",
    body: "Opens, rescues and closes must land within a price bound from the BTC price feed, so if the pool price is off, the transaction is cancelled instead of filling at a bad price.",
  },
] as const;

export const MOAT_FOOTER = "Your account is a separate contract owned by your wallet. It holds the MUSD loan, not Coil.";

export const LIMITS_STRIP =
  "Protection is not a guarantee. A keeper may be unable to act if the pool is too far from the BTC price feed, your reserve is empty, or Mezo is in Recovery Mode. Coil is not audited and runs on Mezo testnet.";

export function coilFeeSentence(feePercent: string, capPercent: string): string {
  return `Coil fee: ${feePercent} of the MUSD you borrow when opening or adding leverage. The contract caps it at ${capPercent}. Protection, rescue, repay, de-lever, unwind and close: 0%. Mezo's borrowing fee, pool swap fee and gas are separate.`;
}

export function feeChipLabel(feePercent: string): string {
  return `Fee ${feePercent}`;
}

export function feeCapLabel(capPercent: string): string {
  return `Max ${capPercent}, set on-chain`;
}

export const BLOCKED_CARD_LABEL = "Sample preview";
export const LIVE_CARD_LABEL = "Quote";
export const PRICE_CHECK_CTA = "Opening paused by price check";

export function priceCheckStatus(gapPercent: string, withinPercent: string): string {
  return `Opening is paused by a safety check. The Mezo pool price is ${gapPercent} away from the BTC price feed, and Coil only opens within ${withinPercent}. Existing positions, protection and exits are not affected. Raising slippage will not help.`;
}

export const EMPTY_DEPOSIT_HELPER = "Enter how much BTC to deposit.";
export const DEPOSIT_NOT_A_NUMBER = "Enter a number, like 0.05.";
export const DEPOSIT_NOT_POSITIVE = "Enter an amount above 0.";

export function leastDepositMessage(amountBtc: string): string {
  return `The least you can deposit is ${amountBtc} BTC.`;
}

export function mostDepositMessage(amountBtc: string): string {
  return `The most you can deposit is ${amountBtc} BTC.`;
}

export function debtLimitMessage(limitMusd: string): string {
  return `The most this position can borrow is ${limitMusd} MUSD.`;
}

export function depositLimitMessage(limitBtc: string): string {
  return mostDepositMessage(limitBtc);
}

export function slippageMessage(limitPercent: string): string {
  return `The pool would fill worse than your ${limitPercent} limit. Try a higher limit or a lower leverage.`;
}

export const RECOVERY_STILL = "What you can still do: repay MUSD, add BTC.";

/**
 * One percent formatter for the screen. Always one decimal: 5.43 -> 5.4%, 200 -> 200.0%.
 */
export function formatOneDecimalPercent(percent: number): string {
  if (!Number.isFinite(percent)) return "0.0%";
  const sign = percent < 0 ? "-" : "";
  const tenths = Math.round(Math.abs(percent) * 10);
  const whole = Math.trunc(tenths / 10);
  const frac = tenths % 10;
  return `${sign}${whole}.${frac}%`;
}

/** Basis points through the same formatter. 543 -> 5.4%, 200 -> 2.0%. */
export function formatBpsOneDecimal(bps: number): string {
  if (!Number.isFinite(bps)) return "0.0%";
  return formatOneDecimalPercent(bps / 100);
}

export const LEVERAGE_CHOICES = [
  { multiple: "2x", crPercent: 200, crLabel: `${formatOneDecimalPercent(200)} CR`, ltvLabel: `${formatOneDecimalPercent(50)} LTV` },
  { multiple: "3x", crPercent: 150, crLabel: `${formatOneDecimalPercent(150)} CR`, ltvLabel: `${formatOneDecimalPercent(200 / 3)} LTV` },
  { multiple: "4x", crPercent: 133.33, crLabel: `${formatOneDecimalPercent(133.33)} CR`, ltvLabel: `${formatOneDecimalPercent(75)} LTV` },
] as const;

export function leverageChoice(crPercent: number) {
  return LEVERAGE_CHOICES.find((choice) => Math.abs(choice.crPercent - crPercent) < 0.2) ?? LEVERAGE_CHOICES[0];
}

/** "BTC can fall 45.0%" from a collateral ratio already computed by the quote. */
export function btcCanFallLine(dropPercent: number): string {
  if (!Number.isFinite(dropPercent) || dropPercent <= 0) return "BTC can fall 0%";
  return `BTC can fall ${formatOneDecimalPercent(dropPercent)}`;
}

/** Basis points through the same one-decimal formatter. */
export function bpsToPercent(bps: number): string {
  return formatBpsOneDecimal(bps);
}

/** Local calendar time plus a short relative age. Never an ISO timestamp. */
export function formatActivityTime(unixSeconds: number, nowSeconds: number): string {
  if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) return "Time unavailable";
  const date = new Date(unixSeconds * 1000);
  const local = new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const delta = Math.max(0, Math.floor(nowSeconds - unixSeconds));
  const relative = delta < 60
    ? `${delta} sec ago`
    : delta < 3600
      ? `${Math.floor(delta / 60)} min ago`
      : delta < 86400
        ? `${Math.floor(delta / 3600)} hr ago`
        : `${Math.floor(delta / 86400)} days ago`;
  return `${local} · ${relative}`;
}

/** Minimum debt copy. The amounts are passed in from chain data and the live price. */
export function minDebtDepositMessage(minDebtMusd: string, leverage: string, depositBtc: string): string {
  return `Mezo needs at least ${minDebtMusd} MUSD of debt. At ${leverage}, deposit at least ${depositBtc} BTC.`;
}

/** One decimal for the pool gap: 663 -> 6.6%. Same formatter as every other percent on the screen. */
export function poolGapOneDecimal(bps: number): string {
  return formatBpsOneDecimal(bps);
}

export function poolWarning(gapBps: number, withinBps: number): string {
  return `Pool price is ${formatBpsOneDecimal(gapBps)} away from the BTC price feed. Opens need under ${formatBpsOneDecimal(withinBps)}.`;
}

export const TERM_LINE =
  "CR means collateral ratio: collateral value divided by what you owe. LTV means loan-to-value: what you owe divided by collateral value. Liquidation price is the BTC price that can liquidate the position. MUSD is Mezo's dollar stablecoin.";

export const TESTNET_NOTE = "Coil runs on Mezo testnet and is not audited. Use test funds only.";

export const ACCOUNT_QUOTE_FAILED =
  "We couldn't read the quote for your account. These numbers are a sample, so opening stays off.";

export const ACCOUNT_QUOTE_PENDING =
  "Your account quote is still loading. These numbers are a sample, so opening stays off.";

export const ACCOUNT_QUOTE_READY = "This quote includes the collateral and debt already in your account.";

export const FRESH_ESTIMATE = "Fresh-position estimate.";

export const OPEN_FEE_LOADING = "The open fee is still loading, so opening stays off.";

export const OPEN_FEE_UNAVAILABLE = "The open fee could not be read, so opening stays off.";
