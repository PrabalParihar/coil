"use client";

import { PublicPage } from "@/components/public-page";
import { useCallback, useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { shorten } from "@/components/shell";
import { KeeperStatus } from "@/components/keeper-status";
import { coilAccountAbi, coilFactoryAbi, FACTORY_DEPLOY_BLOCK, factoryAddress } from "@/lib/mezo";
import { formatActivityTime, formatOneDecimalPercent } from "@/lib/product-copy";
import { deployment, explorerUrl, selectedChain } from "@/lib/network";
import { getLogsChunked } from "@/lib/logs";
import { recentRange } from "@/lib/readiness";

type Row = { kind: string; block: bigint; tx: `0x${string}`; index: number; address: string; time?: number; human: string };
export default function GuardPage() {
  const client = usePublicClient({ chainId: selectedChain.id });
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<bigint | null>(null);
  const [failedBefore, setFailedBefore] = useState<bigint | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  const [scanned, setScanned] = useState(0);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
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
        return {
          kind: "Keeper check-in",
          block: log.blockNumber ?? 0n,
          tx: log.transactionHash ?? "0x",
          index: log.logIndex ?? 0,
          address: args.keeper ?? "",
          time: args.timestamp ? Number(args.timestamp) : undefined,
          human: "",
        };
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
          const ratio = Number(formatUnits((args.crAfter ?? args.cr ?? 0n) * 100n, 18));
          next.push({
            kind: name === "Guarded" ? "Protection" : "Lowered leverage",
            block: log.blockNumber ?? 0n,
            tx: log.transactionHash ?? "0x",
            index: log.logIndex ?? 0,
            address: log.address,
            human: `collateral ratio ${formatOneDecimalPercent(ratio)}${name === "Guarded" ? `, ${formatUnits(args.tip ?? 0n, 18)} MEZO tip` : ""}`,
          });
        }
      }
      const missing = [...new Set(next.filter(row => row.time === undefined).map(row => row.block.toString()))];
      const stamps = new Map<string, number>();
      await Promise.all(missing.map(async block => {
        try {
          const data = await client.getBlock({ blockNumber: BigInt(block) });
          stamps.set(block, Number(data.timestamp));
        } catch {
          stamps.set(block, 0);
        }
      }));
      for (const row of next) if (row.time === undefined) row.time = stamps.get(row.block.toString()) || undefined;
      setRows(previous => {
        const merged = before ? [...previous, ...next] : [...next, ...previous];
        return [...new Map(merged.map(row => [`${row.tx}-${row.index}`, row])).values()].sort((a, b) => a.block > b.block ? -1 : a.block < b.block ? 1 : b.index - a.index);
      });
      setScanned(cap);
      setCursor(current => before || current === null ? range.fromBlock : current);
      setLoaded(true);
      setError(problems.length ? "Some event ranges could not be read. Counts and history may be incomplete. Refresh to try this window again." : null);
      if (problems.length) setCursor(before ?? null);
    } catch { setError("Could not read protection history. Refresh to try again."); }
    finally { setBusy(false); }
  }, [client]);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 30_000); return () => clearInterval(timer); }, [load]);
  useEffect(() => { const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000); return () => clearInterval(timer); }, []);
  return <PublicPage eyebrow="Protection log" title="Protection activity">
    <p className="mt-3 text-sm text-muted-foreground">{selectedChain.name}. Factory <a className="link break-all font-mono" href={factoryAddress ? `${explorerUrl}/address/${factoryAddress}` : undefined}>{factoryAddress ? shorten(factoryAddress) : "not set up"}</a>.</p>
    <KeeperStatus detailsExtra={<>
      <p>Recent activity loads first. Older history loads when you ask for it. Protection and de-lever events cover {scanned} accounts. Check-ins cover the selected factory. Deploy block {deployment.deploymentBlock ?? "pending"}.</p>
      {cursor !== null ? <p>Loaded history reaches back to block {cursor.toString()}.</p> : null}
      {rows.length ? <ul className="space-y-1">{rows.map(row => <li key={`${row.tx}-${row.index}-tech`}>{row.kind}: block {row.block.toString()}{row.address ? ` · ${row.address}` : ""}</li>)}</ul> : null}
    </>} />
    <p className="mt-5 text-sm text-muted-foreground">Recent protection activity loads first. Older activity loads when you ask for it. Anyone can run protection. It only pays if the position gets safer.</p>
    {error ? <p className="mt-5 text-danger" role="alert">{error}</p> : null}
    <button type="button" disabled={busy || !factoryAddress} className="link mt-4" aria-label="Refresh protection history" onClick={() => void load(error ? failedBefore : undefined)}>Refresh</button>
    {!factoryAddress ? <p className="mt-5">History unconfigured for this chain.</p> : !loaded ? <p className="mt-5">{busy ? "Reading recent chain history…" : "History unavailable."}</p> : rows.length === 0 ? <p className="mt-5">No events in the loaded windows.</p> : <ol className="mt-6 divide-y divide-border">{rows.map(row => <li className="py-4" key={`${row.tx}-${row.index}`}><div className="flex justify-between gap-3"><strong>{row.kind}</strong><a className="link font-mono text-xs" href={`${explorerUrl}/tx/${row.tx}`}>{shorten(row.tx)}</a></div><p className="mt-1 text-sm text-muted-foreground">{row.time ? formatActivityTime(row.time, now) : "Time unavailable"}{row.human ? ` · ${row.human}` : ""}</p></li>)}</ol>}
    {cursor !== null && cursor > FACTORY_DEPLOY_BLOCK ? <button type="button" className="link mt-6" disabled={busy} onClick={() => void load(cursor)}>{busy ? "Loading…" : "Load older history"}</button> : null}
  </PublicPage>;
}
