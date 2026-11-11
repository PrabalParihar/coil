/**
 * Owner fee ceiling. `CoilFactory.setCoilFee` in `src/CoilFactory.sol` reverts
 * `BadPolicy` when `bps == 0 || bps > 50`. `coilFeeBps` is a public getter;
 * the cap is not, so the app states this constant rather than reading it.
 */
export const COIL_OPEN_FEE_CAP_BPS = 50;

export type OpenFeeSnapshot = {
  factory: `0x${string}`;
  /** Value returned by `coilFeeBps()`. */
  feeBps: number;
  /** Value returned by `opensPaused()`, or null when that read failed. */
  opensPaused: boolean | null;
  maxCollateral: string | null;
  maxDebt: string | null;
};

export function readFeeBps(value: unknown): number | null {
  const bps = typeof value === "bigint" ? Number(value) : typeof value === "number" ? value : null;
  if (bps === null || !Number.isInteger(bps) || bps < 0 || bps > 10_000) return null;
  return bps;
}

/** Format a fee in basis points as a percent: 25 -> 0.25%, 50 -> 0.5%. */
export function formatOpenFeePercent(bps: number): string {
  const fee = readFeeBps(bps);
  if (fee === null) throw new Error("Invalid Coil fee.");
  const trimmed = (fee / 100).toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${trimmed}%`;
}

export function coilOpenFeeStatement(feeBps: number): string {
  return `Coil open fee: ${formatOpenFeePercent(feeBps)} of newly minted MUSD (owner-capped at ${formatOpenFeePercent(COIL_OPEN_FEE_CAP_BPS)}). Rescue and exit: 0 (guard, owner exit, repay, unwind).`;
}

export function coilOpenFeePendingStatement(): string {
  return `Coil open fee: reading the factory (owner-capped at ${formatOpenFeePercent(COIL_OPEN_FEE_CAP_BPS)}). Rescue and exit: 0 (guard, owner exit, repay, unwind).`;
}

export function coilOpenFeeUnavailableStatement(): string {
  return `Coil open fee could not be read from the factory (owner-capped at ${formatOpenFeePercent(COIL_OPEN_FEE_CAP_BPS)}). Rescue and exit: 0 (guard, owner exit, repay, unwind).`;
}

export function coilOpenFeeLegacyStatement(): string {
  return `This factory charges no Coil open fee. Rescue and exit: 0 (guard, owner exit, repay, unwind).`;
}
