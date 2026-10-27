"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider, getDefaultConfig, useConnectModal } from "@rainbow-me/rainbowkit";
import { injectedWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import "@rainbow-me/rainbowkit/styles.css";
import { getOKXWallet } from "@mezo-org/orangekit/dist/src/wallet/okx/rainbowkit-wallet.js";
import { getUnisatWallet } from "@mezo-org/orangekit/dist/src/wallet/unisat/rainbowkit-wallet.js";
import { getXverseWallet } from "@mezo-org/orangekit/dist/src/wallet/xverse/rainbowkit-wallet.js";
import { createContext, useContext, useEffect, useState } from "react";
import { WagmiProvider, createConfig, http, type Config } from "wagmi";
import { injected } from "wagmi/connectors";
import { mezoTestnet } from "@/lib/mezo";

const fallbackConfig = createConfig({
  chains: [mezoTestnet],
  connectors: [injected()],
  transports: {
    [mezoTestnet.id]: http(mezoTestnet.rpcUrls.default.http[0]),
  },
  ssr: true,
});

/**
 * Opens the wallet modal once OrangeKit (the Bitcoin connectors Mezo Passport ships)
 * is active. Passport 0.17.2 does not compile under Next.js: its package entry
 * imports `mezoTestnet` from `@mezo-org/orangekit`, and that package does not
 * re-export it. These are the same Unisat, OKX, and Xverse connectors.
 */
export const PassportConnectContext = createContext<(() => void) | null>(null);

export function usePassportConnect() {
  return useContext(PassportConnectContext);
}

function PassportBridge({ children }: { children: React.ReactNode }) {
  const { openConnectModal } = useConnectModal();
  return <PassportConnectContext.Provider value={openConnectModal ?? null}>{children}</PassportConnectContext.Provider>;
}

const bitcoinWallet = {
  rpcUrl: mezoTestnet.rpcUrls.default.http[0],
  chainId: mezoTestnet.id,
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [config, setConfig] = useState<Config>(fallbackConfig);
  const passport = config !== fallbackConfig;

  useEffect(() => {
    const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "coil-labs-mezo-testnet";
    const next = getDefaultConfig({
      appName: "Coil Labs",
      projectId,
      chains: [mezoTestnet],
      wallets: [
        {
          groupName: "Bitcoin",
          wallets: [getUnisatWallet(bitcoinWallet), getOKXWallet(bitcoinWallet), getXverseWallet(bitcoinWallet)],
        },
        {
          groupName: "Ethereum",
          wallets: [injectedWallet, walletConnectWallet],
        },
      ],
      multiInjectedProviderDiscovery: true,
      ssr: true,
    });
    setConfig(next);
  }, []);

  const tree = passport ? (
    <RainbowKitProvider initialChain={mezoTestnet} modalSize="compact">
      <PassportBridge>{children}</PassportBridge>
    </RainbowKitProvider>
  ) : (
    <PassportConnectContext.Provider value={null}>{children}</PassportConnectContext.Provider>
  );

  return (
    <WagmiProvider config={config} reconnectOnMount key={passport ? "passport" : "fallback"}>
      <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
    </WagmiProvider>
  );
}
