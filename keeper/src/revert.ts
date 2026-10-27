import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from "viem";

/** Custom errors `guard()` can surface. Selectors are decoded from revert data. */
export const accountErrors = [
  { type: "error", name: "Slippage", inputs: [] },
  { type: "error", name: "NotKeeper", inputs: [] },
  { type: "error", name: "NotSafer", inputs: [] },
  { type: "error", name: "NoGuard", inputs: [] },
  { type: "error", name: "AlreadyAtTarget", inputs: [] },
  { type: "error", name: "KeeperLimited", inputs: [] },
  { type: "error", name: "MinDebt", inputs: [] },
  { type: "error", name: "ShortRepay", inputs: [] },
  { type: "error", name: "BadFlash", inputs: [] },
  { type: "error", name: "PoolPaused", inputs: [] },
  { type: "error", name: "TransferFailed", inputs: [] },
  { type: "error", name: "BadSlippage", inputs: [] },
] as const;

export function revertReason(error: unknown): string {
  if (error instanceof BaseError) {
    const reverted = error.walk((item) => item instanceof ContractFunctionRevertedError);
    if (reverted instanceof ContractFunctionRevertedError) {
      const named = reverted.data?.errorName;
      if (named) return `${named}()`;
      if (reverted.reason) return reverted.reason;
      const fromRaw = nameFromRevertData(reverted.raw);
      if (fromRaw) return fromRaw;
    }
    const fromMessage = nameFromRevertData(error.shortMessage) ?? nameFromRevertData(error.message);
    if (fromMessage) return fromMessage;
    return (error.shortMessage || error.message).slice(0, 240);
  }
  const text = String(error);
  return nameFromRevertData(text) ?? text.slice(0, 240);
}

function nameFromRevertData(data: unknown): string | null {
  if (typeof data !== "string" || data.length === 0) return null;
  const match = data.toLowerCase().match(/0x[0-9a-f]{8}/);
  if (!match) return null;
  try {
    const decoded = decodeErrorResult({ abi: accountErrors, data: match[0] as Hex });
    return `${decoded.errorName}()`;
  } catch {
    return null;
  }
}
