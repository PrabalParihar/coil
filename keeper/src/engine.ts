import type { Address } from "viem";
import { needsGuard, type GuardPosition } from "./alerts.js";
export type Snapshot = {
  position: GuardPosition; oraclePrice: bigint; reserve: bigint; poolMusd: bigint; poolBtc: bigint;
  pegGuardBps: number; belowPegBps: bigint; settings: readonly unknown[];
};
export type KeeperIO = {
  listAccounts(): Promise<Address[]>;
  snapshot(account: Address): Promise<Snapshot>;
  simulateGuard(account: Address): Promise<boolean>;
  sendGuard(account: Address): Promise<string>;
  sendHeartbeat(): Promise<string>;
  receipt(hash: string): Promise<"success" | "reverted">;
  alert(message: string): Promise<void>;
};
export type EngineOptions = {
  chainId: number; factory: Address; keeper: Address | null; expectedKeeper: Address | null;
  mode: "read-only" | "execute"; pollMs: number; now?: () => number;
};
export type KeeperStatus = {
  chainId: number; factory: Address; keeper: Address | null; mode: "read-only" | "execute";
  lastScanAt: number | null; lastHeartbeatAt: number | null;
  status: "starting" | "stale" | "monitoring" | "healthy" | "degraded";
  counters: { scans: number; scanFailures: number; simulations: number; skipped: number; failures: number; confirmedGuards: number; confirmedHeartbeats: number };
};
type Retry = { fingerprint: string; attempts: number; retryAt: number; alert: string | null };

/** All snapshots are refreshed before checking retry deadlines. Changed inputs always retry immediately. */
export class KeeperEngine {
  private retries = new Map<string, Retry>();
  private lastScanAt: number | null = null;
  private lastHeartbeatAt: number | null = null;
  private degraded = false;
  private counters = { scans: 0, scanFailures: 0, simulations: 0, skipped: 0, failures: 0, confirmedGuards: 0, confirmedHeartbeats: 0 };
  private now: () => number;
  constructor(private options: EngineOptions, private io: KeeperIO) {
    this.now = options.now ?? Date.now;
  }
  private canExecute() {
    return this.options.mode === "execute" && this.options.keeper !== null && this.options.expectedKeeper !== null &&
      this.options.keeper.toLowerCase() === this.options.expectedKeeper.toLowerCase();
  }
  private async alert(message: string) {
    // Notification outages must never prevent simulation or rescue.
    try { await this.io.alert(message); } catch { /* public provider details intentionally omitted */ }
  }
  private async failure(account: Address, retry: Retry, code: string) {
    this.counters.failures++;
    retry.attempts++;
    retry.retryAt = this.now() + Math.min(300_000, this.options.pollMs * 2 ** Math.min(retry.attempts, 10));
    if (retry.alert !== code) {
      retry.alert = code;
      await this.alert(`Coil keeper: ${account} ${code}.`);
    }
  }
  async scan() {
    let complete = true;
    this.degraded = false;
    try {
      const accounts = await this.io.listAccounts();
      const current = new Set(accounts.map((a) => a.toLowerCase()));
      for (const key of this.retries.keys()) if (!current.has(key)) this.retries.delete(key);
      for (const account of accounts) {
        let snapshot: Snapshot;
        try { snapshot = await this.io.snapshot(account); }
        catch { complete = false; this.counters.failures++; continue; }
        const key = account.toLowerCase();
        const reason = needsGuard(snapshot.position, snapshot);
        if (!reason) { this.retries.delete(key); continue; }
        const fingerprint = JSON.stringify(snapshot, (_, v) => typeof v === "bigint" ? v.toString() : v);
        let retry = this.retries.get(key);
        if (!retry || retry.fingerprint !== fingerprint) {
          retry = { fingerprint, attempts: 0, retryAt: 0, alert: null };
          this.retries.set(key, retry);
        }
        if (this.now() < retry.retryAt) { this.counters.skipped++; continue; }
        this.counters.simulations++;
        let acted: boolean;
        try { acted = await this.io.simulateGuard(account); }
        catch { await this.failure(account, retry, "simulation failed"); continue; }
        if (!acted) { await this.failure(account, retry, "guard returned no progress"); continue; }
        if (!this.canExecute()) {
          if (retry.alert !== "actionable") {
            retry.alert = "actionable";
            await this.alert(`Coil keeper: ${account} actionable risk (${reason}); monitoring only.`);
          }
          continue;
        }
        try {
          const hash = await this.io.sendGuard(account);
          if (await this.io.receipt(hash) !== "success") {
            await this.failure(account, retry, "guard transaction reverted");
            continue;
          }
          this.counters.confirmedGuards++;
          this.retries.delete(key);
          await this.alert(`Coil keeper: confirmed guard for ${account}.`);
        } catch { await this.failure(account, retry, "guard confirmation failed"); }
      }
      if (this.options.mode === "execute") {
        if (!this.canExecute()) this.degraded = true;
        else {
          try {
            const hash = await this.io.sendHeartbeat();
            if (await this.io.receipt(hash) !== "success") this.degraded = true;
            else { this.lastHeartbeatAt = this.now(); this.counters.confirmedHeartbeats++; }
          } catch { this.degraded = true; }
        }
      }
    } catch { complete = false; }
    if (complete) { this.lastScanAt = this.now(); this.counters.scans++; }
    else { this.counters.scanFailures++; this.degraded = true; }
  }
  status(): KeeperStatus {
    const staleMs = Math.max(60_000, this.options.pollMs * 3);
    let status: KeeperStatus["status"];
    if (this.lastScanAt === null) status = this.degraded ? "degraded" : "starting";
    else if (this.now() - this.lastScanAt > staleMs) status = "stale";
    else if (this.degraded) status = "degraded";
    else if (this.options.mode === "read-only") status = "monitoring";
    else if (this.lastHeartbeatAt === null || this.now() - this.lastHeartbeatAt > staleMs) status = "degraded";
    else status = "healthy";
    return { chainId: this.options.chainId, factory: this.options.factory, keeper: this.options.keeper,
      mode: this.options.mode, lastScanAt: this.lastScanAt, lastHeartbeatAt: this.lastHeartbeatAt, status,
      counters: { ...this.counters } };
  }
}
