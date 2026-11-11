import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { HeaderConnect } from "@/components/header-connect";
import { CoilMark } from "@/components/shell";
import { MobileNavigation, SiteNavigation, WorkspaceHeader } from "@/components/site-navigation";
import { selectedChain } from "@/lib/network";

export function PublicPage({ eyebrow, title, children }: { eyebrow: string; title: string; children: ReactNode }) {
  return <div className="workspace-shell relative isolate min-h-screen lg:pl-52">
    <div className="atmosphere pointer-events-none fixed inset-0 -z-10" aria-hidden />
    <a href="#public-content" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-filament focus:px-4 focus:py-3 focus:text-ink">Skip to content</a>
    <SiteNavigation />
    <WorkspaceHeader className="sticky top-0 z-30 border-b border-border/70 bg-background/90 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2.5 lg:hidden" aria-label="Coil Labs home"><CoilMark className="size-7" /><span className="whitespace-nowrap text-base font-semibold tracking-tight">Coil Labs</span></Link>
        <p className="hidden text-xs text-muted-foreground lg:block">Workspace <span className="mx-2 text-foreground/30">/</span><span className="text-foreground">{eyebrow}</span></p>
        <div className="flex items-center gap-2">
          <HeaderConnect />
          <Link href="/#app" className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border px-3 text-sm font-medium hover:bg-foreground/5">App<ArrowUpRight className="size-4" aria-hidden /></Link>
          <MobileNavigation />
        </div>
      </div>
    </WorkspaceHeader>
    <main id="public-content" tabIndex={-1} className="mx-auto max-w-5xl scroll-mt-28 px-4 py-7 outline-none sm:px-8">
      <p className="mb-2 flex flex-wrap gap-x-2 text-xs text-muted-foreground"><span>{selectedChain.name}</span><span>· chain {selectedChain.id}</span></p>
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      {children}
    </main>
  </div>;
}
