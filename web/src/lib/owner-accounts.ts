import type { Address, PublicClient } from "viem";
import type { Deployment } from "./deployment.generated";
import { coilFactoryAbi, coilAccountAbi, ZERO, type Position } from "./mezo";

export type OwnerDeployment = { key: string; current: boolean; deployment: Deployment; account?: Address; position?: Position; readError?: string };

export function ownerDeploymentCatalog(current: Deployment, retained: readonly Deployment[]): OwnerDeployment[] {
  const catalog = new Map<string, OwnerDeployment>();
  for (const entry of [current, ...retained]) {
    if (entry.chainId !== current.chainId) continue;
    const key = `${entry.chainId}:${entry.factory?.toLowerCase() ?? "pending"}:${entry.deploymentBlock ?? "pending"}`;
    if (!catalog.has(key)) catalog.set(key, { key, current: entry === current, deployment: entry });
  }
  return [...catalog.values()];
}

export async function discoverOwnerAccounts(client: Pick<PublicClient, "readContract">, owner: Address, catalog: readonly OwnerDeployment[]): Promise<OwnerDeployment[]> {
  return Promise.all(catalog.map(async choice => {
    const factory = choice.deployment.factory;
    if (!factory) return choice;
    let account: Address;
    try {
      account = await client.readContract({ address: factory, abi: coilFactoryAbi, functionName: "accountOf", args: [owner] });
      if (account === ZERO) return choice;
    } catch { return { ...choice, readError: "Account lookup unavailable for this factory; retry discovery." }; }
    try {
      const position = await client.readContract({ address: account, abi: coilAccountAbi, functionName: "position" });
      if (position.owner.toLowerCase() !== owner.toLowerCase()) throw new Error("Owner mismatch");
      return { ...choice, account, position: position as Position };
    } catch { return { ...choice, account, readError: "Position unavailable for this retained/current account; funds are not assumed empty." }; }
  }));
}

/** A newly configured empty account cannot displace an existing funded position. */
export function selectOwnerDeployment(catalog: readonly OwnerDeployment[], explicitKey?: string): OwnerDeployment {
  const selected = explicitKey ? catalog.find(choice => choice.key === explicitKey) : undefined;
  const funded = catalog.find(choice => choice.position?.active || (choice.position?.collateral ?? 0n) > 0n || (choice.position?.debt ?? 0n) > 0n);
  const unreadableAccount = catalog.find(choice => choice.account && choice.readError);
  const fallback = catalog.find(choice => choice.current) ?? catalog[0];
  if (!selected && !funded && !unreadableAccount && !fallback) throw new Error("No selected-chain deployment catalog.");
  return selected ?? funded ?? unreadableAccount ?? fallback!;
}

export type OwnerDiscovery = { ownerKey: string; key: string; choices: OwnerDeployment[] };

/** Refreshing the same owner must not unmount their position controls or reset tabs. */
export function ownerDiscoveryView(ownerKey: string, requestKey: string, state: OwnerDiscovery | null, catalog: OwnerDeployment[]) {
  const matchingOwner = state?.ownerKey === ownerKey;
  return { choices: matchingOwner ? state.choices : catalog, pending: !matchingOwner, refreshing: Boolean(matchingOwner && state.key !== requestKey) };
}
