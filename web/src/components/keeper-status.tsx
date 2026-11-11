"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { usePublicClient } from "wagmi";
import { coilFactoryAbi, factoryAddress, FACTORY_DEPLOY_BLOCK, ZERO } from "@/lib/mezo";
import { deployment, explorerUrl, selectedChain } from "@/lib/network";
import { getLogsChunked } from "@/lib/logs";
import { fetchPublicStatus, selectServiceRead, serviceStatusView, startPublicStatusRead, type KeyedServiceRead } from "@/lib/keeper-service";
import { chainEvidenceFresh, heartbeatState, isUnsupportedPolicy, recentRange } from "@/lib/readiness";

type Evidence = { timestamp?: number; sender?: string; keeper?: string; authenticated: boolean; blockTime: number };
export type KeeperMonitor = ReturnType<typeof useKeeperMonitor>;

export function useKeeperMonitor() {
  const client = usePublicClient({ chainId: selectedChain.id });
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [serviceEvidence, setServiceEvidence] = useState<KeyedServiceRead | null>(null);
  const [serviceRetry, setServiceRetry] = useState(0);
  const statusUrl = process.env.NEXT_PUBLIC_KEEPER_STATUS_URL ?? "";
  const expectedKeeper = deployment.keeper ?? evidence?.keeper;
  const serviceKey = [statusUrl, selectedChain.id, factoryAddress, expectedKeeper, serviceRetry].join(":");
  useEffect(() => {
    if (!statusUrl) return;
    if (!factoryAddress) {
      setServiceEvidence({ key: serviceKey, kind: "error", message: "Public keeper service cannot be matched: no factory is configured on this chain." });
      return;
    }
    const factory = factoryAddress;
    let cancel: (() => void) | undefined;
    const refresh = () => {
      cancel?.();
      cancel = startPublicStatusRead(serviceKey, signal => fetchPublicStatus(statusUrl, {
        chainId: selectedChain.id, factory, expectedKeeper,
      }, signal), setServiceEvidence);
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => { cancel?.(); clearInterval(timer); };
  }, [statusUrl, serviceKey, expectedKeeper]);
  const load = useCallback(async () => {
    if (!client || !factoryAddress) return;
    try {
      const [block, keeper, policy] = await Promise.all([
        client.getBlock({ blockTag: "latest" }),
        client.readContract({ address: factoryAddress, abi: coilFactoryAbi, functionName: "keeper" }),
        client.readContract({ address: factoryAddress, abi: coilFactoryAbi, functionName: "policy" }).catch(error => { if (deployment.capabilities.policy || !isUnsupportedPolicy(error)) throw error; return null; }),
      ]);
      const event = coilFactoryAbi.find(item => item.type === "event" && item.name === "Heartbeat")!;
      const result = await getLogsChunked(client, { address: factoryAddress, event, ...recentRange(block.number, FACTORY_DEPLOY_BLOCK) });
      if (result.errors.length) throw new Error("Recent heartbeat history is unavailable. Retry to refresh chain evidence.");
      const expected = deployment.keeper ?? (keeper !== ZERO ? keeper : undefined);
      // A legacy permissionless event is history, never an authenticated health proof.
      const trusted = result.logs.filter(log => (log.args as { keeper?: string }).keeper?.toLowerCase() === expected?.toLowerCase());
      trusted.sort((a, b) => a.blockNumber! > b.blockNumber! ? -1 : 1);
      const args = trusted[0]?.args as { keeper?: string; timestamp?: bigint } | undefined;
      setEvidence({ timestamp: args?.timestamp === undefined ? undefined : Number(args.timestamp), sender: args?.keeper, keeper: expected, authenticated: Boolean(policy) && expected?.toLowerCase() === keeper.toLowerCase(), blockTime: Number(block.timestamp) });
      setError(null);
    } catch { setError("Could not refresh keeper evidence from the selected chain."); }
  }, [client]);
  useEffect(() => {
    setNow(Math.floor(Date.now() / 1000));
    void load();
    const timer = setInterval(() => { setNow(Math.floor(Date.now() / 1000)); void load(); }, 30_000);
    return () => clearInterval(timer);
  }, [load]);
  const health = evidence && now !== null ? heartbeatState({ now, timestamp: evidence.timestamp, sender: evidence.sender, expectedKeeper: evidence.keeper, authenticated: evidence.authenticated }) : null;
  const staleRpc = evidence && now !== null && !chainEvidenceFresh(now, evidence.blockTime);
  const state = !factoryAddress ? "unconfigured" : error || staleRpc ? "stale" : health?.state ?? "loading";
  const serviceRead = selectServiceRead(serviceKey, serviceEvidence);
  const service = serviceRead.kind === "ok" ? serviceStatusView(serviceRead.data, now === null ? Date.now() : now * 1000) : null;
  const age = (milliseconds: number | null) => milliseconds === null ? "unavailable" : `${Math.floor(milliseconds / 1000)} seconds ago`;
  const plainState = state === "fresh" ? "live" : state === "stale" ? "the last check-in is old" : state === "unconfigured" ? "not set up on this chain" : "checking";
  return { state, plainState, error, evidence, health, service, serviceRead, statusUrl, age, load, refresh: () => { void load(); setServiceRetry(value => value + 1); } };
}

export function KeeperFacts({ monitor }: { monitor: KeeperMonitor }) {
  const { plainState, health, evidence, service, serviceRead, statusUrl, age } = monitor;
  const executes = Boolean(statusUrl && service?.mode === "execute" && service.status === "healthy");
  return <div className="space-y-2 leading-relaxed">
    <p>Keeper: {plainState}. {selectedChain.name} · chain {selectedChain.id}. Deployment block {deployment.deploymentBlock ?? "pending"}. This is the same check-in used for the Keeper: live chip. A fresh check-in shows the configured keeper was active recently. It does not show that a rescue transaction was sent.{executes ? " The public status report says execution is enabled." : ""}</p>
    <p>Latest authenticated heartbeat: {health?.age !== null && health?.age !== undefined && health.age >= 0 ? `${health.age} seconds ago` : "unavailable"}. Freshness expires after 180 seconds.</p>
    {evidence?.keeper ? <p className="break-all font-mono">Keeper address <a className="link" href={`${explorerUrl}/address/${evidence.keeper}`}>{evidence.keeper}</a></p> : null}
    {statusUrl ? <div>
      {service && serviceRead.kind === "ok" ? <>
        <p>{service.mode === "execute" ? "Public status report: execution enabled. Confirmed chain actions are separate evidence." : "Public status report: reading the chain. This report does not show a rescue being sent."}</p>
        <p>Last successful scan: {age(service.scanAgeMs)}. Last service-confirmed heartbeat: {age(service.heartbeatAgeMs)}. Scan freshness expires after 60 seconds.</p>
        <p>Self-reported counters: {serviceRead.data.counters.scans} scans · {serviceRead.data.counters.confirmedGuards} confirmed protections · {serviceRead.data.counters.scanFailures} scan failures.</p>
      </> : serviceRead.kind === "error" ? <p role="alert">{serviceRead.message}</p>
        : <p>Reading the configured public status.</p>}
    </div> : null}
  </div>;
}

export function KeeperStatus({ liveChip = false, showDetails = true, detailsExtra }: { liveChip?: boolean; showDetails?: boolean; detailsExtra?: ReactNode }) {
  const current = useKeeperMonitor();
  if (liveChip) {
    if (current.state !== "fresh") return null;
    return <Link href="/keeper" className="chip">Keeper: live</Link>;
  }
  return <section className="well mt-6 p-5" aria-label="Keeper health">
    <h2 className="text-xl font-semibold">Keeper: {current.plainState}</h2>
    <p className="mt-2 text-sm text-muted-foreground">A keeper can only make a position safer. It cannot open a loan, withdraw, or close for you.</p>
    <p className="mt-2 text-sm">{current.state === "fresh" ? "A keeper check-in was confirmed recently." : "No recent keeper check-in is confirmed."}</p>
    {current.error ? <p role="alert" className="mt-2 text-sm text-danger">{current.error} The last check-in on screen may be old.</p> : null}
    {showDetails ? <details className="mt-4 text-xs text-muted-foreground">
      <summary className="cursor-pointer text-sm">Technical details</summary>
      <div className="mt-2 space-y-2">
        <KeeperFacts monitor={current} />
        {detailsExtra}
      </div>
    </details> : null}
    <button type="button" className="link mt-3 text-sm" aria-label="Refresh keeper status" onClick={current.refresh}>Refresh</button>
  </section>;
}
