"use client";

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
import { Bitcoin, Check, ChevronDown, Lock, Plug, ShieldCheck, Wallet } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { MobileNavigation, SiteNavigation, WorkspaceHeader } from "@/components/site-navigation";
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
import {
  coilOpenFeeLegacyStatement,
  coilOpenFeePendingStatement,
  coilOpenFeeStatement,
  COIL_OPEN_FEE_CAP_BPS,
  coilOpenFeeUnavailableStatement,
  formatOpenFeePercent,
  readFeeBps,
  type OpenFeeSnapshot,
} from "@/lib/open-fee";
import { canWrite, isUnsupportedPolicy, loopArguments, ownerActionState, ownerTransactions } from "@/lib/readiness";
import { DEPLOYMENTS, RETAINED_DEPLOYMENTS } from "@/lib/deployment.generated";
import { discoverOwnerAccounts, ownerDeploymentCatalog, ownerDiscoveryView, selectOwnerDeployment, type OwnerDiscovery } from "@/lib/owner-accounts";
import { canSubmitPositionPreview, openButtonReason, presentPositionPreview, readStateAwareQuote, startPositionQuote, type PositionQuoteState } from "@/lib/position-quote";
import { ACCOUNT_QUOTE_READY, FRESH_ESTIMATE, LEVERAGE_CHOICES, OPEN_FEE_LOADING, OPEN_FEE_UNAVAILABLE, PRICE_CHECK_CTA, RECOVERY_STILL, TERM_LINE, debtLimitMessage, feeCapLabel, feeChipLabel, formatBpsOneDecimal, formatOneDecimalPercent, leverageChoice, poolWarning } from "@/lib/product-copy";
import { classifyDeposit, exceedsFactoryLimit, formatLimitAmount, quoteCardView } from "@/lib/quote-card";
import { QuoteCard } from "@/components/quote-card";
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
import { Footer, Hero, HowItWorks, Proof, Risks } from "@/components/landing";

const WAD = 10n ** 18n;
const MIN_DEPOSIT_WEI = 10n ** BigInt(18 - mezoTestnet.nativeCurrency.decimals);
const PRESETS = ["0.01", "0.025", "0.04", "0.05"] as const;
const SLIPPAGE = [50, 100, 150, 200] as const;
const RESCUE_SLIPPAGE = [50, 100, 150, 200, 300] as const;

