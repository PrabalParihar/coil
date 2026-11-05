import { isAddress, parseAbi, type Abi, type Address, type Chain, type Hash, type PublicClient, type WalletClient } from "viem";
import { musdBelowPegBps } from "./alerts.js";
import type { KeeperConfig } from "./config.js";
import type { KeeperIO, Snapshot } from "./engine.js";
import { accountErrors } from "./revert.js";

const guardAbi = [{ type: "function", name: "guard", stateMutability: "nonpayable", inputs: [], outputs: [{ type: "bool" }] }, ...accountErrors] as const;
const heartbeatAbi = parseAbi(["function heartbeat()"]);
const positionAbi = parseAbi(["function position() view returns ((bool active,uint256 collateral,uint256 debt,uint256 cr,uint256 liquidationPrice,uint256 redemptionRank,uint256 floorCR,uint256 guardTargetCR,uint32 redemptionZone,uint16 slippageBps,address owner))"]);
const ZERO = "0x0000000000000000000000000000000000000000";

export function createKeeperIO(opts: {
  publicClient: PublicClient; wallet?: WalletClient; chain: Chain;
  config: KeeperConfig; watches: () => Address[]; alert: (message: string) => Promise<void>;
}): KeeperIO {
  const { publicClient: client, wallet, chain, config } = opts;
  let blockNumber: bigint | undefined;
  async function read<T>(address: Address, name: string, output: string, inputs = "", args: readonly unknown[] = []): Promise<T> {
    const abi: Abi = parseAbi([`function ${name}(${inputs}) view returns (${output})`]);
    return await client.readContract({ address, abi, functionName: name, args, blockNumber }) as T;
  }
  async function readAddress(target: Address, name: string): Promise<Address> {
    const value = await read<Address>(target, name, "address");
    if (!isAddress(value) || value.toLowerCase() === ZERO) throw new Error("Invalid protocol address.");
    return value;
  }
  async function freshChain() {
    if (await client.getChainId() !== config.chainId) throw new Error("RPC chain mismatch.");
    const block = await client.getBlock();
    const age = Math.floor(Date.now() / 1000) - Number(block.timestamp);
    if (age > 120 || age < -30 || block.number === null) throw new Error("RPC latest block is stale.");
    blockNumber = block.number;
  }
  async function expectedSigner() {
    if (!wallet?.account || !config.expectedKeeper || wallet.account.address.toLowerCase() !== config.expectedKeeper.toLowerCase()) {
      throw new Error("Expected keeper signer is not configured.");
    }
    const configured = await read<Address>(config.factory, "keeper", "address");
    if (configured.toLowerCase() !== config.expectedKeeper.toLowerCase()) throw new Error("On-chain keeper mismatch.");
  }
  return {
    async listAccounts() {
      await freshChain();
      if (config.deploymentBlock > blockNumber!) throw new Error("Deployment block is ahead of RPC.");
      const code = await client.getCode({ address: config.factory, blockNumber: config.deploymentBlock });
      if (!code || code === "0x") throw new Error("Factory not deployed at configured block.");
      const implementation = await readAddress(config.factory, "implementation");
      if (config.implementation && implementation.toLowerCase() !== config.implementation.toLowerCase()) throw new Error("Implementation differs from manifest.");
      const length = await read<bigint>(config.factory, "accountsLength", "uint256");
      const accounts: Address[] = [];
      for (let i = 0n; i < length; i++) accounts.push(await read<Address>(config.factory, "accounts", "address", "uint256", [i]));
      return [...new Map([...accounts, ...opts.watches()].map((a) => [a.toLowerCase(), a])).values()];
    },
    async snapshot(account) {
      const factory = await read<Address>(account, "factory", "address");
      if (factory.toLowerCase() !== config.factory.toLowerCase()) throw new Error("Watch account factory mismatch.");
      const position = await client.readContract({ address: account, abi: positionAbi, functionName: "position", blockNumber });
      if (!position.active) {
        return { position, oraclePrice: 0n, reserve: 0n, poolMusd: 0n, poolBtc: 0n, pegGuardBps: 0, belowPegBps: 0n, settings: [] };
      }
      const [musd, priceFeed, pool, park, troveManager, poolFactory] = await Promise.all(["musd", "priceFeed", "pool", "park", "troveManager", "poolFactory"].map((name) => readAddress(account, name)));
      const [oraclePrice, token0, reserves, reserve, pegGuardBps, rescueSlippage, keeper, tip] = await Promise.all([
        read<bigint>(priceFeed, "fetchPrice", "uint256"), readAddress(pool, "token0"),
        read<readonly [bigint, bigint, bigint]>(pool, "getReserves", "uint256,uint256,uint256"),
        read<bigint>(park, "assetsOf", "uint256", "address", [account]),
        read<number>(account, "pegGuardBps", "uint16"), read<number>(account, "rescueSlippageBps", "uint16"),
        read<Address>(account, "keeper", "address"), read<bigint>(account, "tipMezo", "uint256"),
      ]);
      if (oraclePrice <= 0n) throw new Error("Invalid oracle price.");
      const recoveryMode = await read<boolean>(troveManager, "checkRecoveryMode", "bool", "uint256", [oraclePrice]);
      const [stable, poolPaused] = await Promise.all([
        read<boolean>(pool, "stable", "bool"), read<boolean>(poolFactory, "isPaused", "bool"),
      ]);
      const poolFee = await read<bigint>(poolFactory, "getFee", "uint256", "address,bool", [pool, stable]);
      const musdFirst = token0.toLowerCase() === musd.toLowerCase();
      const poolMusd = reserves[musdFirst ? 0 : 1];
      const poolBtc = reserves[musdFirst ? 1 : 0];
      return { position, oraclePrice, reserve, poolMusd, poolBtc, pegGuardBps: Number(pegGuardBps),
        belowPegBps: musdBelowPegBps(poolMusd, poolBtc, oraclePrice), settings: [rescueSlippage, keeper, tip, recoveryMode, poolPaused, poolFee] } satisfies Snapshot;
    },
    async simulateGuard(account) {
      const result = await client.simulateContract({ address: account, abi: guardAbi, functionName: "guard",
        account: wallet?.account?.address ?? config.expectedKeeper ?? "0x0000000000000000000000000000000000000001" });
      return result.result;
    },
    async sendGuard(account) {
      await freshChain();
      if (!wallet?.account) throw new Error("Execution wallet is not configured.");
      return wallet.writeContract({ address: account, abi: guardAbi, functionName: "guard", account: wallet!.account!, chain, gas: 6_000_000n });
    },
    async sendHeartbeat() {
      await freshChain();
      await expectedSigner();
      await client.simulateContract({ address: config.factory, abi: heartbeatAbi, functionName: "heartbeat", account: wallet!.account! });
      return wallet!.writeContract({ address: config.factory, abi: heartbeatAbi, functionName: "heartbeat", account: wallet!.account!, chain, gas: 200_000n });
    },
    async receipt(hash) {
      return (await client.waitForTransactionReceipt({ hash: hash as Hash, confirmations: 1, timeout: 60_000 })).status;
    },
    alert: opts.alert,
  };
}
