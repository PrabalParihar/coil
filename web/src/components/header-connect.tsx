"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { usePassportConnect } from "@/app/providers";
import { Button } from "@/components/ui/button";
import { shorten } from "@/components/shell";

/** Same header Connect control as the home workspace. */
export function HeaderConnect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const openPassport = usePassportConnect();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <Button type="button" className="btn-btc min-h-11 rounded-lg px-4 font-medium" disabled>
        Connect
      </Button>
    );
  }
  if (isConnected) {
    return (
      <span className="flex h-9 items-center gap-2 rounded-full border border-border bg-foreground/5 px-3 font-mono text-xs">
        <span className="size-1.5 rounded-full bg-safe" aria-hidden />
        {shorten(address)}
      </span>
    );
  }
  return (
    <Button
      type="button"
      className="btn-btc min-h-11 rounded-lg px-4 font-medium"
      disabled={isPending}
      onClick={() => {
        if (openPassport) {
          openPassport();
          return;
        }
        const connector = connectors[0];
        if (connector) connect({ connector });
      }}
    >
      {isPending ? "Connecting…" : "Connect"}
    </Button>
  );
}
