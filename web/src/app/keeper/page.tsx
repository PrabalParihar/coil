import { PublicPage } from "@/components/public-page";
import { KeeperStatus } from "@/components/keeper-status";
import { deployment, selectedChain } from "@/lib/network";

export default function KeeperPage() {
  return <PublicPage eyebrow="Keeper" title="Keeper activity">
    <p className="mt-4 text-sm text-muted-foreground">The keeper watches positions on {selectedChain.name} and can only make them safer. It cannot open a loan, take funds, or close a position for you.</p>
    <p className="mt-3 text-sm text-muted-foreground">Anyone can run protection. It can repay MUSD you set aside, or sell a limited amount of BTC when Mezo allows the trade. MUSD is Mezo&apos;s dollar stablecoin. If that cannot be done safely, nothing happens and no tip is paid. When Mezo is in Recovery Mode, a full close is not available.</p>
    <KeeperStatus />
    <details className="mt-4 text-xs text-muted-foreground">
      <summary className="cursor-pointer text-sm">Technical details</summary>
      <p className="mt-2 leading-relaxed">Chain {selectedChain.id}, deployment block {deployment.deploymentBlock ?? "pending"}. Monitoring mode does not submit rescues. Transaction protection requires an execution-enabled keeper with funded gas and confirmed chain activity. Status on this deployment: {deployment.status}.</p>
    </details>
  </PublicPage>;
}
