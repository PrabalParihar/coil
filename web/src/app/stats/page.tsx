"use client";

import { PublicPage } from "@/components/public-page";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits } from "viem";
import { usePublicClient } from "wagmi";
import { shorten } from "@/components/shell";
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
    } catch { if (mounted.current) setError("Could not refresh these counts. Try again."); }
    finally { running.current = false; if (mounted.current) setBusy(false); }
  }, [client]);
  useEffect(() => {
    mounted.current = true; void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [load]);
  const counts = summarizeStatsEvents(events);
  const cards = base ? [
    ["Accounts", String(base.accounts), loadedHistory ? "Accounts opened with this factory" : "Account count is in. Recent activity is still loading."],
    ["Open positions", base.open === null ? "Reading…" : String(base.open), "Open positions among the accounts that could be read."],
    ["Protection runs", loadedHistory ? String(counts.rescues) : "Reading…", "Times protection made a position safer."],
    ["MEZO tips paid", loadedHistory ? `${formatUnits(counts.tips, 18)} MEZO` : "Reading…", "MEZO paid when protection made a position safer."],
    ["Keeper check-ins", loadedHistory ? String(counts.heartbeats) : "Reading…", "Times the keeper checked in."],
  ] : [];
  return <PublicPage eyebrow="Public stats" title="What the chain shows">
      <p className="mt-3 text-sm text-muted-foreground">Counts from this factory on {selectedChain.name}. Newer activity loads first. Older activity loads when you ask for it.</p>
      <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs"><span>Factory <a className="link" href={factoryAddress ? `${explorerUrl}/address/${factoryAddress}` : undefined}>{factoryAddress ? shorten(factoryAddress) : "pending"}</a></span></p>
      <details className="mt-4 text-xs text-muted-foreground">
        <summary className="cursor-pointer text-sm">Technical details</summary>
        <div className="mt-2 space-y-2 leading-relaxed">
          <p>History starts with the latest 9,999-block window; older windows load only when requested.</p>
          <p>Deploy block {FACTORY_DEPLOY_BLOCK.toString()}{base ? `. Snapshot block ${base.latest.toString()}.` : ""}</p>
          <p>Last successful base snapshot: {updated ?? "unavailable"}. Event counts cover loaded windows, not the whole chain. Position and rescue reads are capped.</p>
          <p>{loadedHistory ? `${counts.accountLogs} AccountCreated logs in loaded windows.` : "AccountCreated logs are still loading."} Keeper check-ins are Selected-factory events in loaded windows.</p>
          <p>Public chain observations are not real-user recruitment evidence. Status on this deployment: {deployment.status}.</p>
        </div>
      </details>
      <button type="button" className="link mt-4 text-sm" disabled={busy || !factoryAddress} onClick={() => void load(error ? failedBefore : undefined)}>Retry / refresh stats</button>
      {error ? <p role="alert" className="mt-4 text-danger">{error}</p> : null}
      {base?.unreadable ? <p className="mt-3 text-sm text-warn" role="alert">Some positions are unreadable; the open count is incomplete.</p> : null}
      {!factoryAddress ? <p className="mt-5">No confirmed Coil factory configured on this chain.</p> : !base && !error ? <p className="mt-5">Reading factory counts…</p> : null}
      {base ? <dl className="mt-8 grid gap-3 sm:grid-cols-2">{cards.map(([label, value, detail]) => <div key={label} className="well p-5"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="num mt-1 text-3xl font-medium">{value}</dd><p className="mt-1 text-xs text-muted-foreground">{detail}</p></div>)}</dl> : null}
      {cursor !== null ? <p className="mt-5 text-xs text-muted-foreground">Loaded history begins at block {cursor.toString()}. Refreshes deduplicate event identities; older pages end strictly before the earliest loaded block.</p> : null}
      {cursor !== null && cursor > FACTORY_DEPLOY_BLOCK ? <button type="button" className="link mt-4" disabled={busy || Boolean(error)} onClick={() => void load(cursor)}>{busy ? "Loading…" : `Load older history before block ${cursor}`}</button> : null}
  </PublicPage>;
}
