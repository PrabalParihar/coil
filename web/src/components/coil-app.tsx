"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePassportConnect } from "@/app/providers";
import { parseEther } from "viem";
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { AnimatePresence, motion } from "motion/react";
import { Bitcoin, Check, Lock, Plug, ShieldCheck, Wallet } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ZERO,
  coilAccountAbi,
  coilFactoryAbi,
  factoryAddress,
  addr,
  borrowerAbi,
  erc20Abi,
  factoryFeeAbi,
  mezoTestnet,
  poolAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  troveManagerAbi,
  type Position,
} from "@/lib/mezo";
import {
  QuoteError,
  crToPercent,
  formatBtc,
  formatMusd,
  formatPercent,
  formatUsd,
  icrFromNominal,
  leverageLabel,
  nominalIcr,
  percentToCr,
  poolReserves,
  quoteFlashLoop,
  quoteLoop,
  type Market,
} from "@/lib/quote";
import {
  Activity,
  Banner,
  ChipGroup,
  CoilMark,
  CrGauge,
  EXPLORER_ADDRESS,
  EmptyState,
  HealthBar,
  NumberField,
  RatioSlider,
  ReviewRow,
  RiskPill,
  TweenValue,
  activityScope,
  dropToLiquidation,
  leverageFromPercent,
  riskOf,
  shorten,
  useCoilMotion,
  useMotionOk,
  type TxLink,
} from "@/components/shell";
import { Footer, HowItWorks, Hero, Proof, Risks, Ticker } from "@/components/landing";

const WAD = 10n ** 18n;
const PRESETS = ["0.01", "0.025", "0.04", "0.05"] as const;
const SLIPPAGE = [50, 100, 150, 200] as const;
const RESCUE_SLIPPAGE = [50, 100, 150, 200, 300] as const;

