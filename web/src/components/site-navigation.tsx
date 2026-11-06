"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog } from "radix-ui";
import { Menu, X } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { selectedChain } from "@/lib/network";

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
    current: item.href === pathname,
  }));
}

export function SiteNavigation() {
  const links = useDestinations();
  return <nav aria-label="Primary" className="hidden items-center gap-1 text-sm text-muted-foreground xl:flex">
    {links.map(item => <Link key={item.label} href={item.href} aria-current={item.current ? "page" : undefined}
      className={cn("inline-flex min-h-11 items-center rounded-full px-3 transition-colors hover:bg-foreground/5 hover:text-foreground", item.current && "bg-filament/10 text-filament")}>
      {item.label}
    </Link>)}
  </nav>;
}

export function MobileNavigation() {
  const links = useDestinations();
  return <Dialog.Root>
    <Dialog.Trigger asChild>
      <Button type="button" variant="outline" className="size-11 shrink-0 xl:hidden" aria-label="Open navigation">
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
