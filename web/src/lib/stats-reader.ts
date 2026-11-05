import type { Address, PublicClient } from "viem";
import { coilFactoryAbi, coilAccountAbi } from "./mezo";
import { getLogsChunked, type ChunkLog } from "./logs";
import { recentRange } from "./readiness";

export type StatsBase = { latest: bigint; accounts: number; scanned: number; open: number | null; unreadable: number };
export type StatsEvent = { kind: "created" | "heartbeat" | "rescue"; log: ChunkLog };
type StatsClient = Pick<PublicClient, "readContract" | "getBlockNumber" | "getLogs">;

/** Publish inexpensive counts first; never withhold them behind historical log requests. */
export async function loadPublicStats(client: StatsClient, input: { factory: Address; deploymentBlock: bigint; before?: bigint }, publishBase: (base: StatsBase) => void) {
  const [latest, length] = await Promise.all([client.getBlockNumber(), client.readContract({ address: input.factory, abi: coilFactoryAbi, functionName: "accountsLength" })]);
  let base: StatsBase = { latest, accounts: Number(length), scanned: 0, open: null, unreadable: 0 };
  publishBase(base);
  const cap = Number(length > 40n ? 40n : length);
  const addresses = await Promise.all(Array.from({ length: cap }, (_, i) => client.readContract({ address: input.factory, abi: coilFactoryAbi, functionName: "accounts", args: [BigInt(i)] }).catch(() => undefined)));
  const accounts = addresses.filter((value): value is Address => value !== undefined);
  const positions = await Promise.all(accounts.map(account => client.readContract({ address: account, abi: coilAccountAbi, functionName: "position" }).catch(() => undefined)));
  base = { ...base, scanned: accounts.length, open: positions.filter(position => position?.active).length, unreadable: cap - accounts.length + positions.filter(position => !position).length };
  publishBase(base);
  if (latest < input.deploymentBlock) throw new Error("RPC head predates the selected factory deployment.");
  const range = recentRange(latest, input.deploymentBlock, input.before);
  const created = coilFactoryAbi.find(item => item.type === "event" && item.name === "AccountCreated")!;
  const heartbeat = coilFactoryAbi.find(item => item.type === "event" && item.name === "Heartbeat")!;
  const guarded = coilAccountAbi.find(item => item.type === "event" && item.name === "Guarded")!;
  const [creates, beats, rescues] = await Promise.all([
    getLogsChunked(client, { address: input.factory, event: created, ...range }),
    getLogsChunked(client, { address: input.factory, event: heartbeat, ...range }),
    accounts.length ? getLogsChunked(client, { address: accounts, event: guarded, ...range }) : Promise.resolve({ logs: [], errors: [] }),
  ]);
  const events: StatsEvent[] = [...creates.logs.map(log => ({ kind: "created" as const, log })), ...beats.logs.map(log => ({ kind: "heartbeat" as const, log })), ...rescues.logs.map(log => ({ kind: "rescue" as const, log }))];
  return { ...range, events, incomplete: Boolean(creates.errors.length || beats.errors.length || rescues.errors.length) };
}

export function mergeStatsEvents(previous: readonly StatsEvent[], next: readonly StatsEvent[]): StatsEvent[] {
  const events = new Map<string, StatsEvent>();
  for (const item of [...previous, ...next]) events.set(`${item.kind}:${item.log.address.toLowerCase()}:${item.log.transactionHash ?? item.log.blockNumber}:${item.log.logIndex ?? 0}`, item);
  return [...events.values()];
}

export function summarizeStatsEvents(events: readonly StatsEvent[]) {
  return events.reduce((counts, item) => {
    if (item.kind === "created") counts.accountLogs++;
    if (item.kind === "heartbeat") counts.heartbeats++;
    if (item.kind === "rescue") { counts.rescues++; counts.tips += (item.log.args as { tip?: bigint })?.tip ?? 0n; }
    return counts;
  }, { accountLogs: 0, heartbeats: 0, rescues: 0, tips: 0n });
}
