"use client";

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, Check, X } from "lucide-react";
import { animate, AnimatePresence, motion, useReducedMotion } from "motion/react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

export const EXPLORER = "https://explorer.test.mezo.org/tx/";
export const EXPLORER_ADDRESS = "https://explorer.test.mezo.org/address/";

export type TxLink = { label: string; hash: `0x${string}` };

type FlowState = "wait" | "sign" | "confirm" | "done" | "failed";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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

/** Draws every `.coil-draw` path once on mount. */
export function useCoilMotion() {
  useEffect(() => {
    const paths = Array.from(document.querySelectorAll<SVGPathElement>(".coil-draw"));
    if (prefersReducedMotion()) {
      paths.forEach((path) => {
        path.style.strokeDashoffset = "0";
      });
      return;
    }
    const draws = paths.map((path, index) =>
      animate(path, { strokeDashoffset: [1, 0] }, { duration: 1.8, delay: 0.15 + index * 0.08, ease: [0.16, 1, 0.3, 1] }),
    );
    return () => draws.forEach((draw) => draw.stop());
  }, []);
}

export function shorten(address?: string) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function formatCount(value: number, digits: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
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
      duration: 0.6,
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
      <defs>
        <linearGradient id="coil-mark" x1="0" y1="0" x2="36" y2="36" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffc06b" />
          <stop offset=".55" stopColor="#f7931a" />
          <stop offset="1" stopColor="#e2640c" />
        </linearGradient>
      </defs>
      <rect width="36" height="36" rx="10" fill="url(#coil-mark)" />
      <path d="M25.5 13.2a9 9 0 1 0 1.3 7.6" fill="none" stroke="#1a0f02" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M26.6 8.8l-.6 5.3-5.2-1" fill="none" stroke="#1a0f02" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="18" cy="18" r="3" fill="#1a0f02" />
    </svg>
  );
}

/* ---------------- risk language ---------------- */

export type RiskLevel = "safe" | "warn" | "danger";

export function riskOf(percent: number): { level: RiskLevel; word: string; tone: string; bg: string; border: string } {
  if (percent < 150) {
    return { level: "danger", word: "High risk", tone: "text-danger", bg: "bg-danger", border: "border-danger/40" };
  }
  if (percent < 200) {
    return { level: "warn", word: "Moderate", tone: "text-warn", bg: "bg-warn", border: "border-warn/40" };
  }
  return { level: "safe", word: "Comfortable", tone: "text-safe", bg: "bg-safe", border: "border-safe/40" };
}

/** Share of BTC price that can fall before the trove reaches the 110% liquidation ratio. */
export function dropToLiquidation(percent: number) {
  if (!Number.isFinite(percent) || percent <= 110) return 0;
  return (1 - 110 / percent) * 100;
}

export function leverageFromPercent(percent: number) {
  if (percent <= 100) return 0;
  return percent / (percent - 100);
}

export function RiskPill({ percent, className }: { percent: number; className?: string }) {
  const risk = riskOf(percent);
  return (
    <span className={cn("chip border", risk.border, risk.tone, className)}>
      <span className={cn("size-1.5 rounded-full", risk.bg)} aria-hidden />
      {risk.word}
    </span>
  );
}

function zoneGradient(min: number, max: number) {
  const at = (v: number) => `${Math.min(100, Math.max(0, ((v - min) / (max - min)) * 100)).toFixed(2)}%`;
  return `linear-gradient(90deg, var(--danger) 0%, var(--danger) ${at(150)}, var(--warn) ${at(150)}, var(--warn) ${at(200)}, var(--safe) ${at(200)}, var(--safe) 100%)`;
}

/* ---------------- inputs ---------------- */

