"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check } from "lucide-react";
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  crToPercent,
  formatBtc,
  formatMusd,
  formatPercent,
  formatUsd,
  leverageLabel,
  percentToCr,
  type LoopPreview,
} from "@/lib/quote";

const EXPLORER = "https://explorer.test.mezo.org/tx/";

const HERO_SPIRAL =
  "M140.29 94.56L142.79 98.77L144.69 103.38L145.94 108.31L146.48 113.45L146.27 118.71L145.29 123.97L143.55 129.13L141.04 134.07L137.79 138.68L133.86 142.85L129.31 146.46L124.20 149.44L118.63 151.70L112.72 153.15L106.56 153.76L100.28 153.49L94.02 152.30L87.90 150.20L82.06 147.22L76.62 143.38L71.73 138.74L67.48 133.37L63.99 127.38L61.36 120.87L59.66 113.96L58.94 106.79L59.26 99.49L60.62 92.22L63.04 85.13L66.47 78.38L70.89 72.10L76.22 66.45L82.36 61.55L89.22 57.52L96.67 54.48L104.56 52.50L112.75 51.64L121.07 51.97L129.35 53.48L137.42 56.18L145.11 60.04L152.25 65.01L158.68 71.00L164.26 77.91L168.85 85.62L172.34 93.99L174.63 102.87L175.65 112.06L175.35 121.41L173.72 130.70L170.76 139.77L166.51 148.40L161.02 156.42L154.39 163.66L146.73 169.94L138.18 175.12L128.90 179.08L119.06 181.71L108.85 182.93L98.49 182.69L88.16 180.98L78.10 177.79L68.50 173.17L59.58 167.19L51.52 159.94L44.51 151.56L38.71 142.19L34.25 132.01L31.25 121.21L29.80 110.00L29.95 98.61L31.72 87.26L35.10 76.18L40.06 65.61L46.51 55.77L54.34 46.87L63.43 39.11L73.60 32.66L84.67 27.67L96.42 24.27L108.63 22.55L121.04 22.57L133.43 24.37L145.52 27.92L157.08 33.18L167.85 40.07L177.62 48.47L186.16 58.24L193.28 69.20L198.83 81.14L202.66 93.83L204.67 107.02L204.80 120.47L203.02 133.88L199.34 147.01L193.80 159.56L186.50 171.29L177.55 181.93L167.12 191.27L155.40 199.10";

export type TxLink = { label: string; hash: `0x${string}` };

export type PreviewState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; quote: LoopPreview };

type FlowState = "wait" | "sign" | "confirm" | "done";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function useMotionOk() {
  const lib = useReducedMotion();
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setOk(!media.matches && lib !== true);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [lib]);
  return ok;
}

