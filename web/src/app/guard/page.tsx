"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { CoilMark, shorten } from "@/components/shell";
import { coilAccountAbi, coilFactoryAbi, FACTORY_DEPLOY_BLOCK, factoryAddress, mezoTestnet } from "@/lib/mezo";
import { getLogsChunked } from "@/lib/logs";

const EXPLORER = "https://explorer.test.mezo.org";

type Row = {
  kind: "rescue" | "delever" | "heartbeat";
  block: bigint;
  tx: `0x${string}`;
  account?: Address;
  detail: string;
};

export default function GuardPage() {
  const publicClient = usePublicClient({ chainId: mezoTestnet.id });
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!publicClient || !factoryAddress) return;
      try {
        const latest = await publicClient.getBlockNumber();
        const from = latest > FACTORY_DEPLOY_BLOCK ? FACTORY_DEPLOY_BLOCK : latest > 0n ? 0n : latest;
        const length = await publicClient.readContract({
          address: factoryAddress,
          abi: coilFactoryAbi,
          functionName: "accountsLength",
        });
        const accounts: Address[] = [];
        const cap = length > 40n ? 40n : length;
        for (let i = 0n; i < cap; i++) {
          accounts.push(
            await publicClient.readContract({
              address: factoryAddress,
              abi: coilFactoryAbi,
              functionName: "accounts",
              args: [i],
            }),
          );
        }

        const next: Row[] = [];
        const problems: string[] = [];
        const heartbeat = coilFactoryAbi.find((item) => item.type === "event" && item.name === "Heartbeat")!;
        const beats = await getLogsChunked(publicClient, {
          address: factoryAddress,
          event: heartbeat,
          fromBlock: from,
          toBlock: latest,
        });
        problems.push(...beats.errors);
        for (const log of beats.logs) {
          const keeper = (log.args as { keeper?: Address }).keeper;
          const timestamp = (log.args as { timestamp?: bigint }).timestamp;
          next.push({
            kind: "heartbeat",
            block: log.blockNumber ?? 0n,
            tx: log.transactionHash ?? "0x",
            detail: `Heartbeat from ${keeper ? shorten(keeper) : "keeper"}${timestamp ? ` · ${new Date(Number(timestamp) * 1000).toISOString()}` : ""}`,
          });
        }

        if (accounts.length > 0) {
          const guarded = coilAccountAbi.find((item) => item.type === "event" && item.name === "Guarded")!;
          const delevered = coilAccountAbi.find((item) => item.type === "event" && item.name === "Delevered")!;
          const rescues = await getLogsChunked(publicClient, {
            address: accounts,
            event: guarded,
            fromBlock: from,
            toBlock: latest,
          });
          problems.push(...rescues.errors);
          for (const log of rescues.logs) {
            const args = log.args as { caller?: Address; crBefore?: bigint; crAfter?: bigint; tip?: bigint };
            const tip = args.tip ?? 0n;
            next.push({
              kind: "rescue",
              block: log.blockNumber ?? 0n,
              tx: log.transactionHash ?? "0x",
              account: log.address,
              detail: `${args.caller ? shorten(args.caller) : "caller"} raised ${pct(args.crBefore)} → ${pct(args.crAfter)} · tip ${formatUnits(tip, 18)} MEZO`,
            });
          }
          const moves = await getLogsChunked(publicClient, {
            address: accounts,
            event: delevered,
            fromBlock: from,
            toBlock: latest,
          });
          problems.push(...moves.errors);
          for (const log of moves.logs) {
            const args = log.args as { cr?: bigint; targetCR?: bigint; debt?: bigint };
            next.push({
              kind: "delever",
              block: log.blockNumber ?? 0n,
              tx: log.transactionHash ?? "0x",
              account: log.address,
              detail: `De-lever toward ${pct(args.targetCR)}, landed at ${pct(args.cr)}`,
            });
          }
        }

        next.sort((a, b) => (a.block < b.block ? 1 : -1));
        if (!cancelled) {
          setRows(next.slice(0, 80));
          setError(problems.length > 0 ? problems[0] : null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not read Mezo.");
      }
    }
    load();
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [publicClient]);

  return (
    <div className="relative min-h-screen">
      <div className="atmosphere pointer-events-none fixed inset-0 -z-10" aria-hidden />
      <header className="border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Coil Labs home">
            <CoilMark className="size-8" />
            <span className="text-lg font-semibold tracking-tight">Coil Labs</span>
          </Link>
          <Link className="text-sm text-muted-foreground hover:text-foreground" href="/#app">
            Back to the app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="eyebrow text-filament">Guard log</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Rescues and heartbeats</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Anyone can call <span className="font-mono text-foreground">guard()</span> on a Wave 2 account. The caller earns the MEZO tip only when the collateral ratio actually rose. The call cannot loop, unwind, or withdraw.
        </p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Factory{" "}
          <a className="link text-foreground" href={`${EXPLORER}/address/${factoryAddress}`}>
            {factoryAddress}
          </a>
        </p>
        {error ? (
          <p className="mt-6 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {rows === null ? (
          error ? null : <p className="mt-8 text-sm text-muted-foreground">Reading Mezo testnet…</p>
        ) : rows.length === 0 ? (
          <p className="mt-8 text-sm text-muted-foreground">
            No rescues or heartbeats since block {FACTORY_DEPLOY_BLOCK.toString()}. A Wave 2 factory emits <span className="font-mono">Guarded</span> and <span className="font-mono">Heartbeat</span>.
          </p>
        ) : (
          <ol className="mt-8 divide-y divide-border">
            {rows.map((row) => (
              <li key={`${row.tx}-${row.kind}-${row.detail}`} className="py-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">
                    {row.kind === "rescue" ? "Rescue" : row.kind === "heartbeat" ? "Heartbeat" : "De-lever"}
                    {row.account ? (
                      <>
                        {" "}
                        <a className="link font-mono text-xs" href={`${EXPLORER}/address/${row.account}`}>
                          {shorten(row.account)}
                        </a>
                      </>
                    ) : null}
                  </p>
                  <a className="font-mono text-xs text-muted-foreground hover:text-foreground" href={`${EXPLORER}/tx/${row.tx}`}>
                    {shorten(row.tx)}
                  </a>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{row.detail}</p>
              </li>
            ))}
          </ol>
        )}
      </main>
    </div>
  );
}

function pct(cr?: bigint) {
  if (!cr) return "—";
  const hundredths = (cr * 10000n) / 10n ** 18n;
  return `${hundredths / 100n}.${(hundredths % 100n).toString().padStart(2, "0")}%`;
}
