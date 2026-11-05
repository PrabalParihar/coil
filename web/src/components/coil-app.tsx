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
  addr,
  borrowerAbi,
  erc20Abi,
  factoryFeeAbi,
  selectedChain as mezoTestnet,
  parkAbi,
  poolAbi,
  priceFeedAbi,
  sortedTrovesAbi,
  troveManagerAbi,
  troveRecoveryAbi,
  type Position,
} from "@/lib/mezo";
import {
  QuoteError,
  crToPercent,
  deviationBps,
  formatBtc,
  formatMusd,
  formatPercent,
  formatUsd,
  icrFromNominal,
  leverageLabel,
  musdBelowPegBps,
  nominalIcr,
  percentToCr,
  poolReserves,
  quoteFlashLoop,
  quoteLoop,
  sensibleOpen,
  type Market,
} from "@/lib/quote";
import { deployment as activeDeployment, walletConnectProjectId } from "@/lib/network";
import { canWrite, isUnsupportedPolicy, loopArguments, ownerActionState, ownerTransactions } from "@/lib/readiness";
import { DEPLOYMENTS, RETAINED_DEPLOYMENTS } from "@/lib/deployment.generated";
import { discoverOwnerAccounts, ownerDeploymentCatalog, ownerDiscoveryView, selectOwnerDeployment, type OwnerDiscovery } from "@/lib/owner-accounts";
import { readStateAwareQuote, selectPositionPreview, startPositionQuote, type PositionQuoteState } from "@/lib/position-quote";
import { loadMainnetMarket } from "@/lib/mainnet";
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
  const [slippageBps, setSlippageBps] = useState(50);
  const [rescueBps, setRescueBps] = useState(200);
  const [rescueDirty, setRescueDirty] = useState(false);
  const [unwindPct, setUnwindPct] = useState(100);
  const [floorPct, setFloorPct] = useState(170);
  const [guardPct, setGuardPct] = useState(220);
  const [zone, setZone] = useState(8);
  const [tipText, setTipText] = useState("5");
  const [reserveText, setReserveText] = useState("100");
  const [ownerMusd, setOwnerMusd] = useState("100");
  const [topUpText, setTopUpText] = useState("0.001");
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
  const catalog = useMemo(() => ownerDeploymentCatalog(activeDeployment, [DEPLOYMENTS[String(mezoTestnet.id)], ...(RETAINED_DEPLOYMENTS[String(mezoTestnet.id)] ?? [])]), []);
  const ownerKey = `${mezoTestnet.id}:${address?.toLowerCase() ?? "disconnected"}`;
  const [discoveryRound, setDiscoveryRound] = useState(0);
  const discoveryKey = `${ownerKey}:${discoveryRound}`;
  const [discovered, setDiscovered] = useState<OwnerDiscovery | null>(null);
  const [manualChoice, setManualChoice] = useState<{ ownerKey: string; key: string } | null>(null);
  const discoveryView = ownerDiscoveryView(ownerKey, discoveryKey, discovered, catalog);
  const discoveredChoices = discoveryView.choices;
  const selectedChoice = selectOwnerDeployment(discoveredChoices, manualChoice?.ownerKey === ownerKey ? manualChoice.key : undefined);
  const deployment = selectedChoice.deployment;
  const factoryAddress = deployment.factory ?? undefined;
  const writesEnabled = canWrite(deployment, process.env.NEXT_PUBLIC_COIL_ENABLE_MAINNET_WRITES === "true");
  const discoveryPending = Boolean(address && discoveryView.pending);
  useEffect(() => {
    if (!address || !publicClient) return;
    let current = true;
    let generation = 0;
    const refresh = async () => {
      const request = ++generation;
      const choices = await discoverOwnerAccounts(publicClient, address, catalog);
      if (current && request === generation) setDiscovered({ ownerKey, key: discoveryKey, choices });
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30_000);
    return () => { current = false; clearInterval(timer); };
  }, [address, publicClient, catalog, discoveryKey, ownerKey]);

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
    chainId: mezoTestnet.id,
    address: factoryAddress,
    abi: coilFactoryAbi,
    functionName: "implementation",
  });
  const { data: budget, isError: budgetMissing } = useReadContract({
    chainId: mezoTestnet.id,
    address: implementation,
    abi: coilAccountAbi,
    functionName: "precompileBudget",
    query: { enabled: Boolean(implementation), retry: false },
  });
  const { data: policy, isFetched: policyFetched, error: policyError } = useReadContract({
    chainId: mezoTestnet.id,
    address: factoryAddress, abi: coilFactoryAbi, functionName: "policy",
    query: { enabled: Boolean(factoryAddress), retry: false, refetchInterval: 15_000 },
  });
  const hasPolicy = Boolean(policy);
  const policyUnreadable = !policy && policyFetched && !isUnsupportedPolicy(policyError);
  const newCapabilities = deployment.capabilities.policy || hasPolicy;
  const effectiveMarket = useMemo(() => market ? { ...market, coilFeeBps: BigInt(policy?.feeBps ?? 0) } : null, [market, policy]);
  const flashFactory = Boolean(implementation) && Boolean(budget) && !budgetMissing;

  const { data: coilAccount, refetch: refetchAccount } = useReadContract({
    chainId: mezoTestnet.id,
    address: factoryAddress,
    abi: coilFactoryAbi,
    functionName: "accountOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(factoryAddress && address) },
  });

  const account =
    coilAccount === undefined ? selectedChoice.account : coilAccount !== ZERO ? (coilAccount as `0x${string}`) : undefined;

  const { data: positionRaw, refetch: refetchPosition } = useReadContract({
    chainId: mezoTestnet.id,
    address: account,
    abi: coilAccountAbi,
    functionName: "position",
    query: { enabled: Boolean(account), refetchInterval: 15_000 },
  });
  const position = (positionRaw ?? selectedChoice.position) as Position | undefined;

  const freshPreview = useMemo(() => {
    if (!effectiveMarket) return { kind: "loading" as const };
    if (policyUnreadable || (newCapabilities && !policy)) return { kind: "error" as const, message: "Factory policy is unavailable. Fee-bearing opens are disabled." };
    if (collateral === null) return { kind: "error" as const, message: "Enter a BTC amount." };
    try {
      const target = percentToCr(targetPct);
      const quote = flashFactory
        ? quoteFlashLoop(collateral, target, BigInt(slippageBps), effectiveMarket)
        : { ...quoteLoop(collateral, target, BigInt(slippageBps), effectiveMarket), flashBtc: 0n, poolFeeMusd: 0n };
      return { kind: "ok" as const, quote };
    } catch (error) {
      const message = error instanceof QuoteError ? error.message : "Preview failed.";
      return { kind: "error" as const, message };
    }
  }, [effectiveMarket, collateral, targetPct, slippageBps, flashFactory, newCapabilities, policy, policyUnreadable]);

  const [positionQuote, setPositionQuote] = useState<PositionQuoteState | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  // Before a new clone is created the JS estimate describes a fresh account.
  // Once connected to a new clone, only its state-aware view can authorize a loop.
  const needsStateQuote = Boolean(account && newCapabilities);
  const positionQuoteKey = [mezoTestnet.id, factoryAddress, account, collateral, targetPct, slippageBps,
    policy?.feeBps, position?.active, position?.collateral, position?.debt, market?.borrowRate,
    market?.refiPct, market?.price, flashFactory, quoteRetry].join(":");
  useEffect(() => {
    if (!needsStateQuote || !account || !publicClient || collateral === null || collateral <= 0n || !policy) return;
    let cancel: (() => void) | undefined;
    const refresh = () => {
      cancel?.();
      cancel = startPositionQuote(positionQuoteKey, () => readStateAwareQuote(publicClient, {
        account, chainId: mezoTestnet.id, deposit: collateral, target: percentToCr(targetPct),
        slippage: BigInt(slippageBps), flash: flashFactory,
      }), setPositionQuote);
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => { cancel?.(); clearInterval(timer); };
  }, [needsStateQuote, account, publicClient, collateral, policy, positionQuoteKey, targetPct, slippageBps, flashFactory]);
  const preview = useMemo(() => collateral === null || collateral <= 0n
    ? { kind: "error" as const, message: "Enter a positive BTC amount." }
    : policyUnreadable || (newCapabilities && !policy)
    ? { kind: "error" as const, message: "Factory policy is unavailable. Fee-bearing opens are disabled." }
    : selectPositionPreview(needsStateQuote, positionQuoteKey, positionQuote, freshPreview),
    [collateral, policyUnreadable, newCapabilities, policy, needsStateQuote, positionQuoteKey, positionQuote, freshPreview]);

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

  const { data: tipBalanceRaw } = useReadContract({
    chainId: mezoTestnet.id,
    address: account,
    abi: coilAccountAbi,
    functionName: "tipBalance",
    query: { enabled: Boolean(account && flashFactory), refetchInterval: 20_000 },
  });
  const tipBalance = typeof tipBalanceRaw === "bigint" ? tipBalanceRaw : undefined;

  const { data: rescueRaw, refetch: refetchRescue } = useReadContract({
    chainId: mezoTestnet.id,
    address: account,
    abi: coilAccountAbi,
    functionName: "rescueSlippageBps",
    query: { enabled: Boolean(account), refetchInterval: 15_000 },
  });
  const separateRescue = typeof rescueRaw === "bigint" || typeof rescueRaw === "number";

  const { data: implPark, isError: parkMissing, isFetched: parkFetched } = useReadContract({
    chainId: mezoTestnet.id,
    address: implementation,
    abi: coilAccountAbi,
    functionName: "park",
    query: { enabled: Boolean(implementation), retry: false },
  });
  const reserveFactory = parkFetched && !parkMissing && typeof implPark === "string" && implPark !== ZERO;
  const { data: parkedRaw, refetch: refetchParked } = useReadContract({
    chainId: mezoTestnet.id,
    address: typeof implPark === "string" ? implPark : undefined,
    abi: parkAbi,
    functionName: "assetsOf",
    args: account ? [account] : undefined,
    query: { enabled: Boolean(reserveFactory && account && implPark), refetchInterval: 15_000 },
  });
  const parked = typeof parkedRaw === "bigint" ? parkedRaw : 0n;
  const { data: pegGuardRaw } = useReadContract({
    chainId: mezoTestnet.id,
    address: account,
    abi: coilAccountAbi,
    functionName: "pegGuardBps",
    query: { enabled: Boolean(reserveFactory && account), retry: false },
  });
  const { data: maxPegRaw } = useReadContract({
    chainId: mezoTestnet.id,
    address: account,
    abi: coilAccountAbi,
    functionName: "maxPegDeviationBps",
    query: { enabled: Boolean(reserveFactory && account), retry: false },
  });
  const pegGuardBps = typeof pegGuardRaw === "number" ? pegGuardRaw : Number(pegGuardRaw ?? 0);
  const maxPegBps = typeof maxPegRaw === "number" ? maxPegRaw : Number(maxPegRaw ?? 200);
  const { data: recoveryRaw } = useReadContract({
    chainId: mezoTestnet.id,
    address: addr.troveManager,
    abi: troveRecoveryAbi,
    functionName: "checkRecoveryMode",
    args: market ? [market.price] : undefined,
    query: { enabled: Boolean(market), refetchInterval: 20_000 },
  });
  const inRecovery = recoveryRaw === true;

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
    if (!writesEnabled) throw new Error("Transactions are disabled: this chain needs a confirmed Coil deployment and explicit mainnet enablement.");
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
    await refetchParked();
    setDiscoveryRound(value => value + 1);
  }

  function begin() {
    setManualChoice({ ownerKey, key: selectedChoice.key });
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

  function depositReserve() {
    if (!account) return;
    let amount: bigint;
    try {
      amount = parseEther(reserveText || "0");
    } catch {
      fail(new Error("Enter an MUSD amount."));
      return;
    }
    if (amount === 0n) {
      fail(new Error("Enter an MUSD amount."));
      return;
    }
    begin();
    send("Approve MUSD", () =>
      writeContractAsync({
        address: addr.musd,
        abi: erc20Abi,
        functionName: "approve",
        args: [account, amount],
        chainId: mezoTestnet.id,
      }),
    )
      .then(() =>
        send("Park MUSD", () =>
          writeContractAsync({
            address: account,
            abi: coilAccountAbi,
            functionName: "moveReserve",
            args: [amount, false],
            chainId: mezoTestnet.id,
            gas: 400_000n,
          }),
        ),
      )
      .then(() => setStatus("MUSD parked. A rescue spends this before it sells BTC."))
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function withdrawReserve() {
    if (!account) return;
    let amount: bigint;
    try {
      amount = parseEther(reserveText || "0");
    } catch {
      fail(new Error("Enter an MUSD amount."));
      return;
    }
    if (amount === 0n) {
      fail(new Error("Enter an MUSD amount."));
      return;
    }
    begin();
    send("Withdraw reserve", () =>
      writeContractAsync({
        address: account,
        abi: coilAccountAbi,
        functionName: "moveReserve",
        args: [amount, true],
        chainId: mezoTestnet.id,
        gas: 300_000n,
      }),
    )
      .then(() => setStatus("Reserve returned to your wallet."))
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function savePeg(bps: number) {
    if (!account) return;
    const openCap = maxPegBps > 0 && maxPegBps <= 500 ? maxPegBps : 200;
    begin();
    send("Set peg guard", () =>
      writeContractAsync({
        address: account,
        abi: coilAccountAbi,
        functionName: "setPegBounds",
        args: [openCap, bps],
        chainId: mezoTestnet.id,
        gas: 200_000n,
      }),
    )
      .then(() => setStatus(bps === 0 ? "Peg trigger off." : `Peg trigger set to ${bps} bps under $1.`))
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function saveOpenCap(bps: number) {
    if (!account || pegGuardRaw === undefined) return;
    if (bps < 1 || bps > 500) return;
    const guard = pegGuardBps >= 0 && pegGuardBps <= 500 ? pegGuardBps : 0;
    begin();
    send("Set open cap", () =>
      writeContractAsync({
        address: account,
        abi: coilAccountAbi,
        functionName: "setPegBounds",
        args: [bps, guard],
        chainId: mezoTestnet.id,
        gas: 200_000n,
      }),
    )
      .then(() =>
        setStatus(`Open cap set to ${bps} bps. flashLoop allows a pool-versus-oracle gap up to that. The maximum is 500.`),
      )
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function doLoop() {
    if (!account || collateral === null || !loopReady || preview.kind !== "ok") return;
    begin();
    send(`Loop to ${targetPct}%`, () =>
      writeContractAsync({
        address: account,
        abi: coilAccountAbi,
        functionName: flashFactory ? "flashLoop" : "loop",
        args: loopArguments(targetCR, BigInt(slippageBps), policy?.feeBps ?? 0, hasPolicy),
        value: collateral,
        chainId: mezoTestnet.id,
        gas: 8_000_000n,
      }),
    )
      .then(() => setStatus("Loop confirmed."))
      .catch(fail)
      .finally(() => setBusy(false));
  }

  async function ownerAction(action: "repay" | "close" | "claim") {
    if (!account || !newCapabilities) return;
    begin();
    try {
      const amount = action === "claim" ? 0n : parseEther(ownerMusd);
      const steps = ownerTransactions(action, account, addr.musd, amount, recoveryRaw !== false);
      for (const step of steps) {
        if (step.functionName === "approve") {
          await send("Approve MUSD for your account", () => writeContractAsync({ address: step.address, abi: erc20Abi, functionName: "approve", args: step.args, chainId: mezoTestnet.id }));
        } else if (step.functionName === "claimCollateral") {
          await send("Claim recovered collateral", () => writeContractAsync({ address: step.address, abi: coilAccountAbi, functionName: "claimCollateral", chainId: mezoTestnet.id, gas: 2_000_000n }));
        } else {
          await send(action === "repay" ? "Repay with owner MUSD" : "Close with owner MUSD", () => writeContractAsync({ address: step.address, abi: coilAccountAbi, functionName: step.functionName, args: step.args, chainId: mezoTestnet.id, gas: 6_000_000n }));
        }
      }
      setStatus(action === "repay" ? "Repayment confirmed. Unused funds return to your wallet; minimum remaining debt applies." : action === "claim" ? "Collateral claim confirmed." : "Close confirmed.");
    } catch (error) { fail(error); } finally { setBusy(false); }
  }

  async function topUp() {
    if (!account || !newCapabilities) return;
    begin();
    try {
      const amount = parseEther(topUpText);
      if (amount <= 0n) throw new Error("Enter a positive BTC amount.");
      await send("Add collateral safely", () => writeContractAsync({ address: account, abi: coilAccountAbi, functionName: "addCollateral", value: amount, chainId: mezoTestnet.id, gas: 3_000_000n }));
      setStatus("Collateral added. No Coil fee.");
    } catch (error) { fail(error); } finally { setBusy(false); }
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

  const poolGap = market ? deviationBps(market.reserveMusd, market.reserveBtc, market.price) : 0n;
  const belowPeg = market ? musdBelowPegBps(market.reserveMusd, market.reserveBtc, market.price) : 0n;
  const openCap = reserveFactory ? (maxPegBps > 0 ? maxPegBps : 200) : 200;
  const pegBlocked = reserveFactory && poolGap > BigInt(openCap);
  const capExceeded = preview.kind === "ok" && policy && (preview.quote.collateral > policy.maxCollateral || preview.quote.debt > policy.maxDebt);
  const openingPolicyBlock = policyUnreadable ? "Factory policy read failed. Retry after RPC recovers; opens remain disabled." : recoveryRaw === undefined ? "Mezo Recovery Mode status is unavailable. Opens remain disabled." : !writesEnabled ? "Transactions disabled for this deployment." : !policyFetched ? "Checking factory policy…" : newCapabilities && !policy ? "Factory policy could not be read. Opens are disabled." : policy?.opensPaused ? "Factory opens are paused. Repay, claim, collateral top-up and permitted exits remain available." : capExceeded ? "This preview exceeds the factory collateral or debt limit." : marketError ? "Market data could not refresh. Wait for a fresh preview." : null;
  const ownerState = ownerActionState(newCapabilities, recoveryRaw !== false, Boolean(account && connected && writesEnabled && !discoveryPending));
  const openBlock = openingPolicyBlock ?? (inRecovery
    ? "Mezo is in Recovery Mode. A new loop is refused."
    : pegBlocked
      ? `PegOff: the pool is ${poolGap.toString()} bps off the oracle, and this account's open cap is ${openCap} bps. Raise the cap (maximum 500) to loop.`
      : null);
  const sensible = effectiveMarket && collateral && collateral > 0n ? sensibleOpen(collateral, effectiveMarket) : null;
  const reserveNeed = (() => {
    if (!position?.active || !market || position.collateral === 0n || position.debt === 0n) return 0n;
    const target = position.guardTargetCR > 0n ? position.guardTargetCR : 15n * 10n ** 17n;
    const targetDebt = (position.collateral * market.price) / target;
    if (targetDebt >= position.debt) return 0n;
    return position.debt - targetDebt;
  })();
  const loopReady =
    !busy &&
    !discoveryPending &&
    !openBlock &&
    Boolean(factoryAddress) &&
    Boolean(account) &&
    preview.kind === "ok" &&
    collateral !== null &&
    collateral !== 0n;
  const primary: { label: string; onClick?: () => void; disabled: boolean; icon?: React.ReactNode } = !mounted
    ? { label: "Connect wallet", disabled: true, icon: <Wallet className="size-4" aria-hidden /> }
    : !isConnected
      ? { label: connecting ? "Connecting…" : "Connect wallet", onClick: connectWallet, disabled: connecting, icon: <Wallet className="size-4" aria-hidden /> }
      : !writesEnabled
        ? { label: "Read-only · deployment not enabled", disabled: true }
      : discoveryPending
        ? { label: "Discovering current and retained accounts…", disabled: true }
      : wrongChain
        ? { label: `Switch to ${mezoTestnet.name}`, onClick: () => void switchChainAsync({ chainId: mezoTestnet.id }).catch(fail), disabled: false, icon: <Plug className="size-4" aria-hidden /> }
        : !factoryAddress
          ? { label: "Deploy to enable", disabled: true }
          : !account
            ? { label: busy ? "Creating account…" : "Create your Coil account", onClick: createAccount, disabled: busy || discoveryPending || !implementation || implementation === ZERO }
            : openBlock
              ? { label: inRecovery ? "Recovery Mode: loop refused" : "Opening unavailable", disabled: true, icon: <Lock className="size-4" aria-hidden /> }
              : { label: busy ? "Working…" : `Loop to ${targetPct}% · ${leverageLabel(targetCR)}`, onClick: doLoop, disabled: !loopReady, icon: <Lock className="size-4" aria-hidden /> };

  const setup = [
    { label: "Wallet", done: connected },
    { label: mezoTestnet.name, done: connected && !wrongChain },
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
              {mezoTestnet.id === 31611 ? "testnet" : "mainnet"}
            </span>
          </a>
          <nav aria-label="Primary" className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
            <a className="hover:text-foreground" href="#how">How it works</a>
            <a className="hover:text-foreground" href="#app">App</a>
            <Link className="hover:text-foreground" href="/guard">Guard log</Link>
            <Link className="hover:text-foreground" href="/stats">Stats</Link>
            <Link className="hover:text-foreground" href="/keeper">Keeper</Link>
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
                {mezoTestnet.name} {mezoTestnet.id}
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
          <Hero market={effectiveMarket} marketError={marketError} />
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
              {connected ? <div className="well space-y-2 p-4">
                <Label htmlFor="owner-deployment">Your account generation / factory</Label>
                <select id="owner-deployment" disabled={busy} className="w-full rounded border border-border bg-background p-2 text-sm" value={selectedChoice.key} onChange={event => setManualChoice({ ownerKey, key: event.target.value })}>
                  {discoveredChoices.map(choice => <option key={choice.key} value={choice.key}>{choice.current ? "Current" : "Retained legacy"} · {shorten(choice.deployment.factory ?? undefined)} · block {choice.deployment.deploymentBlock ?? "pending"} · {choice.position?.active ? "funded position" : choice.account ? choice.readError ? "position unavailable" : "existing account" : choice.readError ? "lookup unavailable" : "no account"}</option>)}
                </select>
                <p className="break-all font-mono text-xs">Selected factory {factoryAddress ?? "pending"} · deployment block {deployment.deploymentBlock ?? "pending"} · {hasPolicy ? "policy-enabled generation" : "legacy capability / policy probe"}{account ? ` · clone ${account}` : ""}</p>
                <p className="text-xs text-muted-foreground">Funded older positions remain selectable when a new factory is configured. Existing clones keep their own implementation; the selected factory controls capability reads and owner calls.</p>
                {discoveryPending ? <p className="text-sm">Checking current and retained accounts…</p> : discoveryView.refreshing ? <p className="text-xs text-muted-foreground">Refreshing account discovery…</p> : null}
                {discoveredChoices.some(choice => choice.readError) ? <p className="text-sm text-warn" role="alert">Some account/position reads are unavailable. Older accounts are retained in the selector; unavailable reads do not mean funds are empty.</p> : null}
                <button type="button" disabled={busy} className="link text-xs" onClick={() => setDiscoveryRound(value => value + 1)}>Retry account discovery</button>
              </div> : null}
              {marketError ? (
                <Banner tone="bad" title={`Could not read ${mezoTestnet.name}`}>
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
                      Switch to {mezoTestnet.name}
                    </Button>
                  }
                >
                  Selected network: {mezoTestnet.name} (chain {mezoTestnet.id}). Bitcoin wallets use OrangeKit while Passport remains unavailable.
                </Banner>
              ) : null}
              <Banner tone="warn" title={`${mezoTestnet.name} · ${deployment.status} deployment`}>
                Unaudited contracts and thin pool liquidity. Mainnet starts at 200% CR (about 2×).
                {policy ? ` Coil fee ${policy.feeBps} bps; opens ${policy.opensPaused ? "paused" : "enabled"}. Position limits: ${formatBtc(policy.maxCollateral)} BTC / ${formatMusd(policy.maxDebt)} MUSD total debt.` : " Legacy accounts retain their original capabilities; no upgrade is implied."}
                {!writesEnabled ? " Transactions remain disabled until deployment and release gates are satisfied." : ""}
                {!walletConnectProjectId ? " WalletConnect is unavailable: no project ID configured. Injected and Bitcoin wallets remain available." : ""}
              </Banner>
              {openingPolicyBlock ? <Banner tone="warn" title="Opening status">{openingPolicyBlock}</Banner> : null}
              {inRecovery ? (
                <Banner tone="bad" title="Recovery Mode">
                  Mezo is in Recovery Mode. Opens and full close are blocked. Repay with owner MUSD or funded reserves to reduce debt safely; minimum debt rules still apply. Submit your own close after Mezo permits it. No close is queued.
                </Banner>
              ) : null}
              {market && (poolGap > 0n || reserveFactory) ? (
                <Banner
                  tone={pegBlocked ? "warn" : "info"}
                  title={pegBlocked ? "PegOff: a new loop is blocked" : "Pool versus oracle"}
                  action={
                    account && reserveFactory ? (
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Open cap in bps">
                        {OPEN_CAPS.map((bps) => (
                          <Button
                            key={bps}
                            type="button"
                            variant="outline"
                            className={cn(
                              "h-8 rounded-full px-3 font-mono text-[11px]",
                              openCap === bps && "border-filament text-foreground",
                            )}
                            disabled={busy || openCap === bps || pegGuardRaw === undefined}
                            onClick={() => saveOpenCap(bps)}
                          >
                            {bps} bps
                          </Button>
                        ))}
                      </div>
                    ) : null
                  }
                >
                  The MUSD/BTC pool is {poolGap.toString()} bps off the oracle
                  {poolGap > 0n ? ` (${(Number(poolGap) / 100).toFixed(2)}%)` : ""}.
                  {belowPeg > 0n ? ` MUSD is ${belowPeg.toString()} bps under $1 in this pool.` : " MUSD is not under $1 in this pool."}
                  {reserveFactory
                    ? pegBlocked
                      ? ` flashLoop reverts PegOff above this account's open cap of ${openCap} bps. setPegBounds can raise that cap to 500. Closing a trove is not blocked by PegOff.`
                      : ` The open cap is ${openCap} bps (maximum 500). flashLoop reverts PegOff above it.`
                    : " This factory does not expose setPegBounds."}
                  {reserveFactory && !account ? " Create a Coil account, then set the open cap." : ""}
                </Banner>
              ) : null}
              {connectError && !isConnected ? (
                <Banner tone="info" title="No wallet connected">
                  {/provider|not found|ethereum/i.test(connectError.message)
                    ? `No browser wallet was found. Install an injected wallet, add ${mezoTestnet.name}, and try again.`
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
                    ) : mezoTestnet.id === 31611 ? (
                      <a className="font-mono text-[11px] text-muted-foreground hover:text-foreground" href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer noopener">
                        Get test BTC ↗
                      </a>
                    ) : null}
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
                <PoolDepth deposit={collateral} testnet={market} quote={sensible} />

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
                <ReviewCard preview={preview} existing={needsStateQuote && position?.active ? position : undefined} deposit={collateral} currentPrice={currentPrice} redemption={redemption} zone={zone} flash={flashFactory} />

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

                {needsStateQuote ? <button type="button" className="link mt-4 text-xs" disabled={busy} onClick={() => setQuoteRetry(value => value + 1)}>Refresh state-aware fee quote</button> : null}
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
                  {needsStateQuote ? "State-aware contract quote includes existing collateral, total debt and refinancing. " : position?.active ? "Legacy fresh-position estimate: actual increase totals may differ. " : "Fresh-position estimate. "}Contract limits apply to actual totals. Your wallet shows the exact call before anything is sent. The clone stays yours: only your wallet can loop or unwind.
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

              {account && newCapabilities && !discoveryPending ? (
                <div className="well mt-5 space-y-3 p-4">
                  <h4 className="font-semibold">Owner actions · zero Coil fee</h4>
                  <p className="text-xs text-muted-foreground">MUSD approval targets your account. Repayment returns unused funds and respects minimum debt. Full close uses your account/reserve funds plus your approved maximum; Mezo may refuse it. Claims recover only surplus released by Mezo.</p>
                  <Label htmlFor="owner-musd">Owner MUSD amount / maximum for close</Label>
                  <Input id="owner-musd" inputMode="decimal" value={ownerMusd} onChange={e => setOwnerMusd(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <Button disabled={busy || !ownerState.repay || !position?.active} onClick={() => void ownerAction("repay")}>Approve & repay MUSD</Button>
                    <Button disabled={busy || !ownerState.close || !position?.active} onClick={() => void ownerAction("close")}>Approve & close with MUSD</Button>
                    <Button disabled={busy || !ownerState.claim} onClick={() => void ownerAction("claim")}>Claim surplus collateral</Button>
                  </div>
                  <Label htmlFor="topup-btc">BTC collateral top-up</Label>
                  <Input id="topup-btc" inputMode="decimal" value={topUpText} onChange={e => setTopUpText(e.target.value)} />
                  <Button disabled={busy || !ownerState.topUp || !position?.active} onClick={() => void topUp()}>Add BTC collateral</Button>
                  <p className="text-xs text-muted-foreground">Risk-reducing top-ups are available while opens are paused and are exempt from opening caps.</p>
                </div>
              ) : account ? <p className="mt-4 text-xs text-muted-foreground">Legacy account: funded repayment, direct close, top-up and surplus claim require a new implementation. Existing exit controls remain below.</p> : null}
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={positionKey}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: motionOk ? 0.35 : 0, ease: [0.16, 1, 0.3, 1] }}
                  className="mt-6"
                >
                  {discoveryPending ? <p className="text-sm text-muted-foreground">Discovering your current and retained positions…</p> : !factoryAddress ? (
                    <EmptyState title="Nothing on-chain yet" body="The preview uses the selected chain market. A confirmed Coil deployment is required before this card can show a clone position." />
                  ) : !connected ? (
                    <div className="grid items-center gap-6 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                      <div className="well px-4 py-6 opacity-70">
                        <CrGauge percent={110} empty label="-" sub="collateral ratio" />
                      </div>
                      <EmptyState
                        icon={<Wallet className="mb-4 size-10 text-filament" strokeWidth={1.5} aria-hidden />}
                        title="Connect to see your trove"
                        body={<>Use an injected or supported Bitcoin wallet on {mezoTestnet.name}.{mezoTestnet.id === 31611 ? <> Test BTC comes from <a className="link" href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer noopener">faucet.test.mezo.org</a>.</> : " Mainnet transactions remain subject to the release gate."}</>}
                        action={mounted ? { label: connecting ? "Connecting…" : "Connect wallet", onClick: connectWallet, disabled: connecting } : undefined}
                      />
                    </div>
                  ) : !account ? (
                    <EmptyState
                      title="No Coil account yet"
                      body="Create an account that owns your trove. Owner exits obey pool bounds and Mezo protocol rules; the keeper cannot take funds."
                      action={wrongChain ? undefined : { label: busy ? "Creating…" : "Create your Coil account", onClick: createAccount, disabled: busy || !writesEnabled || !implementation || implementation === ZERO }}
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
                        disabled={!account || !writesEnabled || wrongChain}
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
                        reserveAvailable={reserveFactory}
                        parked={parked}
                        reserveNeed={reserveNeed}
                        reserveText={reserveText}
                        setReserveText={setReserveText}
                        onDepositReserve={depositReserve}
                        onWithdrawReserve={withdrawReserve}
                        pegAvailable={reserveFactory}
                        pegGuardBps={pegGuardBps}
                        onSavePeg={savePeg}
                      />
                    </div>
                  ) : (
                    <OpenPosition
                      recovery={recoveryRaw !== false}
                      position={position}
                      market={market}
                      deleverPct={deleverPct}
                      setDeleverPct={setDeleverPct}
                      unwindPct={unwindPct}
                      setUnwindPct={setUnwindPct}
                      busy={busy || !writesEnabled || wrongChain}
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
                          disabled={!account || !writesEnabled || wrongChain}
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
                          reserveAvailable={reserveFactory}
                          parked={parked}
                          reserveNeed={reserveNeed}
                          reserveText={reserveText}
                          setReserveText={setReserveText}
                          onDepositReserve={depositReserve}
                          onWithdrawReserve={withdrawReserve}
                          pegAvailable={reserveFactory}
                          pegGuardBps={pegGuardBps}
                          onSavePeg={savePeg}
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
  existing,
  preview,
  deposit,
  currentPrice,
  redemption,
  zone,
  flash,
}: {
  existing?: Position;
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
        <ReviewRow label="Total collateral" before={existing ? `${formatBtc(existing.collateral)} BTC` : deposit ? `${formatBtc(deposit)}` : "0"} after={`${formatBtc(q.collateral)} BTC`} />
        <ReviewRow label="Coil fee (minted notional)" after={`${formatMusd(q.coilFeeMusd)} MUSD`} />
        <ReviewRow label="Gross MUSD minted" after={`${formatMusd(q.musdMinted)} MUSD`} />
        <ReviewRow label="Total debt (includes protocol fees)" before={existing ? `${formatMusd(existing.debt)} MUSD` : "0"} after={<><TweenValue canonical={formatMusd(q.debt)} numeric={wad(q.debt, 2)} digits={2} /> MUSD</>} />
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
  recovery,
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
  recovery: boolean;
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
                    ? "A bounded flash swap closes the trove when Mezo permits it. Full close is unavailable in Recovery Mode; use owner MUSD repayment instead."
                    : "Sells collateral to repay everything and closes the trove. On this factory a full close can take more than one transaction."
                  : "Sells collateral to repay part of the debt, down toward the 2,000 MUSD floor."}
              </p>
              <Button type="button" variant="outline" className="h-12 w-full rounded-2xl font-semibold" disabled={busy || (recovery && unwindPct === 100)} onClick={onUnwind}>
                {recovery && unwindPct === 100 ? "Full close unavailable: Mezo mode" : unwindPct === 100 ? "Unwind and close" : "Unwind"}
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

function describeSensible(quote: ReturnType<typeof sensibleOpen> | null) {
  if (!quote) return "Enter a BTC amount to see the largest leverage that stays under 1% price impact.";
  if (quote.targetCR === 0n) return "This deposit cannot open. Mezo requires at least 1,800 MUSD of debt.";
  if (!quote.capped) {
    return `No leverage stays under 1% impact. The gentlest open is ${quote.leverage} at ${quote.impact.toString()} bps.`;
  }
  return `Max sensible leverage now: ${quote.leverage}, at ${quote.impact.toString()} bps of pool impact.`;
}

function PoolDepth({
  deposit,
  testnet,
  quote,
}: {
  deposit: bigint | null;
  testnet: Market | null;
  quote: ReturnType<typeof sensibleOpen> | null;
}) {
  const [main, setMain] = useState<Market | null>(null);
  const [mainError, setMainError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadMainnetMarket()
      .then((next) => {
        if (!cancelled) {
          setMain(next);
          setMainError(null);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) setMainError(error instanceof Error ? error.message : "Mainnet RPC failed.");
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const mainQuote = main && deposit && deposit > 0n ? sensibleOpen(deposit, main) : null;
  const testLine = testnet ? describeSensible(quote) : `Waiting for the ${mezoTestnet.name} pool.`;
  const mainLine = mainError ? "Could not read the mainnet pool." : describeSensible(mainQuote);
  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-border px-4 py-3">
        <p className="eyebrow">{mezoTestnet.name} depth</p>
        <p className="mt-2 text-sm leading-relaxed">{testLine}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Quoted from the selected chain pool. Cap is 1% impact.</p>
      </div>
      <div className="rounded-2xl border border-border px-4 py-3">
        <p className="eyebrow">Mainnet depth</p>
        <p className="mt-2 text-sm leading-relaxed">{mainLine}</p>
        <p className="mt-1 text-[11px] text-muted-foreground">Read-only market comparison. Mainnet writes require a confirmed deployment and explicit enablement.</p>
      </div>
    </div>
  );
}

const PEG_GUARD = [0, 50, 100, 200] as const;
const OPEN_CAPS = [200, 300, 400, 500] as const;

function ReserveBlock({
  available,
  parked,
  need,
  text,
  setText,
  busy,
  disabled,
  onDeposit,
  onWithdraw,
  pegAvailable,
  pegGuardBps,
  onSavePeg,
}: {
  available: boolean;
  parked: bigint;
  need: bigint;
  text: string;
  setText?: (v: string) => void;
  busy: boolean;
  disabled: boolean;
  onDeposit?: () => void;
  onWithdraw?: () => void;
  pegAvailable: boolean;
  pegGuardBps: number;
  onSavePeg?: (bps: number) => void;
}) {
  const covered =
    need === 0n
      ? `Parked ${formatMusd(parked)} MUSD. Nothing to repay at the guard target.`
      : parked >= need
        ? `Reserve covers the full ${formatMusd(need)} MUSD a rescue would repay. No BTC sale.`
        : `Reserve covers ${((Number((parked * 10000n) / need) / 100) || 0).toFixed(0)}% of a rescue (${formatMusd(parked)} of ${formatMusd(need)} MUSD). The rest requires a permitted bounded BTC sale.`;
  return (
    <div className="mt-4 space-y-3 rounded-2xl border border-border p-3">
      <p className="eyebrow">MUSD reserve</p>
      {available ? (
        <>
          <p className="text-[11px] leading-relaxed text-muted-foreground">{covered}</p>
          <Input
            inputMode="decimal"
            value={text}
            onChange={(event) => setText?.(event.target.value)}
            aria-label="MUSD reserve amount"
            className="h-11 rounded-xl bg-black/25 font-mono md:text-sm dark:bg-black/25"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-10 rounded-2xl" disabled={busy || disabled} onClick={onDeposit}>
              Park MUSD
            </Button>
            <Button type="button" variant="outline" className="h-10 rounded-2xl" disabled={busy || disabled} onClick={onWithdraw}>
              Withdraw
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Plain MUSD. No verified sMUSD address is published, so the park stays in MUSD until the governor points it at a savings vault.
          </p>
        </>
      ) : (
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          This factory has no MUSD reserve. A rescue still sells BTC. The next factory repays parked MUSD first, and can later hold a savings vault if an sMUSD address is verified.
        </p>
      )}
      {pegAvailable && onSavePeg ? (
        <div className="space-y-2">
          <p className="eyebrow">Peg trigger</p>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            When MUSD is this far under $1 and the trove is near the front of the redemption queue, guard() acts. Off leaves the trigger disabled. Current setting {pegGuardBps} bps.
          </p>
          <ChipGroup
            label="Peg trigger"
            options={PEG_GUARD}
            value={(PEG_GUARD as readonly number[]).includes(pegGuardBps) ? (pegGuardBps as (typeof PEG_GUARD)[number]) : 0}
            onChange={onSavePeg}
            render={(v) => (v === 0 ? "Off" : `${(v / 100).toFixed(2)}%`)}
          />
        </div>
      ) : null}
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
  reserveAvailable = false,
  parked = 0n,
  reserveNeed = 0n,
  reserveText = "",
  setReserveText,
  onDepositReserve,
  onWithdrawReserve,
  pegAvailable = false,
  pegGuardBps = 0,
  onSavePeg,
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
  reserveAvailable?: boolean;
  parked?: bigint;
  reserveNeed?: bigint;
  reserveText?: string;
  setReserveText?: (v: string) => void;
  onDepositReserve?: () => void;
  onWithdrawReserve?: () => void;
  pegAvailable?: boolean;
  pegGuardBps?: number;
  onSavePeg?: (bps: number) => void;
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
        {" "}A rescue spends parked MUSD first and sells BTC only for the remainder.
      </p>
      <ReserveBlock
        available={reserveAvailable}
        parked={parked}
        need={reserveNeed}
        text={reserveText}
        setText={setReserveText}
        busy={busy}
        disabled={disabled}
        onDeposit={onDepositReserve}
        onWithdraw={onWithdrawReserve}
        pegAvailable={pegAvailable}
        pegGuardBps={pegGuardBps}
        onSavePeg={onSavePeg}
      />
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
            Jar {tipBalance !== undefined ? `${formatMusd(tipBalance)} MEZO` : "-"}. Paid once per block, and only if the ratio rose.
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
        <p className="mt-3 text-xs text-muted-foreground">Unset, the keeper cannot touch the trove. Owner exits remain subject to pool bounds and Mezo protocol rules.</p>
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
  if (rank === 0n) return "-";
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
