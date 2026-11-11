import { PublicPage } from "@/components/public-page";
import { KeeperStatus } from "@/components/keeper-status";
import { selectedChain } from "@/lib/network";

export default function KeeperPage() {
  return <PublicPage eyebrow="Keeper" title="Keeper activity">
    <p className="mt-4 text-sm text-muted-foreground">The keeper watches positions on {selectedChain.name}.</p>
    <p className="mt-3 text-sm text-muted-foreground">Anyone can run protection. It can repay MUSD you set aside, or sell a limited amount of BTC when Mezo allows the trade. MUSD is Mezo&apos;s dollar stablecoin. If that cannot be done safely, nothing happens and no tip is paid. When Mezo is in Recovery Mode, a full close is not available.</p>
    <KeeperStatus />
  </PublicPage>;
}
