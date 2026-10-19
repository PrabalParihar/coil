import { defineChain } from "viem";

export const mezoTestnet = defineChain({
  id: 31611,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.test.mezo.org"] } },
  blockExplorers: {
    default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" },
  },
});

export const RPC = mezoTestnet.rpcUrls.default.http[0];

export const addr = {
  btc: "0x7b7C000000000000000000000000000000000000",
  musd: "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503",
  borrowerOperations: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5",
  troveManager: "0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0",
  priceFeed: "0x86bCF0841622a5dAC14A313a15f96A95421b9366",
  router: "0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9",
  poolFactory: "0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A",
  pool: "0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9",
} as const;

const factoryEnv = process.env.NEXT_PUBLIC_COIL_FACTORY ?? "";

export const factoryAddress = /^0x[a-fA-F0-9]{40}$/.test(factoryEnv)
  ? (factoryEnv as `0x${string}`)
  : undefined;

export const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const priceFeedAbi = [
  {
    type: "function",
    name: "fetchPrice",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const borrowerAbi = [
  {
    type: "function",
    name: "minNetDebt",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "borrowingRate",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "refinancingFeePercentage",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export const poolAbi = [
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "_reserve0", type: "uint256" },
      { name: "_reserve1", type: "uint256" },
      { name: "_blockTimestampLast", type: "uint256" },
    ],
  },
] as const;

export const factoryFeeAbi = [
  {
    type: "function",
    name: "getFee",
    stateMutability: "view",
    inputs: [
      { name: "pool", type: "address" },
      { name: "stable", type: "bool" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const coilFactoryAbi = [
  {
    type: "function",
    name: "createAccount",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "account", type: "address" }],
  },
  {
    type: "function",
    name: "accountOf",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "keeper",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const positionComponents = [
  { name: "active", type: "bool" },
  { name: "collateral", type: "uint256" },
  { name: "debt", type: "uint256" },
  { name: "cr", type: "uint256" },
  { name: "liquidationPrice", type: "uint256" },
  { name: "redemptionRank", type: "uint256" },
  { name: "floorCR", type: "uint256" },
  { name: "guardTargetCR", type: "uint256" },
  { name: "redemptionZone", type: "uint32" },
  { name: "slippageBps", type: "uint16" },
  { name: "owner", type: "address" },
] as const;

export const coilAccountAbi = [
  {
    type: "function",
    name: "loop",
    stateMutability: "payable",
    inputs: [
      { name: "targetCR", type: "uint256" },
      { name: "maxSlippageBps", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "unwind",
    stateMutability: "nonpayable",
    inputs: [{ name: "fractionWad", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "deleverTo",
    stateMutability: "nonpayable",
    inputs: [{ name: "targetCR", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "setGuard",
    stateMutability: "nonpayable",
    inputs: [
      { name: "floor", type: "uint256" },
      { name: "target", type: "uint256" },
      { name: "zone", type: "uint32" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "position",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "p",
        type: "tuple",
        components: positionComponents,
      },
    ],
  },
] as const;

export type Position = {
  active: boolean;
  collateral: bigint;
  debt: bigint;
  cr: bigint;
  liquidationPrice: bigint;
  redemptionRank: bigint;
  floorCR: bigint;
  guardTargetCR: bigint;
  redemptionZone: number;
  slippageBps: number;
  owner: `0x${string}`;
};
