"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatUnits, type Address } from "viem";
import { usePublicClient } from "wagmi";
import { CoilMark, shorten } from "@/components/shell";
import { getLogsChunked } from "@/lib/logs";
import { coilAccountAbi, coilFactoryAbi, FACTORY_DEPLOY_BLOCK, factoryAddress, mezoTestnet } from "@/lib/mezo";

const EXPLORER = "https://explorer.test.mezo.org";
const ACCOUNT_CAP = 40;

type Stats = {
  latest: bigint;
  accounts: number;
  accountLogs: number;
  scanned: number;
  open: number;
  rescues: number;
  tips: bigint;
  heartbeats: number;
};

export default function StatsPage() {
  const publicClient = usePublicClient({ chainId: mezoTestnet.id });
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!publicClient || !factoryAddress) return;
      try {
        const latest = await publicClient.getBlockNumber();
        const from = latest > FACTORY_DEPLOY_BLOCK ? FACTORY_DEPLOY_BLOCK : 0n;
        const length = await publicClient.readContract({
          address: factoryAddress,
          abi: coilFactoryAbi,
          functionName: "accountsLength",
        });
        const cap = length > BigInt(ACCOUNT_CAP) ? BigInt(ACCOUNT_CAP) : length;
        const accounts: Address[] = [];
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
        let open = 0;
        for (const account of accounts) {
          try {
            const position = await publicClient.readContract({
              address: account,
              abi: coilAccountAbi,
              functionName: "position",
            });
            if (position.active) open += 1;
          } catch {
            // An unreadable clone is counted in the factory list and skipped here.
          }
        }

        const problems: string[] = [];
        const created = coilFactoryAbi.find((item) => item.type === "event" && item.name === "AccountCreated")!;
        const heartbeat = coilFactoryAbi.find((item) => item.type === "event" && item.name === "Heartbeat")!;
        const guarded = coilAccountAbi.find((item) => item.type === "event" && item.name === "Guarded")!;
        const [createdLogs, beats, rescues] = await Promise.all([
          getLogsChunked(publicClient, { address: factoryAddress, event: created, fromBlock: from, toBlock: latest }),
          getLogsChunked(publicClient, { address: factoryAddress, event: heartbeat, fromBlock: from, toBlock: latest }),
          accounts.length > 0
            ? getLogsChunked(publicClient, { address: accounts, event: guarded, fromBlock: from, toBlock: latest })
            : Promise.resolve({ logs: [], errors: [] }),
        ]);
        problems.push(...createdLogs.errors, ...beats.errors, ...rescues.errors);
        let tips = 0n;
        for (const log of rescues.logs) {
          const tip = (log.args as { tip?: bigint }).tip ?? 0n;
          tips += tip;
        }
        if (!cancelled) {
          setStats({
            latest,
            accounts: Number(length),
            accountLogs: createdLogs.logs.length,
            scanned: accounts.length,
            open,
            rescues: rescues.logs.length,
            tips,
            heartbeats: beats.logs.length,
          });
          setError(problems[0] ?? null);
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

  const cards = stats
    ? [
        ["Accounts", stats.accounts.toString(), `${stats.accountLogs} AccountCreated logs`],
        ["Open troves", stats.open.toString(), `of the first ${stats.scanned} accounts`],
        ["Guard rescues", stats.rescues.toString(), "Guarded events"],
        ["MEZO tips paid", `${formatUnits(stats.tips, 18)} MEZO`, "sum of Guarded tips"],
        ["Heartbeats", stats.heartbeats.toString(), "factory Heartbeat events"],
      ]
    : [];

  return (
    <div className="relative min-h-screen">
      <div className="atmosphere pointer-events-none fixed inset-0 -z-10" aria-hidden />
      <header className="border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="flex items-center gap-2.5" aria-label="Coil Labs home">
            <CoilMark className="size-8" />
            <span className="text-lg font-semibold tracking-tight">Coil Labs</span>
          </Link>
          <nav className="flex gap-4 text-sm text-muted-foreground">
            <Link className="hover:text-foreground" href="/guard">
              Guard log
            </Link>
            <Link className="hover:text-foreground" href="/#app">
              App
            </Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="eyebrow text-filament">Public stats</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">What the chain shows</h1>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Counts come from Mezo testnet. Logs are read in chunks of 9,999 blocks, starting at the Wave 2 factory deploy
          block {FACTORY_DEPLOY_BLOCK.toString()}. Open troves are read from each account, not from a log.
        </p>
        <p className="mt-2 font-mono text-xs text-muted-foreground">
          Factory{" "}
          <a className="link text-foreground" href={`${EXPLORER}/address/${factoryAddress}`}>
            {shorten(factoryAddress)}
          </a>
          {stats ? ` · block ${stats.latest.toString()}` : null}
        </p>
        {error ? (
          <p className="mt-6 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        {stats === null ? (
          error ? null : <p className="mt-8 text-sm text-muted-foreground">Reading Mezo testnet…</p>
        ) : (
          <dl className="mt-8 grid gap-3 sm:grid-cols-2">
            {cards.map(([label, value, sub]) => (
              <div key={label} className="well p-5">
                <dt className="text-[11px] text-muted-foreground">{label}</dt>
                <dd className="num mt-1 text-3xl font-medium">{value}</dd>
                <p className="mt-1 text-[11px] text-muted-foreground">{sub}</p>
              </div>
            ))}
          </dl>
        )}
      </main>
    </div>
  );
}
