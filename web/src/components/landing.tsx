"use client";

import Link from "next/link";
import { useMemo } from "react";
import { parseEther } from "viem";
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUpRight,
  Bitcoin,
  CodeXml,
  Landmark,
  Layers,
  Repeat2,
  ShieldCheck,
  TimerReset,
  TriangleAlert,
} from "lucide-react";
import { cn } from "cn";
import { formatBtc, formatMusd, formatUsd, percentToCr, quoteFlashLoop, type Market } from "@/lib/quote";
import { factoryAddress } from "@/lib/mezo";
import { EXPLORER, EXPLORER_ADDRESS, dropToLiquidation, shorten, useMotionOk } from "@/components/shell";

const RING = "M240 70 a170 170 0 1 1 0 340 a170 170 0 1 1 0 -340";

/* ------------------------------------------------------------------ */
/* Animated loop                                                       */
/* ------------------------------------------------------------------ */

function chevron(angle: number) {
  const rad = (angle * Math.PI) / 180;
  const x = 240 + 170 * Math.cos(rad);
  const y = 240 + 170 * Math.sin(rad);
  return { x, y, rot: angle + 90 };
}

export function LoopViz() {
  const motionOk = useMotionOk();
  const stations = [
    { x: 240, y: 70, label: "Trove", sub: "Post BTC · mint MUSD", n: "01", pos: "left-[61%] top-[7%] text-left" },
    { x: 387.2, y: 325, label: "Mezo Pools", sub: "Swap MUSD → BTC", n: "02", pos: "right-[-2%] top-[74%] sm:right-[-6%]" },
    { x: 92.8, y: 325, label: "Collateral", sub: "Post the BTC back", n: "03", pos: "left-[-2%] top-[74%] sm:left-[-6%]" },
  ];
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[520px]" aria-hidden>
      <div className="absolute inset-[22%] rounded-full bg-filament/20 blur-3xl" />
      <svg viewBox="0 0 480 480" className="absolute inset-0 h-full w-full overflow-visible">
        <defs>
          <radialGradient id="core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#f7931a" stopOpacity="0.35" />
            <stop offset="70%" stopColor="#f7931a" stopOpacity="0.04" />
            <stop offset="100%" stopColor="#f7931a" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="ring-btc" x1="0" y1="0" x2="480" y2="480" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#ffd9a3" />
            <stop offset="50%" stopColor="#f7931a" />
            <stop offset="100%" stopColor="#e2640c" />
          </linearGradient>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx="240" cy="240" r="128" fill="url(#core)" />
        <g className="spin-slow">
          <circle cx="240" cy="240" r="208" fill="none" stroke="currentColor" strokeOpacity="0.09" strokeDasharray="2 7" />
        </g>
        <g className="spin-rev">
          <circle cx="240" cy="240" r="118" fill="none" stroke="#f7931a" strokeOpacity="0.28" strokeDasharray="1 5" strokeWidth="2" />
        </g>
        <circle cx="240" cy="240" r="92" fill="none" stroke="currentColor" strokeOpacity="0.07" />
        {/* the loop */}
        <path d={RING} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="18" />
        <path d={RING} pathLength={1} className="coil-draw" fill="none" stroke="url(#ring-btc)" strokeWidth="2.5" strokeLinecap="round" />
        <path d={RING} fill="none" stroke="#f7931a" strokeOpacity="0.55" strokeWidth="2" className="flow-dash" />
        {[-30, 90, 210].map((angle) => {
          const c = chevron(angle);
          return (
            <path
              key={angle}
              d="M-6 -7 L4 0 L-6 7"
              transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)}) rotate(${c.rot})`}
              fill="none"
              stroke="#ffd9a3"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
        {/* travelling value: MUSD out of the trove, BTC back from the pool */}
        {motionOk
          ? [0, 1, 2].map((i) => (
              <g key={`m${i}`}>
                <circle r="5" fill="#f4ede1" filter="url(#glow)">
                  <animateMotion dur="2.4s" begin={`${i * 0.8}s`} repeatCount="indefinite" keyPoints="0;0.3333" keyTimes="0;1" calcMode="linear" path={RING} />
                </circle>
              </g>
            ))
          : null}
        {motionOk
          ? [0, 1, 2, 3].map((i) => (
              <circle key={`b${i}`} r="6" fill="#f7931a" filter="url(#glow)">
                <animateMotion dur="4.2s" begin={`${i * 1.05}s`} repeatCount="indefinite" keyPoints="0.3333;1" keyTimes="0;1" calcMode="linear" path={RING} />
              </circle>
            ))
          : null}
        {stations.map((s, i) => (
          <g key={s.label}>
            <circle cx={s.x} cy={s.y} r="44" fill="#f7931a" className={cn("station-pulse", i === 1 && "station-pulse-2", i === 2 && "station-pulse-3")} opacity="0.2" />
            <circle cx={s.x} cy={s.y} r="34" fill="#15120f" stroke="#f7931a" strokeOpacity="0.7" strokeWidth="1.5" />
          </g>
        ))}
      </svg>
      {/* station icons */}
      {stations.map((s, i) => {
        const Icon = i === 0 ? Landmark : i === 1 ? ArrowLeftRight : Layers;
        return (
          <div
            key={s.label}
            className="absolute flex size-[13%] -translate-x-1/2 -translate-y-1/2 items-center justify-center text-filament"
            style={{ left: `${(s.x / 480) * 100}%`, top: `${(s.y / 480) * 100}%` }}
          >
            <Icon className="size-[46%]" strokeWidth={1.75} />
          </div>
        );
      })}
      {stations.map((s) => (
        <div key={`${s.label}-l`} className={cn("absolute w-max", s.n === "01" ? "text-left" : "text-center", s.pos)}>
          <p className="font-mono text-[10px] tracking-[0.16em] text-filament">{s.n}</p>
          <p className="text-sm font-semibold sm:text-base">{s.label}</p>
          <p className="text-[11px] text-muted-foreground sm:text-xs">{s.sub}</p>
        </div>
      ))}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <p className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase sm:text-[10px]">at 200% collateral</p>
        <p className="btc-text num mt-1 text-5xl font-semibold tracking-tighter sm:text-7xl">2.00×</p>
        <p className="mt-1 text-xs text-muted-foreground">BTC exposure target</p>
        <p className="mt-3 hidden chip border-filament/30 font-mono text-[10px] text-foreground/80 sm:inline-flex">
          <Repeat2 className="size-3 text-filament" />1 flash swap · 1 transaction
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export function Hero({ market, marketError }: { market: Market | null; marketError: string | null }) {
  const sample = useMemo(() => {
    if (!market) return null;
    try {
      return quoteFlashLoop(parseEther("0.05"), percentToCr(200), 50n, market);
    } catch {
      return null;
    }
  }, [market]);
  const cr = sample ? Number((sample.cr * 10000n) / 10n ** 18n) / 100 : 0;
  return (
    <section className="relative grid items-center gap-x-12 gap-y-10 pt-10 pb-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pt-16 lg:pb-24">
      <div className="lg:col-start-1 lg:row-start-1 lg:self-end">
        <p className="rise chip border-filament/30 text-foreground/85">
          <span className="relative flex size-1.5" aria-hidden>
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-safe opacity-70" />
            <span className="relative inline-flex size-1.5 rounded-full bg-safe" />
          </span>
          Live on Mezo testnet · chain 31611
        </p>
        <h1 className="mt-6 text-[2.9rem] leading-[0.95] font-semibold tracking-[-0.045em] sm:text-7xl lg:text-[5.4rem]">
          <span className="rise rise-1 block">Stack more</span>
          <span className="rise rise-2 block">
            <span className="btc-text">Bitcoin</span> in{" "}
            <em className="font-serif font-normal tracking-[-0.02em] italic">one</em>
          </span>
          <span className="rise rise-3 block">transaction.</span>
        </h1>
        <p className="rise rise-3 mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
          Coil borrows MUSD against your BTC, buys more BTC on Mezo Pools, and posts it back as collateral — stopping at the
          collateral ratio you pick. A keeper you configure can only make the position <span className="text-foreground">safer</span>.
        </p>
        <div className="rise rise-4 mt-8 flex flex-wrap items-center gap-3">
          <a
            href="#app"
            className="btn-btc inline-flex h-12 items-center gap-2 rounded-full px-6 text-[15px] font-semibold focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Open the app <ArrowDown className="size-4" aria-hidden />
          </a>
          <a
            href="#proof"
            className="inline-flex h-12 items-center gap-2 rounded-full border border-border px-5 text-[15px] font-medium text-foreground/90 transition-colors hover:border-foreground/30 hover:bg-foreground/5"
          >
            See it on-chain <ArrowUpRight className="size-4" aria-hidden />
          </a>
        </div>
      </div>

      <div className="rise rise-2 px-6 pb-12 sm:px-10 sm:pb-14 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:px-4">
        <LoopViz />
      </div>

      <div className="lg:col-start-1 lg:row-start-2 lg:self-start">
        <div className="rise rise-4 panel max-w-xl p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="eyebrow">Live quote · 0.05 BTC @ 200%</p>
            <p className="font-mono text-[11px] text-muted-foreground">
              {market ? `BTC ${formatUsd(market.price)}` : marketError ? "RPC unavailable" : "reading oracle…"}
            </p>
          </div>
          {sample ? (
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
              <HeroStat label="Collateral" value={`${formatBtc(sample.collateral)} BTC`} accent />
              <HeroStat label="Debt" value={`${formatMusd(sample.debt, 0)} MUSD`} />
              <HeroStat label="Liq. price" value={formatUsd(sample.liquidationPrice)} />
              <HeroStat label="BTC can fall" value={`${dropToLiquidation(cr).toFixed(1)}%`} />
            </dl>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-busy="true">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className="skeleton h-3 w-16 rounded" />
                  <div className="skeleton h-5 w-24 rounded" />
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Computed in your browser from the Mezo price feed and the MUSD/BTC pool reserves, 0.5% slippage.
          </p>
        </div>
      </div>
    </section>
  );
}

function HeroStat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("num mt-0.5 text-[15px] font-medium", accent && "text-filament")}>{value}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Ticker                                                              */
/* ------------------------------------------------------------------ */

const TICKER = [
  "0.0475 BTC looped to 200.09% in one transaction",
  "deleverTo(300%) → 288.04%",
  "Flash unwind and de-lever each fit in one transaction",
  "Liquidation 110% · Coil floor 115%",
  "Keeper earns MEZO only when the ratio rises",
  "MUSD BorrowerOperations + Mezo Pools",
  `Factory ${shorten(factoryAddress)}`,
];

export function Ticker() {
  const items = [...TICKER, ...TICKER];
  return (
    <div className="relative -mx-4 overflow-hidden border-y border-border bg-foreground/[0.02] py-3 sm:-mx-6 lg:-mx-8" aria-label="Facts from Mezo testnet">
      <div className="marquee flex w-max gap-10 pr-10 font-mono text-xs text-muted-foreground">
        {items.map((item, i) => (
          <span key={`${item}-${i}`} className="flex items-center gap-10 whitespace-nowrap" aria-hidden={i >= TICKER.length}>
            {item}
            <span className="size-1 rounded-full bg-filament/70" />
          </span>
        ))}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-16 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* How it works                                                        */
/* ------------------------------------------------------------------ */

const HOW = [
  {
    icon: Bitcoin,
    title: "Post BTC, mint MUSD",
    body: "Your BTC opens or tops up a MUSD trove owned by your own Coil clone. BorrowerOperations mints MUSD against it.",
    tag: "BorrowerOperations",
  },
  {
    icon: ArrowLeftRight,
    title: "Buy BTC on Mezo Pools",
    body: "The MUSD is swapped back into BTC on the MUSD/BTC pool, inside your slippage limit.",
    tag: "MUSD/BTC pool",
  },
  {
    icon: Layers,
    title: "Post it back, stop at your ratio",
    body: "The flash-borrowed BTC is posted as collateral. The clone mints the MUSD the pool is owed and repays it in the same transaction, landing on or above your target.",
    tag: "flash swap · openTrove",
  },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-24 py-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-filament">How it works</p>
          <h2 id="how-title" className="mt-3 max-w-xl text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
            Three moves. <span className="font-serif font-normal italic">One</span> transaction.
          </h2>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          The clone owns the trove. A Mezo Pools flash swap borrows the BTC, posts it, and repays the pool before the transaction ends.
          Mezo allows 20 precompile calls. The flash loop uses 7. The two-swap loop remains the fallback when the pool is paused.
        </p>
      </div>
      <ol className="mt-10 grid gap-4 md:grid-cols-3">
        {HOW.map((step, i) => (
          <li key={step.title} className="panel group p-6 transition-colors hover:border-filament/40">
            <div className="flex items-center justify-between">
              <span className="flex size-11 items-center justify-center rounded-2xl border border-filament/30 bg-filament/10 text-filament">
                <step.icon className="size-5" aria-hidden />
              </span>
              <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
            </div>
            <h3 className="mt-6 text-xl font-semibold tracking-tight">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            <p className="mt-5 inline-block rounded-md bg-foreground/5 px-2 py-1 font-mono text-[11px] text-foreground/70">{step.tag}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Proof                                                               */
/* ------------------------------------------------------------------ */

type Receipt = { label: string; hash: `0x${string}` };

const PROOF: { kicker: string; big: string; title: string; body: string; receipts: Receipt[] }[] = [
  {
    kicker: "Wave 2 · flashLoop",
    big: "4.00×",
    title: "0.015 BTC to 133.33% in one transaction",
    body: "The Wave 2 factory opened 0.05183 BTC of collateral against 3,100.8 MUSD. A keeper then raised 133.30% to 150.00% for 1 MEZO, and one flashUnwind closed the trove.",
    receipts: [
      { label: "flashLoop", hash: "0x576e5383d45538f63658ffdc110d256a4d1a41779efbd7df9c4e0b3d55af0eef" },
      { label: "guard", hash: "0xcb90da8575306d82209d7ba49c0d21caef14e5d5527ec5b9486c4689d71fb54a" },
      { label: "flashUnwind", hash: "0x296bb52c8458bbdd0f00bd8c58f425655cccabb6409c3068bb87e36a9209c3d2" },
    ],
  },
  {
    kicker: "Wave 1 · loop(200%, 1%)",
    big: "200.09%",
    title: "0.0475 BTC looped in one transaction",
    body: "Collateral went from 0.0475 to 0.0939 BTC with 3,859.73 MUSD of debt, landing just above the 200% target.",
    receipts: [{ label: "Loop", hash: "0xfb9af4255b2317ea89feb36c530c29bfeace97b0098a3c6074fec015f52d7f85" }],
  },
  {
    kicker: "Wave 1 · deleverTo(300%)",
    big: "288.04%",
    title: "De-lever raised the ratio",
    body: "One sale repaid the debt to exactly 2,000 MUSD, Mezo's floor for that trove. A second call succeeded without selling.",
    receipts: [
      { label: "Sale 1", hash: "0x8e742936951d59555c236f9c03dfd20d7d3d28d3a91b74e29f7863c18a6885a8" },
      { label: "Call 2", hash: "0xbafe5283fbcb373b167591cec8015b80606e5b970742bb17aa76ea70f47ff060" },
    ],
  },
  {
    kicker: "Wave 1 · unwind(100%)",
    big: "2 txs",
    title: "A fresh 200% trove, fully closed",
    body: "A new 0.046 BTC loop at 200.09% unwound in two transactions: repay to the floor at 281.99%, then close the trove.",
    receipts: [
      { label: "Loop", hash: "0xd72758f1114ac3add69ed08a519603d1059c41c2fa959b9e225fc88769d9fd89" },
      { label: "Unwind 1", hash: "0x3ff34e57f63d0278bf5932442f786bd346e08028f40bae0cbb5dc1f5d2efc2fd" },
      { label: "Unwind 2", hash: "0xd55cdf5fb1d882f36f7c6cc66ff62960eeab30b8a4122240aa09329bcc8defdc" },
    ],
  },
];

export function Proof() {
  return (
    <section id="proof" aria-labelledby="proof-title" className="scroll-mt-24 py-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-filament">Receipts</p>
          <h2 id="proof-title" className="mt-3 max-w-2xl text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
            Already run on Mezo testnet.
          </h2>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          The first card is the Wave 2 factory. The other three are the earlier Wave 1 factory. Click any hash to check it on the Mezo explorer.
        </p>
      </div>
            <div className="mt-10 grid gap-4 lg:grid-cols-2">
        {PROOF.map((item) => (
          <article key={item.title} className="panel flex flex-col p-6">
            <p className="font-mono text-xs text-filament">{item.kicker}</p>
            <p className="num mt-4 text-5xl font-semibold tracking-tighter">{item.big}</p>
            <h3 className="mt-3 text-lg font-semibold tracking-tight">{item.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            <ul className="mt-auto space-y-2 border-t border-border pt-4">
              {item.receipts.map((r) => (
                <li key={r.hash} className="flex items-center justify-between gap-3 text-xs">
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="size-1.5 rounded-full bg-safe" aria-hidden />
                    {r.label}
                  </span>
                  <a
                    href={`${EXPLORER}${r.hash}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 font-mono text-foreground/90 underline decoration-filament/40 underline-offset-[3px] hover:decoration-filament"
                  >
                    {r.hash.slice(0, 10)}…{r.hash.slice(-6)}
                    <ArrowUpRight className="size-3" aria-hidden />
                    <span className="sr-only">{item.kicker} {r.label} on the Mezo explorer</span>
                  </a>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <p className="mt-5 text-xs text-muted-foreground">
        Factory{" "}
        <a className="link font-mono text-foreground" href={`${EXPLORER_ADDRESS}${factoryAddress}`} target="_blank" rel="noreferrer noopener">
          {factoryAddress}
        </a>{" "}
        on chain 31611. Full log in{" "}
        <a className="link text-foreground" href="https://github.com/PrabalParihar/coil/blob/main/DEPLOYMENTS.md" target="_blank" rel="noreferrer noopener">
          DEPLOYMENTS.md
        </a>
        .
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Risks                                                               */
/* ------------------------------------------------------------------ */

const RISKS = [
  {
    icon: TriangleAlert,
    title: "Liquidation at 110%",
    body: "A trove under 110% collateral can be liquidated. Coil will not target below 115%, and the app shows how far BTC can fall before that line.",
  },
  {
    icon: Repeat2,
    title: "Redemptions go lowest-first",
    body: "MUSD redemptions repay the lowest-ratio troves first and take their BTC. A tight coil sits near the front of that queue.",
  },
  {
    icon: ShieldCheck,
    title: "A keeper that can only help",
    body: "If you set a guard, the keeper may call deleverTo up to your target. It cannot loop, unwind, or withdraw. Unset, it cannot touch the trove.",
  },
  {
    icon: TimerReset,
    title: "Exits can take a few txs",
    body: "A big de-lever or a full unwind sells collateral once per transaction because of Mezo's 20-precompile limit. The app sends the next one and links each hash.",
  },
];

export function Risks() {
  return (
    <section id="risks" aria-labelledby="risks-title" className="scroll-mt-24 py-20">
      <p className="eyebrow text-filament">Know the risks</p>
      <h2 id="risks-title" className="mt-3 max-w-2xl text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
        Leverage, with the edges in plain sight.
      </h2>
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        {RISKS.map((risk) => (
          <div key={risk.title} className="panel flex gap-4 p-6">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-foreground/5 text-filament">
              <risk.icon className="size-5" aria-hidden />
            </span>
            <div>
              <h3 className="font-semibold tracking-tight">{risk.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{risk.body}</p>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs text-muted-foreground">Testnet prototype. The contracts are not audited and are not deployed on mainnet.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

export function Footer() {
  return (
    <footer className="mt-10 border-t border-border py-10 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="max-w-md">
          <p className="text-base font-semibold text-foreground">Coil Labs</p>
          <p className="mt-1 leading-relaxed">
            One-transaction BTC leverage on MUSD, with a keeper that can only make you safer, paid in MEZO. Built by{" "}
            <a className="link text-foreground" href="https://prabal.pro" target="_blank" rel="noreferrer noopener">
              Prabal Pratap Singh
            </a>
            .
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
          <a className="hover:text-foreground" href="#app">App</a>
          <Link className="hover:text-foreground" href="/guard">Guard log</Link>
          <Link className="hover:text-foreground" href="/stats">Stats</Link>
          <a className="hover:text-foreground" href="#proof">Receipts</a>
          <a className="hover:text-foreground" href="#risks">Risks</a>
          <a className="inline-flex items-center gap-1.5 hover:text-foreground" href="https://github.com/PrabalParihar/coil" target="_blank" rel="noreferrer noopener">
            <CodeXml className="size-4" aria-hidden /> Source
          </a>
          <a className="inline-flex items-center gap-1 hover:text-foreground" href="https://faucet.test.mezo.org" target="_blank" rel="noreferrer noopener">
            Testnet faucet <ArrowUpRight className="size-3" aria-hidden />
          </a>
        </nav>
      </div>
    </footer>
  );
}
