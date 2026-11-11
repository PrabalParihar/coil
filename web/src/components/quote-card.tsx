import { cn } from "cn";
import type { QuoteCardView } from "@/lib/quote-card";

export function QuoteCard({ view }: { view: QuoteCardView }) {
  return (
    <div className="mt-5" data-quote-badge={view.blocked ? "Sample" : "Quote"}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-muted-foreground">If you opened this amount</p>
        <span className={cn("chip shrink-0", view.blocked ? "border-warn/50 text-warn" : "border-safe/40 text-safe")}>
          {view.badge}
        </span>
      </div>
      <p className="mt-3 text-[11px] text-muted-foreground">Liquidation price</p>
      <p className="num mt-1 text-4xl font-semibold tracking-tight sm:text-5xl">
        {view.liquidationPrice ?? "Not available for this amount"}
      </p>
      <p className="mt-3 text-sm font-medium">{view.dropLine ?? "BTC can fall: not available for this amount"}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{view.feeLine ?? "Fees appear after the oracle and pool are read."}</p>
      {view.feeCapLabel ? <p className="mt-1 text-xs text-muted-foreground">{view.feeCapLabel}</p> : null}
      {view.pegMessage ? (
        <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm leading-relaxed" role="status">
          {view.pegMessage}
        </p>
      ) : null}
      {view.slippageMessage ? (
        <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm leading-relaxed" role="alert">
          {view.slippageMessage}
        </p>
      ) : null}
      {view.overLimitMessage ? (
        <p className="mt-4 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm leading-relaxed" role="alert">
          {view.overLimitMessage}
        </p>
      ) : null}
    </div>
  );
}
