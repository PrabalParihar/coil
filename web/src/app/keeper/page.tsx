import Link from "next/link";
import { KeeperStatus } from "@/components/keeper-status";
import { deployment, selectedChain } from "@/lib/network";

export default function KeeperPage() {
  return <main className="mx-auto max-w-3xl px-4 py-12">
    <nav className="flex gap-5 text-sm"><Link href="/">Coil Labs</Link><Link href="/guard">Guard history</Link><Link href="/stats">Public stats</Link></nav>
    <p className="eyebrow mt-10 text-filament">Public keeper status</p>
    <h1 className="mt-3 text-4xl font-semibold">Keeper activity and freshness</h1>
    <p className="mt-4 text-sm text-muted-foreground">Chain {selectedChain.id}, deployment block {deployment.deploymentBlock ?? "pending"}. Monitoring mode does not submit rescues. Transaction protection requires an execution-enabled keeper with funded gas and confirmed chain activity.</p>
    <KeeperStatus />
    <p className="mt-6 text-sm text-muted-foreground">Anyone may call the risk-reducing guard. It can repay funded reserves and make bounded sales when Mezo allows them. Empty reserves or an unsafe fill can result in no action and no tip. Recovery Mode does not permit a promised full close.</p>
  </main>;
}
