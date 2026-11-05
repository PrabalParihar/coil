export type PublicDeployment = {
  chainId: number;
  factory: string | null;
  deploymentBlock: string | null;
  status: string;
};
const nonzeroAddress = (value?: string | null) => Boolean(value && /^0x[\da-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value));

export function resolveDeployment<T extends PublicDeployment>(base: T, factory?: string, block?: string, catalog: Readonly<Record<string, PublicDeployment>> = {}): T {
  if (factory !== undefined || block !== undefined) {
    if (!nonzeroAddress(factory) || !block || !/^\d+$/.test(block) || BigInt(block) < 1n) {
      throw new Error("Factory override requires a nonzero address and matching decimal deployment block.");
    }
    const known = base.factory?.toLowerCase() === factory!.toLowerCase();
    if (known) {
      if (base.deploymentBlock !== block) throw new Error("Factory and deployment block do not match the selected-chain manifest.");
      return base;
    }
    if (Object.values(catalog).some(entry => entry.chainId !== base.chainId && entry.factory?.toLowerCase() === factory!.toLowerCase())) {
      throw new Error("Factory belongs to a different chain.");
    }
    return { ...base, factory: factory!, deploymentBlock: block!, status: base.chainId === 31612 ? "pending" : base.status, keeper: null, implementation: null, capabilities: { policy: false, coilFee: false, ownerActions: false } };
  }
  return base;
}

export function canWrite(deployment: PublicDeployment, mainnetEnabled: boolean): boolean {
  if (![31611, 31612].includes(deployment.chainId) || deployment.status === "pending" || !nonzeroAddress(deployment.factory) || !deployment.deploymentBlock || !/^\d+$/.test(deployment.deploymentBlock)) return false;
  return deployment.chainId === 31611 || (deployment.status === "ready" && mainnetEnabled);
}

export function loopArguments(target: bigint, slippage: bigint, acceptedFee: number, hasPolicy: boolean): readonly [bigint, bigint] | readonly [bigint, bigint, number] {
  if (!Number.isInteger(acceptedFee) || acceptedFee < 0 || acceptedFee > 50) throw new Error("Invalid accepted Coil fee.");
  return hasPolicy ? [target, slippage, acceptedFee] : [target, slippage];
}

export function ownerActionState(capable: boolean, recovery: boolean, ownsAccount: boolean) {
  const allowed = capable && ownsAccount;
  return { repay: allowed, close: allowed && !recovery, claim: allowed, topUp: allowed };
}

export function heartbeatState(input: { now: number; timestamp?: number; sender?: string; expectedKeeper?: string | null; authenticated: boolean }) {
  if (!input.authenticated || !nonzeroAddress(input.expectedKeeper)) return { state: "unconfigured" as const, age: null };
  const age = input.timestamp === undefined ? null : input.now - input.timestamp;
  const trusted = input.sender?.toLowerCase() === input.expectedKeeper?.toLowerCase();
  return { state: trusted && age !== null && age >= 0 && age <= 180 ? "fresh" as const : "stale" as const, age };
}

export function recentRange(latest: bigint, deployment: bigint, before?: bigint) {
  const toBlock = before === undefined ? latest : before - 1n;
  const floor = toBlock > 9998n ? toBlock - 9998n : 0n;
  return { fromBlock: floor > deployment ? floor : deployment, toBlock };
}

export function ownerTransactions(action: "repay" | "close" | "claim", account: `0x${string}`, musd: `0x${string}`, amount: bigint, recovery: boolean) {
  if (action === "close" && recovery) throw new Error("Mezo blocks full close during Recovery Mode. Repay safely, then submit a close yourself when permitted.");
  if (amount < 0n || (action === "repay" && amount === 0n)) throw new Error("Enter a positive MUSD amount.");
  if (action === "claim") return [{ address: account, functionName: "claimCollateral" as const, args: [] as const }];
  if (action === "close" && amount === 0n) return [{ address: account, functionName: "closeWithMUSD" as const, args: [0n] as const }];
  return [
    { address: musd, functionName: "approve" as const, args: [account, amount] as const },
    { address: account, functionName: action === "repay" ? "repayWithMUSD" as const : "closeWithMUSD" as const, args: [amount] as const },
  ];
}

/** Only a contract-level missing selector may identify legacy capability. */
export function isUnsupportedPolicy(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 12 && current && typeof current === "object"; depth++) {
    const value = current as { name?: string; raw?: string; reason?: string; cause?: unknown };
    if (value.name === "ContractFunctionZeroDataError") return true;
    if (value.name === "ContractFunctionRevertedError" && (!value.raw || value.raw === "0x") && (!value.reason || value.reason === "execution reverted")) return true;
    current = value.cause;
  }
  return false;
}

export function chainEvidenceFresh(now: number, blockTimestamp: number): boolean {
  return Number.isFinite(blockTimestamp) && now - blockTimestamp <= 180 && blockTimestamp <= now + 30;
}
