import { defineChain } from "viem";
import type { KeeperConfig } from "./config.js";

export function chainForDeployment(config: Pick<KeeperConfig, "chainId" | "rpcUrl" | "explorerUrl">) {
  return defineChain({
    id: config.chainId,
    name: config.chainId === 31611 ? "Mezo Testnet" : "Mezo",
    nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    blockExplorers: { default: { name: "Mezo Explorer", url: config.explorerUrl } },
  });
}