export function RatioSlider({
  label,
  min,
  max,
  step,
  value,
  onValueChange,
  ticks,
  thumbLabel,
  zoned = true,
  display,
  hint,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onValueChange: (value: number) => void;
  ticks?: number[];
  thumbLabel: string;
  zoned?: boolean;
  display?: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-4">
        <Label className="eyebrow pb-1">{label}</Label>
        {display}
      </div>
      <div className="relative">
        {zoned ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full opacity-75"
            style={{ background: zoneGradient(min, max) }}
            aria-hidden
          />
        ) : null}
        <Slider
          min={min}
          max={max}
          step={step}
          value={[value]}
          onValueChange={(next) => onValueChange(next[0] ?? value)}
          thumbLabel={thumbLabel}
          trackClassName={zoned ? "bg-transparent data-horizontal:h-2.5" : undefined}
          rangeClassName={zoned ? "bg-transparent" : undefined}
        />
      </div>
      {ticks ? (
        <div className="relative h-4 font-mono text-[10px] text-muted-foreground">
          {ticks.map((tick) => {
            const t = (tick - min) / (max - min);
            const align = t <= 0.001 ? "" : t >= 0.999 ? "-translate-x-full" : "-translate-x-1/2";
            return (
              <span key={tick} className={cn("absolute top-0", align)} style={{ left: `${t * 100}%` }}>
                {tick}%
              </span>
            );
          })}
        </div>
      ) : null}
      {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ChipGroup<T extends number | string>({
  label,
  options,
  value,
  onChange,
  render,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  render: (value: T) => string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={String(option)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option)}
            className={cn(
              "h-8 rounded-full border px-3 font-mono text-xs transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active
                ? "border-filament/70 bg-filament/15 text-foreground"
                : "border-border text-muted-foreground hover:border-foreground/25 hover:text-foreground",
            )}
          >
            {render(option)}
          </button>
        );
      })}
    </div>
  );
}