export function CoilApp({ initialPolicy = null }: { initialPolicy?: OpenFeeSnapshot | null }) {
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
    const parsed = classifyDeposit(btcText, { minWei: MIN_DEPOSIT_WEI });
    return parsed.ok ? parsed.wei : null;
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
  const { data: policy, error: policyError } = useReadContract({
    chainId: mezoTestnet.id,
    address: factoryAddress, abi: coilFactoryAbi, functionName: "policy",
    query: { enabled: Boolean(factoryAddress), retry: false, refetchInterval: 15_000 },
  });
  const { data: coilFeeRaw, isFetched: coilFeeFetched, error: coilFeeError } = useReadContract({
    chainId: mezoTestnet.id,
    address: factoryAddress, abi: coilFactoryAbi, functionName: "coilFeeBps",
    query: { enabled: Boolean(factoryAddress), retry: false, refetchInterval: 15_000 },
  });
  const { data: opensPausedRaw, isFetched: opensPausedFetched } = useReadContract({
    chainId: mezoTestnet.id,
    address: factoryAddress, abi: coilFactoryAbi, functionName: "opensPaused",
    query: { enabled: Boolean(factoryAddress), retry: false, refetchInterval: 15_000 },
  });
  const hasPolicy = Boolean(policy);
  const newCapabilities = deployment.capabilities.policy || hasPolicy;
  const feeSnapshot = initialPolicy && factoryAddress && initialPolicy.factory.toLowerCase() === factoryAddress.toLowerCase() ? initialPolicy : null;
  const clientFeeBps = readFeeBps(coilFeeRaw);
  // Prefer a successful coilFeeBps() read. Keep the build snapshot if that read has not returned a value.
  const feeBpsLive = clientFeeBps ?? feeSnapshot?.feeBps ?? null;
  const legacyFactory = !newCapabilities && coilFeeFetched && isUnsupportedPolicy(coilFeeError ?? policyError);
  const feePending = Boolean(factoryAddress) && newCapabilities && feeBpsLive === null && !coilFeeFetched;
  const feeUnavailable = Boolean(factoryAddress) && newCapabilities && feeBpsLive === null && coilFeeFetched && !legacyFactory;
  const opensPausedLive = typeof opensPausedRaw === "boolean"
    ? opensPausedRaw
    : typeof policy?.opensPaused === "boolean"
      ? policy.opensPaused
      : feeSnapshot?.opensPaused ?? null;
  const pausePending = Boolean(factoryAddress) && newCapabilities && opensPausedLive === null && !opensPausedFetched;
  const effectiveMarket = useMemo(() => {
    if (!market) return null;
    if (newCapabilities && feeBpsLive === null) return null;
    return { ...market, coilFeeBps: BigInt(feeBpsLive ?? 0) };
  }, [market, newCapabilities, feeBpsLive]);
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
    if (collateral === null) return { kind: "error" as const, message: "Enter a BTC amount." };
    const target = percentToCr(targetPct);
    try {
      const quote = flashFactory
        ? quoteFlashLoop(collateral, target, BigInt(slippageBps), effectiveMarket)
        : { ...quoteLoop(collateral, target, BigInt(slippageBps), effectiveMarket), flashBtc: 0n, poolFeeMusd: 0n };
      return { kind: "ok" as const, quote, illustrative: false };
    } catch (error) {
      if (flashFactory) {
        try {
          const quote = quoteFlashLoop(collateral, target, BigInt(slippageBps), effectiveMarket, true);
          return { kind: "ok" as const, quote, illustrative: true };
        } catch {
          // The sample uses the same sizing. If that also fails, the deposit cannot be quoted.
        }
      }
      const message = error instanceof QuoteError ? error.message : "Preview failed.";
      return { kind: "error" as const, message, illustrative: false };
    }
  }, [effectiveMarket, collateral, targetPct, slippageBps, flashFactory]);

  const [positionQuote, setPositionQuote] = useState<PositionQuoteState | null>(null);
  const [quoteRetry, setQuoteRetry] = useState(0);
  // Before a new account is created the JS estimate describes a fresh position.
  // Once connected to a new account, only its state-aware view can authorize an open.
  const needsStateQuote = Boolean(account && newCapabilities);
  const positionQuoteKey = [mezoTestnet.id, factoryAddress, account, collateral, targetPct, slippageBps,
    feeBpsLive, position?.active, position?.collateral, position?.debt, market?.borrowRate,
    market?.refiPct, market?.price, flashFactory, quoteRetry].join(":");
  useEffect(() => {
    if (!needsStateQuote || !account || !publicClient || collateral === null || collateral <= 0n || (newCapabilities && feeBpsLive === null)) return;
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
  }, [needsStateQuote, account, publicClient, collateral, newCapabilities, feeBpsLive, positionQuoteKey, targetPct, slippageBps, flashFactory]);
  const preview = useMemo(() => {
    if (collateral === null || collateral <= 0n) return { kind: "error" as const, message: "Enter an amount above 0.", illustrative: false, displayOnly: false, reason: null };
    if (feePending) return freshPreview.kind === "ok" ? { ...freshPreview, displayOnly: true, reason: OPEN_FEE_LOADING } : { kind: "loading" as const, illustrative: false, displayOnly: true, reason: OPEN_FEE_LOADING };
    if (feeUnavailable) return { kind: "error" as const, message: "Factory policy is unavailable. Fee-bearing opens are disabled.", illustrative: false, displayOnly: true, reason: OPEN_FEE_UNAVAILABLE };
    return presentPositionPreview(needsStateQuote, positionQuoteKey, positionQuote, freshPreview);
  }, [collateral, feePending, feeUnavailable, needsStateQuote, positionQuoteKey, positionQuote, freshPreview]);

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
  const { data: recoveryRaw, isFetched: recoveryFetched, isError: recoveryFailed } = useReadContract({
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
    if (!writesEnabled) throw new Error("Transactions are disabled until this deployment is confirmed and writes are enabled.");
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
          ? "The position is closed."
          : end.cr >= target
            ? `Ratio is now ${formatPercent(end.cr)}.`
            : `Ratio is now ${formatPercent(end.cr)}. Mezo keeps at least 1,800 MUSD of debt, so this position cannot go higher without closing.`,
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
          unwindPct === 100 ? (flashFactory ? "Unwind and close" : `Unwind ${step}: closing the position`) : flashFactory ? "Unwind" : `Unwind ${step}: repaying debt`,
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
      setStatus(end.active ? `Debt is now ${formatMusd(end.debt)} MUSD.` : "Position closed. BTC is back in your wallet.");
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
      .then(() => {
        const percent = formatBpsOneDecimal(bps);
        setStatus(bps === 0 ? "Peg trigger off." : `Peg trigger set to ${percent} under $1.`);
      })
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
      .then(() => {
        const percent = formatBpsOneDecimal(bps);
        setStatus(`Allowed price gap set to ${percent}. A new open is refused when the pool is farther from the BTC price feed than that. The maximum is 5%.`);
      })
      .catch(fail)
      .finally(() => setBusy(false));
  }

  function doLoop() {
    if (!account || collateral === null || !loopReady || !canSubmitPositionPreview(preview)) return;
    begin();
    send(`Loop to ${targetPct}%`, () =>
      writeContractAsync({
        address: account,
        abi: coilAccountAbi,
        functionName: flashFactory ? "flashLoop" : "loop",
        args: loopArguments(targetCR, BigInt(slippageBps), feeBpsLive ?? policy?.feeBps ?? 0, hasPolicy || (newCapabilities && feeBpsLive !== null)),
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
      .then(() => setStatus("MEZO tip funded. A caller earns it only when protection raises the ratio."))
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
  const limitCollateral = policy?.maxCollateral ?? (feeSnapshot?.maxCollateral ? BigInt(feeSnapshot.maxCollateral) : null);
  const limitDebt = policy?.maxDebt ?? (feeSnapshot?.maxDebt ? BigInt(feeSnapshot.maxDebt) : null);
  const depositCheck = classifyDeposit(btcText, { minWei: MIN_DEPOSIT_WEI, maxWei: limitCollateral });
  const debtLimitError = preview.kind === "ok" && limitDebt !== null && limitDebt > 0n && preview.quote.debt > limitDebt
    ? debtLimitMessage(formatLimitAmount(limitDebt))
    : null;
  const depositError = depositCheck.ok ? debtLimitError : depositCheck.message;
  const depositOverLimit = exceedsFactoryLimit(btcText, collateral, limitCollateral);
  const debtOverLimit = preview.kind === "ok" && limitDebt !== null && preview.quote.debt > limitDebt;
  const resultOverLimit = preview.kind === "ok" && limitCollateral !== null && preview.quote.collateral > limitCollateral;
  const overLimit = depositOverLimit || debtOverLimit || resultOverLimit;
  const openingPolicyBlock = feeUnavailable
    ? "Factory policy read failed. Retry after RPC recovers; opens remain disabled."
    : recoveryRaw === undefined && (!market || !recoveryFetched || !recoveryFailed)
      ? "Checking Mezo Recovery Mode. Opens stay disabled until that read finishes."
      : recoveryRaw === undefined
        ? "Mezo Recovery Mode status is unavailable. Opens remain disabled."
      : !writesEnabled
        ? "Transactions disabled for this deployment."
        : feePending
          ? "Checking factory policy…"
          : pausePending
            ? "Checking whether factory opens are paused."
            : opensPausedLive
              ? "Factory opens are paused. Repay, claim, collateral top-up and permitted exits remain available."
              : marketError
                  ? "Market data could not refresh. Wait for a fresh preview."
                  : null;
  const openFeeText = legacyFactory
    ? coilOpenFeeLegacyStatement()
    : feeBpsLive !== null
      ? coilOpenFeeStatement(feeBpsLive)
      : feeUnavailable
        ? coilOpenFeeUnavailableStatement()
        : coilOpenFeePendingStatement();
  const outcome = preview.kind === "ok" && !depositError ? preview.quote : null;
  const illustrative = preview.kind === "ok" && preview.illustrative === true;
  const displayOnly = preview.displayOnly === true && !depositError;
  const slippageMiss = illustrative && !pegBlocked;
  const quoteView = quoteCardView({
    paused: opensPausedLive === true,
    pegBlocked: Boolean(pegBlocked),
    illustrative,
    displayOnly,
    inputError: depositError,
    sampleReason: displayOnly ? preview.reason : null,
    overLimit,
    limitBtc: limitCollateral !== null ? formatLimitAmount(limitCollateral) : null,
    gapPercent: formatBpsOneDecimal(Number(poolGap)),
    withinPercent: formatBpsOneDecimal(openCap),
    slippagePercent: formatOneDecimalPercent(slippageBps / 100),
    slippageMiss,
    liquidationPrice: outcome ? formatUsd(outcome.liquidationPrice) : null,
    dropPercent: outcome ? dropToLiquidation(crToPercent(outcome.cr)) : null,
    feeLine: openFeeText,
    feeCapLabel: feeBpsLive !== null ? feeCapLabel(formatOpenFeePercent(COIL_OPEN_FEE_CAP_BPS)) : null,
  });
  const deploymentFeeText = !newCapabilities
    ? " Legacy accounts retain their original capabilities; no upgrade is implied."
    : feeBpsLive === null
      ? " Reading the factory open fee."
      : ` Coil open fee ${formatOpenFeePercent(feeBpsLive)}; ${opensPausedLive === null ? "opens still being read" : opensPausedLive ? "opens paused" : "opens enabled"}.${limitCollateral !== null && limitDebt !== null ? ` Position limits: ${formatBtc(limitCollateral)} BTC / ${formatMusd(limitDebt)} MUSD total debt.` : ""}`;
  const ownerState = ownerActionState(newCapabilities, recoveryRaw !== false, Boolean(account && connected && writesEnabled && !discoveryPending));
  const openBlock = openingPolicyBlock ?? (inRecovery
    ? "Mezo is in Recovery Mode. A new open is refused."
    : pegBlocked
      ? quoteView.pegMessage
      : slippageMiss
        ? quoteView.slippageMessage
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
    canSubmitPositionPreview(preview) &&
    depositCheck.ok &&
    !debtLimitError &&
    collateral !== null &&
    collateral !== 0n;
  const primary: { label: string; onClick?: () => void; disabled: boolean; icon?: React.ReactNode } = pegBlocked
    ? { label: PRICE_CHECK_CTA, disabled: true, icon: <Lock className="size-4" aria-hidden /> }
    : !mounted
    ? { label: "Connect", disabled: true, icon: <Wallet className="size-4" aria-hidden /> }
    : !isConnected
      ? { label: connecting ? "Connecting…" : "Connect", onClick: connectWallet, disabled: connecting, icon: <Wallet className="size-4" aria-hidden /> }
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
              ? { label: inRecovery ? "Recovery Mode: opens refused" : slippageMiss ? "Opening unavailable" : opensPausedLive ? "Opens are paused" : "Opening unavailable", disabled: true, icon: <Lock className="size-4" aria-hidden /> }
              : { label: busy ? "Working…" : `Open at ${leverageChoice(targetPct).multiple}`, onClick: doLoop, disabled: !loopReady, icon: <Lock className="size-4" aria-hidden /> };
  const disabledOpenReason = primary.label.startsWith("Open at") && primary.disabled
    ? depositError ?? openButtonReason(preview)
    : null;

  const setup = [
    { label: "Wallet", done: connected },
    { label: "Network", done: connected && !wrongChain },
    { label: "Account", done: Boolean(account) },
    { label: "Loop", done: Boolean(position?.active) },
  ];
  const currentPrice = market ? formatUsd(market.price) : null;

  return (
    <div className="workspace-shell relative min-h-screen lg:pl-52">
      <div className="atmosphere pointer-events-none fixed inset-0 -z-10" aria-hidden />
      <div className="grain pointer-events-none fixed inset-0 -z-10" aria-hidden />
      <a
        href="#app"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-filament focus:px-4 focus:py-2 focus:text-ink"
      >
        Skip to the app
      </a>
      <SiteNavigation />

      <WorkspaceHeader className="sticky top-0 z-30 border-b border-border/70 bg-background/70 backdrop-blur-xl">
        <div className="relative mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <a href="#" className="flex min-h-11 shrink-0 items-center gap-2.5 lg:hidden" aria-label="Coil Labs home">
            <CoilMark className="size-7" />
            <span className="text-base font-semibold tracking-tight">Coil Labs</span>
            <span className="hidden rounded-md border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
              Testnet
            </span>
          </a>
          <p className="hidden text-xs text-muted-foreground lg:block">Workspace <span className="mx-2 text-foreground/30">/</span><span className="text-foreground">App</span></p>
          <div className="flex flex-wrap items-center gap-2">
            {feeBpsLive !== null ? (
              <span id="coil-open-fee" className="chip" title={openFeeText} aria-label={openFeeText}>
                {feeChipLabel(formatOpenFeePercent(feeBpsLive))}
              </span>
            ) : null}
            <p className="hidden items-center gap-2 px-3 py-1.5 text-xs text-muted-foreground sm:flex">
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
                className="min-h-11 rounded-full border border-danger/50 bg-danger/10 px-3 py-1.5 font-mono text-[11px] text-danger hover:bg-danger/20"
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
                className={cn("btn-btc min-h-11 rounded-lg px-4 font-medium", !pegBlocked && "hidden lg:inline-flex")}
                disabled={!mounted || connecting}
                onClick={connectWallet}
              >
                {connecting ? "Connecting…" : "Connect"}
              </Button>
            )}
            <MobileNavigation />
          </div>
          {busy ? <div className="busy-bar" aria-hidden /> : null}
        </div>
      </WorkspaceHeader>

      <div className="mx-auto flex w-full max-w-7xl flex-col px-4 pb-28 sm:px-6 lg:px-8 lg:pb-0">
        <main aria-busy={busy}>
          <Hero market={market} marketError={marketError} />
          <section id="app" aria-labelledby="app-title" className="scroll-mt-32 py-7 lg:scroll-mt-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 id="app-title" className="text-xl font-semibold tracking-tight">
                  Open a position
                </h2>
              </div>
              <ol className="flex flex-wrap items-center gap-1.5" aria-label="Setup progress">
                {setup.map((step, i) => (
                  <li key={step.label} className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "flex min-h-8 items-center gap-1.5 text-[11px]",
                        step.done ? "border-safe/40 text-safe" : "text-muted-foreground",
                      )}
                    >
                      {step.done ? <Check className="size-3" aria-hidden /> : <span className="font-mono text-[10px]">{i + 1}</span>}
                      {step.label}
                    </span>
                    {i < setup.length - 1 ? <span className="mx-1 h-px w-3 bg-border" aria-hidden /> : null}
                  </li>
                ))}
              </ol>
            </div>

            <div className="mt-5 space-y-2">
              <p id="coil-open-fee" role="status" className="rounded-lg border border-border bg-foreground/[0.03] px-3 py-2.5 text-sm leading-relaxed text-foreground">
                {openFeeText}
              </p>
              {connected ? <div className="well space-y-2 p-4">
                <Label htmlFor="owner-deployment">Your account generation / factory</Label>
                <select id="owner-deployment" disabled={busy} className="w-full rounded border border-border bg-background p-2 text-sm" value={selectedChoice.key} onChange={event => setManualChoice({ ownerKey, key: event.target.value })}>
                  {discoveredChoices.map(choice => <option key={choice.key} value={choice.key}>{choice.current ? "Current" : "Older version"} · {choice.position?.active ? "open position" : choice.account ? choice.readError ? "position unavailable" : "account exists" : choice.readError ? "lookup unavailable" : "no account"}</option>)}
                </select>
                <p className="text-xs text-muted-foreground">Older positions stay in this list when a new factory is configured. An existing account keeps its own rules. The factory you pick controls what this wallet can call.</p>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Technical details</summary>
                  <p className="mt-2 break-all font-mono">Selected factory {factoryAddress ?? "pending"} · deployment block {deployment.deploymentBlock ?? "pending"} · {hasPolicy ? "fee and limits can be read" : "older factory"}{account ? ` · account ${account}` : ""}</p>
                </details>
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
              <Banner tone="info" title={`${mezoTestnet.name} · not audited`} detailsLabel="Technical details">
                Contracts on Mezo testnet are not audited. Pool liquidity is limited.
                {deploymentFeeText}
                {!writesEnabled ? " Transactions remain disabled until deployment and release gates are satisfied." : ""}
                {!walletConnectProjectId ? " WalletConnect is unavailable: no project ID configured. Injected and Bitcoin wallets remain available." : ""}
              </Banner>
              {openingPolicyBlock ? <Banner tone="warn" title="Opening status">{openingPolicyBlock}</Banner> : null}
              {inRecovery ? (
                <Banner tone="bad" title="Recovery Mode">
                  Mezo is in Recovery Mode. Opens and full close are blocked. Repay with owner MUSD or funded reserves to reduce debt safely; minimum debt rules still apply. Submit your own close after Mezo permits it. No close is queued. {RECOVERY_STILL}
                </Banner>
              ) : null}
              {market && (poolGap > 0n || reserveFactory) ? (
                <Banner
                  tone={pegBlocked ? "warn" : "info"}
                  title={poolWarning(Number(poolGap), openCap)}
                  detailsLabel="Price gap"
                  summaryText={pegBlocked ? "A new open stays blocked until the prices are closer." : "The pool is inside the open bound."}
                  action={
                    account && reserveFactory ? (
                      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Allowed price gap">
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
                            {formatBpsOneDecimal(bps)}
                          </Button>
                        ))}
                      </div>
                    ) : null
                  }
                >
                  {quoteView.pegMessage ?? `${poolWarning(Number(poolGap), openCap)} ${belowPeg > 0n ? `MUSD is ${formatBpsOneDecimal(Number(belowPeg))} under $1 in this pool.` : "MUSD is not under $1 in this pool."}`}
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

            <div className="mt-5 grid items-start gap-4 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
              {/* Composer */}
              <section className="panel p-4 sm:p-5" aria-labelledby="compose-title">
                <h2 id="compose-title" className="mb-5 flex items-center gap-2 text-sm font-medium"><span className="flex size-5 items-center justify-center rounded-md border border-border text-[10px] text-muted-foreground" aria-hidden>1</span>Build your position</h2>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="btc" className="text-xs text-muted-foreground">You deposit</Label>
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
                  <div className="deposit-field flex items-center gap-3 rounded-lg border border-border bg-background px-4 py-3 focus-within:border-filament/60">
                    <Input
                      id="btc"
                      inputMode="decimal"
                      autoComplete="off"
                      spellCheck={false}
                      value={btcText}
                      onChange={(event) => setBtcText(event.target.value)}
                      aria-describedby={depositError ? "btc-usd btc-limit" : "btc-usd"}
                      aria-invalid={Boolean(depositError)}
                      className="h-12 min-w-0 flex-1 border-0 bg-transparent px-0 text-2xl font-medium tabular-nums tracking-tight shadow-none focus-visible:ring-0 sm:text-[32px] dark:bg-transparent"
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
                      {market && depositCheck.ok ? `≈ ${formatUsd((depositCheck.wei * market.price) / WAD)}` : "\u00a0"}
                    </p>
                  </div>
                  {depositError ? (
                    <p id="btc-limit" role="alert" className="text-sm leading-relaxed text-warn">{depositError}</p>
                  ) : null}
                </div>

                <div className="mt-6 border-t border-border pt-5">
                  <div className="flex items-end justify-between gap-3">
                    <Label id="leverage-label">Leverage</Label>
                    <p className="text-right text-sm">
                      <span className={cn("num font-medium", riskOf(targetPct).tone)}>{leverageChoice(targetPct).crLabel}</span>
                      <span className="mx-1.5 text-muted-foreground">·</span>
                      <span className="num">{leverageChoice(targetPct).ltvLabel}</span>
                    </p>
                  </div>
                  <div role="radiogroup" aria-labelledby="leverage-label" className="mt-3 grid grid-cols-3 gap-2">
                    {LEVERAGE_CHOICES.map((choice) => {
                      const selected = Math.abs(targetPct - choice.crPercent) < 0.2;
                      return (
                        <button
                          key={choice.multiple}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setTargetPct(choice.crPercent)}
                          className={cn(
                            "min-h-14 rounded-lg border px-2 py-2 text-left",
                            selected ? "border-filament bg-filament/10 text-foreground" : "border-border text-muted-foreground hover:text-foreground",
                          )}
                        >
                          <span className="num block text-lg font-semibold">{choice.multiple}</span>
                          <span className="mt-0.5 block text-[11px]">{choice.crLabel} · {choice.ltvLabel}</span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {quoteView.showRisk ? <RiskPill percent={targetPct} /> : null} Liquidation starts at 110% collateral. A lower collateral ratio is repaid first.
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{TERM_LINE}</p>
                </div>

                <details className="group/execution mt-6 border-t border-border">
                  <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-xs text-muted-foreground hover:text-foreground">
                    <span>Execution &amp; liquidity</span><span className="flex items-center gap-2">Slippage {formatOneDecimalPercent(slippageBps / 100)}<ChevronDown className="size-3.5 transition-transform group-open/execution:rotate-180" aria-hidden /></span>
                  </summary>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="eyebrow">Open slippage</p>
                    <p className="mt-1 text-xs text-muted-foreground">Rescue and close use a separate cap.</p>
                  </div>
                  <ChipGroup label="Open slippage" options={SLIPPAGE} value={slippageBps as (typeof SLIPPAGE)[number]} onChange={setSlippageBps} render={(v) => formatOneDecimalPercent(v / 100)} />
                </div>
                <PoolDepth testnet={market} quote={sensible} />

                <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-3">
                  {[
                    ["01", "Borrow MUSD", "against your BTC"],
                    ["02", "Buy BTC", "on Mezo Pools"],
                    ["03", "Post it back", flashFactory ? "one swap" : "stop at your ratio"],
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
                </details>
              </section>

              {/* Review */}
              <section className="panel quote-panel p-4 sm:p-5 xl:sticky xl:top-20" aria-labelledby="review-title">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="review-title" className="flex items-center gap-2 text-sm font-medium"><span className="flex size-5 items-center justify-center rounded-md border border-border text-[10px] text-muted-foreground" aria-hidden>2</span>Review before you sign</h2>
                  {preview.kind === "ok" && quoteView.showRisk ? <RiskPill percent={crToPercent(preview.quote.cr)} /> : null}
                </div>
                <ReviewCard preview={preview} existing={needsStateQuote && position?.active ? position : undefined} deposit={collateral} currentPrice={currentPrice} redemption={redemption} zone={zone} flash={flashFactory} outcome={quoteView} />

                <div className="mt-5 space-y-2">
                  <p className="text-xs text-muted-foreground">Transactions</p>
                  <ol className="space-y-2 text-xs">
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
                      {flashFactory ? "One pool swap" : "Two swaps on this factory"} <span className="text-muted-foreground">· one transaction</span>
                    </li>
                  </ol>
                </div>

                {needsStateQuote ? <button type="button" className="link mt-4 text-xs" disabled={busy} onClick={() => setQuoteRetry(value => value + 1)}>Refresh account quote</button> : null}
                <Button
                  type="button"
                  className={cn("mt-5 hidden min-h-11 w-full rounded-lg text-sm font-medium", isConnected && "lg:inline-flex", primary.disabled ? "" : "btn-btc")}
                  variant={primary.disabled ? "secondary" : "default"}
                  disabled={primary.disabled}
                  onClick={primary.onClick}
                >
                  {primary.icon}
                  {primary.label}
                </Button>
                {disabledOpenReason ? <p className="mt-2 hidden text-center text-sm leading-relaxed text-muted-foreground lg:block">{disabledOpenReason}</p> : null}
                {quoteView.sampleReason || depositError ? null : (
                  <p className="mt-3 text-center text-[11px] text-muted-foreground">
                    {needsStateQuote ? `${ACCOUNT_QUOTE_READY} ` : position?.active ? "This estimate does not include an older account's existing loan. " : `${FRESH_ESTIMATE} `}Contract limits apply. Review the exact call in your wallet before signing.
                  </p>
                )}

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
            <section id="position" className="panel mt-5 scroll-mt-32 p-4 sm:p-5 lg:scroll-mt-20" aria-labelledby="position-title">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 id="position-title" className="text-base font-medium tracking-tight">Your position</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {account ? (
                      <>
                        Account{" "}
                        <a className="link font-mono text-foreground" href={`${EXPLORER_ADDRESS}${account}`} target="_blank" rel="noreferrer noopener">
                          {shorten(account)}
                        </a>{" "}
                        · this account is the borrower
                      </>
                    ) : (
                      "Each wallet gets one account. That account is the borrower."
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
                    <EmptyState title="Nothing on-chain yet" body="The preview uses the selected chain market. A confirmed Coil deployment is required before this card can show a position." />
                  ) : !connected ? (
                    <div className="flex flex-wrap items-center gap-4 rounded-lg border border-dashed border-border p-4">
                      <Wallet className="size-6 shrink-0 text-muted-foreground" strokeWidth={1.5} aria-hidden />
                      <div className="min-w-0 flex-1 basis-48">
                        <p className="text-sm font-medium">Connect to see your position</p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Use an injected or supported Bitcoin wallet on {mezoTestnet.name}. Test BTC: <a className="link" href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer noopener">Mezo faucet</a>. Use the Connect button.</p>
                      </div>
                    </div>
                  ) : !account ? (
                    <EmptyState
                      title="No Coil account yet"
                      body="Create an account that owns your position. Owner exits obey pool bounds and Mezo protocol rules; the keeper cannot take funds."
                      action={wrongChain ? undefined : { label: busy ? "Creating…" : "Create your Coil account", onClick: createAccount, disabled: busy || !writesEnabled || !implementation || implementation === ZERO }}
                    />
                  ) : !position?.active ? (
                    <div className="grid gap-5 md:grid-cols-2">
                      <EmptyState
                        title="Account ready, position closed"
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

          <HowItWorks />
          <Proof />
          <Risks />
        </main>
        <Footer />
      </div>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
        <Button
          type="button"
          className={cn("min-h-12 w-full rounded-lg text-sm font-medium", primary.disabled ? "" : "btn-btc")}
          variant={primary.disabled ? "secondary" : "default"}
          disabled={primary.disabled}
          onClick={primary.onClick}
        >
          {primary.icon}
          {primary.label}
        </Button>
        {disabledOpenReason ? <p className="mt-2 text-center text-sm leading-relaxed text-muted-foreground">{disabledOpenReason}</p> : null}
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
  outcome,
}: {
  existing?: Position;
  preview: PreviewState;
  deposit: bigint | null;
  currentPrice: string | null;
  redemption: { rank: number; inside: boolean; suggested: number | null } | null;
  zone: number;
  flash: boolean;
  outcome: ReturnType<typeof quoteCardView>;
}) {
  const blockedCopy = outcome.pegMessage || outcome.overLimitMessage;
  if (!outcome.showResults) return <QuoteCard view={outcome} />;
  if (preview.kind === "loading") {
    return (
      <div className="mt-5 space-y-3" aria-busy="true">
        <QuoteCard view={outcome} />
        <p className="text-sm text-muted-foreground">Reading the BTC price feed and the MUSD/BTC pool…</p>
      </div>
    );
  }
  if (preview.kind === "error") {
    const quiet = /^Enter a /i.test(preview.message);
    return (
      <div>
        <QuoteCard view={outcome} />
        {blockedCopy || quiet ? null : (
          <div className="mt-4 rounded-lg border border-warn/35 bg-warn/10 px-4 py-4" role="alert">
            <p className="text-sm font-medium text-warn">This open would not go through</p>
            <p className="mt-1 text-sm leading-relaxed text-foreground/90">{preview.message}</p>
          </div>
        )}
      </div>
    );
  }
  const q = preview.quote;
  const ratio = crToPercent(q.cr);
  const risk = riskOf(ratio);
  const drop = dropToLiquidation(ratio);
  return (
    <div>
      <QuoteCard view={{ ...outcome, liquidationPrice: formatUsd(q.liquidationPrice), dropLine: `BTC can fall ${formatOneDecimalPercent(drop)}` }} />
      <dl className="mt-3 divide-y divide-border">
        <ReviewRow label="Total collateral" before={existing ? `${formatBtc(existing.collateral)} BTC` : deposit ? `${formatBtc(deposit)}` : "0"} after={`${formatBtc(q.collateral)} BTC`} />
        <ReviewRow label="Coil fee" after={`${formatMusd(q.coilFeeMusd)} MUSD`} />
        <ReviewRow label="Total MUSD borrowed" after={`${formatMusd(q.musdMinted)} MUSD`} />
        <ReviewRow label="Total debt (includes protocol fees)" before={existing ? `${formatMusd(existing.debt)} MUSD` : "0"} after={<><TweenValue canonical={formatMusd(q.debt)} numeric={wad(q.debt, 2)} digits={2} /> MUSD</>} />
        <ReviewRow
          label="Collateral ratio"
          after={<TweenValue canonical={formatOneDecimalPercent(ratio)} numeric={ratio} digits={formatOneDecimalPercent(ratio).includes(".") ? 1 : 0} suffix="%" />}
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
        <ReviewRow label="BTC can fall" after={`${formatOneDecimalPercent(drop)} before liquidation`} tone={risk.tone} />
        <ReviewRow
          label="How the trade runs"
          after={
            flash
              ? `Borrow ${formatMusd(q.musdMinted, 0)} MUSD, buy ${formatBtc(q.flashBtc ?? 0n)} BTC, and post it back. The pool charges ${formatMusd(q.poolFeeMusd ?? 0n)} MUSD.`
              : `Borrow ${formatMusd(q.musdMinted, 0)} MUSD and buy BTC in ${q.iterations} ${q.iterations === 1 ? "swap" : "swaps"}.`
          }
        />
      </dl>
      <div className="mt-4">
        <HealthBar percent={ratio} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        Liquidation risk: <span className={risk.tone}>{risk.word.toLowerCase()}</span>.{" "}
        {redemption?.inside ? (
          <span className="text-danger">
            This quote is within the first {zone} places on the repayment line
            {redemption.suggested ? `. A collateral ratio near ${formatOneDecimalPercent(redemption.suggested)} sits just outside it.` : "."}
          </span>
        ) : (
          <>
            If someone redeems MUSD, the lowest collateral ratios are repaid first. {ratio < 150 ? <span className="text-danger">That risk is higher at this ratio.</span> : "That risk falls as the ratio rises."}
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
        <Stat label="Repayment line" sub="If someone redeems MUSD, lower collateral ratios are repaid first.">
          {rankRisk(position.redemptionRank)}
        </Stat>
        <Stat label="Keeper guard" sub={position.guardTargetCR ? `front of the line ${position.redemptionZone}` : "keeper cannot act"}>
          {position.guardTargetCR ? `${formatPercent(position.floorCR)} → ${formatPercent(position.guardTargetCR)}` : "Off"}
        </Stat>
        <p className="col-span-2 text-xs leading-relaxed text-muted-foreground">
          {redemptionNote(position.redemptionRank, position.cr)} Liquidation can take the position if BTC trades through{" "}
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
                {flash ? "One swap covers the whole raise." : "On this factory, one sale per transaction."} Mezo keeps at least 1,800 MUSD of debt on an open position.
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
                display={<span className="num text-2xl font-semibold">{unwindPct === 100 ? "Close position" : `${unwindPct}% of debt`}</span>}
              />
              <p className="text-xs leading-relaxed text-muted-foreground">
                {unwindPct === 100
                  ? flash
                    ? "A bounded swap closes the position when Mezo permits it. Full close is unavailable in Recovery Mode; use owner MUSD repayment instead."
                    : "Sells collateral to repay everything and closes the position. On this factory a full close can take more than one transaction."
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
    return `No leverage stays under 1% impact. The gentlest open is ${quote.leverage} at ${formatBpsOneDecimal(Number(quote.impact))}.`;
  }
  return `Max sensible leverage now: ${quote.leverage}, at ${formatBpsOneDecimal(Number(quote.impact))} of pool impact.`;
}

function PoolDepth({
  testnet,
  quote,
}: {
  testnet: Market | null;
  quote: ReturnType<typeof sensibleOpen> | null;
}) {
  const testLine = testnet ? describeSensible(quote) : `Waiting for the ${mezoTestnet.name} pool.`;
  return (
    <div className="mt-6 rounded-lg border border-border px-4 py-3">
      <p className="eyebrow">{mezoTestnet.name} depth</p>
      <p className="mt-2 text-sm leading-relaxed">{testLine}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">Quoted from the selected chain pool. Cap is 1% price impact.</p>
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
            When MUSD is this far under $1 and the position is near the front of the repayment line, protection runs. Off leaves the trigger disabled. Current setting {pegGuardBps === 0 ? "off" : formatBpsOneDecimal(pegGuardBps)}.
          </p>
          <ChipGroup
            label="Peg trigger"
            options={PEG_GUARD}
            value={(PEG_GUARD as readonly number[]).includes(pegGuardBps) ? (pegGuardBps as (typeof PEG_GUARD)[number]) : 0}
            onChange={onSavePeg}
            render={(v) => (v === 0 ? "Off" : formatOneDecimalPercent(v / 100))}
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
        If your collateral ratio drops under the floor, or your position moves to the front of the repayment line, anyone can run protection for you.
        It can only raise the ratio. It cannot open leverage, unwind, or withdraw.{flash ? " The caller earns MEZO only when the ratio rises." : ""}
        {" "}Protection spends MUSD you set aside first and sells BTC only for the rest.
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
        <NumberField id={bare ? "zone" : "zone-closed"} label="Front of the line" value={zone} onChange={setZone} />
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
              ? "Separate from the open. Default 2%, hard cap 3%. The keeper cannot change it. Protection does not run if the pool is worse than this against the BTC price feed."
              : "This account uses one cap for open, protection, and close. Raise it when the pool sits under the BTC price feed. Hard cap 3%. The keeper cannot change it."}
          </p>
          <ChipGroup
            label="Rescue and close slippage"
            options={RESCUE_SLIPPAGE}
            value={rescueBps as (typeof RESCUE_SLIPPAGE)[number]}
            onChange={onRescueBps}
            render={(v) => formatOneDecimalPercent(v / 100)}
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
          <span className="chip">Front of the line {position.redemptionZone}</span>
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">Unset, the keeper cannot touch the position. Owner exits remain subject to pool bounds and Mezo protocol rules.</p>
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

function rankRisk(rank: bigint) {
  if (rank === 0n) return "not ranked";
  if (rank <= 8n) return "front of the queue";
  if (rank <= 32n) return "in the first 32";
  return "far back in the queue";
}

function redemptionNote(rank: bigint, cr: bigint) {
  if (rank > 0n && rank <= 8n) {
    return "This position is near the front of the redemption queue. A redemption repays MUSD and takes BTC.";
  }
  if (cr < 15n * 10n ** 17n) {
    return "A tight ratio is redeemed before safer positions. Raising it moves you back in the queue.";
  }
  return "Redemptions start at the lowest ratios. This position is not in the first 8.";
}

function alreadyThere(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("AlreadyAtTarget") || message.includes("0xc9b136fe");
}

function shortError(message: string) {
  const cleaned = message.replace(/^Error:\s*/, "");
  return cleaned.length > 280 ? `${cleaned.slice(0, 280)}…` : cleaned;
}
