import { isAddress, type Address } from "viem";
import type { Deployment } from "./deployment.generated.js";

type Catalog = Readonly<Record<string, Deployment>>;
type RetainedCatalog = Readonly<Record<string, readonly Deployment[]>>;
const ZERO = "0x0000000000000000000000000000000000000000";
function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !isAddress(value) || value.toLowerCase() === ZERO) throw new Error(`Invalid ${label}.`);
  return value;
}
function integer(value: string, min: number, max: number, label: string) {
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${label}.`);
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`Invalid ${label}.`);
  return n;
}
export function assertRpcChain(expected: number, actual: number) {
  if (expected !== actual) throw new Error("RPC chain does not match configured deployment chain.");
}
export function selectDeployment(env: NodeJS.ProcessEnv, deployments: Catalog, executeFlag = false, retainedDeployments: RetainedCatalog = {}) {
  const chainId = integer(env.COIL_CHAIN_ID ?? "31611", 31611, 31612, "COIL_CHAIN_ID");
  const activeDeployment = deployments[String(chainId)];
  if (!activeDeployment || activeDeployment.chainId !== chainId) throw new Error("Unsupported chain.");
  const hasFactory = env.COIL_FACTORY !== undefined;
  const hasBlock = env.COIL_FACTORY_DEPLOY_BLOCK !== undefined;
  if (hasFactory !== hasBlock) throw new Error("COIL_FACTORY and COIL_FACTORY_DEPLOY_BLOCK must be configured together.");
  const factory = address(hasFactory ? env.COIL_FACTORY : activeDeployment.factory, "factory");
  const block = hasBlock ? env.COIL_FACTORY_DEPLOY_BLOCK : activeDeployment.deploymentBlock;
  if (typeof block !== "string" || !/^\d+$/.test(block) || BigInt(block) < 1n) throw new Error("Invalid deployment block.");
  const selectedChainEntries = [activeDeployment, ...(retainedDeployments[String(chainId)] ?? [])];
  const matchingFactories = selectedChainEntries.filter((entry) => entry.factory?.toLowerCase() === factory.toLowerCase());
  if (matchingFactories.some((entry) => entry.chainId !== chainId)) throw new Error("Retained deployment chain does not match selection.");
  const selectedDeployment = matchingFactories.find((entry) => entry.deploymentBlock === block);
  if (matchingFactories.length > 0 && !selectedDeployment) throw new Error("Factory and deployment block do not match manifest.");
  const known = selectedDeployment !== undefined;
  const allEntries = [...Object.values(deployments), ...Object.values(retainedDeployments).flat()];
  if (!known && allEntries.some((entry) => entry.chainId !== chainId && entry.factory?.toLowerCase() === factory.toLowerCase())) {
    throw new Error("Factory belongs to a different chain.");
  }
  // Explicit retained pairs bind their own generation's signer, implementation,
  // RPC and capabilities. Unlisted overrides retain the existing untrusted path.
  const deployment = selectedDeployment ?? activeDeployment;
  const execute = executeFlag || env.COIL_EXECUTE === "true";
  if (chainId === 31612 && execute && (!known || deployment.status !== "ready" || env.COIL_MAINNET_ENABLED !== "true")) {
    throw new Error("Mainnet execution requires a ready manifest deployment and COIL_MAINNET_ENABLED=true.");
  }
  const expected = env.COIL_EXPECTED_KEEPER ?? (known ? deployment.keeper : null);
  const expectedKeeper = expected === null ? null : address(expected, "expected keeper");
  if (known && deployment.keeper && expectedKeeper?.toLowerCase() !== deployment.keeper.toLowerCase()) {
    throw new Error("Expected keeper does not match manifest.");
  }
  const rpcUrl = env.COIL_RPC_URL ?? (chainId === 31611 ? env.MEZO_TESTNET_RPC : env.MEZO_MAINNET_RPC) ?? deployment.rpcUrl;
  try { if (!["http:", "https:"].includes(new URL(rpcUrl).protocol)) throw new Error(); }
  catch { throw new Error("Invalid RPC URL."); }
  return { chainId, factory, deploymentBlock: BigInt(block), expectedKeeper, execute, rpcUrl,
    explorerUrl: deployment.explorerUrl, implementation: known ? deployment.implementation : null,
    pollMs: integer(env.KEEPER_POLL_MS ?? "20000", 3000, 300_000, "KEEPER_POLL_MS"),
    port: integer(env.PORT ?? "3000", 0, 65535, "PORT"), deployment };
}
export type KeeperConfig = ReturnType<typeof selectDeployment>;
