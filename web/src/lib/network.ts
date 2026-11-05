import { defineChain } from "viem";
import { DEPLOYMENTS } from "./deployment.generated";
import { canWrite, resolveDeployment } from "./readiness";

export const mezoTestnet = defineChain({
  id: 31611, name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [DEPLOYMENTS["31611"].rpcUrl] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: DEPLOYMENTS["31611"].explorerUrl } },
});
export const mezoMainnet = defineChain({
  id: 31612, name: "Mezo",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: [DEPLOYMENTS["31612"].rpcUrl] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: DEPLOYMENTS["31612"].explorerUrl } },
});
const chain = process.env.NEXT_PUBLIC_COIL_CHAIN_ID ?? "31611";
if (chain !== "31611" && chain !== "31612") throw new Error("Unsupported Coil chain. Select 31611 or 31612.");
export const selectedChain = chain === "31612" ? mezoMainnet : mezoTestnet;
export const deployment = resolveDeployment(DEPLOYMENTS[chain], process.env.NEXT_PUBLIC_COIL_FACTORY, process.env.NEXT_PUBLIC_COIL_FACTORY_DEPLOY_BLOCK, DEPLOYMENTS);
export const writesEnabled = canWrite(deployment, process.env.NEXT_PUBLIC_COIL_ENABLE_MAINNET_WRITES === "true");
export const explorerUrl = deployment.explorerUrl;
export const walletConnectProjectId = /^[0-9a-f]{32}$/i.test(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "") ? process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID! : undefined;
