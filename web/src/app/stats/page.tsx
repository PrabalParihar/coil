"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import { CoilMark, shorten } from "@/components/shell";
import { FACTORY_DEPLOY_BLOCK, factoryAddress, selectedChain } from "@/lib/mezo";
import { deployment, explorerUrl } from "@/lib/network";
import { loadPublicStats, mergeStatsEvents, summarizeStatsEvents, type StatsBase, type StatsEvent } from "@/lib/stats-reader";

export default function StatsPage() {
  const client = usePublicClient({ chainId: selectedChain.id });
  const [base, setBase] = useState<StatsBase | null>(null);
  const [events, setEvents] = useState<StatsEvent[]>([]);
  const [loadedHistory, setLoadedHistory] = useState(false);
  const [cursor, setCursor] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedBefore, setFailedBefore] = useState<bigint | undefined>();
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState<string | null>(null);
  const mounted = useRef(false);
  const running = useRef(false);
  const load = useCallback(async (before?: bigint) => {
    if (!client || !factoryAddress || running.current) return;
    running.current = true; setBusy(true); setFailedBefore(before);
    try {
      const page = await loadPublicStats(client, { factory: factoryAddress, deploymentBlock: FACTORY_DEPLOY_BLOCK, before }, snapshot => {
        if (mounted.current) { setBase(snapshot); setUpdated(new Date().toISOString()); }
      });
      if (!mounted.current) return;
      setEvents(previous => mergeStatsEvents(previous, page.events));
      setLoadedHistory(true);
      if (!page.incomplete) setCursor(previous => previous === null || page.fromBlock < previous ? page.fromBlock : previous);
      setError(page.incomplete ? "Some event reads failed. Counts cover successfully loaded logs only; retry this window before loading older history." : null);
    } catch { if (mounted.current) setError("Could not refresh selected-factory counts/history. The retained snapshot may be outdated; retry to refresh."); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }, [client]);
  useEffect(() => {
    mounted.current = true; void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [load]);
  const counts = summarizeStatsEvents(events);
  const cards = base ? [
    ["Accounts", String(base.accounts), loadedHistory ? `${counts.accountLogs} AccountCreated logs in loaded windows` : "Factory count available; recent history loading"],
    ["Open troves", base.open === null ? "Reading…" : String(base.open), `of first ${base.scanned} accounts; ${base.unreadable} unreadable`],
    ["Guard rescues", loadedHistory ? String(counts.rescues) : "Reading…", "Loaded windows; first 40 accounts only"],
    ["MEZO tips paid", loadedHistory ? `${formatUnits(counts.tips, 18)} MEZO` : "Reading…", "Guarded tips in loaded windows; first 40 accounts"],
    ["Heartbeats", loadedHistory ? String(counts.heartbeats) : "Reading…", "Selected-factory events in loaded windows"],
  ] : [];
  return <div className="relative min-h-screen">
    <div className="atmosphere pointer-events-none fixed inset-0 -z-10" aria-hidden />
    <header className="border-b border-border/70"><div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
      <Link href="/" className="flex items-center gap-2.5"><CoilMark className="size-8" /><span className="text-lg font-semibold">Coil Labs</span></Link>
      <nav className="flex gap-4 text-sm"><Link href="/keeper">Keeper</Link><Link href="/guard">Guard log</Link><Link href="/#app">App</Link></nav>
    </div></header>
    <main className="mx-auto max-w-3xl px-4 py-10">
      <p className="eyebrow text-filament">Public stats</p><h1 className="mt-3 text-4xl font-semibold">What the chain shows</h1>
      <p className="mt-3 text-sm text-muted-foreground">{selectedChain.name}, chain {selectedChain.id}, {deployment.status} deployment. Factory and position counts publish before event history. History starts with the latest 9,999-block window; older windows load only when requested.</p>
      <p className="mt-3 break-all font-mono text-xs">Factory <a className="link" href={factoryAddress ? `${explorerUrl}/address/${factoryAddress}` : undefined}>{factoryAddress ? shorten(factoryAddress) : "pending"}</a> · deploy block {FACTORY_DEPLOY_BLOCK.toString()}{base ? ` · snapshot block ${base.latest}` : ""}</p>
      <p className="mt-3 text-xs text-muted-foreground">Last successful base snapshot: {updated ?? "unavailable"}. Event counts cover loaded windows, not complete chain history. Position/rescue reads cover at most the first 40 accounts. Public chain observations are not real-user recruitment evidence.</p>
      <button type="button" className="link mt-4 text-sm" disabled={busy || !factoryAddress} onClick={() => void load(error ? failedBefore : undefined)}>Retry / refresh stats</button>
      {error ? <p role="alert" className="mt-4 text-danger">{error}</p> : null}
      {base?.unreadable ? <p className="mt-3 text-sm text-warn" role="alert">Some positions are unreadable; the open count is incomplete.</p> : null}
      {!factoryAddress ? <p className="mt-5">No confirmed Coil factory configured on this chain.</p> : !base && !error ? <p className="mt-5">Reading factory counts…</p> : null}
      {base ? <dl className="mt-8 grid gap-3 sm:grid-cols-2">{cards.map(([label, value, detail]) => <div key={label} className="well p-5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="num mt-1 text-3xl font-medium">{value}</dd><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>)}</dl> : null}
      {cursor !== null ? <p className="mt-5 text-xs text-muted-foreground">Loaded history begins at block {cursor.toString()}. Refreshes deduplicate event identities; older pages end strictly before the earliest loaded block.</p> : null}
      {cursor !== null && cursor > FACTORY_DEPLOY_BLOCK ? <button type="button" className="link mt-4" disabled={busy || Boolean(error)} onClick={() => void load(cursor)}>{busy ? "Loading…" : `Load older history before block ${cursor}`}</button> : null}
    </main>
  </div>;
}
