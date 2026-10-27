import { createPublicClient, defineChain, http } from "viem";
import { borrowerAbi, factoryFeeAbi, poolAbi, priceFeedAbi } from "./mezo";
import type { Market } from "./quote";

/** Read-only. Coil is not deployed here. */
export const mezoMainnet = defineChain({
  id: 31612,
  name: "Mezo",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc-http.mezo.boar.network"] } },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.mezo.org" } },
});

export const mainnetAddr = {
  musd: "0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186",
  borrowerOperations: "0x44b1bac67dDA612a41a58AAf779143B181dEe031",
  priceFeed: "0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88",
  poolFactory: "0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248",
  pool: "0x52e604c44417233b6CcEDDDc0d640A405Caacefb",
} as const;

const client = createPublicClient({ chain: mezoMainnet, transport: http() });

export async function loadMainnetMarket(): Promise<Market> {
  const [price, minNetDebt, borrowRate, refiPct, token0, reserves, feeBps] = await Promise.all([
    client.readContract({ address: mainnetAddr.priceFeed, abi: priceFeedAbi, functionName: "fetchPrice" }),
    client.readContract({
      address: mainnetAddr.borrowerOperations,
      abi: borrowerAbi,
      functionName: "minNetDebt",
    }),
    client.readContract({
      address: mainnetAddr.borrowerOperations,
      abi: borrowerAbi,
      functionName: "borrowingRate",
    }),
    client.readContract({
      address: mainnetAddr.borrowerOperations,
      abi: borrowerAbi,
      functionName: "refinancingFeePercentage",
    }),
    client.readContract({ address: mainnetAddr.pool, abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: mainnetAddr.pool, abi: poolAbi, functionName: "getReserves" }),
    client.readContract({
      address: mainnetAddr.poolFactory,
      abi: factoryFeeAbi,
      functionName: "getFee",
      args: [mainnetAddr.pool, false],
    }),
  ]);
  const musd = mainnetAddr.musd.toLowerCase();
  const reserveMusd = token0.toLowerCase() === musd ? reserves[0] : reserves[1];
  const reserveBtc = token0.toLowerCase() === musd ? reserves[1] : reserves[0];
  return {
    price,
    minNetDebt,
    borrowRate,
    refiPct: BigInt(refiPct),
    feeBps,
    reserveMusd,
    reserveBtc,
  };
}