export function CoilApp() {
  const [mounted, setMounted] = useState(false);
  const [btcText, setBtcText] = useState("0.04");
  const [targetPct, setTargetPct] = useState(200);
  const [deleverPct, setDeleverPct] = useState(300);
  const [slippageBps, setSlippageBps] = useState(100);
  const [rescueBps, setRescueBps] = useState(200);
  const [rescueDirty, setRescueDirty] = useState(false);
  const [unwindPct, setUnwindPct] = useState(100);
  const [floorPct, setFloorPct] = useState(170);
  const [guardPct, setGuardPct] = useState(220);
  const [zone, setZone] = useState(8);
  const [tipText, setTipText] = useState("5");
  const [tail, setTail] = useState<bigint[]>([]);
  const [market, setMarket] = useState<Market | null>(null);
  const [marketError, setMarketError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [txError, setTxError] = useState<string | null>(null);
  const [txs, setTxs] = useState<TxLink[]>([]);
  const [busy, setBusy] = useState(false);

  const { address, isConnected, chainId: walletChainId } = useAccount();
  const configChainId = useChainId();
  // wagmi's useChainId() falls back to a configured chain when the wallet sits on an
  // unsupported one, so prefer the wallet's real chain for the wrong-network check.
  const chainId = walletChainId ?? configChainId;
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect();
  const openPassport = usePassportConnect();
  const { switchChainAsync } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: mezoTestnet.id });
  const { writeContractAsync } = useWriteContract();
  const { data: balance } = useBalance({
    address,
    chainId: mezoTestnet.id,
    query: { enabled: Boolean(address), refetchInterval: 20_000 },
  });

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

  const { data: implementation } = useReadContract({
    address: factoryAddress,
    abi: coilFactoryAbi,
    functionName: "implementation",
  });
  const { data: budget, isError: budgetMissing } = useReadContract({
    address: implementation,
    abi: coilAccountAbi,
    functionName: "precompileBudget",
    query: { enabled: Boolean(implementation), retry: false },
  });
  const flashFactory = Boolean(implementation) && Boolean(budget) && !budgetMissing;

  const preview = useMemo(() => {
    if (!market) return { kind: "loading" as const };
    if (collateral === null) return { kind: "error" as const, message: "Enter a BTC amount." };
    try {
      const target = percentToCr(targetPct);
      const quote = flashFactory
        ? quoteFlashLoop(collateral, target, BigInt(slippageBps), market)
        : { ...quoteLoop(collateral, target, BigInt(slippageBps), market), flashBtc: 0n, poolFeeMusd: 0n };
      return { kind: "ok" as const, quote };
    } catch (error) {
      const message = error instanceof QuoteError ? error.message : "Preview failed.";
      return { kind: "error" as const, message };
    }
  }, [market, collateral, targetPct, slippageBps, flashFactory]);

  const redemption = useMemo(() => {
    if (preview.kind !== "ok" || tail.length === 0 || !market) return null;
    const ours = nominalIcr(preview.quote.collateral, preview.quote.debt);
    let lower = 0;
    for (const nicr of tail) if (nicr < ours) lower += 1;
    const rank = lower >= tail.length && tail.length >= 32 ? 33 : lower + 1;
    const edge = zone > 0 && tail.length >= zone ? tail[zone - 1]! : 0n;
    const inside = edge > 0n && ours <= edge && rank !== 0 && rank <= zone;
    const suggested =
      inside && edge > 0n ? Number((icrFromNominal(edge, market.price) * 10000n) / WAD) / 100 + 0.5 : null;
    return { rank, inside, suggested };
  }, [preview, tail, zone, market]);

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

  const { data: tipBalanceRaw } = useReadContract({
    address: account,
    abi: coilAccountAbi,
    functionName: "tipBalance",
    query: { enabled: Boolean(account && flashFactory), refetchInterval: 20_000 },
  });
  const tipBalance = typeof tipBalanceRaw === "bigint" ? tipBalanceRaw : undefined;

  const { data: rescueRaw, refetch: refetchRescue } = useReadContract({
    address: account,
    abi: coilAccountAbi,
    functionName: "rescueSlippageBps",
    query: { enabled: Boolean(account), refetchInterval: 15_000 },
  });
  const separateRescue = typeof rescueRaw === "bigint" || typeof rescueRaw === "number";

  useEffect(() => {
    setRescueDirty(false);
  }, [account]);

  useEffect(() => {
    if (rescueDirty || !account) return;
    if (separateRescue) {
      setRescueBps(Number(rescueRaw));
      return;
    }
    if (position?.slippageBps) setRescueBps(Number(position.slippageBps));
  }, [account, rescueDirty, separateRescue, rescueRaw, position?.slippageBps]);

  useEffect(() => {
    let cancelled = false;
    async function loadTail() {
      if (!publicClient) return;
      try {
        const nicrs: bigint[] = [];
        let cur = await publicClient.readContract({
          address: addr.sortedTroves,
          abi: sortedTrovesAbi,
          functionName: "getLast",
        });
        for (let i = 0; i < 32 && cur && cur !== ZERO; i++) {
          nicrs.push(
            await publicClient.readContract({
              address: addr.troveManager,
              abi: troveManagerAbi,
              functionName: "getNominalICR",
              args: [cur],
            }),
          );
          cur = await publicClient.readContract({
            address: addr.sortedTroves,
            abi: sortedTrovesAbi,
            functionName: "getPrev",
            args: [cur],
          });
        }
        if (!cancelled) setTail(nicrs);
      } catch {
        if (!cancelled) setTail([]);
      }
    }
    loadTail();
    const timer = setInterval(loadTail, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [publicClient]);

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
    const steps = flashFactory ? 1 : 4;
    try {
      for (let step = 1; step <= steps; step++) {
        const pos = await readPos(clone);
        if (!pos.active || pos.cr >= target) break;
        const beforeDebt = pos.debt;
        try {
          await send(flashFactory ? `De-lever to ${deleverPct}%` : `De-lever ${step} of the way to ${deleverPct}%`, () =>
            writeContractAsync({
              address: clone,
              abi: coilAccountAbi,
              functionName: flashFactory ? "flashDeleverTo" : "deleverTo",
              args: [target],
              chainId: mezoTestnet.id,
              gas: 6_000_000n,
            }),
          );
        } catch (error) {
          if (alreadyThere(error)) break;
          throw error;
        }
        const mid = await readPos(clone);
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
    const steps = flashFactory ? 1 : 4;
    try {
      const start = await readPos(clone);
      const goal =
        unwindPct === 100 ? 0n : start.debt - ((start.debt - 200n * WAD) * BigInt(unwindPct)) / 100n;
      for (let step = 1; step <= steps; step++) {
        const pos = await readPos(clone);
        if (!pos.active) break;
        if (unwindPct < 100 && pos.debt <= goal) break;
        const before = pos.debt;
        await send(
          unwindPct === 100 ? (flashFactory ? "Unwind and close" : `Unwind ${step}: closing the trove`) : flashFactory ? "Unwind" : `Unwind ${step}: repaying debt`,
          () =>
            writeContractAsync({
              address: clone,
              abi: coilAccountAbi,
              functionName: flashFactory ? "flashUnwind" : "unwind",
              args: [fraction],
              chainId: mezoTestnet.id,
              gas: 6_000_000n,
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
    if (openPassport) {
      openPassport();
      return;
    }
    const connector = connectors[0];
    if (connector) connect({ connector });
  }

  function createAccount() {
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
  }

  function doLoop() {
    if (!account || collateral === null) return;
    begin();
    send(`Loop to ${targetPct}%`, () =>
      writeContractAsync({
        address: account,
        abi: coilAccountAbi,
        functionName: flashFactory ? "flashLoop" : "loop",
        args: [targetCR, BigInt(slippageBps)],
        value: collateral,
        chainId: mezoTestnet.id,
        gas: 8_000_000n,
      }),
    )
      .then(() => setStatus("Loop confirmed."))
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function setGuard() {
    if (!account) return;
    begin();
    let tip = 0n;
    try {
      tip = parseEther(tipText || "0");
    } catch {
      fail(new Error("Enter a MEZO tip amount."));
      setBusy(false);
      return;
    }
    send("Set guard", () =>
      writeContractAsync({
        address: account,
        abi: coilAccountAbi,
        functionName: "setGuard",
        args: flashFactory
          ? [percentToCr(floorPct), percentToCr(guardPct), zone, tip]
          : [percentToCr(floorPct), percentToCr(guardPct), zone],
        chainId: mezoTestnet.id,
        gas: 300_000n,
      }),
    )
      .then(() => setStatus("Guard saved."))
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function saveRescueSlippage() {
    if (!account) return;
    begin();
    const label = separateRescue ? "Set rescue slippage" : "Set slippage";
    send(label, () =>
      writeContractAsync({
        address: account,
        abi: coilAccountAbi,
        functionName: separateRescue ? "setRescueSlippage" : "setSlippage",
        args: [rescueBps],
        chainId: mezoTestnet.id,
        gas: 200_000n,
      }),
    )
      .then(() => {
        setRescueDirty(false);
        setStatus(separateRescue ? "Rescue slippage saved." : "Slippage saved. Rescues and closes use this cap.");
        void refetchPosition();
        void refetchRescue();
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function fundTips() {
    if (!account) return;
    let amount = 0n;
    try {
      amount = parseEther(tipText || "0");
    } catch {
      fail(new Error("Enter a MEZO tip amount."));
      return;
    }
    if (amount === 0n) return;
    begin();
    send("Approve MEZO", () =>
      writeContractAsync({
        address: addr.mezo,
        abi: erc20Abi,
        functionName: "approve",
        args: [account, amount],
        chainId: mezoTestnet.id,
        gas: 200_000n,
      }),
    )
      .then(() =>
        send("Fund MEZO tip", () =>
          writeContractAsync({
            address: account,
            abi: coilAccountAbi,
            functionName: "fundTips",
            args: [amount],
            chainId: mezoTestnet.id,
            gas: 250_000n,
          }),
        ),
      )
      .then(() => setStatus("MEZO tip funded. A caller earns it only when guard() raises the ratio."))
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function dismissActivity() {
    setStatus(null);
    setTxError(null);
    setTxs([]);
  }

  const wrongChain = mounted && isConnected && chainId !== mezoTestnet.id;
  const targetCR = percentToCr(targetPct);
  const scope = activityScope(status, txs, txError);
  const errorText = txError ? shortError(txError) : null;
  const connected = mounted && isConnected;
  const positionKey = !factoryAddress
    ? "preview"
    : !connected
      ? "connect"
      : !account
        ? "account"
        : !position?.active
          ? "closed"
          : "open";

  const loopReady =
    !busy && Boolean(factoryAddress) && Boolean(account) && preview.kind === "ok" && collateral !== null && collateral !== 0n;
  const primary: { label: string; onClick?: () => void; disabled: boolean; icon?: React.ReactNode } = !mounted
    ? { label: "Connect wallet", disabled: true, icon: <Wallet className="size-4" aria-hidden /> }
    : !isConnected
      ? { label: connecting ? "Connecting…" : "Connect wallet", onClick: connectWallet, disabled: connecting, icon: <Wallet className="size-4" aria-hidden /> }
      : wrongChain
        ? { label: "Switch to Mezo testnet", onClick: () => void switchChainAsync({ chainId: mezoTestnet.id }).catch(fail), disabled: false, icon: <Plug className="size-4" aria-hidden /> }
        : !factoryAddress
          ? { label: "Deploy to enable", disabled: true }
          : !account
            ? { label: busy ? "Creating account…" : "Create your Coil account", onClick: createAccount, disabled: busy }
            : { label: busy ? "Working…" : `Loop to ${targetPct}% · ${leverageLabel(targetCR)}`, onClick: doLoop, disabled: !loopReady, icon: <Lock className="size-4" aria-hidden /> };

  const setup = [
    { label: "Wallet", done: connected },
    { label: "Mezo testnet", done: connected && !wrongChain },
    { label: "Coil account", done: Boolean(account) },
    { label: "Loop", done: Boolean(position?.active) },
  ];
  const currentPrice = market ? formatUsd(market.price) : null;

  return (
    <div className="relative min-h-screen overflow-x-clip">
      <div className="atmosphere pointer-events-none fixed inset-0 -z-10" aria-hidden />
      <div className="grain pointer-events-none fixed inset-0 -z-10" aria-hidden />
      <a
        href="#app"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-filament focus:px-4 focus:py-2 focus:text-ink"
      >
        Skip to the app
      </a>

      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="relative mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <a href="#" className="flex items-center gap-2.5" aria-label="Coil Labs home">
            <CoilMark className="size-8" />
            <span className="text-lg font-semibold tracking-tight">Coil Labs</span>
            <span className="hidden rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
              testnet
            </span>
          </a>
          <nav aria-label="Primary" className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a className="hover:text-foreground" href="#how">How it works</a>
            <a className="hover:text-foreground" href="#app">App</a>
            <Link className="hover:text-foreground" href="/guard">Guard log</Link>
            <a className="hover:text-foreground" href="#proof">Receipts</a>
            <a className="hover:text-foreground" href="#risks">Risks</a>
          </nav>
          <div className="flex items-center gap-2">
            <p className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs text-muted-foreground lg:flex">
              <Bitcoin className="size-3.5 text-filament" aria-hidden />
              {market ? (
                <TweenValue
                  canonical={formatUsd(market.price)}
                  numeric={Number(market.price / 10n ** 18n)}
                  digits={0}
                  prefix="$"
                  className="font-mono text-foreground"
                />
              ) : (
                <span className="font-mono text-foreground/70">reading…</span>
              )}
            </p>
            {wrongChain ? (
              <button
                type="button"
                onClick={() => switchChainAsync({ chainId: mezoTestnet.id }).catch(fail)}
                className="rounded-full border border-danger/50 bg-danger/10 px-3 py-1.5 font-mono text-[11px] text-danger hover:bg-danger/20"
              >
                Wrong network · switch
              </button>
            ) : (
              <span className="hidden items-center gap-1.5 rounded-full border border-border px-3 py-1.5 font-mono text-[11px] text-muted-foreground sm:flex">
                <span className="size-1.5 rounded-full bg-safe" aria-hidden />
                Mezo 31611
              </span>
            )}
            {connected ? (
              <span className="flex h-9 items-center gap-2 rounded-full border border-border bg-foreground/5 px-3 font-mono text-xs">
                <span className="size-1.5 rounded-full bg-safe" aria-hidden />
                {shorten(address)}
              </span>
            ) : (
              <Button
                type="button"
                className="btn-btc h-9 rounded-full px-4 font-semibold"
                disabled={!mounted || connecting}
                onClick={connectWallet}
              >
                {connecting ? "Connecting…" : "Connect"}
              </Button>
            )}
          </div>
          {busy ? <div className="busy-bar" aria-hidden /> : null}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 sm:px-6 lg:px-8">
        <main aria-busy={busy}>
          <Hero market={market} marketError={marketError} />
          <Ticker />
          <HowItWorks />

          <section id="app" aria-labelledby="app-title" className="scroll-mt-20 py-16">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div>
                <p className="eyebrow text-filament">The desk</p>
                <h2 id="app-title" className="mt-3 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
                  Open a coil
                </h2>
              </div>
              <ol className="flex flex-wrap items-center gap-1.5" aria-label="Setup progress">
                {setup.map((step, i) => (
                  <li key={step.label} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "chip",
                        step.done ? "border-safe/40 text-safe" : "text-muted-foreground",
                      )}
                    >
                      {step.done ? <Check className="size-3" aria-hidden /> : <span className="font-mono text-[10px]">{i + 1}</span>}
                      {step.label}
                    </span>
                    {i < setup.length - 1 ? <span className="h-px w-3 bg-border" aria-hidden /> : null}
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-6 space-y-3">
              {marketError ? (
                <Banner tone="bad" title="Could not read Mezo testnet">
                  {shortError(marketError)} The preview retries every 20 seconds.
                </Banner>
              ) : null}
              {wrongChain ? (
                <Banner
                  tone="warn"
                  title="Your wallet is on another network"
                  action={
                    <Button
                      type="button"
                      className="btn-btc h-10 rounded-full px-5 font-semibold"
                      onClick={() => switchChainAsync({ chainId: mezoTestnet.id }).catch(fail)}
                    >
                      Switch to Mezo testnet
                    </Button>
                  }
                >
                  Coil Labs sends transactions on Mezo testnet (chain 31611). Bitcoin wallets connect through Mezo Passport.
                </Banner>
              ) : null}
              {connectError && !isConnected ? (
                <Banner tone="info" title="No wallet connected">
                  {/provider|not found|ethereum/i.test(connectError.message)
                    ? "No browser wallet was found. Install MetaMask or another injected wallet, add Mezo testnet, and try again."
                    : shortError(connectError.message)}
                </Banner>
              ) : null}
            </div>

            <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
              {/* Composer */}
              <section className="panel p-5 sm:p-7" aria-labelledby="compose-title">
                <h3 id="compose-title" className="sr-only">Compose</h3>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="btc" className="eyebrow">You deposit</Label>
                    {connected && balance ? (
                      <span className="font-mono text-[11px] text-muted-foreground">
                        Wallet <span className="text-foreground">{formatBtc(balance.value)}</span> BTC
                      </span>
                    ) : (
                      <a className="font-mono text-[11px] text-muted-foreground hover:text-foreground" href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer noopener">
                        Get test BTC ↗
                      </a>
                    )}
                  </div>
                  <div className="well flex items-center gap-3 px-4 py-3 focus-within:border-filament/60">
                    <Input
                      id="btc"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={btcText}
                      onChange={(event) => setBtcText(event.target.value)}
                      aria-describedby="btc-usd"
                      className="h-14 border-0 bg-transparent px-0 font-mono text-4xl font-medium tracking-tight shadow-none focus-visible:ring-0 md:text-4xl dark:bg-transparent"
                    />
                    <span className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-foreground/5 py-1.5 pr-3 pl-1.5 text-sm font-semibold">
                      <span className="flex size-6 items-center justify-center rounded-full bg-filament text-ink">
                        <Bitcoin className="size-4" aria-hidden />
                      </span>
                      BTC
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <ChipGroup label="Deposit presets" options={PRESETS} value={btcText as (typeof PRESETS)[number]} onChange={setBtcText} render={(v) => `${v}`} />
                    <p id="btc-usd" className="font-mono text-[11px] text-muted-foreground">
                      {market && collateral ? `≈ ${formatUsd((collateral * market.price) / WAD)}` : "\u00a0"}
                    </p>
                  </div>
                </div>

                <div className="mt-8">
                  <RatioSlider
                    label="Target collateral ratio"
                    thumbLabel="Target collateral ratio"
                    min={115}
                    max={350}
                    step={5}
                    value={targetPct}
                    onValueChange={setTargetPct}
                    ticks={[115, 150, 200, 300, 350]}
                    display={
                      <div className="flex items-end gap-4 text-right">
                        <div>
                          <TweenValue canonical={`${targetPct}%`} numeric={targetPct} digits={0} suffix="%" className={cn("num block text-4xl font-semibold tracking-tight", riskOf(targetPct).tone)} />
                        </div>
                        <div className="pb-1">
                          <p className="num text-lg font-medium">{leverageLabel(targetCR)}</p>
                          <p className="text-[10px] text-muted-foreground">leverage</p>
                        </div>
                      </div>
                    }
                    hint={
                      <span className="flex flex-wrap items-center gap-2">
                        <RiskPill percent={targetPct} />
                        <span>
                          Liquidation is 110%. Coil will not target below 115%. Lower ratios are redeemed first.
                        </span>
                      </span>
                    }
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-[11px] text-muted-foreground">Leverage</span>
                    {([
                      ["4×", 133.33],
                      ["3×", 150],
                      ["2×", 200],
                    ] as const).map(([label, pct]) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => setTargetPct(pct)}
                        className={cn(
                          "rounded-full border px-3 py-1 font-mono text-xs",
                          Math.abs(targetPct - pct) < 0.2 ? "border-filament text-filament" : "border-border text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">Open slippage</p>
                    <p className="mt-1 text-xs text-muted-foreground">Default 1%. Rescue and close use a separate cap.</p>
                  </div>
                  <ChipGroup label="Open slippage" options={SLIPPAGE} value={slippageBps as (typeof SLIPPAGE)[number]} onChange={setSlippageBps} render={(v) => `${(v / 100).toFixed(2)}%`} />
                </div>

                <div className="mt-8 grid gap-3 border-t border-border pt-6 sm:grid-cols-3">
                  {[
                    ["01", "Borrow MUSD", "against your BTC"],
                    ["02", "Buy BTC", "on Mezo Pools"],
                    ["03", "Post it back", flashFactory ? "one flash swap" : "stop at your ratio"],
                  ].map(([n, t, s]) => (
                    <div key={n} className="flex items-start gap-3">
                      <span className="font-mono text-[11px] text-filament">{n}</span>
                      <div>
                        <p className="text-sm font-medium">{t}</p>
                        <p className="text-xs text-muted-foreground">{s}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              {/* Review */}
              <section className="panel panel-glow p-5 sm:p-7 lg:sticky lg:top-20" aria-labelledby="review-title">
                <div className="flex items-center justify-between gap-3">
                  <h3 id="review-title" className="text-lg font-semibold tracking-tight">Review before you sign</h3>
                  {preview.kind === "ok" ? <RiskPill percent={crToPercent(preview.quote.cr)} /> : null}
                </div>
                <ReviewCard preview={preview} deposit={collateral} currentPrice={currentPrice} redemption={redemption} zone={zone} flash={flashFactory} />

                <div className="mt-5 space-y-2">
                  <p className="eyebrow">Transactions</p>
                  <ol className="space-y-1.5 text-sm">
                    {!account ? (
                      <li className="flex items-center gap-2.5">
                        <span className={cn("flex size-5 items-center justify-center rounded-full border font-mono text-[10px]", "border-filament/60 text-filament")}>1</span>
                        Create your Coil account <span className="text-muted-foreground">· once per wallet</span>
                      </li>
                    ) : (
                      <li className="flex items-center gap-2.5 text-muted-foreground">
                        <span className="flex size-5 items-center justify-center rounded-full bg-safe text-ink"><Check className="size-3" aria-hidden /></span>
                        Coil account <a className="link font-mono text-foreground" href={`${EXPLORER_ADDRESS}${account}`} target="_blank" rel="noreferrer noopener">{shorten(account)}</a>
                      </li>
                    )}
                    <li className="flex items-center gap-2.5">
                      <span className="flex size-5 items-center justify-center rounded-full border border-filament/60 font-mono text-[10px] text-filament">{account ? 1 : 2}</span>
                      {flashFactory ? "Flash loop · one pool swap" : "Loop · two swaps on this factory"} <span className="text-muted-foreground">· one transaction</span>
                    </li>
                  </ol>
                </div>

                <Button
                  type="button"
                  className={cn("mt-6 h-13 w-full rounded-2xl text-[15px] font-semibold", primary.disabled ? "" : "btn-btc")}
                  variant={primary.disabled ? "secondary" : "default"}
                  disabled={primary.disabled}
                  onClick={primary.onClick}
                >
                  {primary.icon}
                  {primary.label}
                </Button>
                <p className="mt-3 text-center text-[11px] text-muted-foreground">
                  Your wallet shows the exact call before anything is sent. The clone stays yours: only your wallet can loop or unwind.
                </p>

                {scope === "compose" ? (
                  <Activity
                    status={status}
                    txs={txs}
                    error={errorText}
                    busy={busy}
                    deleverPct={deleverPct}
                    unwindPct={unwindPct}
                    onDismiss={dismissActivity}
                  />
                ) : null}
              </section>
            </div>

            {/* Position */}
            <section id="position" className="panel mt-5 scroll-mt-20 p-5 sm:p-7" aria-labelledby="position-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="eyebrow text-filament">Position</p>
                  <h3 id="position-title" className="mt-2 text-2xl font-semibold tracking-tight">Your trove</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {account ? (
                      <>
                        Clone{" "}
                        <a className="link font-mono text-foreground" href={`${EXPLORER_ADDRESS}${account}`} target="_blank" rel="noreferrer noopener">
                          {shorten(account)}
                        </a>{" "}
                        · the clone is the borrower
                      </>
                    ) : (
                      "Each wallet gets one clone. The clone is the borrower."
                    )}
                  </p>
                </div>
                {position?.active ? (
                  <span className="chip border-safe/40 text-safe">
                    <span className="size-1.5 rounded-full bg-safe" aria-hidden /> Open · refreshes every 15s
                  </span>
                ) : account ? (
                  <span className="chip text-muted-foreground">Closed</span>
                ) : null}
              </div>

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={positionKey}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: motionOk ? 0.35 : 0, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-6"
                >
                  {!factoryAddress ? (
                    <EmptyState title="Nothing on-chain yet" body="The preview uses live Mezo state. After a testnet deploy, this card shows the trove the clone owns." />
                  ) : !connected ? (
                    <div className="grid items-center gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                      <div className="well px-4 py-6 opacity-70">
                        <CrGauge percent={110} empty label="—" sub="collateral ratio" />
                      </div>
                      <EmptyState
                        icon={<Wallet className="mb-4 size-10 text-filament" strokeWidth={1.5} aria-hidden />}
                        title="Connect to see your trove"
                        body={<>Use any injected wallet on Mezo testnet. Test BTC comes from <a className="link" href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer noopener">faucet.test.mezo.org</a>.</>}
                        action={mounted ? { label: connecting ? "Connecting…" : "Connect wallet", onClick: connectWallet, disabled: connecting } : undefined}
                      />
                    </div>
                  ) : !account ? (
                    <EmptyState
                      title="No Coil account yet"
                      body="Create one. It is a minimal proxy that owns your trove. Your wallet can always unwind, and the keeper cannot take funds."
                      action={wrongChain ? undefined : { label: busy ? "Creating…" : "Create your Coil account", onClick: createAccount, disabled: busy }}
                    />
                  ) : !position?.active ? (
                    <div className="grid gap-5 md:grid-cols-2">
                      <EmptyState
                        title="Account ready, trove closed"
                        body="Pick an amount and a ratio above, then loop. The resulting debt has to clear the 1,800 MUSD minimum."
                        action={{ label: "Go to the desk", onClick: () => document.getElementById("app")?.scrollIntoView({ behavior: motionOk ? "smooth" : "auto" }) }}
                      />
                      <GuardPanel
                        floorPct={floorPct}
                        setFloorPct={setFloorPct}
                        guardPct={guardPct}
                        setGuardPct={setGuardPct}
                        zone={zone}
                        setZone={setZone}
                        busy={busy}
                        disabled={!account}
                        onSave={setGuard}
                        onFund={fundTips}
                        position={position}
                        flash={flashFactory}
                        tipText={tipText}
                        setTipText={setTipText}
                        tipBalance={tipBalance}
                        rescueBps={rescueBps}
                        separateRescue={separateRescue}
                        onRescueBps={(v) => {
                          setRescueDirty(true);
                          setRescueBps(v);
                        }}
                        onSaveRescue={saveRescueSlippage}
                      />
                    </div>
                  ) : (
                    <OpenPosition
                      position={position}
                      market={market}
                      deleverPct={deleverPct}
                      setDeleverPct={setDeleverPct}
                      unwindPct={unwindPct}
                      setUnwindPct={setUnwindPct}
                      busy={busy}
                      onDelever={() => account && delever(account)}
                      onUnwind={() => account && unwind(account)}
                      flash={flashFactory}
                      guard={
                        <GuardPanel
                          floorPct={floorPct}
                          setFloorPct={setFloorPct}
                          guardPct={guardPct}
                          setGuardPct={setGuardPct}
                          zone={zone}
                          setZone={setZone}
                          busy={busy}
                          disabled={!account}
                          onSave={setGuard}
                          onFund={fundTips}
                          position={position}
                          flash={flashFactory}
                          tipText={tipText}
                          setTipText={setTipText}
                          tipBalance={tipBalance}
                          rescueBps={rescueBps}
                          separateRescue={separateRescue}
                          onRescueBps={(v) => {
                            setRescueDirty(true);
                            setRescueBps(v);
                          }}
                          onSaveRescue={saveRescueSlippage}
                          bare
                        />
                      }
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
                  onDismiss={dismissActivity}
                />
              ) : null}
            </section>
          </section>

          <Proof />
          <Risks />
        </main>
        <Footer />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

type PreviewQuote = ReturnType<typeof quoteLoop> & { flashBtc?: bigint; poolFeeMusd?: bigint };
type PreviewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; quote: PreviewQuote };

function ReviewCard({
  preview,
  deposit,
  currentPrice,
  redemption,
  zone,
  flash,
}: {
  preview: PreviewState;
  deposit: bigint | null;
  currentPrice: string | null;
  redemption: { rank: number; inside: boolean; suggested: number | null } | null;
  zone: number;
  flash: boolean;
}) {
  if (preview.kind === "loading") {
    return (
      <div className="mt-5 space-y-3" aria-busy="true">
        <p className="text-sm text-muted-foreground">Reading the Mezo oracle and the MUSD/BTC pool…</p>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex justify-between">
            <div className="skeleton h-4 w-28 rounded" />
            <div className="skeleton h-4 w-36 rounded" />
          </div>
        ))}
        <div className="skeleton h-2 w-full rounded-full" />
      </div>
    );
  }
  if (preview.kind === "error") {
    return (
      <div className="mt-5 rounded-2xl border border-warn/35 bg-warn/10 px-4 py-4" role="alert">
        <p className="text-sm font-medium text-warn">This loop would not go through</p>
        <p className="mt-1 text-sm leading-relaxed text-foreground/90">{preview.message}</p>
      </div>
    );
  }
  const q = preview.quote;
  const ratio = crToPercent(q.cr);
  const risk = riskOf(ratio);
  const drop = dropToLiquidation(ratio);
  return (
    <div className="mt-5">
      <div className="well grid grid-cols-2 gap-4 px-4 py-4">
        <div>
          <p className="text-[11px] text-muted-foreground">You end with</p>
          <p className="num mt-1 text-2xl font-semibold text-filament">
            <TweenValue canonical={formatBtc(q.collateral)} numeric={wad(q.collateral, 4)} digits={4} /> <span className="text-base">BTC</span>
          </p>
          <p className="text-[11px] text-muted-foreground">as collateral</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">Leverage</p>
          <p className="num mt-1 text-2xl font-semibold">{q.leverage}</p>
          <p className="text-[11px] text-muted-foreground">BTC exposure</p>
        </div>
      </div>
      <dl className="mt-3 divide-y divide-border">
        <ReviewRow label="Collateral" before={deposit ? `${formatBtc(deposit)}` : "0"} after={`${formatBtc(q.collateral)} BTC`} />
        <ReviewRow label="Debt" before="0" after={<><TweenValue canonical={formatMusd(q.debt)} numeric={wad(q.debt, 2)} digits={2} /> MUSD</>} />
        <ReviewRow
          label="Collateral ratio"
          after={<TweenValue canonical={formatPercent(q.cr)} numeric={ratio} digits={2} suffix="%" />}
          emphasis
          tone={risk.tone}
        />
        <ReviewRow
          label="Liquidation price"
          after={
            <span>
              <TweenValue canonical={formatUsd(q.liquidationPrice)} numeric={wad(q.liquidationPrice, 0)} digits={0} prefix="$" />
              {currentPrice ? <span className="ml-1.5 text-xs text-muted-foreground">now {currentPrice}</span> : null}
            </span>
          }
        />
        <ReviewRow label="BTC can fall" after={`${drop.toFixed(1)}% before liquidation`} tone={risk.tone} />
        <ReviewRow
          label="Route"
          after={
            flash
              ? `${formatMusd(q.musdMinted, 0)} MUSD · flash ${formatBtc(q.flashBtc ?? 0n)} BTC · pool fee ${formatMusd(q.poolFeeMusd ?? 0n)} MUSD`
              : `${formatMusd(q.musdMinted, 0)} MUSD → BTC · ${q.iterations} ${q.iterations === 1 ? "swap" : "swaps"}`
          }
        />
        {redemption ? (
          <ReviewRow
            label="Redemption rank"
            after={redemption.rank > 32 ? "Outside 32" : `#${redemption.rank}`}
            tone={redemption.inside ? "text-danger" : undefined}
          />
        ) : null}
      </dl>
      <div className="mt-4">
        <HealthBar percent={ratio} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Liquidation risk: <span className={risk.tone}>{risk.word.toLowerCase()}</span>.{" "}
        {redemption?.inside ? (
          <span className="text-danger">
            This quote sits inside redemption zone {zone}
            {redemption.suggested ? ` (rank #${redemption.rank}). A ratio near ${redemption.suggested.toFixed(0)}% sits just outside that zone.` : "."}
          </span>
        ) : (
          <>
            Redemption risk {ratio < 150 ? <span className="text-danger">is higher at this ratio</span> : "falls as the ratio rises"}: MUSD redemptions repay the lowest-ratio troves first.
          </>
        )}
      </p>
    </div>
  );
}

function OpenPosition({
  position,
  market,
  deleverPct,
  setDeleverPct,
  unwindPct,
  setUnwindPct,
  busy,
  onDelever,
  onUnwind,
  guard,
  flash,
}: {
  position: Position;
  market: Market | null;
  deleverPct: number;
  setDeleverPct: (value: number) => void;
  unwindPct: number;
  setUnwindPct: (value: number) => void;
  busy: boolean;
  onDelever: () => void;
  onUnwind: () => void;
  guard: React.ReactNode;
  flash: boolean;
}) {
  const [tab, setTab] = useState<"delever" | "unwind" | "guard">("delever");
  const ratio = Number((position.cr * 10000n) / 10n ** 18n) / 100;
  const leverage = leverageNumber(position.cr);
  const risk = riskOf(ratio);
  const drop = dropToLiquidation(ratio);
  const valueUsd = market ? (position.collateral * market.price) / WAD : null;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="well flex flex-col items-center justify-center px-4 py-6">
        <CrGauge
          percent={ratio}
          label={<TweenValue canonical={formatPercent(position.cr)} numeric={ratio} digits={2} suffix="%" className={risk.tone} />}
          sub="collateral ratio"
        />
        <div className="mt-4 flex items-center gap-2">
          <RiskPill percent={ratio} />
          <span className="chip num">
            <TweenValue canonical={leverageLabel(position.cr)} numeric={leverage} digits={2} suffix="×" /> leverage
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-2 content-start gap-x-4 gap-y-5">
        <Stat label="Collateral" sub={valueUsd !== null ? `≈ ${formatUsd(valueUsd)}` : undefined}>
          <TweenValue canonical={`${formatBtc(position.collateral)} BTC`} numeric={wad(position.collateral, 4)} digits={4} suffix=" BTC" />
        </Stat>
        <Stat label="Debt">
          <TweenValue canonical={`${formatMusd(position.debt)} MUSD`} numeric={wad(position.debt, 2)} digits={2} suffix=" MUSD" />
        </Stat>
        <Stat label="Liquidation price" sub={market ? `now ${formatUsd(market.price)}` : undefined}>
          <TweenValue canonical={formatUsd(position.liquidationPrice)} numeric={wad(position.liquidationPrice, 0)} digits={0} prefix="$" />
        </Stat>
        <Stat label="BTC can fall" sub="before 110%">
          <span className={risk.tone}>{drop.toFixed(1)}%</span>
        </Stat>
        <Stat label="Redemption rank" sub={rankRisk(position.redemptionRank)}>
          {rankLabel(position.redemptionRank)}
        </Stat>
        <Stat label="Keeper guard" sub={position.guardTargetCR ? `zone ${position.redemptionZone}` : "keeper cannot act"}>
          {position.guardTargetCR ? `${formatPercent(position.floorCR)} → ${formatPercent(position.guardTargetCR)}` : "Off"}
        </Stat>
        <p className="col-span-2 text-xs leading-relaxed text-muted-foreground">
          {redemptionNote(position.redemptionRank, position.cr)} Liquidation can take the trove if BTC trades through{" "}
          {formatUsd(position.liquidationPrice)}.
        </p>
      </dl>

      <div className="well p-4 sm:p-5">
        <div role="tablist" aria-label="Position actions" className="grid grid-cols-3 gap-1 rounded-full bg-foreground/5 p-1">
          {(
            [
              ["delever", "De-lever"],
              ["unwind", "Unwind"],
              ["guard", "Guard"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "h-9 rounded-full text-sm font-medium transition-colors",
                tab === id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-5" role="tabpanel">
          {tab === "delever" ? (
            <div className="space-y-4">
              <RatioSlider
                label="Raise the ratio to"
                thumbLabel="De-lever target ratio"
                min={130}
                max={400}
                step={10}
                value={deleverPct}
                onValueChange={setDeleverPct}
                ticks={[130, 200, 300, 400]}
                display={<span className={cn("num text-3xl font-semibold", riskOf(deleverPct).tone)}>{deleverPct}%</span>}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                Sells some BTC for MUSD and repays, about {leverageFromPercent(deleverPct).toFixed(2)}× after.{" "}
                {flash ? "One flash swap covers the whole raise." : "On this factory, one sale per transaction."} Mezo keeps at least 1,800 MUSD of debt on an open trove.
              </p>
              <Button
                type="button"
                className={cn("h-12 w-full rounded-2xl font-semibold", percentToCr(deleverPct) > position.cr && !busy ? "btn-btc" : "")}
                variant={percentToCr(deleverPct) > position.cr && !busy ? "default" : "secondary"}
                disabled={busy || percentToCr(deleverPct) <= position.cr}
                onClick={onDelever}
              >
                <ShieldCheck className="size-4" aria-hidden />
                {percentToCr(deleverPct) <= position.cr ? `Already above ${deleverPct}%` : `De-lever to ${deleverPct}%`}
              </Button>
            </div>
          ) : tab === "unwind" ? (
            <div className="space-y-4">
              <RatioSlider
                label="Unwind"
                thumbLabel="Unwind fraction"
                min={10}
                max={100}
                step={10}
                value={unwindPct}
                onValueChange={setUnwindPct}
                ticks={[10, 50, 100]}
                zoned={false}
                display={<span className="num text-2xl font-semibold">{unwindPct === 100 ? "Close trove" : `${unwindPct}% of debt`}</span>}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {unwindPct === 100
                  ? flash
                    ? "One flash swap repays the debt, closes the trove, and returns leftover BTC to your wallet."
                    : "Sells collateral to repay everything and closes the trove. On this factory a full close can take more than one transaction."
                  : "Sells collateral to repay part of the debt, down toward the 2,000 MUSD floor."}
              </p>
              <Button type="button" variant="outline" className="h-12 w-full rounded-2xl font-semibold" disabled={busy} onClick={onUnwind}>
                {unwindPct === 100 ? "Unwind and close" : "Unwind"}
              </Button>
            </div>
          ) : (
            guard
          )}
        </div>
      </div>
    </div>
  );
}

function GuardPanel({
  floorPct,
  setFloorPct,
  guardPct,
  setGuardPct,
  zone,
  setZone,
  busy,
  disabled,
  onSave,
  onFund,
  position,
  flash = false,
  tipText = "5",
  setTipText,
  tipBalance,
  rescueBps = 200,
  separateRescue = false,
  onRescueBps,
  onSaveRescue,
  bare = false,
}: {
  floorPct: number;
  setFloorPct: (v: number) => void;
  guardPct: number;
  setGuardPct: (v: number) => void;
  zone: number;
  setZone: (v: number) => void;
  busy: boolean;
  disabled: boolean;
  onSave: () => void;
  onFund?: () => void;
  position?: Position;
  flash?: boolean;
  tipText?: string;
  setTipText?: (v: string) => void;
  tipBalance?: bigint;
  rescueBps?: number;
  separateRescue?: boolean;
  onRescueBps?: (v: number) => void;
  onSaveRescue?: () => void;
  bare?: boolean;
}) {
  const min = 110;
  const max = 350;
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100))}%`;
  return (
    <div className={cn(!bare && "well p-5")}>
      {!bare ? (
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck className="size-4 text-filament" aria-hidden />
          <p className="font-semibold">Keeper guard</p>
        </div>
      ) : null}
      <p className="text-xs leading-relaxed text-muted-foreground">
        If the ratio drops under the floor, or the trove enters the redemption zone, anyone may call <span className="font-mono text-foreground/90">guard()</span>.
        It can only raise the ratio. It cannot loop, unwind, or withdraw. {flash ? "The caller earns MEZO only when the ratio rises." : "MEZO tips ship with the Wave 2 factory."}
      </p>
      <div className="relative mt-5 h-10" aria-hidden>
        <div className="absolute inset-x-0 top-4 h-1.5 rounded-full opacity-60" style={{ background: "linear-gradient(90deg,var(--danger) 0%,var(--danger) 16.7%,var(--warn) 16.7%,var(--warn) 37.5%,var(--safe) 37.5%)" }} />
        <div className="absolute top-4 h-1.5 bg-foreground/80" style={{ left: at(floorPct), width: `calc(${at(guardPct)} - ${at(floorPct)})` }} />
        <span className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-danger" style={{ left: at(floorPct) }}>floor</span>
        <span className="absolute top-0 -translate-x-1/2 font-mono text-[10px] text-safe" style={{ left: at(guardPct) }}>target</span>
        <span className="absolute top-3 size-3.5 -translate-x-1/2 rounded-full border-2 border-background bg-danger" style={{ left: at(floorPct) }} />
        <span className="absolute top-3 size-3.5 -translate-x-1/2 rounded-full border-2 border-background bg-safe" style={{ left: at(guardPct) }} />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <NumberField id={bare ? "floor" : "floor-closed"} label="Floor" value={floorPct} onChange={setFloorPct} suffix="%" />
        <NumberField id={bare ? "guard-target" : "guard-target-closed"} label="De-lever to" value={guardPct} onChange={setGuardPct} suffix="%" />
        <NumberField id={bare ? "zone" : "zone-closed"} label="Zone" value={zone} onChange={setZone} />
      </div>
      {flash && setTipText ? (
        <div className="mt-3 space-y-2">
          <Label htmlFor={bare ? "tip" : "tip-closed"} className="eyebrow">MEZO tip</Label>
          <Input
            id={bare ? "tip" : "tip-closed"}
            inputMode="decimal"
            value={tipText}
            onChange={(event) => setTipText(event.target.value)}
            className="h-11 rounded-xl bg-black/25 font-mono md:text-sm dark:bg-black/25"
          />
          <p className="text-[11px] text-muted-foreground">
            Jar {tipBalance !== undefined ? `${formatMusd(tipBalance)} MEZO` : "—"}. Paid once per block, and only if the ratio rose.
          </p>
          <Button type="button" variant="outline" className="h-10 w-full rounded-2xl" disabled={busy || disabled} onClick={onFund}>
            Fund MEZO tip
          </Button>
        </div>
      ) : null}
      {onRescueBps && onSaveRescue ? (
        <div className="mt-4 space-y-2">
          <p className="eyebrow">Rescue and close slippage</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {separateRescue
              ? "Separate from the open. Default 2%, hard cap 3%. The keeper cannot change it. A rescue reverts if the pool is worse than this against the oracle."
              : "This account uses one cap for open, rescue, and close. Raise it when the pool sits under the oracle. Hard cap 3%. The keeper cannot change it."}
          </p>
          <ChipGroup
            label="Rescue and close slippage"
            options={RESCUE_SLIPPAGE}
            value={rescueBps as (typeof RESCUE_SLIPPAGE)[number]}
            onChange={onRescueBps}
            render={(v) => `${(v / 100).toFixed(2)}%`}
          />
          <Button type="button" variant="outline" className="h-10 w-full rounded-2xl" disabled={busy || disabled} onClick={onSaveRescue}>
            Save slippage
          </Button>
        </div>
      ) : null}
      <Button type="button" variant="secondary" className="mt-4 h-11 w-full rounded-2xl font-semibold" disabled={busy || disabled} onClick={onSave}>
        Save guard
      </Button>
      {position?.guardTargetCR ? (
        <p className="mt-3 flex flex-wrap gap-2 text-xs">
          <span className="chip">Floor {formatPercent(position.floorCR)}</span>
          <span className="chip">Target {formatPercent(position.guardTargetCR)}</span>
          <span className="chip">Zone {position.redemptionZone}</span>
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Unset, the keeper cannot touch the trove. You can always unwind yourself.</p>
      )}
    </div>
  );
}

function Stat({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="num mt-1 text-xl font-medium">{children}</dd>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function wad(value: bigint, digits: number) {
  const quant = 10n ** BigInt(digits);
  return Number((value * quant) / 10n ** 18n) / 10 ** digits;
}

function leverageNumber(cr: bigint) {
  const one = 10n ** 18n;
  if (cr <= one) return 0;
  return Number((cr * 100n) / (cr - one)) / 100;
}

function rankLabel(rank: bigint) {
  if (rank === 0n) return "—";
  if (rank > 32n) return "Outside 32";
  return `#${rank.toString()}`;
}

function rankRisk(rank: bigint) {
  if (rank === 0n) return "not ranked";
  if (rank <= 8n) return "front of the queue";
  if (rank <= 32n) return "in the first 32";
  return "far back in the queue";
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
