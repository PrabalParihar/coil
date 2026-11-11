import type { Address, PublicClient } from "viem";
import { coilAccountAbi } from "./mezo";
import { ACCOUNT_QUOTE_FAILED, ACCOUNT_QUOTE_PENDING } from "./product-copy";
import { leverageLabel, type FlashPreview } from "./quote";

export type PositionPreview =
  | { kind: "loading"; illustrative?: boolean }
  | { kind: "error"; message: string; illustrative?: boolean }
  | { kind: "ok"; quote: FlashPreview; illustrative?: boolean };
export type PositionQuoteState = PositionPreview & { key: string };
export type PositionQuoteRequest = {
  account: Address; chainId: number; deposit: bigint;
  target: bigint; slippage: bigint; flash: boolean;
};

/** New fee-aware views include the account's existing position and refinancing. */
export async function readStateAwareQuote(client: Pick<PublicClient, "readContract">, request: PositionQuoteRequest): Promise<FlashPreview> {
  const common = { address: request.account, abi: coilAccountAbi, args: [request.deposit, request.target, request.slippage] as const };
  const [q, flashBtc, poolFeeMusd, coilFeeMusd] = request.flash
    ? await client.readContract({ ...common, functionName: "quoteFlashLoopWithFee" })
    : await client.readContract({ ...common, functionName: "quoteLoopWithFee" }).then(([q, fee]) => [q, 0n, 0n, fee] as const);
  return { ...q, iterations: Number(q.iterations), leverage: leverageLabel(q.cr), flashBtc, poolFeeMusd, coilFeeMusd };
}

/** The key includes chain/account/inputs/policy/position. Never reuse another key's consent. */
export function selectPositionPreview(required: boolean, key: string, state: PositionQuoteState | null, freshPreview: PositionPreview): PositionPreview {
  if (!required) return freshPreview;
  if (!state || state.key !== key) return { kind: "loading" };
  if (state.kind === "ok") return { kind: "ok", quote: state.quote, illustrative: false };
  if (state.kind === "error") return { kind: "error", message: state.message };
  return { kind: "loading" };
}

/**
 * A required state-aware quote is the only result that can be submitted.
 * Pending, failed, and mismatched reads may still show the fresh estimate, but only as a sample.
 */
export function presentPositionPreview(required: boolean, key: string, state: PositionQuoteState | null, freshPreview: PositionPreview): PositionPreview & { displayOnly: boolean; reason: string | null } {
  const selected = selectPositionPreview(required, key, state, freshPreview);
  // No account exists, so a fresh estimate is the quote. Its error is about the deposit, not a loading account.
  if (!required) {
    if (freshPreview.kind === "ok") return { ...freshPreview, displayOnly: false, reason: null };
    if (freshPreview.kind === "error") return { ...freshPreview, displayOnly: false, reason: null };
    return { kind: "loading", illustrative: false, displayOnly: false, reason: null };
  }
  if (selected.kind === "ok" && state?.key === key && state.kind === "ok") {
    return { kind: "ok", quote: selected.quote, illustrative: false, displayOnly: false, reason: null };
  }
  const reason = selected.kind === "error" ? selected.message : ACCOUNT_QUOTE_PENDING;
  if (freshPreview.kind === "ok") return { ...freshPreview, displayOnly: true, reason };
  if (selected.kind === "error") return { ...selected, displayOnly: true, reason };
  return { kind: "loading", illustrative: false, displayOnly: true, reason };
}

/** One line under a disabled Open button when the numbers cannot be submitted. */
export function openButtonReason(preview: { displayOnly?: boolean; reason?: string | null }): string | null {
  if (preview.displayOnly !== true) return null;
  return preview.reason ?? ACCOUNT_QUOTE_PENDING;
}

export function canSubmitPositionPreview(preview: { kind: string; illustrative?: boolean; displayOnly?: boolean }): boolean {
  return preview.kind === "ok" && preview.illustrative !== true && preview.displayOnly !== true;
}

/** viem eth_call cannot abort its transport; cancel prevents any stale publication. */
export function startPositionQuote(key: string, read: () => Promise<FlashPreview>, publish: (state: PositionQuoteState) => void): () => void {
  let current = true;
  publish({ key, kind: "loading" });
  void (async () => {
    try {
      const quote = await read();
      if (current) publish({ key, kind: "ok", quote });
    } catch {
      if (current) publish({ key, kind: "error", message: ACCOUNT_QUOTE_FAILED });
    }
  })();
  return () => { current = false; };
}
