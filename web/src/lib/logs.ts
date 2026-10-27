import type { AbiEvent, Address, PublicClient } from "viem";

/** Mezo's eth_getLogs rejects a from/to distance above 10,000. Stay under it. */
export const LOG_CHUNK = 9_999n;

export type ChunkLog = {
  args?: unknown;
  blockNumber: bigint | null;
  transactionHash: `0x${string}` | null;
  address: Address;
};

export async function getLogsChunked(
  client: Pick<PublicClient, "getLogs">,
  args: {
    address: Address | Address[];
    event: AbiEvent;
    fromBlock: bigint;
    toBlock: bigint;
  },
): Promise<{ logs: ChunkLog[]; errors: string[] }> {
  const logs: ChunkLog[] = [];
  const errors: string[] = [];
  if (args.fromBlock > args.toBlock) return { logs, errors };
  let cursor = args.fromBlock;
  while (cursor <= args.toBlock) {
    const end = cursor + LOG_CHUNK > args.toBlock ? args.toBlock : cursor + LOG_CHUNK;
    try {
      const batch = await client.getLogs({
        address: args.address,
        event: args.event,
        fromBlock: cursor,
        toBlock: end,
      });
      logs.push(...(batch as ChunkLog[]));
    } catch (err) {
      errors.push(err instanceof Error ? err.message : "Mezo rejected the log request.");
    }
    if (end === args.toBlock) break;
    cursor = end + 1n;
  }
  return { logs, errors };
}
