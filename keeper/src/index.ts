import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mezoTestnet } from "./chain.js";

const factoryAbi = [
  {
    type: "function",
    name: "accountsLength",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "accounts",
    stateMutability: "view",
    inputs: [{ type: "uint256" }],
    outputs: [{ type: "address" }],
  },
] as const;

const accountAbi = [
  {
    type: "function",
    name: "position",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        type: "tuple",
        components: [
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
        ],
      },
    ],
  },
  {
    type: "function",
    name: "deleverTo",
    stateMutability: "nonpayable",
    inputs: [{ name: "targetCR", type: "uint256" }],
    outputs: [],
  },
] as const;

type Position = {
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
  owner: Address;
};

const OUTSIDE = (1n << 256n) - 1n;

function pct(cr: bigint) {
  return `${(cr * 10000n) / 10n ** 18n / 100n}.${((cr * 10000n) / 10n ** 18n % 100n)
    .toString()
    .padStart(2, "0")}%`;
}

function needsDelever(position: Position) {
  if (!position.active || position.guardTargetCR === 0n) return null;
  const crRisk = position.floorCR > 0n && position.cr < position.floorCR;
  const inZone =
    position.redemptionZone > 0 &&
    position.redemptionRank > 0n &&
    position.redemptionRank !== OUTSIDE &&
    position.redemptionRank <= BigInt(position.redemptionZone);
  const belowGuard = position.cr < position.guardTargetCR;
  if (crRisk) return "collateral ratio is under the floor";
  if (inZone && belowGuard) return "trove is inside the redemption zone";
  return null;
}

async function main() {
  const execute = process.argv.includes("--execute") || process.env.COIL_EXECUTE === "true";
  const rpc = process.env.MEZO_TESTNET_RPC ?? "https://rpc.test.mezo.org";
  const factory = process.env.COIL_FACTORY;
  if (!factory || !isAddress(factory)) {
    throw new Error("Set COIL_FACTORY to the deployed CoilFactory address.");
  }

  const publicClient = createPublicClient({ chain: mezoTestnet, transport: http(rpc) });
  const length = await publicClient.readContract({
    address: factory,
    abi: factoryAbi,
    functionName: "accountsLength",
  });

  console.log(`Coil keeper · ${length} account(s) · ${execute ? "EXECUTE" : "dry run"}`);

  let wallet: ReturnType<typeof createWalletClient> | undefined;
  if (execute) {
    const key = process.env.KEEPER_PRIVATE_KEY;
    if (!key) throw new Error("Set KEEPER_PRIVATE_KEY to send deleverTo transactions.");
    const account = privateKeyToAccount(key as `0x${string}`);
    wallet = createWalletClient({ account, chain: mezoTestnet, transport: http(rpc) });
    console.log(`signer ${account.address}`);
  }

  for (let i = 0n; i < length; i++) {
    const account = await publicClient.readContract({
      address: factory,
      abi: factoryAbi,
      functionName: "accounts",
      args: [i],
    });
    const position = (await publicClient.readContract({
      address: account,
      abi: accountAbi,
      functionName: "position",
    })) as Position;

    if (!position.active) {
      console.log(`${account} idle`);
      continue;
    }

    const reason = needsDelever(position);
    const rank =
      position.redemptionRank === OUTSIDE ? "outside top 32" : position.redemptionRank.toString();
    console.log(
      `${account} owner=${position.owner} CR=${pct(position.cr)} floor=${pct(position.floorCR)} guard=${pct(position.guardTargetCR)} rank=${rank}`,
    );
    if (!reason) continue;

    console.log(`  deleverTo ${pct(position.guardTargetCR)} because ${reason}`);
    if (!execute || !wallet) continue;

    const hash = await wallet.writeContract({
      address: account,
      abi: accountAbi,
      functionName: "deleverTo",
      args: [position.guardTargetCR],
      account: wallet.account!,
      chain: mezoTestnet,
    });
    console.log(`  tx ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${receipt.status} block ${receipt.blockNumber}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