export function NumberField({
  id,
  label,
  value,
  onChange,
  suffix,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="eyebrow">
        {label}
      </Label>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          value={String(value)}
          onChange={(event) => onChange(Number(event.target.value || 0))}
          className="h-11 rounded-xl bg-black/25 pr-9 font-mono md:text-sm dark:bg-black/25"
        />
        {suffix ? (
          <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-xs text-muted-foreground" aria-hidden>
            {suffix}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- meters ---------------- */

const METER_MIN = 110;
const METER_MAX = 350;

/** Linear ratio meter: 110% liquidation on the left, safer to the right. */
export function HealthBar({ percent, compact = false }: { percent: number; compact?: boolean }) {
  const t = Math.min(1, Math.max(0, (percent - METER_MIN) / (METER_MAX - METER_MIN)));
  const risk = riskOf(percent);
  const mark = (v: number) => `${((v - METER_MIN) / (METER_MAX - METER_MIN)) * 100}%`;
  return (
    <div>
      <div className="relative h-2 rounded-full bg-foreground/8">
        <div className="absolute inset-0 rounded-full opacity-35" style={{ background: zoneGradient(METER_MIN, METER_MAX) }} aria-hidden />
        <div
          className="absolute inset-y-0 left-0 rounded-full opacity-90 transition-[width] duration-500"
          style={{ width: `${t * 100}%`, background: zoneGradient(METER_MIN, METER_MAX), backgroundSize: `${100 / Math.max(t, 0.001)}% 100%` }}
          aria-hidden
        />
        <span className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-foreground/50" style={{ left: mark(115) }} aria-hidden />
        <div
          className={cn(
            "absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-background transition-[left] duration-500",
            risk.bg,
          )}
          style={{ left: `${t * 100}%` }}
          aria-hidden
        />
      </div>
      {!compact ? (
        <div className="relative mt-2 h-4 font-mono text-[10px] text-muted-foreground">
          <span className="absolute left-0">110% liq.</span>
          <span className="absolute -translate-x-1/2" style={{ left: mark(150) }}>150</span>
          <span className="absolute -translate-x-1/2" style={{ left: mark(200) }}>200</span>
          <span className="absolute -translate-x-1/2" style={{ left: mark(300) }}>300</span>
          <span className="absolute right-0">safer →</span>
        </div>
      ) : null}
    </div>
  );
}

function polar(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 180) * Math.PI) / 180;
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
}

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x1, y1] = polar(cx, cy, r, from);
  const [x2, y2] = polar(cx, cy, r, to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Semicircle collateral-ratio gauge with liquidation / moderate / comfortable zones. */
export function CrGauge({
  percent,
  label,
  sub,
  empty = false,
}: {
  percent: number;
  label: React.ReactNode;
  sub?: React.ReactNode;
  empty?: boolean;
}) {
  const deg = (v: number) => (Math.min(METER_MAX, Math.max(METER_MIN, v)) - METER_MIN) / (METER_MAX - METER_MIN) * 180;
  const needle = deg(percent);
  const risk = riskOf(percent);
  const [nx, ny] = polar(120, 120, 82, needle);
  return (
    <div className="relative mx-auto w-full max-w-[300px]">
      <svg viewBox="0 0 240 140" className="w-full overflow-visible" role="img" aria-label={empty ? "No open trove" : `Collateral ratio gauge at ${percent.toFixed(2)} percent`}>
        <path d={arc(120, 120, 100, 0, 180)} fill="none" stroke="currentColor" strokeOpacity="0.08" strokeWidth="16" strokeLinecap="round" />
        {!empty ? (
          <>
            <path d={arc(120, 120, 100, 0.5, deg(150))} fill="none" stroke="var(--danger)" strokeOpacity="0.85" strokeWidth="16" />
            <path d={arc(120, 120, 100, deg(150), deg(200))} fill="none" stroke="var(--warn)" strokeOpacity="0.85" strokeWidth="16" />
            <path d={arc(120, 120, 100, deg(200), 179.5)} fill="none" stroke="var(--safe)" strokeOpacity="0.85" strokeWidth="16" />
          </>
        ) : null}
        {[115, 150, 200, 300].map((v) => {
          const [x1, y1] = polar(120, 120, 88, deg(v));
          const [x2, y2] = polar(120, 120, 112, deg(v));
          return <line key={v} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--background)" strokeWidth="2" />;
        })}
        {!empty ? (
          <motion.g initial={false} animate={{ opacity: 1 }}>
            <line x1="120" y1="120" x2={nx} y2={ny} stroke="var(--foreground)" strokeWidth="3" strokeLinecap="round" style={{ transition: "all 0.6s cubic-bezier(0.16,1,0.3,1)" }} />
            <circle cx="120" cy="120" r="7" fill="var(--foreground)" />
            <circle cx="120" cy="120" r="3" className={risk.level === "danger" ? "fill-danger" : risk.level === "warn" ? "fill-warn" : "fill-safe"} />
          </motion.g>
        ) : null}
        <text x="14" y="138" className="fill-muted-foreground font-mono" fontSize="9">110%</text>
        <text x="226" y="138" textAnchor="end" className="fill-muted-foreground font-mono" fontSize="9">350%+</text>
      </svg>
      <div className="mt-1 text-center">
        <div className="num text-4xl font-medium tracking-tight sm:text-5xl">{label}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </div>
    </div>
  );
}

/* ---------------- review rows ---------------- */

export function ReviewRow({
  label,
  before,
  after,
  emphasis = false,
  tone,
}: {
  label: string;
  before?: React.ReactNode;
  after: React.ReactNode;
  emphasis?: boolean;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={cn("num flex items-baseline gap-2 text-right", emphasis ? "text-lg font-medium" : "text-sm", tone)}>
        {before !== undefined ? (
          <>
            <span className="text-muted-foreground/80">{before}</span>
            <ArrowRight className="size-3.5 self-center text-muted-foreground" aria-hidden />
          </>
        ) : null}
        <span>{after}</span>
      </dd>
    </div>
  );
}

/* ---------------- states ---------------- */

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string;
  body: React.ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
  icon?: React.ReactNode;
}) {
  return (
    <div className="well flex flex-col items-center px-6 py-10 text-center">
      {icon ?? <CoilMark className="mb-4 size-11 opacity-90" />}
      <p className="text-lg font-medium tracking-tight">{title}</p>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action ? (
        <Button type="button" className="btn-btc mt-5 h-11 px-6 font-semibold" onClick={action.onClick} disabled={action.disabled}>
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
  action,
}: {
  title: string;
  children: React.ReactNode;
  tone: "warn" | "bad" | "info";
  action?: React.ReactNode;
}) {
  return (
    <div
      role={tone === "bad" ? "alert" : "status"}
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm",
        tone === "bad" && "border-danger/40 bg-danger/10",
        tone === "warn" && "border-warn/40 bg-warn/10",
        tone === "info" && "border-border bg-foreground/[0.03]",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <AlertTriangle className={cn("mt-0.5 size-4 shrink-0", tone === "bad" ? "text-danger" : tone === "warn" ? "text-warn" : "text-muted-foreground")} aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-foreground">{title}</p>
          <p className="mt-0.5 leading-relaxed break-words text-muted-foreground">{children}</p>
        </div>
      </div>
      {action}
    </div>
  );
}

/* ---------------- transaction progress ---------------- */

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

export function ExplorerLink({ hash, label }: { hash: `0x${string}`; label?: string }) {
  return (
    <a
      className="inline-flex items-center gap-1 rounded-md font-mono text-[11px] text-foreground/90 underline decoration-filament/50 underline-offset-[3px] hover:decoration-filament"
      href={`${EXPLORER}${hash}`}
      target="_blank"
      rel="noreferrer noopener"
    >
      {label ? <span className="sr-only">{label} on the Mezo explorer</span> : null}
      <span aria-hidden>
        {hash.slice(0, 10)}…{hash.slice(-6)}
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
        "relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-[11px]",
        state === "done" && "border-safe bg-safe text-ink",
        (state === "sign" || state === "confirm") && "node-live border-filament bg-background text-filament",
        state === "wait" && "border-border bg-background text-muted-foreground",
        state === "failed" && "border-danger bg-danger/15 text-danger",
      )}
    >
      {state === "done" ? (
        <Check className="size-3.5" aria-hidden />
      ) : state === "failed" ? (
        <X className="size-3.5" aria-hidden />
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
  if (state === "confirm") return "Mining on Mezo testnet";
  if (state === "done") return "Confirmed";
  if (state === "failed") return "Did not go through";
  return "Queued";
}

const PHASES = ["Sign", "Mining", "Confirmed"] as const;

function PhasePips({ state }: { state: FlowState }) {
  const index = state === "sign" ? 0 : state === "confirm" ? 1 : state === "done" ? 3 : state === "failed" ? -1 : -2;
  return (
    <ol className="grid grid-cols-3 gap-1.5" aria-label="Transaction phases">
      {PHASES.map((phase, i) => {
        const done = index > i || index === 3;
        const live = index === i;
        return (
          <li key={phase} className="space-y-1.5">
            <div
              className={cn(
                "h-1 overflow-hidden rounded-full bg-foreground/10",
                done && "bg-safe",
                state === "failed" && "bg-danger/50",
              )}
            >
              {live ? <div className="pip-live h-full" /> : null}
            </div>
            <p className={cn("font-mono text-[10px] tracking-wide uppercase", done ? "text-safe" : live ? "text-filament" : "text-muted-foreground")}>
              {phase}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

function flowKind(status: string | null, txs: TxLink[]) {
  const sample = txs.find((tx) => stepNumber(tx.label))?.label ?? status ?? "";
  if (sample.startsWith("Unwind") || status?.startsWith("Unwind")) return "unwind" as const;
  if (sample.startsWith("De-lever") || status?.startsWith("De-lever") || txs.some((tx) => tx.label.startsWith("De-lever"))) {
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
  onDismiss,
}: {
  status: string | null;
  txs: TxLink[];
  error: string | null;
  busy: boolean;
  deleverPct: number;
  unwindPct: number;
  onDismiss?: () => void;
}) {
  const kind = flowKind(status, txs);
  return (
    <div className="well mt-4 space-y-4 px-4 py-4" aria-live="polite">
      <div className="flex items-center justify-between gap-3">
        <p className="eyebrow">
          {kind === "delever" ? "De-lever · one sale per transaction" : kind === "unwind" ? "Unwind · one sale per transaction" : "Transaction progress"}
        </p>
        {!busy && onDismiss ? (
          <button type="button" onClick={onDismiss} className="rounded-full p-1 text-muted-foreground hover:text-foreground" aria-label="Dismiss transaction progress">
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {kind ? (
        <StepRail kind={kind} status={status} txs={txs} busy={busy} deleverPct={deleverPct} unwindPct={unwindPct} failed={Boolean(error)} />
      ) : (
        <SingleTrack status={status} txs={txs} busy={busy} failed={Boolean(error)} />
      )}
      {kind && !busy && status ? <p className="text-sm leading-relaxed text-foreground/90">{status}</p> : null}
      {error ? (
        <div role="alert" className="rounded-xl border border-danger/35 bg-danger/10 px-3 py-2.5 text-sm leading-relaxed break-words text-danger">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function SingleTrack({ status, txs, busy, failed }: { status: string | null; txs: TxLink[]; busy: boolean; failed: boolean }) {
  const active = stripWaiting(status);
  const waiting = Boolean(status?.includes("Waiting"));
  const pending = busy && active && !txs.some((tx) => tx.label === active);
  const last = txs[txs.length - 1];
  const headState: FlowState = pending ? "sign" : busy && waiting ? "confirm" : failed ? "failed" : txs.length > 0 ? "done" : "wait";
  return (
    <div className="space-y-4">
      <PhasePips state={headState} />
      <ol className="space-y-3">
        {pending ? (
          <li className="flex items-start gap-3">
            <StepNode state="sign" n={txs.length + 1} />
            <div>
              <p className="text-sm font-medium">{active}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Confirm in your wallet</p>
            </div>
          </li>
        ) : null}
        {txs.map((tx, index) => {
          const confirming = busy && waiting && tx.label === active;
          const isLast = tx === last;
          const state: FlowState = confirming ? "confirm" : failed && isLast ? "failed" : "done";
          return (
            <li key={tx.hash} className="flex items-start gap-3">
              <StepNode state={state} n={index + 1} />
              <div className="min-w-0">
                <p className="text-sm font-medium">{tx.label}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {confirming ? phaseCopy("confirm") : !busy && isLast && status && !failed ? status : phaseCopy(state)}
                </p>
                <div className="mt-1">
                  <ExplorerLink hash={tx.hash} label={tx.label} />
                </div>
              </div>
            </li>
          );
        })}
        {!pending && txs.length === 0 && failed ? (
          <li className="flex items-start gap-3">
            <StepNode state="failed" n={1} />
            <div>
              <p className="text-sm font-medium">{active ?? "Transaction"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">Nothing was sent.</p>
            </div>
          </li>
        ) : null}
      </ol>
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
  failed,
}: {
  kind: "delever" | "unwind";
  status: string | null;
  txs: TxLink[];
  busy: boolean;
  deleverPct: number;
  unwindPct: number;
  failed: boolean;
}) {
  const motionOk = useMotionOk();
  const active = stripWaiting(status);
  const activeN = active ? stepNumber(active) : null;
  const waiting = Boolean(status?.includes("Waiting"));
  const steps = [1, 2, 3, 4].map((n) => {
    const tx = txs.find((item) => stepNumber(item.label) === n);
    let state: FlowState = "wait";
    if (tx && activeN === n && waiting && busy) state = "confirm";
    else if (tx) state = "done";
    else if (busy && activeN === n) state = "sign";
    else if (failed && activeN === n) state = "failed";
    const fallback =
      kind === "delever"
        ? `De-lever ${n} of the way to ${deleverPct}%`
        : unwindPct === 100
          ? `Unwind ${n}: closing the trove`
          : `Unwind ${n}: repaying debt`;
    return { n, state, title: kind === "delever" ? `Sale ${n}` : `Repay ${n}`, label: tx?.label ?? fallback, hash: tx };
  });
  const visible = busy ? steps.filter((step) => step.n <= Math.max(activeN ?? 1, 2)) : steps.filter((step) => step.state === "done" || step.state === "failed");
  return (
    <ol aria-label={kind === "delever" ? "De-lever progress" : "Unwind progress"}>
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
              <span
                aria-hidden
                className={cn("absolute top-7 left-[13px] w-px", step.state === "done" ? "bg-safe" : "bg-border")}
                style={{ height: "calc(100% - 12px)" }}
              />
            ) : null}
            <StepNode state={step.state} n={step.n} />
            <div className="min-w-0">
              <p className="text-sm font-medium">{step.title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{phaseCopy(step.state)}</p>
              <p className="sr-only">{step.label}</p>
              {step.hash ? (
                <div className="mt-1">
                  <ExplorerLink hash={step.hash.hash} label={step.hash.label} />
                </div>
              ) : null}
            </div>
          </motion.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}
