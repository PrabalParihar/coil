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
    body: "A flash swap borrows the BTC, posts it, mints MUSD and repays the pool before the transaction ends. Unwind closes the same way.",
  },
  {
    title: "A keeper that can only make you safer.",
    body: "It may repay from your reserve or sell just enough BTC to reach your target ratio. It cannot open leverage, withdraw, close or change your settings.",
  },
  {
    title: "Rescues are free. Tips only when it worked.",
    body: "Coil charges 0% on protection, repay, de-lever, unwind and close. A keeper earns your MEZO tip only if your ratio actually rose, at most once per block.",
  },
  {
    title: "Every fill checked against the oracle.",
    body: "Opens, rescues and closes must land within a price bound from Mezo's price feed, so a pushed pool price makes the transaction revert instead of filling badly.",
  },
] as const;

export const MOAT_FOOTER = "Your account is a separate contract owned by your wallet. It holds the MUSD loan, not Coil.";

export const LIMITS_STRIP =
  "Protection is not a guarantee. A keeper may be unable to act if the pool is too far from the oracle, your reserve is empty, or Mezo is in Recovery Mode. Coil is not audited and runs on Mezo testnet.";

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
  return `Opening is paused by a safety check. The Mezo pool price is ${gapPercent} away from the oracle price, and Coil only opens within ${withinPercent}. Existing positions, protection and exits are not affected. Raising slippage will not help.`;
}

export const EMPTY_DEPOSIT_HELPER = "Enter how much BTC to deposit.";

export function depositLimitMessage(limitBtc: string): string {
  return `The current limit is ${limitBtc} BTC per position on this release.`;
}

export function slippageMessage(limitPercent: string): string {
  return `The pool would fill worse than your ${limitPercent} limit. Try a higher limit or a lower leverage.`;
}

export const RECOVERY_STILL = "What you can still do: repay MUSD, add BTC.";

export const LEVERAGE_CHOICES = [
  { multiple: "2x", crPercent: 200, crLabel: "200% CR", ltvLabel: "50% LTV" },
  { multiple: "3x", crPercent: 150, crLabel: "150% CR", ltvLabel: "66.7% LTV" },
  { multiple: "4x", crPercent: 133.33, crLabel: "133.33% CR", ltvLabel: "75% LTV" },
] as const;

export function leverageChoice(crPercent: number) {
  return LEVERAGE_CHOICES.find((choice) => Math.abs(choice.crPercent - crPercent) < 0.2) ?? LEVERAGE_CHOICES[0];
}

/** "BTC can fall 45%" from a collateral ratio already computed by the quote. */
export function btcCanFallLine(dropPercent: number): string {
  if (!Number.isFinite(dropPercent) || dropPercent <= 0) return "BTC can fall 0%";
  const rounded = Math.round(dropPercent * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `BTC can fall ${text}%`;
}

/** 664 -> 6.64%, 200 -> 2%. Input is basis points from a chain read. */
export function bpsToPercent(bps: number): string {
  if (!Number.isFinite(bps)) return "0%";
  const rounded = Math.round(bps) / 100;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${text}%`;
}

/** One decimal for the pool gap: 663 -> 6.6%. */
export function poolGapOneDecimal(bps: number): string {
  if (!Number.isFinite(bps)) return "0.0%";
  const tenths = Math.round(bps / 10);
  const sign = tenths < 0 ? "-" : "";
  const abs = Math.abs(tenths);
  return `${sign}${Math.trunc(abs / 10)}.${abs % 10}%`;
}

export function poolWarning(gapBps: number, withinBps: number): string {
  return `Pool price is ${poolGapOneDecimal(gapBps)} away from the oracle. Opens need under ${bpsToPercent(withinBps)}.`;
}
