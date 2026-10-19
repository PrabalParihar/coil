"use client";

import { useEffect, useMemo, useState } from "react";
import { parseEther } from "viem";
import {
  useAccount,
  useChainId,
  useConnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  ZERO,
  addr,
  borrowerAbi,
  coilAccountAbi,
  coilFactoryAbi,
  factoryAddress,
  factoryFeeAbi,
  mezoTestnet,
  poolAbi,
  priceFeedAbi,
  type Position,
} from "@/lib/mezo";
import {
  QuoteError,
  formatBtc,
  formatMusd,
  formatPercent,
  formatUsd,
  leverageLabel,
  percentToCr,
  poolReserves,
  quoteLoop,
  type LoopPreview,
  type Market,
} from "@/lib/quote";

const WAD = 10n ** 18n;
const EXPLORER = "https://explorer.test.mezo.org/tx/";

type TxLink = { label: string; hash: `0x${string}` };

export function CoilApp() {
  const [mounted, setMounted] = useState(false);
  const [btcText, setBtcText] = useState("0.04");
  const [targetPct, setTargetPct] = useState(200);
  const [deleverPct, setDeleverPct] = useState(300);
  const [slippageBps, setSlippageBps] = useState(50);
  const [unwindPct, setUnwindPct] = useState(100);
  const [floorPct, setFloorPct] = useState(170);
  const [guardPct, setGuardPct] = useState(220);
  const [zone, setZone] = useState(8);
  const [market, setMarket] = useState<Market | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxLink[]>([]);
  const [busy, setBusy] = useState(false);

  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: mezoTestnet.id });
  const { writeContractAsync } = useWriteContract();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!publicClient) return;
      try {
        const [price, minNetDebt, borrowRate, refiPct, token0, reserves, feeBps] =
          await Promise.all([
            publicClient.readContract({
              address: addr.priceFeed,
              abi: priceFeedAbi,
              functionName: "fetchPrice",
            }),
            publicClient.readContract({
              address: addr.borrowerOperations,
              abi: borrowerAbi,
              functionName: "minNetDebt",
            }),
            publicClient.readContract({
              address: addr.borrowerOperations,
              abi: borrowerAbi,
              functionName: "borrowingRate",
            }),
            publicClient.readContract({
              address: addr.borrowerOperations,
              abi: borrowerAbi,
              functionName: "refinancingFeePercentage",
            }),
            publicClient.readContract({
              address: addr.pool,
              abi: poolAbi,
              functionName: "token0",
            }),
            publicClient.readContract({
              address: addr.pool,
              abi: poolAbi,
              functionName: "getReserves",
            }),
            publicClient.readContract({
              address: addr.poolFactory,
              abi: factoryFeeAbi,
              functionName: "getFee",
              args: [addr.pool, false],
            }),
          ]);
        const reservesSplit = poolReserves(token0, reserves[0], reserves[1]);
        if (!cancelled) {
          setMarket({
            price,
            minNetDebt,
            borrowRate,
            refiPct: BigInt(refiPct),
            feeBps,
            ...reservesSplit,
          });
          setMarketError(null);
        }
      } catch (error) {
        if (!cancelled) {
          setMarketError(error instanceof Error ? error.message : "Could not read Mezo.");
        }
      }
    }
    load();
    const timer = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [publicClient]);

  const collateral = useMemo(() => {
    try {
      if (!btcText || Number(btcText) <= 0) return 0n;
      return parseEther(btcText);
    } catch {
      return null;
    }
  }, [btcText]);

  const preview = useMemo(() => {
    if (!market) return { kind: "loading" as const };
    if (collateral === null) return { kind: "error" as const, message: "Enter a BTC amount." };
    try {
      const quote = quoteLoop(collateral, percentToCr(targetPct), BigInt(slippageBps), market);
      return { kind: "ok" as const, quote };
    } catch (error) {
      const message = error instanceof QuoteError ? error.message : "Preview failed.";
      return { kind: "error" as const, message };
    }
  }, [market, collateral, targetPct, slippageBps]);

  const { data: coilAccount, refetch: refetchAccount } = useReadContract({
    address: factoryAddress,
    abi: coilFactoryAbi,
    functionName: "accountOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(factoryAddress && address) },
  });

  const account =
    coilAccount && coilAccount !== ZERO ? (coilAccount as `0x${string}`) : undefined;

  const { data: positionRaw, refetch: refetchPosition } = useReadContract({
    address: account,
    abi: coilAccountAbi,
    functionName: "position",
    query: { enabled: Boolean(account), refetchInterval: 15_000 },
  });
  const position = positionRaw as Position | undefined;

  async function ensureChain() {
    if (chainId !== mezoTestnet.id) {
      await switchChainAsync({ chainId: mezoTestnet.id });
    }
  }

  async function readPos(clone: `0x${string}`): Promise<Position> {
    if (!publicClient) throw new Error("Mezo RPC is not ready.");
    return (await publicClient.readContract({
      address: clone,
      abi: coilAccountAbi,
      functionName: "position",
    })) as Position;
  }

  async function send(label: string, action: () => Promise<`0x${string}`>) {
    if (!publicClient) throw new Error("Mezo RPC is not ready.");
    await ensureChain();
    setStatus(label);
    const hash = await action();
    setTxs((current) => [...current, { label, hash }]);
    setStatus(`${label}. Waiting for the Mezo receipt…`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error("The transaction reverted.");
    await refetchAccount();
    await refetchPosition();
  }

  function begin() {
    setBusy(true);
    setTxError(null);
    setTxs([]);
  }

  function fail(error: unknown) {
    setTxError(error instanceof Error ? error.message : "Transaction failed.");
  }

  async function delever(clone: `0x${string}`) {
    begin();
    const target = percentToCr(deleverPct);
    try {
      for (let step = 1; step <= 4; step++) {
        const pos = await readPos(clone);
        if (!pos.active || pos.cr >= target) break;
        const beforeDebt = pos.debt;
        try {
          await send(`De-lever ${step} of the way to ${deleverPct}%`, () =>
            writeContractAsync({
              address: clone,
              abi: coilAccountAbi,
              functionName: "deleverTo",
              args: [target],
              chainId: mezoTestnet.id,
              gas: 5_000_000n,
            }),
          );
        } catch (error) {
          if (alreadyThere(error)) break;
          throw error;
        }
        const mid = await readPos(clone);
        // Stop when the sale did not repay. An oracle tick can lift the ratio
        // without a sale, and another call would only repeat a no-op.
        if (!mid.active || mid.debt >= beforeDebt) break;
      }
      const end = await readPos(clone);
      setStatus(
        !end.active
          ? "The trove is closed."
          : end.cr >= target
            ? `Ratio is now ${formatPercent(end.cr)}.`
            : `Ratio is now ${formatPercent(end.cr)}. Mezo keeps at least 1,800 MUSD of debt, so this trove cannot go higher without closing.`,
      );
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function unwind(clone: `0x${string}`) {
    begin();
    const fraction = (BigInt(unwindPct) * WAD) / 100n;
    try {
      const start = await readPos(clone);
      const goal =
        unwindPct === 100 ? 0n : start.debt - ((start.debt - 200n * WAD) * BigInt(unwindPct)) / 100n;
      for (let step = 1; step <= 4; step++) {
        const pos = await readPos(clone);
        if (!pos.active) break;
        if (unwindPct < 100 && pos.debt <= goal) break;
        const before = pos.debt;
        await send(
          unwindPct === 100 ? `Unwind ${step}: closing the trove` : `Unwind ${step}: repaying debt`,
          () =>
            writeContractAsync({
              address: clone,
              abi: coilAccountAbi,
              functionName: "unwind",
              args: [fraction],
              chainId: mezoTestnet.id,
              gas: 5_000_000n,
            }),
        );
        const after = await readPos(clone);
        if (!after.active) break;
        if (after.debt >= before) break;
      }
      const end = await readPos(clone);
      setStatus(end.active ? `Debt is now ${formatMusd(end.debt)} MUSD.` : "Trove closed. BTC is back in your wallet.");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  const wrongChain = mounted && isConnected && chainId !== mezoTestnet.id;
  const targetCR = percentToCr(targetPct);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <div className="flex items-center gap-3">
          <CoilMark />
          <div>
            <p className="font-[family-name:var(--font-fraunces)] text-2xl leading-none tracking-tight">
              Coil
            </p>
            <p className="mt-1 text-sm text-muted-foreground">BTC leverage on MUSD</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {market ? (
            <p className="text-sm text-muted-foreground">
              BTC <span className="text-foreground">{formatUsd(market.price)}</span>
            </p>
          ) : null}
          <Button
            variant={isConnected ? "outline" : "default"}
            disabled={!mounted || connecting}
            onClick={() => {
              const connector = connectors[0];
              if (connector) connect({ connector });
            }}
          >
            {!mounted ? "Connect wallet" : isConnected ? shorten(address) : "Connect wallet"}
          </Button>
        </div>
      </header>

      <section className="grid gap-8 py-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <div>
          <p className="text-xs tracking-[0.18em] text-muted-foreground uppercase">
            Mezo testnet · chain 31611
          </p>
          <h1 className="mt-3 max-w-xl font-[family-name:var(--font-fraunces)] text-4xl leading-[1.05] font-medium tracking-tight sm:text-5xl">
            One transaction turns BTC into a leveraged BTC position.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Coil borrows MUSD against your Bitcoin, buys more BTC on Mezo Pools, and posts that
            BTC back as collateral. You pick the ratio. A keeper can only make the position safer.
          </p>
          <ol className="mt-6 grid max-w-xl gap-3 sm:grid-cols-3">
            {[
              ["Post BTC", "Open a MUSD trove"],
              ["Buy BTC", "Swap the MUSD"],
              ["Post it back", "Stop at your ratio"],
            ].map(([title, body]) => (
              <li key={title} className="rounded-xl border border-border bg-card/60 px-3 py-3">
                <p className="font-[family-name:var(--font-fraunces)] text-lg leading-none">{title}</p>
                <p className="mt-1 text-xs text-muted-foreground">{body}</p>
              </li>
            ))}
          </ol>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Why it is one call</CardTitle>
            <CardDescription>The clone owns the trove, so the steps share a transaction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>1. Your BTC collateral opens or tops up the trove and mints MUSD.</p>
            <p>2. The MUSD/BTC pool swaps that MUSD back into BTC.</p>
            <p>3. The BTC is added as collateral. Refinance lifts the borrow cap, and Coil repeats until the next mint would cross under your ratio.</p>
          </CardContent>
        </Card>
      </section>

      {marketError ? (
        <Banner tone="bad" title="Mezo RPC">
          {marketError}
        </Banner>
      ) : null}
      {wrongChain ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 px-4 py-3 text-sm">
          <div>
            <p className="font-medium">Wrong network</p>
            <p className="mt-1 text-muted-foreground">Coil sends transactions on Mezo testnet, chain 31611.</p>
          </div>
          <Button
            variant="outline"
            onClick={() => switchChainAsync({ chainId: mezoTestnet.id }).catch(fail)}
          >
            Switch to Mezo testnet
          </Button>
        </div>
      ) : null}
      {!factoryAddress ? (
        <Banner tone="warn" title="Preview only">
          No Coil factory address is configured. Quotes below are read from the live testnet pool
          and oracle. Set NEXT_PUBLIC_COIL_FACTORY after you deploy to enable loop and unwind.
        </Banner>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Open a coil</CardTitle>
            <CardDescription>
              Target {targetPct}% collateral, about {leverageLabel(targetCR)} BTC exposure.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="btc">BTC to deposit</Label>
              <Input
                id="btc"
                inputMode="decimal"
                value={btcText}
                onChange={(event) => setBtcText(event.target.value)}
                className="h-11 text-lg"
              />
            </div>
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Label>Target collateral ratio</Label>
                <span className="font-[family-name:var(--font-fraunces)] text-2xl">{targetPct}%</span>
              </div>
              <Slider
                min={115}
                max={350}
                step={5}
                value={[targetPct]}
                onValueChange={(value) => setTargetPct(value[0] ?? 200)}
              />
              <p className="text-xs text-muted-foreground">
                115% is the floor Coil will accept. Liquidation is 110%. Lower ratios are redeemed first.
              </p>
            </div>
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Label>Max slippage</Label>
                <span className="text-sm">{(slippageBps / 100).toFixed(2)}%</span>
              </div>
              <Slider
                min={10}
                max={150}
                step={5}
                value={[slippageBps]}
                onValueChange={(value) => setSlippageBps(value[0] ?? 50)}
              />
            </div>

            <Preview quote={preview} />

            <div className="flex flex-col gap-2 sm:flex-row">
              {factoryAddress && mounted && isConnected && !account ? (
                <Button
                  className="h-11 flex-1"
                  disabled={busy}
                  onClick={() => {
                    const factory = factoryAddress;
                    if (!factory) return;
                    begin();
                    send("Create account", () =>
                      writeContractAsync({
                        address: factory,
                        abi: coilFactoryAbi,
                        functionName: "createAccount",
                        chainId: mezoTestnet.id,
                        gas: 800_000n,
                      }),
                    )
                      .then(() => setStatus("Account created."))
                      .catch(fail)
                      .finally(() => setBusy(false));
                  }}
                >
                  Create account
                </Button>
              ) : null}
              <Button
                className="h-11 flex-1"
                disabled={
                  busy ||
                  !factoryAddress ||
                  !account ||
                  preview.kind !== "ok" ||
                  collateral === null ||
                  collateral === 0n
                }
                onClick={() => {
                  if (!account || collateral === null) return;
                  begin();
                  send(`Loop to ${targetPct}%`, () =>
                    writeContractAsync({
                      address: account,
                      abi: coilAccountAbi,
                      functionName: "loop",
                      args: [targetCR, BigInt(slippageBps)],
                      value: collateral,
                      chainId: mezoTestnet.id,
                      gas: 8_000_000n,
                    }),
                  )
                    .then(() => setStatus("Loop confirmed."))
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              >
                {account ? "Loop" : factoryAddress ? "Create an account first" : "Deploy to enable"}
              </Button>
            </div>
            {status ? <p className="text-sm text-muted-foreground">{status}</p> : null}
            <TxList txs={txs} />
            {txError ? <p className="text-sm text-destructive">{shortError(txError)}</p> : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Position</CardTitle>
              <CardDescription>
                {account ? shorten(account) : "Each wallet gets one clone. The clone is the borrower."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!factoryAddress ? (
                <Empty
                  title="Nothing on-chain yet"
                  body="The preview uses live Mezo state. After a testnet deploy, this card shows the trove the clone owns."
                />
              ) : !mounted || !isConnected ? (
                <Empty
                  title="Connect to see your trove"
                  body="Use any injected wallet on Mezo testnet. Test BTC comes from faucet.test.mezo.org."
                />
              ) : !account ? (
                <Empty
                  title="No Coil account"
                  body="Create one. It is a minimal proxy. Your wallet stays able to unwind, and the keeper cannot take funds."
                />
              ) : !position?.active ? (
                <Empty
                  title="Account ready, trove closed"
                  body="Deposit BTC and loop. The resulting debt has to clear the 1,800 MUSD minimum."
                />
              ) : (
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-4">
                    <Stat label="Collateral ratio" value={formatPercent(position.cr)} />
                    <Stat label="Leverage" value={leverageLabel(position.cr)} />
                    <Stat label="Collateral" value={`${formatBtc(position.collateral)} BTC`} />
                    <Stat label="Debt" value={`${formatMusd(position.debt)} MUSD`} />
                    <Stat label="Liquidation price" value={formatUsd(position.liquidationPrice)} />
                    <Stat label="Redemption rank" value={rankLabel(position.redemptionRank)} />
                  </div>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {redemptionNote(position.redemptionRank, position.cr)} Liquidation can take the
                    trove if BTC trades through {formatUsd(position.liquidationPrice)}.
                  </p>
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <Label>Raise the ratio</Label>
                      <span className="font-[family-name:var(--font-fraunces)] text-2xl">{deleverPct}%</span>
                    </div>
                    <Slider
                      min={130}
                      max={400}
                      step={10}
                      value={[deleverPct]}
                      onValueChange={(value) => setDeleverPct(value[0] ?? 300)}
                    />
                    <Button
                      variant="secondary"
                      className="h-11 w-full"
                      disabled={busy || !account || percentToCr(deleverPct) <= position.cr}
                      onClick={() => account && delever(account)}
                    >
                      De-lever to {deleverPct}%
                    </Button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <Label>Unwind</Label>
                      <span className="text-sm">{unwindPct === 100 ? "Close trove" : `${unwindPct}% of debt`}</span>
                    </div>
                    <Slider
                      min={10}
                      max={100}
                      step={10}
                      value={[unwindPct]}
                      onValueChange={(value) => setUnwindPct(value[0] ?? 100)}
                    />
                    <Button
                      variant="outline"
                      className="h-11 w-full"
                      disabled={busy || !account}
                      onClick={() => account && unwind(account)}
                    >
                      {unwindPct === 100 ? "Unwind and close" : "Unwind"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Guard</CardTitle>
              <CardDescription>
                The keeper calls deleverTo only up to this ratio, and only if you set one.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Floor %" value={floorPct} onChange={setFloorPct} />
                <Field label="De-lever to %" value={guardPct} onChange={setGuardPct} />
                <Field label="Redeem zone" value={zone} onChange={setZone} />
              </div>
              <Button
                variant="secondary"
                className="h-11 w-full"
                disabled={busy || !account}
                onClick={() => {
                  if (!account) return;
                  begin();
                  send("Set guard", () =>
                    writeContractAsync({
                      address: account,
                      abi: coilAccountAbi,
                      functionName: "setGuard",
                      args: [percentToCr(floorPct), percentToCr(guardPct), zone],
                      chainId: mezoTestnet.id,
                      gas: 300_000n,
                    }),
                  )
                    .then(() => setStatus("Guard saved."))
                    .catch(fail)
                    .finally(() => setBusy(false));
                }}
              >
                Set guard
              </Button>
              {position?.guardTargetCR ? (
                <p className="text-xs text-muted-foreground">
                  Active floor {formatPercent(position.floorCR)}, target {formatPercent(position.guardTargetCR)}, zone{" "}
                  {position.redemptionZone}.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Unset, the keeper cannot touch the trove. You can always unwind yourself.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <footer className="mt-10 border-t border-border py-8 text-sm text-muted-foreground">
        <div className="grid gap-4 sm:grid-cols-3">
          <p>Liquidation takes the trove at 110%. Coil will not target below 115%.</p>
          <p>Redemptions repay the lowest-ratio troves first. A tight coil sits at the front of that queue.</p>
          <p>
            A big de-lever or a full unwind can take more than one transaction. Mezo allows 20 precompile
            calls per transaction, so Coil sells collateral once per call and continues.
          </p>
        </div>
        <p className="mt-6">
          Built by Prabal Pratap Singh for Mezo Buildathon Wave 1. Factory {shorten(factoryAddress)} on chain
          31611.
        </p>
      </footer>
    </div>
  );
}

function Preview({
  quote,
}: {
  quote: { kind: "loading" } | { kind: "error"; message: string } | { kind: "ok"; quote: LoopPreview };
}) {
  if (quote.kind === "loading") {
    return <p className="text-sm text-muted-foreground">Reading the pool and the oracle…</p>;
  }
  if (quote.kind === "error") {
    return <p className="text-sm text-destructive">{quote.message}</p>;
  }
  const q = quote.quote;
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl border border-border bg-background/40 p-4 text-sm">
      <Stat label="Collateral after" value={`${formatBtc(q.collateral)} BTC`} />
      <Stat label="Debt" value={`${formatMusd(q.debt)} MUSD`} />
      <Stat label="Resulting ratio" value={formatPercent(q.cr)} />
      <Stat label="Liquidation price" value={formatUsd(q.liquidationPrice)} />
      <Stat label="MUSD minted" value={formatMusd(q.musdMinted)} />
      <Stat label="Swaps" value={String(q.iterations)} />
    </dl>
  );
}

function TxList({ txs }: { txs: TxLink[] }) {
  if (txs.length === 0) return null;
  return (
    <ul className="space-y-1 text-sm">
      {txs.map((tx) => (
        <li key={tx.hash}>
          <a
            className="underline decoration-border underline-offset-4 hover:decoration-foreground"
            href={`${EXPLORER}${tx.hash}`}
            target="_blank"
            rel="noreferrer"
          >
            {tx.label} · {tx.hash.slice(0, 10)}… on the explorer
          </a>
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-[family-name:var(--font-fraunces)] text-lg leading-none">{value}</dd>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        inputMode="numeric"
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value || 0))}
      />
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-8">
      <p className="font-medium">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Banner({
  title,
  children,
  tone,
}: {
  title: string;
  children: string;
  tone: "warn" | "bad";
}) {
  return (
    <div
      className={`mb-4 rounded-xl border px-4 py-3 text-sm ${
        tone === "bad" ? "border-destructive/40 text-destructive" : "border-border"
      }`}
    >
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 text-muted-foreground">{children}</p>
    </div>
  );
}

function CoilMark() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
      <rect width="36" height="36" rx="10" fill="var(--primary)" />
      <path
        d="M18 8c-5 0-8 3-8 7.2 0 3.4 2.2 5.4 5.2 5.4 2.4 0 4-1.3 4-3.2 0-1.6-1.1-2.6-2.7-2.6"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M18 28c5 0 8-3 8-7.2 0-3.4-2.2-5.4-5.2-5.4-2.4 0-4 1.3-4 3.2 0 1.6 1.1 2.6 2.7 2.6"
        fill="none"
        stroke="var(--primary-foreground)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function shorten(address?: string) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function rankLabel(rank: bigint) {
  if (rank === 0n) return "—";
  if (rank > 32n) return "Outside 32";
  return `#${rank.toString()}`;
}

function redemptionNote(rank: bigint, cr: bigint) {
  if (rank > 0n && rank <= 8n) {
    return "This trove is near the front of the redemption queue. A redemption repays MUSD and takes BTC.";
  }
  if (cr < 15n * 10n ** 17n) {
    return "A tight ratio is redeemed before safer troves. Raising it moves you back in the queue.";
  }
  return "Redemptions start at the lowest ratios. This trove is not in the first 8.";
}

function alreadyThere(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("AlreadyAtTarget") || message.includes("0xc9b136fe");
}

function shortError(message: string) {
  const cleaned = message.replace(/^Error:\s*/, "");
  return cleaned.length > 280 ? `${cleaned.slice(0, 280)}…` : cleaned;
}
