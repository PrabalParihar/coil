"use client";

import { PublicPage } from "@/components/public-page";
import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { shorten } from "@/components/shell";
import { KeeperStatus } from "@/components/keeper-status";
import { coilAccountAbi, coilFactoryAbi, FACTORY_DEPLOY_BLOCK, factoryAddress } from "@/lib/mezo";
import { deployment, explorerUrl, selectedChain } from "@/lib/network";
import { getLogsChunked } from "@/lib/logs";
import { recentRange } from "@/lib/readiness";

type Row = { kind: string; block: bigint; tx: `0x${string}`; detail: string; index: number };
export default function GuardPage() {
  const client = usePublicClient({ chainId: selectedChain.id });
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<bigint | null>(null);
  const [failedBefore, setFailedBefore] = useState<bigint | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [scanned, setScanned] = useState(0);
  const load = useCallback(async (before?: bigint) => {
    if (!client || !factoryAddress) return;
    const factory = factoryAddress;
    setBusy(true);
    setFailedBefore(before);
    try {
      const latest = await client.getBlockNumber();
      const range = recentRange(latest, FACTORY_DEPLOY_BLOCK, before);
      const length = await client.readContract({ address: factory, abi: coilFactoryAbi, functionName: "accountsLength" });
      const cap = Number(length > 40n ? 40n : length);
      const heartbeat = coilFactoryAbi.find(item => item.type === "event" && item.name === "Heartbeat")!;
      const beats = await getLogsChunked(client, { address: factory, event: heartbeat, ...range });
      const next: Row[] = beats.logs.map(log => {
        const args = log.args as { keeper?: string; timestamp?: bigint };
        return { kind: "Heartbeat history", block: log.blockNumber ?? 0n, tx: log.transactionHash ?? "0x", index: log.logIndex ?? 0, detail: `${shorten(args.keeper)} · ${args.timestamp ? new Date(Number(args.timestamp) * 1000).toISOString() : "timestamp unavailable"}` };
      });
      const accounts: Address[] = await Promise.all(Array.from({ length: cap }, (_, i) => client.readContract({ address: factory, abi: coilFactoryAbi, functionName: "accounts", args: [BigInt(i)] })));
      const problems = [...beats.errors];
      for (const name of ["Guarded", "Delevered"] as const) {
        if (!accounts.length) break;
        const event = name === "Guarded" ? coilAccountAbi.find(item => item.type === "event" && item.name === "Guarded")! : coilAccountAbi.find(item => item.type === "event" && item.name === "Delevered")!;
        const result = await getLogsChunked(client, { address: accounts, event, ...range });
        problems.push(...result.errors);
        for (const log of result.logs) {
          const args = log.args as { tip?: bigint; crAfter?: bigint; cr?: bigint };
          next.push({ kind: name === "Guarded" ? "Rescue" : "De-lever", block: log.blockNumber ?? 0n, tx: log.transactionHash ?? "0x", index: log.logIndex ?? 0, detail: `${shorten(log.address)} · CR ${formatUnits((args.crAfter ?? args.cr ?? 0n) * 100n, 18)}%${name === "Guarded" ? ` · ${formatUnits(args.tip ?? 0n, 18)} MEZO tip` : ""}` });
        }
      }
      setRows(previous => {
        const merged = before ? [...previous, ...next] : [...next, ...previous];
        return [...new Map(merged.map(row => [`${row.tx}-${row.index}`, row])).values()].sort((a, b) => a.block > b.block ? -1 : a.block < b.block ? 1 : b.index - a.index);
      });
      setScanned(cap);
      setCursor(current => before || current === null ? range.fromBlock : current);
      setLoaded(true);
      setError(problems.length ? "Some event ranges could not be read. Counts/history may be incomplete; retry this window." : null);
      // Do not advance past an unreadable page: Retry must re-request the same range.
      if (problems.length) setCursor(before ?? null);
    } catch { setError("Could not read guard history. Retry to refresh the selected chain."); }
    finally { setBusy(false); }
  }, [client]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, [load]);
  return <PublicPage eyebrow="Guard log" title="Rescues and heartbeats">
    <p className="mt-3 text-sm text-muted-foreground">{selectedChain.name} · {deployment.status} factory <a className="link break-all font-mono" href={factoryAddress ? `${explorerUrl}/address/${factoryAddress}` : undefined}>{factoryAddress ?? "pending deployment"}</a> · deploy block {deployment.deploymentBlock ?? "pending"}.</p>
    <KeeperStatus />
    <p className="mt-5 text-sm text-muted-foreground">Recent 9,999 blocks load first. Older history is paginated below. Rescue/de-lever events cover the first {scanned} accounts (limit 40); heartbeat events cover the selected factory. Anyone can call guard; only actual risk reduction can earn a tip.</p>
    {error ? <p className="mt-5 text-danger" role="alert">{error}</p> : null}
    <button type="button" disabled={busy || !factoryAddress} className="link mt-4" onClick={() => void load(error ? failedBefore : undefined)}>Retry / refresh history</button>
    {!factoryAddress ? <p className="mt-5">History unconfigured for this chain.</p> : !loaded ? <p className="mt-5">{busy ? "Reading recent chain history…" : "History unavailable."}</p> : rows.length === 0 ? <p className="mt-5">No events in the loaded windows.</p> : <ol className="mt-6 divide-y divide-border">{rows.map(row => <li className="py-4" key={`${row.tx}-${row.index}`}><div className="flex justify-between gap-3"><strong>{row.kind}</strong><a className="link font-mono text-xs" href={`${explorerUrl}/tx/${row.tx}`}>{shorten(row.tx)}</a></div><p className="mt-1 text-sm text-muted-foreground">{row.detail} · block {row.block.toString()}</p></li>)}</ol>}
    {cursor !== null && cursor > FACTORY_DEPLOY_BLOCK ? <button type="button" className="link mt-6" disabled={busy} onClick={() => void load(cursor)}>{busy ? "Loading…" : `Load older history before block ${cursor}`}</button> : null}
  </PublicPage>;
}
