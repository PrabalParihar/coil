/**
 * User-facing product copy for the web app.
 * The attached BRIEF.md was not present in this workspace, so the sub-line,
 * moat lines, and limits strip are written from the product facts already in
 * this repo: one-transaction BTC leverage, a keeper that can only reduce risk,
 * an account the owner controls, testnet, and no audit.
 * Do not add metrics, users, TVL, or yields here.
 */

export const HERO_TITLE = "Leverage your BTC in one transaction.";

export const HERO_SUBLINE =
  "Deposit BTC. Coil borrows against it, buys more BTC, and posts that BTC back before the transaction ends.";

export const MOAT_LINES = [
  "One transaction. The borrow, the buy, and the extra collateral finish together.",
  "A keeper can only reduce risk. It cannot open, close, or take your BTC.",
  "Your position stays in an account you own. Coil does not hold your BTC.",
] as const;

export const HONEST_LIMITS = [
  "Mezo testnet. This is not real BTC.",
  "The contracts are not audited.",
  "New opens can be paused. Risk-reducing repayment and collateral top-up can stay available.",
  "If the pool price is off the oracle price, a new open is refused. Raising slippage will not help.",
  "Liquidation can take the position if collateral falls through 110%.",
  "A deposit over the factory limit is refused. That limit is read from the chain when the factory publishes one.",
  "Older testnet transactions are history. They are not a promise that the same size will open now.",
] as const;

export const PEG_BLOCK_MESSAGE =
  "The pool price is off the oracle price. Raising slippage will not help.";

export const OVER_LIMIT_MESSAGE =
  "This deposit is over the factory limit. Choose a smaller amount.";

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
