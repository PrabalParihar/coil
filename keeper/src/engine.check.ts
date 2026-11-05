import assert from "node:assert/strict";
import { KeeperEngine, type Snapshot, type KeeperIO } from "./engine.js";
import { createStatusServer } from "./status.js";
const account = "0x0000000000000000000000000000000000000011" as const;
const signer = "0x0000000000000000000000000000000000000012" as const;
let now = 1_000_000;
let snapshot: Snapshot = {
  position: { active: true, cr: 130n, floorCR: 140n, guardTargetCR: 150n, redemptionRank: 3n, redemptionZone: 0 },
  oraclePrice: 80_000n, reserve: 0n, poolMusd: 800_000n, poolBtc: 10n,
  pegGuardBps: 50, belowPegBps: 0n, settings: [200n],
};
let simulateCount = 0;
let sends = 0;
let simulateResult = false;
let simulateError = false;
let receipt: "success" | "reverted" = "success";
const alerts: string[] = [];
const io: KeeperIO = {
  listAccounts: async () => [account], snapshot: async () => snapshot,
  simulateGuard: async () => { simulateCount++; if (simulateError) throw new Error("provider-secret"); return simulateResult; },
  sendGuard: async () => { sends++; return "0x01"; }, sendHeartbeat: async () => "0x02",
  receipt: async () => receipt, alert: async (message) => { alerts.push(message); },
};
const options = { chainId: 31611, factory: account, keeper: signer, mode: "execute" as const, pollMs: 20_000, expectedKeeper: signer, now: () => now };
const engine = new KeeperEngine(options, io);
await engine.scan();
assert.equal(simulateCount, 1, "first no-op is simulated");
assert.equal(sends, 0, "false simulation never sends");
assert.equal(alerts.length, 1, "one initial failure alert");
now += 20_000;
await engine.scan();
assert.equal(simulateCount, 1, "unchanged failure backs off at normal poll cadence");
now += 20_000;
await engine.scan();
assert.equal(simulateCount, 2, "failure becomes eligible after initial bounded delay");
assert.equal(alerts.length, 1, "unchanged failure alerts deduplicated even on retry");
for (const change of [
  { reserve: 100n }, { oraclePrice: 70_000n }, { settings: [100n] },
  { position: { ...snapshot.position, cr: 110n } }, { poolMusd: 700_000n },
]) {
  const before: number = simulateCount;
  snapshot = { ...snapshot, ...change };
  now += 1;
  await engine.scan();
  assert.equal(simulateCount, before + 1, "changed risk/reserve/oracle/settings/pool bypass backoff");
}
simulateError = true;
snapshot = { ...snapshot, reserve: 101n };
await engine.scan();
assert.equal(sends, 0, "throwing simulation never sends");
assert(!JSON.stringify(engine.status()).includes("provider-secret"), "public status excludes private errors");
simulateError = false;
simulateResult = true;
snapshot = { ...snapshot, reserve: 102n };
receipt = "reverted";
const heartbeatBefore = engine.status().lastHeartbeatAt;
await engine.scan();
assert.equal(engine.status().lastHeartbeatAt, heartbeatBefore, "reverted heartbeat cannot advance freshness");
assert.equal(engine.status().counters.confirmedGuards, 0, "reverted rescue is not confirmed");
receipt = "success";
snapshot = { ...snapshot, reserve: 103n };
await engine.scan();
assert.equal(engine.status().counters.confirmedGuards, 1);
assert.equal(engine.status().lastHeartbeatAt, now);
assert.equal(engine.status().status, "healthy");
now += 60_001;
assert.equal(engine.status().status, "stale", "stalled scan is unhealthy despite live process");
const readonly = new KeeperEngine({ ...options, mode: "read-only", keeper: null }, io);
await readonly.scan();
assert.equal(readonly.status().status, "monitoring", "read-only never claims execution protection");
assert.equal(readonly.status().lastHeartbeatAt, null);
const alertCountBeforeMonitoring = alerts.length;
await readonly.scan();
assert.equal(alerts.length, alertCountBeforeMonitoring, "unchanged actionable monitoring alert is deduplicated");
assert(alerts.some((message) => message.includes("actionable")), "monitoring alerts on actionable risk even without sending");
const mismatched = new KeeperEngine({ ...options, expectedKeeper: account }, io);
await mismatched.scan();
assert.equal(mismatched.status().status, "degraded", "wrong expected signer cannot be healthy");
// Repeated identical failures become eligible by five minutes, never unbounded delays.
const bounded = new KeeperEngine({ ...options, mode: "read-only", keeper: null }, { ...io, simulateGuard: async () => { simulateCount++; return false; } });
await bounded.scan();
for (let i = 0; i < 8; i++) {
  now += 300_000;
  const previousCount: number = simulateCount;
  await bounded.scan();
  assert.equal(simulateCount, previousCount + 1, "retry deadline stays bounded at five minutes");
}
let brokenReads = false;
const reads = new KeeperEngine({ ...options, mode: "read-only", keeper: null }, { ...io,
  snapshot: async () => { if (brokenReads) throw new Error("private-provider-error"); return snapshot; },
});
await reads.scan();
const lastGoodScan = reads.status().lastScanAt;
brokenReads = true;
now += 1;
await reads.scan();
assert.equal(reads.status().lastScanAt, lastGoodScan, "failed account reads cannot refresh successful scan timestamp");
assert.equal(reads.status().status, "degraded");
const unconfirmed = new KeeperEngine(options, { ...io, receipt: async () => { throw new Error("receipt timeout"); } });
await unconfirmed.scan();
assert.equal(unconfirmed.status().lastHeartbeatAt, null, "unconfirmed heartbeat cannot claim freshness");
assert.equal(unconfirmed.status().counters.confirmedGuards, 0);
assert.equal(unconfirmed.status().status, "degraded");
const server = createStatusServer(() => engine.status());
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 503, "real HTTP health becomes unavailable when scan stalls");
  const body = await health.json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(body).sort(), ["chainId", "factory", "keeper", "mode", "lastScanAt", "lastHeartbeatAt", "status", "counters"].sort());
  assert.equal((await fetch(`${base}/status`)).status, 200);
  assert.equal((await fetch(`${base}/anything`)).status, 404);
  assert.equal((await fetch(`${base}/status`, { method: "POST" })).status, 405);
  await engine.scan();
  assert.equal((await fetch(`${base}/health`)).status, 200, "fresh confirmed scan restores HTTP health");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log("keeper engine/backoff/status/real HTTP checks passed");
