import type { Address, PublicClient } from "viem";
import { coilAccountAbi } from "./mezo";
import { leverageLabel, type FlashPreview } from "./quote";

export type PositionPreview =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; quote: FlashPreview };
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
  if (state.kind === "ok") return { kind: "ok", quote: state.quote };
  if (state.kind === "error") return { kind: "error", message: state.message };
  return { kind: "loading" };
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
      if (current) publish({ key, kind: "error", message: "State-aware quote unavailable. Refresh or wait for the selected chain RPC to recover." });
    }
  })();
  return () => { current = false; };
}