export function useCoilMotion() {
  useEffect(() => {
    const paths = Array.from(document.querySelectorAll<SVGPathElement>(".coil-draw"));
    const drift = document.querySelector<HTMLElement>(".coil-drift");
    if (prefersReducedMotion()) {
      paths.forEach((path) => {
        path.style.strokeDashoffset = "0";
      });
      return;
    }
    const draws = paths.map((path, index) =>
      animate(
        path,
        { strokeDashoffset: [1, 0] },
        { duration: 1.7, delay: 0.12 + index * 0.05, ease: [0.16, 1, 0.3, 1] },
      ),
    );
    const sway = drift
      ? animate(
          drift,
          { rotate: [-7, 7] },
          { duration: 9, delay: 1.15, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" },
        )
      : null;
    return () => {
      draws.forEach((draw) => draw.stop());
      sway?.stop();
    };
  }, []);
}

export function shorten(address?: string) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function wadNumber(value: bigint, digits: number) {
  const quant = 10n ** BigInt(digits);
  const truncated = (value * quant) / 10n ** 18n;
  return Number(truncated) / 10 ** digits;
}

function leverageNumber(cr: bigint) {
  const wad = 10n ** 18n;
  if (cr <= wad) return 0;
  return Number((cr * 100n) / (cr - wad)) / 100;
}

function formatCount(value: number, digits: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function TweenValue({
  canonical,
  numeric,
  digits,
  prefix = "",
  suffix = "",
  className,
}: {
  canonical: string;
  numeric: number;
  digits: number;
  prefix?: string;
  suffix?: string;
  className?: string;
}) {
  const [text, setText] = useState(canonical);
  const fromRef = useRef(numeric);
  const shownRef = useRef(numeric);
  const reduceLib = useReducedMotion();

  useEffect(() => {
    const reduce = reduceLib === true || prefersReducedMotion();
    if (reduce || Object.is(fromRef.current, numeric)) {
      fromRef.current = numeric;
      shownRef.current = numeric;
      setText(canonical);
      return;
    }
    const from = fromRef.current;
    shownRef.current = from;
    const controls = animate(from, numeric, {
      duration: 0.65,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (value) => {
        shownRef.current = value;
        setText(`${prefix}${formatCount(value, digits)}${suffix}`);
      },
      onComplete: () => {
        fromRef.current = numeric;
        shownRef.current = numeric;
        setText(canonical);
      },
    });
    return () => {
      controls.stop();
      fromRef.current = shownRef.current;
    };
  }, [canonical, numeric, digits, prefix, suffix, reduceLib]);

  return <span className={cn("tabular-nums", className)}>{text}</span>;
}

export function CoilMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 36 36" className={cn("size-9 shrink-0", className)} aria-hidden>
      <rect width="36" height="36" rx="12" fill="var(--filament)" />
      <path
        d="M18 8c-5 0-8 3-8 7.2 0 3.4 2.2 5.4 5.2 5.4 2.4 0 4-1.3 4-3.2 0-1.6-1.1-2.6-2.7-2.6"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M18 28c5 0 8-3 8-7.2 0-3.4-2.2-5.4-5.2-5.4-2.4 0-4 1.3-4 3.2 0 1.6 1.1 2.6 2.7 2.6"
        fill="none"
        stroke="var(--ink)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function HeroInstrument({ targetPct }: { targetPct: number }) {
  const cr = percentToCr(targetPct);
  return (
    <div className="relative mx-auto w-full max-w-[320px]">
      <div className="pointer-events-none absolute inset-[18%] rounded-full bg-filament/15 blur-3xl" aria-hidden />
      <div className="coil-drift relative aspect-square">
        <svg viewBox="0 0 220 220" className="h-full w-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id="hero-filament" x1="20" y1="20" x2="200" y2="200" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#ffe7c2" />
              <stop offset="42%" stopColor="#f5a524" />
              <stop offset="100%" stopColor="#e07a12" />
            </linearGradient>
          </defs>
          <circle cx="110" cy="110" r="86" fill="none" stroke="currentColor" strokeOpacity="0.08" />
          <circle cx="110" cy="110" r="58" fill="none" stroke="currentColor" strokeOpacity="0.06" />
          <path
            d={HERO_SPIRAL}
            pathLength={1}
            className="coil-draw"
            fill="none"
            stroke="url(#hero-filament)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <TweenValue
            canonical={leverageLabel(cr)}
            numeric={leverageNumber(cr)}
            digits={2}
            suffix="×"
            className="font-serif text-5xl leading-none tracking-tight"
          />
          <p className="mt-2 text-[11px] tracking-[0.18em] text-muted-foreground uppercase">Leverage</p>
        </div>
      </div>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        <TweenValue canonical={`${targetPct}%`} numeric={targetPct} digits={0} suffix="%" /> collateral
      </p>
    </div>
  );
}

export function Rail({
  label,
  display,
  min,
  max,
  step,
  value,
  onValueChange,
  ticks,
  hint,
  thumbLabel,
}: {
  label: string;
  display: React.ReactNode;
  min: number;
  max: number;
  step: number;
  value: number;
  onValueChange: (value: number) => void;
  ticks?: number[];
  hint?: string;
  thumbLabel: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-4">
        <Label className="pb-1 text-[11px] tracking-[0.16em] text-muted-foreground uppercase">{label}</Label>
        <div className="text-right">{display}</div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(next) => onValueChange(next[0] ?? value)}
        thumbLabel={thumbLabel}
      />
      {ticks ? (
        <div className="relative h-4 text-[10px] tracking-wide text-muted-foreground">
          {ticks.map((tick) => {
            const t = (tick - min) / (max - min);
            const align = t <= 0.001 ? "" : t >= 0.999 ? "-translate-x-full" : "-translate-x-1/2";
            return (
              <span key={tick} className={cn("absolute top-0", align)} style={{ left: `${t * 100}%` }}>
                {tick}
              </span>
            );
          })}
        </div>
      ) : null}
      {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function HealthFilament({ percent }: { percent: number }) {
  const t = Math.min(1, Math.max(0, (percent - 110) / 210));
  const tight = percent < 130;
  return (
    <div>
      <div className="relative h-px bg-foreground/15">
        <div
          className={cn("absolute inset-y-0 left-0 transition-[width] duration-500", tight ? "bg-destructive" : "bg-filament")}
          style={{ width: `${t * 100}%` }}
        />
        <div
          className={cn(
            "absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left] duration-500",
            tight ? "bg-destructive" : "bg-filament",
          )}
          style={{ left: `${t * 100}%` }}
        />
      </div>
      <div className="mt-2 flex justify-between text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
        <span>110% liquidation</span>
        <span>Safer</span>
      </div>
    </div>
  );
}

function MeterFigure({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="font-serif text-2xl leading-none tracking-tight sm:text-[1.7rem]">{children}</div>
      <div className="mt-2 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">{label}</div>
    </div>
  );
}

export function PreviewPanel({ quote }: { quote: PreviewState }) {
  if (quote.kind === "loading") {
    return (
      <div className="meter px-4 py-5" aria-busy="true">
        <p className="text-sm text-muted-foreground">Reading the pool and the oracle…</p>
        <div className="mt-4 grid grid-cols-3 gap-3">
          {["Ratio", "Liquidation", "Debt"].map((label) => (
            <div key={label} className="space-y-2">
              <div className="skeleton h-7 rounded-md" />
              <div className="skeleton h-3 w-14 rounded-md" />
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (quote.kind === "error") {
    return (
      <div className="meter border-destructive/35 px-4 py-5" role="alert">
        <p className="text-[11px] tracking-[0.16em] text-destructive uppercase">Preview</p>
        <p className="mt-2 text-sm leading-relaxed text-foreground">{quote.message}</p>
      </div>
    );
  }
  const q = quote.quote;
  const ratio = crToPercent(q.cr);
  return (
    <div className="meter px-4 py-4 sm:px-5">
      <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">After this loop</p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        <MeterFigure label="Ratio">
          <TweenValue canonical={formatPercent(q.cr)} numeric={ratio} digits={2} suffix="%" />
        </MeterFigure>
        <MeterFigure label="Liq. price">
          <TweenValue
            canonical={formatUsd(q.liquidationPrice)}
            numeric={wadNumber(q.liquidationPrice, 0)}
            digits={0}
            prefix="$"
          />
        </MeterFigure>
        <MeterFigure label="Debt">
          <TweenValue
            canonical={formatMusd(q.debt)}
            numeric={wadNumber(q.debt, 2)}
            digits={2}
          />
        </MeterFigure>
      </div>
      <div className="mt-4">
        <HealthFilament percent={ratio} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        {q.leverage} exposure · collateral{" "}
        <TweenValue canonical={formatBtc(q.collateral)} numeric={wadNumber(q.collateral, 4)} digits={4} /> BTC · minted{" "}
        <TweenValue canonical={formatMusd(q.musdMinted)} numeric={wadNumber(q.musdMinted, 2)} digits={2} /> MUSD ·{" "}
        {q.iterations} {q.iterations === 1 ? "swap" : "swaps"}
      </p>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}) {
  return (
    <div className="meter px-5 py-8">
      <CoilMark className="mb-4" />
      <p className="font-serif text-2xl tracking-tight">{title}</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action ? (
        <Button
          type="button"
          className="mt-5 h-11 px-5"
          onClick={action.onClick}
          disabled={action.disabled}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

export function Banner({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone: "warn" | "bad";
}) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm",
        tone === "bad" ? "border-destructive/40 bg-destructive/10" : "border-border bg-foreground/[0.03]",
      )}
    >
      <p className="font-medium text-foreground">{title}</p>
      <p className="mt-1 leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

export function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
        {label}
      </Label>
      <Input
        id={id}
        inputMode="numeric"
        value={String(value)}
        onChange={(event) => onChange(Number(event.target.value || 0))}
        className="h-11 rounded-xl md:text-sm"
      />
    </div>
  );
}

function stripWaiting(status: string | null) {
  if (!status) return null;
  return status.replace(/\. Waiting for the Mezo receipt…$/, "");
}

function stepNumber(label: string) {
  const match = label.match(/^(?:De-lever|Unwind) (\d+)/);
  return match ? Number(match[1]) : null;
}

export function activityScope(
  status: string | null,
  txs: { label: string }[],
  error: string | null,
): "compose" | "position" | null {
  if (!status && txs.length === 0 && !error) return null;
  const position =
    txs.some((tx) => tx.label.startsWith("De-lever") || tx.label.startsWith("Unwind")) ||
    Boolean(status?.startsWith("De-lever")) ||
    Boolean(status?.startsWith("Unwind")) ||
    Boolean(status?.startsWith("Ratio is now")) ||
    Boolean(status?.startsWith("Debt is now")) ||
    Boolean(status?.startsWith("Trove closed")) ||
    Boolean(status?.startsWith("The trove is closed"));
  return position ? "position" : "compose";
}

function ExplorerLink({ tx }: { tx: TxLink }) {
  return (
    <a
      className="link mt-1 inline-flex items-center gap-1 font-mono text-[11px] text-foreground/90"
      href={`${EXPLORER}${tx.hash}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      <span className="sr-only">{tx.label} on the Mezo explorer</span>
      <span aria-hidden>
        {tx.hash.slice(0, 10)}…{tx.hash.slice(-4)}
      </span>
      <ArrowUpRight className="size-3" aria-hidden />
    </a>
  );
}

function StepNode({ state, n }: { state: FlowState; n: number }) {
  return (
    <span
      data-state={state}
      className={cn(
        "relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px]",
        state === "done" && "border-filament bg-filament text-ink",
        (state === "sign" || state === "confirm") && "node-live border-filament bg-background text-filament",
        state === "wait" && "border-border bg-background text-muted-foreground",
      )}
    >
      {state === "done" ? (
        <Check className="size-3.5" aria-hidden />
      ) : state === "wait" ? (
        n
      ) : (
        <span className="spinner" aria-hidden />
      )}
    </span>
  );
}

function phaseCopy(state: FlowState) {
  if (state === "sign") return "Confirm in your wallet";
  if (state === "confirm") return "Waiting for the Mezo receipt";
  if (state === "done") return "Confirmed";
  return "Queued";
}

function flowKind(status: string | null, txs: TxLink[]) {
  const sample = txs.find((tx) => stepNumber(tx.label))?.label ?? status ?? "";
  if (sample.startsWith("Unwind") || status?.startsWith("Unwind")) return "unwind" as const;
  if (
    sample.startsWith("De-lever") ||
    status?.startsWith("De-lever") ||
    txs.some((tx) => tx.label.startsWith("De-lever"))
  ) {
    return "delever" as const;
  }
  return null;
}

export function Activity({
  status,
  txs,
  error,
  busy,
  deleverPct,
  unwindPct,
}: {
  status: string | null;
  txs: TxLink[];
  error: string | null;
  busy: boolean;
  deleverPct: number;
  unwindPct: number;
}) {
  const kind = flowKind(status, txs);
  return (
    <div className="mt-5 space-y-3" aria-live="polite">
      {kind ? (
        <StepRail
          kind={kind}
          status={status}
          txs={txs}
          busy={busy}
          deleverPct={deleverPct}
          unwindPct={unwindPct}
        />
      ) : status || txs.length > 0 ? (
        <SingleTrack status={status} txs={txs} busy={busy} />
      ) : null}
      {kind && !busy && status ? (
        <p className="text-sm leading-relaxed text-muted-foreground">{status}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm leading-relaxed break-words text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SingleTrack({
  status,
  txs,
  busy,
}: {
  status: string | null;
  txs: TxLink[];
  busy: boolean;
}) {
  const active = stripWaiting(status);
  const waiting = Boolean(status?.includes("Waiting"));
  const pending = busy && active && !txs.some((tx) => tx.label === active);
  return (
    <div className="meter space-y-3 px-4 py-3">
      {pending ? (
        <div className="flex items-start gap-3">
          <StepNode state="sign" n={1} />
          <div>
            <p className="text-sm font-medium">{active}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Confirm in your wallet</p>
          </div>
        </div>
      ) : null}
      {txs.map((tx, index) => {
        const confirming = busy && waiting && tx.label === active;
        return (
          <div key={tx.hash} className="flex items-start gap-3">
            <StepNode state={confirming ? "confirm" : "done"} n={index + 1} />
            <div>
              <p className="text-sm font-medium">{tx.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {confirming ? "Waiting for the Mezo receipt" : !busy && index === txs.length - 1 && status ? status : "Confirmed"}
              </p>
              <ExplorerLink tx={tx} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StepRail({
  kind,
  status,
  txs,
  busy,
  deleverPct,
  unwindPct,
}: {
  kind: "delever" | "unwind";
  status: string | null;
  txs: TxLink[];
  busy: boolean;
  deleverPct: number;
  unwindPct: number;
}) {
  const motionOk = useMotionOk();
  const active = stripWaiting(status);
  const activeN = active ? stepNumber(active) : null;
  const waiting = Boolean(status?.includes("Waiting"));
  const steps = [1, 2, 3, 4].map((n) => {
    const tx = txs.find((item) => stepNumber(item.label) === n);
    let state: FlowState = "wait";
    if (tx && activeN === n && waiting) state = "confirm";
    else if (tx) state = "done";
    else if (busy && activeN === n) state = "sign";
    const fallback =
      kind === "delever"
        ? `De-lever ${n} of the way to ${deleverPct}%`
        : unwindPct === 100
          ? `Unwind ${n}: closing the trove`
          : `Unwind ${n}: repaying debt`;
    return {
      n,
      state,
      title: kind === "delever" ? `Sale ${n}` : `Repay ${n}`,
      label: tx?.label ?? fallback,
      hash: tx,
    };
  });
  const visible = busy ? steps : steps.filter((step) => step.state === "done");
  return (
    <div className="meter px-4 py-4">
      <p className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">
        {kind === "delever" ? "De-lever" : "Unwind"} · one sale per transaction
      </p>
      <ol className="mt-3" aria-label={kind === "delever" ? "De-lever progress" : "Unwind progress"}>
        <AnimatePresence initial={false}>
          {visible.map((step, index) => (
            <motion.li
              key={step.n}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: motionOk ? 0.35 : 0, ease: [0.16, 1, 0.3, 1] }}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {index < visible.length - 1 ? (
                <motion.span
                  aria-hidden
                  className="absolute top-6 left-[11px] w-px origin-top bg-filament"
                  initial={false}
                  animate={{ scaleY: step.state === "done" ? 1 : 0 }}
                  transition={{ duration: motionOk ? 0.45 : 0 }}
                  style={{ height: "calc(100% - 8px)" }}
                />
              ) : null}
              <StepNode state={step.state} n={step.n} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{step.title}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{phaseCopy(step.state)}</p>
                <p className="sr-only">{step.label}</p>
                {step.hash ? <ExplorerLink tx={step.hash} /> : null}
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}
