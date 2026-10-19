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
import { AnimatePresence, motion } from "motion/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type Market,
} from "@/lib/quote";
import {
  Activity,
  Banner,
  CoilMark,
  EmptyState,
  HealthFilament,
  HeroInstrument,
  NumberField,
  PreviewPanel,
  Rail,
  TweenValue,
  activityScope,
  shorten,
  useCoilMotion,
  useMotionOk,
  type TxLink,
} from "@/components/shell";

const WAD = 10n ** 18n;

const STEPS = [
  ["Post BTC", "Open a MUSD trove"],
  ["Buy BTC", "Swap the MUSD"],
  ["Post it back", "Stop at your ratio"],
] as const;

const CALL = [
  "Your BTC collateral opens or tops up the trove and mints MUSD.",
  "The MUSD/BTC pool swaps that MUSD back into BTC.",
  "The BTC is added as collateral. Refinance lifts the borrow cap, and Coil repeats until the next mint would cross under your ratio.",
] as const;

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

  useCoilMotion();
  const motionOk = useMotionOk();
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

  function connectWallet() {
    const connector = connectors[0];
    if (connector) connect({ connector });
  }

  const wrongChain = mounted && isConnected && chainId !== mezoTestnet.id;
  const targetCR = percentToCr(targetPct);
  const scope = activityScope(status, txs, txError);
  const errorText = txError ? shortError(txError) : null;
  const positionKey = !factoryAddress
    ? "preview"
    : !mounted || !isConnected
      ? "connect"
      : !account
        ? "account"
        : !position?.active
          ? "closed"
          : "open";

  const loopLabel = !factoryAddress
    ? "Deploy to enable"
    : !mounted || !isConnected
      ? "Connect to loop"
      : !account
        ? "Create an account first"
        : "Loop";

  return (
    <div className="relative min-h-screen">
      <div className="atmosphere pointer-events-none fixed inset-0 -z-10" aria-hidden />
      <div
        className="pointer-events-none fixed inset-x-0 top-0 z-40 h-px bg-gradient-to-r from-transparent via-filament to-transparent"
        aria-hidden
      />
      <a
        href="#desk"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-filament focus:px-4 focus:py-2 focus:text-ink"
      >
        Skip to compose
      </a>

      <header className="sticky top-0 z-30 border-b border-border/80 bg-background/75 backdrop-blur-xl">
        <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <CoilMark />
            <div>
              <p className="font-serif text-2xl leading-none tracking-tight">Coil</p>
              <p className="mt-1 text-xs text-muted-foreground">BTC leverage on MUSD</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-3">
            <p className="hidden items-center gap-2 text-sm text-muted-foreground sm:flex">
              <span className="relative flex size-1.5" aria-hidden>
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-safe opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-safe" />
              </span>
              BTC{" "}
              {market ? (
                <TweenValue
                  canonical={formatUsd(market.price)}
                  numeric={Number(market.price / 10n ** 18n)}
                  digits={0}
                  prefix="$"
                  className="text-foreground"
                />
              ) : (
                <span className="text-foreground/70">Reading oracle…</span>
              )}
            </p>
            <span
              className={`hidden rounded-full border px-2.5 py-1 font-mono text-[10px] tracking-wide md:inline ${
                wrongChain ? "border-destructive/50 text-destructive" : "border-border text-muted-foreground"
              }`}
            >
              {wrongChain ? "Wrong network" : "Mezo 31611"}
            </span>
            <Button
              type="button"
              variant={isConnected ? "outline" : "default"}
              className="h-10 px-4"
              disabled={!mounted || connecting}
              onClick={connectWallet}
            >
              {!mounted ? "Connect wallet" : connecting ? "Connecting…" : isConnected ? shorten(address) : "Connect wallet"}
            </Button>
          </div>
          {busy ? <div className="busy-bar" aria-hidden /> : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-8">
        <main aria-busy={busy}>
          <section className="grid items-center gap-10 py-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(260px,0.8fr)] lg:py-14">
            <div>
              <p className="rise flex items-center gap-2 text-[11px] tracking-[0.18em] text-muted-foreground uppercase">
                <span className="size-1.5 rounded-full bg-filament" aria-hidden />
                Mezo testnet · chain 31611
              </p>
              <h1 className="mt-4 max-w-[16ch] font-serif text-5xl leading-[0.98] tracking-[-0.035em] sm:text-6xl">
                <span className="rise rise-1 block">One transaction turns</span>
                <span className="rise rise-2 block">
                  BTC into a <em className="text-filament italic">leveraged</em>
                </span>
                <span className="rise rise-3 block">BTC position.</span>
              </h1>
              <p className="rise rise-3 mt-5 max-w-xl text-base leading-relaxed text-muted-foreground">
                Coil borrows MUSD against your Bitcoin, buys more BTC on Mezo Pools, and posts that
                BTC back as collateral. You pick the ratio. A keeper can only make the position safer.
              </p>
              <ol className="mt-8 grid max-w-xl gap-4 sm:grid-cols-3">
                {STEPS.map(([title, body], index) => (
                  <li key={title}>
                    <div className="mb-3 flex items-center gap-3">
                      <span className="font-mono text-[11px] text-filament">0{index + 1}</span>
                      <span className={`filament-line filament-line-${index + 1} h-px flex-1 bg-gradient-to-r from-filament/80 to-transparent`} />
                    </div>
                    <p className="font-serif text-xl leading-none">{title}</p>
                    <p className="mt-1.5 text-xs text-muted-foreground">{body}</p>
                  </li>
                ))}
              </ol>
            </div>
            <HeroInstrument targetPct={targetPct} />
          </section>

          <section aria-labelledby="why-title" className="border-t border-border py-8">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <h2 id="why-title" className="font-serif text-3xl tracking-tight">
                Why it is one call
              </h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                The clone owns the trove, so the steps share a transaction.
              </p>
            </div>
            <ol className="mt-6 grid gap-5 sm:grid-cols-3">
              {CALL.map((step, index) => (
                <li key={step} className="border-t border-border pt-4">
                  <p className="font-mono text-[11px] text-filament">0{index + 1}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step}</p>
                </li>
              ))}
            </ol>
          </section>

          <div className="space-y-3 pb-5">
            {market ? (
              <p className="text-sm text-muted-foreground sm:hidden">
                BTC <span className="text-foreground">{formatUsd(market.price)}</span>
              </p>
            ) : null}
            {marketError ? (
              <Banner tone="bad" title="Mezo RPC">
                {marketError}
              </Banner>
            ) : null}
            {wrongChain ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
                <div>
                  <p className="font-medium">Wrong network</p>
                  <p className="mt-1 text-muted-foreground">Coil sends transactions on Mezo testnet, chain 31611.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 px-4"
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
          </div>

          <div id="desk" className="grid scroll-mt-24 items-start gap-5 pb-6 lg:grid-cols-2">
            <section className="panel p-5 sm:p-6" aria-labelledby="compose-title">
              <p className="text-[11px] tracking-[0.18em] text-filament uppercase">Compose</p>
              <h2 id="compose-title" className="mt-2 font-serif text-3xl tracking-tight">
                Open a coil
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Target {targetPct}% collateral, about {leverageLabel(targetCR)} BTC exposure.
              </p>

              <div className="mt-6 space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="btc" className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
                    BTC to deposit
                  </Label>
                  <div className="relative">
                    <Input
                      id="btc"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={btcText}
                      onChange={(event) => setBtcText(event.target.value)}
                      className="h-14 rounded-2xl border-border bg-black/25 pr-16 font-serif text-3xl md:text-3xl dark:bg-black/25"
                    />
                    <span className="pointer-events-none absolute top-1/2 right-4 -translate-y-1/2 text-[11px] tracking-[0.16em] text-muted-foreground" aria-hidden>
                      BTC
                    </span>
                  </div>
                </div>

                <Rail
                  label="Target collateral ratio"
                  thumbLabel="Target collateral ratio"
                  min={115}
                  max={350}
                  step={5}
                  value={targetPct}
                  onValueChange={setTargetPct}
                  ticks={[115, 150, 200, 300, 350]}
                  hint="115% is the floor Coil will accept. Liquidation is 110%. Lower ratios are redeemed first."
                  display={
                    <TweenValue
                      canonical={`${targetPct}%`}
                      numeric={targetPct}
                      digits={0}
                      suffix="%"
                      className="font-serif text-4xl leading-none tracking-tight"
                    />
                  }
                />

                <Rail
                  label="Max slippage"
                  thumbLabel="Max slippage"
                  min={10}
                  max={150}
                  step={5}
                  value={slippageBps}
                  onValueChange={setSlippageBps}
                  display={
                    <span className="font-serif text-2xl leading-none tabular-nums">
                      {(slippageBps / 100).toFixed(2)}%
                    </span>
                  }
                />

                <PreviewPanel quote={preview} />

                <div className="flex flex-col gap-2">
                  {factoryAddress && mounted && isConnected && !account ? (
                    <Button
                      type="button"
                      className="h-12 px-6 text-[15px]"
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
                    type="button"
                    variant={account ? "default" : "secondary"}
                    className="h-12 px-6 text-[15px]"
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
                    {loopLabel}
                  </Button>
                </div>

                {scope === "compose" ? (
                  <Activity
                    status={status}
                    txs={txs}
                    error={errorText}
                    busy={busy}
                    deleverPct={deleverPct}
                    unwindPct={unwindPct}
                  />
                ) : null}
              </div>
            </section>

            <div className="space-y-5">
              <section className="panel p-5 sm:p-6" aria-labelledby="position-title">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] tracking-[0.18em] text-filament uppercase">Position</p>
                    <h2 id="position-title" className="mt-2 font-serif text-3xl tracking-tight">
                      Trove
                    </h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {account ? (
                        <span className="font-mono text-foreground/90">{shorten(account)}</span>
                      ) : (
                        "Each wallet gets one clone. The clone is the borrower."
                      )}
                    </p>
                  </div>
                  {position?.active ? (
                    <span className="rounded-full border border-safe/30 bg-safe/10 px-2.5 py-1 text-[11px] tracking-wide text-safe uppercase">
                      Open
                    </span>
                  ) : null}
                </div>

                <AnimatePresence mode="wait" initial={false}>
                  <motion.div
                    key={positionKey}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: motionOk ? 0.35 : 0, ease: [0.16, 1, 0.3, 1] }}
                    className="mt-5"
                  >
                    {!factoryAddress ? (
                      <EmptyState
                        title="Nothing on-chain yet"
                        body="The preview uses live Mezo state. After a testnet deploy, this card shows the trove the clone owns."
                      />
                    ) : !mounted || !isConnected ? (
                      <EmptyState
                        title="Connect to see your trove"
                        body="Use any injected wallet on Mezo testnet. Test BTC comes from faucet.test.mezo.org."
                        action={
                          mounted
                            ? { label: connecting ? "Connecting…" : "Connect wallet", onClick: connectWallet, disabled: connecting }
                            : undefined
                        }
                      />
                    ) : !account ? (
                      <EmptyState
                        title="No Coil account"
                        body="Create one. It is a minimal proxy. Your wallet stays able to unwind, and the keeper cannot take funds."
                      />
                    ) : !position?.active ? (
                      <EmptyState
                        title="Account ready, trove closed"
                        body="Deposit BTC and loop. The resulting debt has to clear the 1,800 MUSD minimum."
                      />
                    ) : (
                      <OpenPosition
                        position={position}
                        deleverPct={deleverPct}
                        setDeleverPct={setDeleverPct}
                        unwindPct={unwindPct}
                        setUnwindPct={setUnwindPct}
                        busy={busy}
                        onDelever={() => account && delever(account)}
                        onUnwind={() => account && unwind(account)}
                      />
                    )}
                  </motion.div>
                </AnimatePresence>

                {scope === "position" ? (
                  <Activity
                    status={status}
                    txs={txs}
                    error={errorText}
                    busy={busy}
                    deleverPct={deleverPct}
                    unwindPct={unwindPct}
                  />
                ) : null}
              </section>

              <section className="panel p-5 sm:p-6" aria-labelledby="guard-title">
                <p className="text-[11px] tracking-[0.18em] text-muted-foreground uppercase">Keeper</p>
                <h2 id="guard-title" className="mt-2 font-serif text-3xl tracking-tight">
                  Guard
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  The keeper calls deleverTo only up to this ratio, and only if you set one.
                </p>
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <NumberField id="floor" label="Floor %" value={floorPct} onChange={setFloorPct} />
                  <NumberField id="guard-target" label="De-lever to %" value={guardPct} onChange={setGuardPct} />
                  <NumberField id="zone" label="Redeem zone" value={zone} onChange={setZone} />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  className="mt-4 h-12 w-full px-6 text-[15px]"
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
                  <ul className="mt-4 flex flex-wrap gap-2 text-xs">
                    <li className="rounded-full border border-border px-2.5 py-1">
                      Floor {formatPercent(position.floorCR)}
                    </li>
                    <li className="rounded-full border border-border px-2.5 py-1">
                      Target {formatPercent(position.guardTargetCR)}
                    </li>
                    <li className="rounded-full border border-border px-2.5 py-1">Zone {position.redemptionZone}</li>
                  </ul>
                ) : (
                  <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
                    Unset, the keeper cannot touch the trove. You can always unwind yourself.
                  </p>
                )}
              </section>
            </div>
          </div>
        </main>

        <footer className="mt-6 border-t border-border py-8 text-sm text-muted-foreground">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <p className="text-[11px] tracking-[0.16em] text-foreground/80 uppercase">Liquidation</p>
              <p className="mt-2 leading-relaxed">Liquidation takes the trove at 110%. Coil will not target below 115%.</p>
            </div>
            <div>
              <p className="text-[11px] tracking-[0.16em] text-foreground/80 uppercase">Redemptions</p>
              <p className="mt-2 leading-relaxed">
                Redemptions repay the lowest-ratio troves first. A tight coil sits at the front of that queue.
              </p>
            </div>
            <div>
              <p className="text-[11px] tracking-[0.16em] text-foreground/80 uppercase">Transactions</p>
              <p className="mt-2 leading-relaxed">
                A big de-lever or a full unwind can take more than one transaction. Mezo allows 20 precompile
                calls per transaction, so Coil sells collateral once per call and continues.
              </p>
            </div>
          </div>
          <p className="mt-8 text-xs leading-relaxed">
            Built by{" "}
            <a className="link text-foreground" href="https://prabal.pro" target="_blank" rel="noreferrer noopener">
              Prabal Pratap Singh
            </a>{" "}
            (
            <a
              className="link"
              href="https://github.com/PrabalParihar"
              target="_blank"
              rel="noreferrer noopener"
            >
              PrabalParihar
            </a>
            ) for Mezo Buildathon Wave 1. Factory{" "}
            <a
              className="link font-mono text-foreground"
              href={`https://explorer.test.mezo.org/address/${factoryAddress}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              {shorten(factoryAddress)}
            </a>{" "}
            on chain 31611.
          </p>
        </footer>
      </div>
    </div>
  );
}

function OpenPosition({
  position,
  deleverPct,
  setDeleverPct,
  unwindPct,
  setUnwindPct,
  busy,
  onDelever,
  onUnwind,
}: {
  position: Position;
  deleverPct: number;
  setDeleverPct: (value: number) => void;
  unwindPct: number;
  setUnwindPct: (value: number) => void;
  busy: boolean;
  onDelever: () => void;
  onUnwind: () => void;
}) {
  const ratio = Number((position.cr * 10000n) / 10n ** 18n) / 100;
  const leverage = leverageNumber(position.cr);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <TweenValue
            canonical={formatPercent(position.cr)}
            numeric={ratio}
            digits={2}
            suffix="%"
            className="font-serif text-4xl leading-none tracking-tight sm:text-5xl"
          />
          <p className="mt-2 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Collateral ratio</p>
        </div>
        <div className="text-right">
          <TweenValue
            canonical={leverageLabel(position.cr)}
            numeric={leverage}
            digits={2}
            suffix="×"
            className="font-serif text-4xl leading-none tracking-tight sm:text-5xl"
          />
          <p className="mt-2 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">Leverage</p>
        </div>
      </div>
      <HealthFilament percent={ratio} />
      <dl className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Stat label="Collateral">
          <TweenValue canonical={`${formatBtc(position.collateral)} BTC`} numeric={wadNumber(position.collateral, 4)} digits={4} suffix=" BTC" />
        </Stat>
        <Stat label="Debt">
          <TweenValue canonical={`${formatMusd(position.debt)} MUSD`} numeric={wadNumber(position.debt, 2)} digits={2} suffix=" MUSD" />
        </Stat>
        <Stat label="Liquidation price">
          <TweenValue
            canonical={formatUsd(position.liquidationPrice)}
            numeric={wadNumber(position.liquidationPrice, 0)}
            digits={0}
            prefix="$"
          />
        </Stat>
        <Stat label="Redemption rank">{rankLabel(position.redemptionRank)}</Stat>
      </dl>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {redemptionNote(position.redemptionRank, position.cr)} Liquidation can take the trove if BTC trades
        through {formatUsd(position.liquidationPrice)}.
      </p>
      <div className="space-y-3 border-t border-border pt-5">
        <Rail
          label="Raise the ratio"
          thumbLabel="De-lever target ratio"
          min={130}
          max={400}
          step={10}
          value={deleverPct}
          onValueChange={setDeleverPct}
          ticks={[130, 200, 300, 400]}
          display={
            <span className="font-serif text-3xl leading-none tabular-nums">{deleverPct}%</span>
          }
        />
        <Button
          type="button"
          variant="secondary"
          className="h-12 w-full px-6"
          disabled={busy || percentToCr(deleverPct) <= position.cr}
          onClick={onDelever}
        >
          De-lever to {deleverPct}%
        </Button>
      </div>
      <div className="space-y-3 border-t border-border pt-5">
        <Rail
          label="Unwind"
          thumbLabel="Unwind fraction"
          min={10}
          max={100}
          step={10}
          value={unwindPct}
          onValueChange={setUnwindPct}
          ticks={[10, 50, 100]}
          display={
            <span className="font-serif text-2xl leading-none">
              {unwindPct === 100 ? "Close trove" : `${unwindPct}% of debt`}
            </span>
          }
        />
        <Button
          type="button"
          variant="outline"
          className="h-12 w-full px-6"
          disabled={busy}
          onClick={onUnwind}
        >
          {unwindPct === 100 ? "Unwind and close" : "Unwind"}
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-1.5 font-serif text-xl leading-none">{children}</dd>
    </div>
  );
}

function wadNumber(value: bigint, digits: number) {
  const quant = 10n ** BigInt(digits);
  return Number((value * quant) / 10n ** 18n) / 10 ** digits;
}

function leverageNumber(cr: bigint) {
  const wad = 10n ** 18n;
  if (cr <= wad) return 0;
  return Number((cr * 100n) / (cr - wad)) / 100;
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
