import assert from "node:assert/strict";
import type { PublicClient, WalletClient } from "viem";
import { createKeeperIO } from "./rpc.js";
const factory = "0x0000000000000000000000000000000000000021" as const;
const signer = "0x0000000000000000000000000000000000000022" as const;
const clone = "0x0000000000000000000000000000000000000023" as const;
const address = "0x0000000000000000000000000000000000000024" as const;
let actualChain = 31611;
let blockTime = BigInt(Math.floor(Date.now() / 1000));
let expectedOnChain = signer as string;
let foreignAccount = false;
let recoveryMode = true;
let poolPaused = true;
const writes: { chain: { id: number }; functionName: string }[] = [];
const simulated: string[] = [];
const publicClient = {
  getChainId: async () => actualChain,
  getBlock: async () => ({ number: 456n, timestamp: blockTime }),
  getCode: async () => "0x1234",
  readContract: async ({ functionName, address: target }: { functionName: string; address: string }) => {
    if (functionName === "accountsLength") return 1n;
    if (functionName === "accounts") return clone;
    if (functionName === "implementation") return address;
    if (functionName === "keeper" && target === factory) return expectedOnChain;
    if (functionName === "factory") return foreignAccount ? address : factory;
    if (functionName === "position") return { active: true, cr: 130n, floorCR: 140n, guardTargetCR: 150n, redemptionRank: 1n, redemptionZone: 0 };
    if (functionName === "isPaused") return poolPaused;
    if (functionName === "stable") return false;
    if (functionName === "checkRecoveryMode") return recoveryMode;
    if (functionName === "fetchPrice") return 80_000n * 10n ** 18n;
    if (functionName === "getReserves") return [800_000n * 10n ** 18n, 10n * 10n ** 18n, 0n];
    if (functionName === "assetsOf") return 123n;
    if (functionName === "token0") return address;
    if (["musd", "priceFeed", "pool", "park", "keeper", "troveManager", "poolFactory"].includes(functionName)) return address;
    return 200n;
  },
  simulateContract: async ({ functionName }: { functionName: string }) => { simulated.push(functionName); return { result: true }; },
  waitForTransactionReceipt: async () => ({ status: "success" }),
} as unknown as PublicClient;
const wallet = { account: { address: signer }, writeContract: async (args: typeof writes[number]) => { writes.push(args); return "0x01"; } } as unknown as WalletClient;
const io = createKeeperIO({ publicClient, wallet, chain: { id: 31611 } as never,
  config: { chainId: 31611, factory, deploymentBlock: 123n, expectedKeeper: signer, implementation: null } as never,
  watches: () => [], alert: async () => {} });
assert.deepEqual(await io.listAccounts(), [clone]);
assert.equal((await io.snapshot(clone)).reserve, 123n, "funded reserve participates in retry snapshot");
const duringRecovery = await io.snapshot(clone);
recoveryMode = false;
assert.notDeepEqual((await io.snapshot(clone)).settings, duringRecovery.settings, "Recovery Mode transition resets unchanged-position retry state");
const whilePaused = await io.snapshot(clone);
poolPaused = false;
assert.notDeepEqual((await io.snapshot(clone)).settings, whilePaused.settings, "Pool unpause resets unchanged-position retry state");
foreignAccount = true;
await assert.rejects(io.snapshot(clone), /factory/i, "foreign watch clone cannot be acted on");
foreignAccount = false;
actualChain = 31612;
await assert.rejects(io.listAccounts(), /chain/i);
await assert.rejects(io.sendGuard(clone), /chain/i);
actualChain = 31611;
blockTime -= 300n;
await assert.rejects(io.listAccounts(), /stale/i);
blockTime = BigInt(Math.floor(Date.now() / 1000));
expectedOnChain = address;
await assert.rejects(io.sendHeartbeat(), /keeper/i);
await io.simulateGuard(clone);
await io.sendGuard(clone);
assert.equal(writes.at(-1)?.functionName, "guard", "heartbeat signer mismatch does not block permissionless simulated rescue");
expectedOnChain = signer;
await io.sendHeartbeat();
assert(simulated.includes("heartbeat"), "heartbeat simulates before submission");
assert.equal(writes.at(-1)?.chain.id, 31611, "write chain is selected deployment chain");
assert.equal(writes.at(-1)?.functionName, "heartbeat");
console.log("keeper chain-aware RPC adapter checks passed");
