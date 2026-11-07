"use client";

import Link from "next/link";
import { useEffect, useRef, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Dialog } from "radix-ui";
import { Activity, ArrowUpRight, BookOpen, ChartNoAxesCombined, CircleHelp, LayoutDashboard, Menu, ReceiptText, ShieldCheck, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { selectedChain } from "@/lib/network";
import { CoilMark } from "@/components/shell";

/** Anchor targets follow the actual header height, including wallet/network rows. */
export function WorkspaceHeader({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const header = ref.current;
    const shell = header?.parentElement;
    if (!header || !shell) return;
    const sync = () => shell.style.setProperty("--workspace-header-offset", `${header.getBoundingClientRect().height + 16}px`);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  return <header ref={ref} className={className}>{children}</header>;
}

const destinations = [
  { href: "/#how", label: "How it works" },
  { href: "/#app", label: "App" },
  { href: "/guard", label: "Guard log" },
  { href: "/stats", label: "Stats" },
  { href: "/keeper", label: "Keeper" },
  { href: "/#proof", label: "Receipts" },
  { href: "/#risks", label: "Risks" },
] as const;

function useDestinations() {
  const pathname = usePathname();
  return destinations.map(item => ({
    ...item,
    href: pathname === "/" && item.href.startsWith("/#") ? item.href.slice(1) : item.href,
    current: item.href === pathname || (pathname === "/" && item.label === "App"),
  }));
}

export function SiteNavigation() {
  const links = useDestinations();
  const primary = ["App", "Guard log", "Stats", "Keeper"];
  const icons = { App: LayoutDashboard, "Guard log": ShieldCheck, Stats: ChartNoAxesCombined, Keeper: Activity, "How it works": BookOpen, Receipts: ReceiptText, Risks: CircleHelp };
  return <aside className="workspace-rail fixed inset-y-0 left-0 z-40 hidden w-52 flex-col overflow-y-auto border-r border-border bg-background p-4 lg:flex">
    <Link href="/" className="flex min-h-11 shrink-0 items-center gap-2.5 px-2" aria-label="Coil Labs home"><CoilMark className="size-7" /><span className="text-base font-semibold tracking-tight">Coil Labs</span></Link>
    <p className="mt-8 mb-2 px-3 text-[11px] text-muted-foreground">Workspace</p>
    <nav aria-label="Primary" className="grid shrink-0 gap-1">
      {[...primary, "How it works", "Receipts", "Risks"].map((label, index) => {
        const item = links.find(item => item.label === label)!;
        const Icon = icons[item.label];
        return <Link key={item.label} href={item.href} aria-current={item.current ? "page" : undefined}
          className={cn("flex min-h-11 items-center gap-3 rounded-lg px-3 text-[13px] text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground", index === 4 && "mt-6", item.current && "bg-filament/10 font-medium text-filament")}>
          <Icon className="size-4" strokeWidth={1.7} aria-hidden />{item.label}
        </Link>;
      })}
    </nav>
    <div className="mt-auto shrink-0 border-t border-border px-3 pt-4 text-xs text-muted-foreground">
      <p className="font-medium text-foreground">{selectedChain.name}</p>
      <p className="mt-1">Chain {selectedChain.id}</p>
      <a href="https://github.com/PrabalParihar/coil" target="_blank" rel="noreferrer noopener" className="mt-4 inline-flex min-h-11 items-center gap-2 hover:text-foreground">View source<ArrowUpRight className="size-3.5" aria-hidden /></a>
    </div>
  </aside>;
}

export function WorkspaceNavigation() {
  const links = useDestinations().filter(item => ["App", "Guard log", "Stats", "Keeper"].includes(item.label));
  return <nav aria-label="Workspace" className="flex border-b border-border bg-background lg:hidden">
    {links.map(item => <Link key={item.label} href={item.href} aria-current={item.current ? "page" : undefined} className={cn("flex min-h-11 flex-1 items-center justify-center border-b-2 border-transparent px-2 text-xs text-muted-foreground", item.current && "border-filament font-medium text-foreground")}>{item.label}</Link>)}
  </nav>;
}

export function MobileNavigation() {
  const links = useDestinations();
  return <Dialog.Root>
    <Dialog.Trigger asChild>
      <Button type="button" variant="outline" className="size-11 shrink-0 lg:hidden" aria-label="Open navigation">
        <Menu className="size-5" aria-hidden />
      </Button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-black/70" />
      <Dialog.Content className="fixed inset-x-4 top-4 z-50 mx-auto max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto rounded-3xl border border-border bg-background p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Dialog.Title className="text-xl font-semibold">Explore Coil</Dialog.Title>
            <Dialog.Description className="mt-1 text-sm text-muted-foreground">The app and its on-chain evidence.</Dialog.Description>
          </div>
          <Dialog.Close asChild><Button type="button" variant="ghost" className="size-11 shrink-0" aria-label="Close navigation"><X className="size-5" aria-hidden /></Button></Dialog.Close>
        </div>
        <p className="mt-4 font-mono text-xs text-filament">{selectedChain.name} · chain {selectedChain.id}</p>
        <nav aria-label="Mobile" className="mt-4 grid gap-1">
          {links.map(item => <Dialog.Close key={item.label} asChild>
            <Link href={item.href} aria-current={item.current ? "page" : undefined}
              className={cn("flex min-h-11 items-center justify-between gap-4 rounded-xl px-4 py-3 text-sm hover:bg-foreground/5", item.current && "bg-filament/10 text-filament")}>
              {item.label}{item.current ? <span className="text-xs">Current page</span> : null}
            </Link>
          </Dialog.Close>)}
        </nav>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}
