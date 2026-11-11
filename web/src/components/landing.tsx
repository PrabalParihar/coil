"use client";

import Link from "next/link";
import {
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
import { formatUsd, type Market } from "@/lib/quote";
import { factoryAddress } from "@/lib/mezo";
import { deployment, selectedChain } from "@/lib/network";
import { DEPLOYMENTS } from "@/lib/deployment.generated";
import {
  HERO_PRIMARY,
  HERO_SECONDARY,
  HERO_SUBLINE,
  HERO_TITLE,
  LIMITS_STRIP,
  MOAT_CARDS,
  MOAT_FOOTER,
  MOAT_SUBTITLE,
  MOAT_TITLE,
  PROOF_EXIT_FEE,
  PROOF_OPEN,
  heroEyebrow,
} from "@/lib/product-copy";
import { KeeperStatus } from "@/components/keeper-status";
import { shorten, useMotionOk } from "@/components/shell";

const FLOW = [
  { icon: Bitcoin, title: "BTC in", body: "You deposit bitcoin." },
  { icon: Landmark, title: "Borrow MUSD", body: "Borrowed against that bitcoin." },
  { icon: ArrowLeftRight, title: "Swap on Mezo Pools", body: "MUSD buys more BTC." },
  { icon: Layers, title: "Post the BTC back", body: "It returns to your account." },
] as const;

export function LoopViz() {
  const motionOk = useMotionOk();
  return (
    <figure aria-label="One open, in order" className="panel relative w-full p-3">
      <figcaption className="text-xs text-muted-foreground">One transaction</figcaption>
      <ol className="relative mt-2 space-y-2">
        <span className="absolute top-4 bottom-4 left-[15px] w-px bg-filament/35" aria-hidden>
          {motionOk ? <span className="flow-step" /> : null}
        </span>
        {FLOW.map((step, index) => (
          <li key={step.title} className="relative flex items-center gap-3">
            <span className="relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-filament/40 bg-background text-filament">
              <step.icon className="size-3.5" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="font-mono text-[10px] text-filament">0{index + 1}</span>
              <span className="ml-2 text-sm font-semibold">{step.title}</span>
              <span className="block text-xs leading-snug text-muted-foreground">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

export function Hero({ market, marketError }: { market: Market | null; marketError: string | null }) {
  return (
    <section aria-label="Coil overview" className="border-b border-border py-8 sm:py-12">
      <div className="grid items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(280px,0.95fr)] lg:gap-12">
        <div>
          <span className="chip border-filament/40 text-foreground">{heroEyebrow(selectedChain.id)}</span>
          <h1 className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{HERO_TITLE}</h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground">{HERO_SUBLINE}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <a href="#app" className="btn-btc inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium">
              {HERO_PRIMARY}
            </a>
            <a href="#protection" className="inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm font-medium hover:bg-foreground/5">
              {HERO_SECONDARY}
            </a>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            {market ? `BTC ${formatUsd(market.price)}` : marketError ? "Market data unavailable" : "Reading the oracle"}
            {` · ${deployment.status}`}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="chip">{PROOF_OPEN}</span>
            <span className="chip">{PROOF_EXIT_FEE}</span>
            <KeeperStatus liveChip />
          </div>
        </div>
        <LoopViz />
      </div>
      <section id="protection" aria-labelledby="why-title" className="mt-10 scroll-mt-28">
        <p className="text-xs text-muted-foreground">{MOAT_TITLE}</p>
        <h2 id="why-title" className="mt-2 max-w-2xl text-2xl font-semibold tracking-tight">{MOAT_SUBTITLE}</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {MOAT_CARDS.map((card, index) => (
            <article key={card.title} className="panel p-4">
              <p className="font-mono text-[11px] text-filament">0{index + 1}</p>
              <h3 className="mt-2 text-sm font-semibold">{card.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{card.body}</p>
            </article>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{MOAT_FOOTER}</p>
      </section>
      <p className="mt-4 rounded-lg border border-border px-4 py-3 text-sm leading-relaxed text-muted-foreground">{LIMITS_STRIP}</p>
    </section>
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
    body: "Your BTC opens or tops up a MUSD position in an account you own. The protocol mints MUSD against it.",
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
    body: "The borrowed BTC is posted as collateral. Your account mints the MUSD the pool is owed and repays it in the same transaction, landing on or above your target.",
    tag: "one transaction",
  },
];

export function HowItWorks() {
  return (
    <section id="how" aria-labelledby="how-title" className="scroll-mt-24 border-t border-border py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-filament">How it works</p>
          <h2 id="how-title" className="mt-3 max-w-xl text-2xl font-semibold tracking-tight">
            Three moves. One transaction.
          </h2>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Your account holds the position. A Mezo Pools swap borrows the BTC, posts it, and repays the pool before the transaction ends.
          Transaction paths stay inside the Mezo call limit. A two-swap path remains the fallback when the pool is paused.
        </p>
      </div>
      <ol className="mt-5 grid gap-3 md:grid-cols-3">
        {HOW.map((step, i) => (
          <li key={step.title} className="panel group p-4 transition-colors hover:border-filament/40">
            <div className="flex items-center justify-between">
              <span className="flex size-11 items-center justify-center rounded-2xl border border-filament/30 bg-filament/10 text-filament">
                <step.icon className="size-5" aria-hidden />
              </span>
              <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
            </div>
            <h3 className="mt-4 text-sm font-semibold tracking-tight">{step.title}</h3>
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
    kicker: "Earlier testnet open",
    big: "4.00×",
    title: "0.015 BTC to 133.33% in one transaction",
    body: "An earlier factory opened 0.05183 BTC of collateral against 3,100.8 MUSD. A keeper then raised 133.30% to 150.00% for 1 MEZO, and one close returned the position. Those receipts are not this factory.",
    receipts: [
      { label: "Open", hash: "0x576e5383d45538f63658ffdc110d256a4d1a41779efbd7df9c4e0b3d55af0eef" },
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
    body: "One sale repaid the debt to exactly 2,000 MUSD, Mezo's floor for that position. A second call succeeded without selling.",
    receipts: [
      { label: "Sale 1", hash: "0x8e742936951d59555c236f9c03dfd20d7d3d28d3a91b74e29f7863c18a6885a8" },
      { label: "Call 2", hash: "0xbafe5283fbcb373b167591cec8015b80606e5b970742bb17aa76ea70f47ff060" },
    ],
  },
  {
    kicker: "Wave 1 · unwind(100%)",
    big: "2 txs",
    title: "A fresh 200% position, fully closed",
    body: "A new 0.046 BTC open at 200.09% unwound in two transactions: repay to the floor at 281.99%, then close the position.",
    receipts: [
      { label: "Loop", hash: "0xd72758f1114ac3add69ed08a519603d1059c41c2fa959b9e225fc88769d9fd89" },
      { label: "Unwind 1", hash: "0x3ff34e57f63d0278bf5932442f786bd346e08028f40bae0cbb5dc1f5d2efc2fd" },
      { label: "Unwind 2", hash: "0xd55cdf5fb1d882f36f7c6cc66ff62960eeab30b8a4122240aa09329bcc8defdc" },
    ],
  },
];

export function Proof() {
  return (
    <section id="proof" aria-labelledby="proof-title" className="scroll-mt-24 border-t border-border py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow text-filament">Receipts</p>
          <h2 id="proof-title" className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight">
            Already run on Mezo testnet.
          </h2>
        </div>
        <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
          Historical legacy testnet receipts: the first card is the earlier Wave 2 factory; the other three are Wave 1. They do not prove the new fee/owner-action release or recruited user evidence.
        </p>
      </div>
            <div className="mt-10 grid gap-4 lg:grid-cols-2">
        {PROOF.map((item) => (
          <article key={item.title} className="panel flex flex-col p-6">
            <p className="font-mono text-xs text-filament">{item.kicker}</p>
            <p className="num mt-3 text-2xl font-semibold tracking-tight">{item.big}</p>
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
                    href={`${DEPLOYMENTS["31611"].explorerUrl}/tx/${r.hash}`}
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
        <a className="link font-mono text-foreground" href={`${DEPLOYMENTS["31611"].explorerUrl}/address/${DEPLOYMENTS["31611"].factory}`} target="_blank" rel="noreferrer noopener">
          {DEPLOYMENTS["31611"].factory}
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
    body: "A position under 110% collateral can be liquidated. Coil will not target below 115%, and the app shows how far BTC can fall before that line.",
  },
  {
    icon: Repeat2,
    title: "Redemptions go lowest-first",
    body: "MUSD redemptions repay the lowest-ratio positions first and take their BTC. A tight position sits near the front of that queue.",
  },
  {
    icon: ShieldCheck,
    title: "A keeper that can only help",
    body: "If you set a guard, the keeper may reduce risk up to your target. It cannot open, close, or withdraw. Unset, it cannot touch the position.",
  },
  {
    icon: TimerReset,
    title: "Exits can take a few txs",
    body: "Pool exits require the oracle price bound and Mezo permission. Full close is blocked in Recovery Mode; owner MUSD repayment can reduce debt safely without selling collateral.",
  },
];

export function Risks() {
  return (
    <section id="risks" aria-labelledby="risks-title" className="scroll-mt-24 border-t border-border py-10">
      <p className="eyebrow text-filament">Know the risks</p>
      <h2 id="risks-title" className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight">
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
      <p className="mt-5 text-xs text-muted-foreground">Testnet prototype. The contracts are not audited. Writes stay off until this deployment is confirmed and explicitly enabled.</p>
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
