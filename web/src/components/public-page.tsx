import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { CoilMark } from "@/components/shell";
import { MobileNavigation, SiteNavigation } from "@/components/site-navigation";
import { deployment, selectedChain } from "@/lib/network";

export function PublicPage({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <div className="relative isolate min-h-screen">
    <div className="atmosphere pointer-events-none fixed inset-0 -z-10" aria-hidden />
    <a href="#public-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-filament focus:px-4 focus:py-3 focus:text-ink">Skip to content</a>
    <header className="sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2.5" aria-label="Coil Labs home"><CoilMark className="size-8" /><span className="whitespace-nowrap text-lg font-semibold tracking-tight">Coil Labs</span></Link>
        <SiteNavigation />
        <div className="flex items-center gap-2">
          <Link href="/#app" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium hover:bg-foreground/5">App<ArrowUpRight className="size-4" aria-hidden /></Link>
          <MobileNavigation />
        </div>
      </div>
    </header>
    <main id="public-content" tabIndex={-1} className="mx-auto max-w-3xl scroll-mt-24 px-4 py-10 outline-none sm:py-14">
      <p className="mb-7 inline-flex flex-wrap gap-x-2 rounded-xl border border-border bg-foreground/3 px-3 py-2 font-mono text-xs text-muted-foreground"><span>{selectedChain.name}</span><span>Chain {selectedChain.id}</span><span className="text-filament">{deployment.status} deployment</span></p>
      <p className="eyebrow text-filament">{eyebrow}</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  </div>;
}
