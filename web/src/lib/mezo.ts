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
  mezo: "0x7B7c000000000000000000000000000000000001",
  sortedTroves: "0x722E4D24FD6Ff8b0AC679450F3D91294607268fA",
} as const;

/** Live Mezo testnet factory. Override with NEXT_PUBLIC_COIL_FACTORY. */
const DEPLOYED_FACTORY = "0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e" as const;

const factoryEnv = process.env.NEXT_PUBLIC_COIL_FACTORY ?? "";

export const factoryAddress = /^0x[a-fA-F0-9]{40}$/.test(factoryEnv)
  ? (factoryEnv as `0x${string}`)
  : DEPLOYED_FACTORY;

export const ZERO = "0x0000000000000000000000000000000000000000" as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const sortedTrovesAbi = [
  {
    type: "function",
    name: "getLast",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getPrev",
    stateMutability: "view",
    inputs: [{ name: "_id", type: "address" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export const troveManagerAbi = [
  {
    type: "function",
    name: "getNominalICR",
    stateMutability: "view",
    inputs: [{ name: "_borrower", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

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
  {
    type: "function",
    name: "implementation",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "accounts",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "accountsLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "heartbeat",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },
  {
    type: "event",
    name: "Heartbeat",
    inputs: [
      { name: "keeper", type: "address", indexed: true },
      { name: "timestamp", type: "uint256", indexed: false },
    ],
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
    name: "flashLoop",
    stateMutability: "payable",
    inputs: [
      { name: "targetCR", type: "uint256" },
      { name: "maxSlippageBps", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "flashUnwind",
    stateMutability: "nonpayable",
    inputs: [{ name: "fractionWad", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "flashDeleverTo",
    stateMutability: "nonpayable",
    inputs: [{ name: "targetCR", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "quoteFlashLoop",
    stateMutability: "view",
    inputs: [
      { name: "collateralIn", type: "uint256" },
      { name: "targetCR", type: "uint256" },
      { name: "slippageBps", type: "uint256" },
    ],
    outputs: [
      {
        name: "q",
        type: "tuple",
        components: [
          { name: "collateral", type: "uint256" },
          { name: "debt", type: "uint256" },
          { name: "cr", type: "uint256" },
          { name: "liquidationPrice", type: "uint256" },
          { name: "musdMinted", type: "uint256" },
          { name: "iterations", type: "uint256" },
        ],
      },
      { name: "flashBtc", type: "uint256" },
      { name: "poolFeeMusd", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "precompileBudget",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "loopCalls", type: "uint256" },
      { name: "unwindCalls", type: "uint256" },
      { name: "deleverCalls", type: "uint256" },
      { name: "guardCalls", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "previewRedemptionRank",
    stateMutability: "view",
    inputs: [
      { name: "collateral", type: "uint256" },
      { name: "debt", type: "uint256" },
    ],
    outputs: [{ name: "rank", type: "uint256" }],
  },
  {
    type: "function",
    name: "redemptionEdge",
    stateMutability: "view",
    inputs: [{ name: "zone", type: "uint32" }],
    outputs: [{ name: "nicr", type: "uint256" }],
  },
  {
    type: "function",
    name: "tipMezo",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "tipBalance",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "fundTips",
    stateMutability: "nonpayable",
    inputs: [{ name: "amount", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "guard",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "acted", type: "bool" }],
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
    name: "setGuard",
    stateMutability: "nonpayable",
    inputs: [
      { name: "floor", type: "uint256" },
      { name: "target", type: "uint256" },
      { name: "zone", type: "uint32" },
      { name: "tip", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Guarded",
    inputs: [
      { name: "caller", type: "address", indexed: true },
      { name: "crBefore", type: "uint256", indexed: false },
      { name: "crAfter", type: "uint256", indexed: false },
      { name: "tip", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Delevered",
    inputs: [
      { name: "owner", type: "address", indexed: true },
      { name: "targetCR", type: "uint256", indexed: false },
      { name: "cr", type: "uint256", indexed: false },
      { name: "debt", type: "uint256", indexed: false },
    ],
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
