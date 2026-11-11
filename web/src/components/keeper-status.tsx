"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { coilFactoryAbi, factoryAddress, FACTORY_DEPLOY_BLOCK, ZERO } from "@/lib/mezo";
import { deployment, explorerUrl, selectedChain } from "@/lib/network";
import { getLogsChunked } from "@/lib/logs";
import { fetchPublicStatus, selectServiceRead, serviceStatusView, startPublicStatusRead, type KeyedServiceRead } from "@/lib/keeper-service";
import { chainEvidenceFresh, heartbeatState, isUnsupportedPolicy, recentRange } from "@/lib/readiness";

type Evidence = { timestamp?: number; sender?: string; keeper?: string; authenticated: boolean; blockTime: number };
export function KeeperStatus({ liveChip = false }: { liveChip?: boolean }) {
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
  const plainState = state === "fresh" ? "checked in recently" : state === "stale" ? "the last check-in is old" : state === "unconfigured" ? "not set up on this chain" : "checking";
  if (liveChip) {
    if (state !== "fresh") return null;
    return <Link href="/keeper" className="chip">Keeper: live</Link>;
  }
  return <section className="well mt-6 p-5" aria-label="Keeper health">
    <h2 className="text-xl font-semibold">Keeper: {plainState}</h2>
    <p className="mt-2 text-sm text-muted-foreground">A keeper can only make a position safer. It cannot open a loan, withdraw, or close for you.</p>
    <p className="mt-2 text-sm">{state === "fresh" ? "A keeper check-in was confirmed recently." : "No recent keeper check-in is confirmed."}</p>
    {error ? <p role="alert" className="mt-2 text-sm text-danger">{error} The last check-in on screen may be old.</p> : null}
    <details className="mt-4 text-xs text-muted-foreground">
      <summary className="cursor-pointer text-sm">Technical details</summary>
      <div className="mt-2 space-y-2 leading-relaxed">
        <p>Chain heartbeat evidence: {state}. {selectedChain.name} · chain {selectedChain.id}. Deployment block {deployment.deploymentBlock ?? "pending"}. Monitoring mode does not submit rescues. Transaction protection requires an execution-enabled keeper with funded gas and confirmed chain activity. Status on this deployment: {deployment.status}.</p>
        <p>Latest authenticated heartbeat: {health?.age !== null && health?.age !== undefined && health.age >= 0 ? `${health.age} seconds ago` : "unavailable"}. Freshness expires after 180 seconds.</p>
        {evidence?.keeper ? <p className="break-all font-mono">Expected keeper <a className="link" href={`${explorerUrl}/address/${evidence.keeper}`}>{evidence.keeper}</a></p> : null}
        <p>Legacy permissionless heartbeats do not prove keeper health. A fresh authenticated heartbeat proves recent configured-keeper activity; it does not guarantee a rescue or replace monitoring of confirmed transactions. No authenticated heartbeat is configured for a legacy factory.</p>
        <div aria-label="Public keeper service status">
          <p className="font-medium text-foreground">Public service status: {!statusUrl ? "unconfigured" : service?.status ?? (serviceRead.kind === "error" ? "unavailable" : "loading")}</p>
          {!statusUrl ? <p>Chain evidence only / service mode unavailable. No public keeper status URL is configured.</p>
            : service && serviceRead.kind === "ok" ? <>
              <p>{service.mode === "read-only" ? "Mode: read-only monitoring. This service does not submit guard transactions." : "Mode: execution enabled. This is the service report; confirmed chain actions remain separate evidence."}</p>
              <p>Last successful scan: {age(service.scanAgeMs)}. Last service-confirmed heartbeat: {age(service.heartbeatAgeMs)}. Scan freshness expires after 60 seconds.</p>
              <p>Self-reported counters: {serviceRead.data.counters.scans} scans · {serviceRead.data.counters.confirmedGuards} confirmed guards · {serviceRead.data.counters.scanFailures} scan failures. Fresh scanning or execution mode does not guarantee a rescue.</p>
            </> : serviceRead.kind === "error" ? <p role="alert">{serviceRead.message} Service mode and scan freshness are unavailable.</p>
              : <p>Reading the configured public service. Service mode and scan freshness are not confirmed yet.</p>}
        </div>
      </div>
    </details>
    <button type="button" className="link mt-3 text-sm" onClick={() => { void load(); setServiceRetry(value => value + 1); }}>Refresh keeper evidence</button>
  </section>;
}
