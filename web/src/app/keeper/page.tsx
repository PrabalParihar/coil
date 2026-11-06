import { PublicPage } from "@/components/public-page";
import { KeeperStatus } from "@/components/keeper-status";
import { deployment, selectedChain } from "@/lib/network";

export default function KeeperPage() {
  return <PublicPage eyebrow="Public keeper status" title="Keeper activity and freshness">
    <p className="mt-4 text-sm text-muted-foreground">Chain {selectedChain.id}, deployment block {deployment.deploymentBlock ?? "pending"}. Monitoring mode does not submit rescues. Transaction protection requires an execution-enabled keeper with funded gas and confirmed chain activity.</p>
    <KeeperStatus />
    <p className="mt-6 text-sm text-muted-foreground">Anyone may call the risk-reducing guard. It can repay funded reserves and make bounded sales when Mezo allows them. Empty reserves or an unsafe fill can result in no action and no tip. Recovery Mode does not permit a promised full close.</p>
  </PublicPage>;
}
