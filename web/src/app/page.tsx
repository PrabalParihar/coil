import { CoilApp } from "@/components/coil-app";
import { readOpenFeeSnapshot } from "@/lib/factory-policy";
import { deployment, selectedChain } from "@/lib/network";

export default async function Home() {
  const factory = deployment.factory;
  const initialPolicy = factory
    ? await readOpenFeeSnapshot(factory, selectedChain.rpcUrls.default.http[0])
    : null;
  return <CoilApp initialPolicy={initialPolicy} />;
}
