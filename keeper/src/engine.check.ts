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
// Repayment must compare with the last successful observation, including skipped polls.
{
  const simulationsAfterRepayment: number[] = [];
  for (const repaidDelta of [9n, 0n]) {
    let repaymentNow = 8_000_000;
    const originalDebt = 10_000n * 10n ** 18n;
    let repaymentSnapshot = { ...snapshot, position: { ...snapshot.position,
      cr: 130n * 10n ** 16n, floorCR: 140n * 10n ** 16n,
      guardTargetCR: 150n * 10n ** 16n, debt: originalDebt } };
    let repaymentSimulations = 0;
    const repaymentAlerts: string[] = [];
    const repaymentEngine = new KeeperEngine({ ...options, now: () => repaymentNow, mode: "read-only", keeper: null }, {
      ...io, snapshot: async () => repaymentSnapshot,
      simulateGuard: async () => { repaymentSimulations++; return false; },
      alert: async (message) => { repaymentAlerts.push(message); },
    });
    await repaymentEngine.scan();
    repaymentNow += 20_000;
    repaymentSnapshot = { ...repaymentSnapshot, position: { ...repaymentSnapshot.position, debt: originalDebt + 10n } };
    await repaymentEngine.scan();
    assert.equal(repaymentSimulations, 1, "tiny accrued debt preserves backoff on the skipped poll");
    repaymentNow += 1;
    repaymentSnapshot = { ...repaymentSnapshot, position: { ...repaymentSnapshot.position, debt: originalDebt + repaidDelta } };
    await repaymentEngine.scan();
    simulationsAfterRepayment.push(repaymentSimulations);
    const repaymentAnchor = repaymentSnapshot.position.debt;
    repaymentNow += 1;
    repaymentSnapshot = { ...repaymentSnapshot, position: { ...repaymentSnapshot.position,
      debt: repaymentAnchor + (repaymentAnchor + 19_999n) / 20_000n } };
    await repaymentEngine.scan();
    assert.equal(repaymentSimulations, 2, "sub-basis-point accrual after repayment remains backed off");
    repaymentNow += 1;
    repaymentSnapshot = { ...repaymentSnapshot, position: { ...repaymentSnapshot.position,
      debt: repaymentAnchor + (repaymentAnchor + 9_999n) / 10_000n } };
    await repaymentEngine.scan();
    assert.equal(repaymentSimulations, 3, "updating last observed debt must not move the cumulative debt-growth anchor");
    assert.equal(repaymentAlerts.length, 1, "observed repayment retry retains unchanged failure alert deduplication");
  }
  assert.deepEqual(simulationsAfterRepayment, [2, 2], "D->D+10->D+9 and D->D+10->D both immediately resimulate observed repayment");
}
// Changed markets retry immediately without restarting an unchanged failure alert episode.
{
  let marketNow = 9_000_000;
  let marketSnapshot = snapshot;
  let marketSimulations = 0;
  let marketOutcome: "no-op" | "throw" | "actionable" = "no-op";
  const marketAlerts: string[] = [];
  const marketEngine = new KeeperEngine({ ...options, now: () => marketNow, mode: "read-only", keeper: null }, {
    ...io, snapshot: async () => marketSnapshot,
    simulateGuard: async () => { marketSimulations++; if (marketOutcome === "throw") throw new Error("private-provider-error"); return marketOutcome === "actionable"; },
    alert: async (message) => { marketAlerts.push(message); },
  });
  await marketEngine.scan();
  marketNow += 1;
  marketSnapshot = { ...marketSnapshot, oraclePrice: 79_999n };
  await marketEngine.scan();
  assert.equal(marketSimulations, 2, "changed oracle retries a failed rescue before its deadline");
  assert.equal(marketAlerts.length, 1, "changed oracle must not duplicate the same failure alert in one risk episode");
  marketOutcome = "throw";
  marketSnapshot = { ...marketSnapshot, poolMusd: 799_999n };
  await marketEngine.scan();
  assert.equal(marketAlerts.length, 2, "a changed failure code still alerts");
  marketOutcome = "actionable";
  marketSnapshot = { ...marketSnapshot, reserve: 1n };
  await marketEngine.scan();
  assert.equal(marketAlerts.length, 3, "newly actionable simulation still alerts in monitoring mode");
  await marketEngine.scan();
  assert.equal(marketAlerts.length, 3, "unchanged actionable alert is deduplicated");
  marketSnapshot = { ...marketSnapshot, position: { ...marketSnapshot.position, cr: 160n } };
  await marketEngine.scan();
  marketOutcome = "no-op";
  marketSnapshot = snapshot;
  await marketEngine.scan();
  assert.equal(marketAlerts.length, 4, "resolved risk clears the episode so a new failure alerts again");
}
// Debt and derived ratios accrue between polls even when the rescue inputs do not change.
{
  let interestNow = 10_000_000;
  const originalPosition = { active: true, collateral: 1n * 10n ** 18n, debt: 10_000n * 10n ** 18n,
    cr: 130n * 10n ** 16n, liquidationPrice: 11_000n * 10n ** 18n,
    floorCR: 140n * 10n ** 16n, guardTargetCR: 150n * 10n ** 16n, redemptionRank: 3n, redemptionZone: 0 };
  let interestSnapshot = { ...snapshot, position: originalPosition };
  let interestSimulations = 0;
  const interestAlerts: string[] = [];
  const interestEngine = new KeeperEngine({ ...options, now: () => interestNow, mode: "read-only", keeper: null }, {
    ...io, snapshot: async () => interestSnapshot,
    simulateGuard: async () => { interestSimulations++; return false; },
    alert: async (message) => { interestAlerts.push(message); },
  });
  await interestEngine.scan();
  interestNow += 20_000;
  interestSnapshot = { ...interestSnapshot, position: { ...originalPosition, debt: originalPosition.debt + 1n,
    cr: originalPosition.cr - 1n, liquidationPrice: originalPosition.liquidationPrice + 1n } };
  await interestEngine.scan();
  assert.equal(interestSimulations, 1, "one wei interest and derived CR/liquidation drift must retain no-op backoff");
  assert.equal(interestAlerts.length, 1, "automatic interest drift must not duplicate identical failure alerts");
  interestNow += 20_000;
  interestSnapshot = { ...interestSnapshot, position: { ...interestSnapshot.position,
    debt: originalPosition.debt + 2n, cr: originalPosition.cr - 2n, liquidationPrice: originalPosition.liquidationPrice + 2n } };
  await interestEngine.scan();
  assert.equal(interestSimulations, 2, "interest drift still retries at the original deadline");
  assert.equal(interestAlerts.length, 1, "scheduled retry with unchanged failure remains deduplicated");
  // Compare cumulative worsening with the retry's original anchor, not the last poll.
  interestNow += 1;
  interestSnapshot = { ...interestSnapshot, position: { ...interestSnapshot.position,
    cr: originalPosition.cr - 65_000_000_000_000n } };
  await interestEngine.scan();
  assert.equal(interestSimulations, 2, "sub-basis-point movement retains backoff even at a rounding boundary");
  interestNow += 1;
  interestSnapshot = { ...interestSnapshot, position: { ...interestSnapshot.position,
    cr: originalPosition.cr - 130_000_000_000_000n } };
  await interestEngine.scan();
  assert.equal(interestSimulations, 3, "cumulative one-basis-point worsening retries immediately before deadline");
  interestNow += 1;
  interestSnapshot = { ...interestSnapshot, position: { ...interestSnapshot.position,
    debt: originalPosition.debt + 1n } };
  await interestEngine.scan();
  assert.equal(interestSimulations, 4, "even one wei owner debt reduction can make a rescue newly usable");
  interestNow += 1;
  const debtAnchor = interestSnapshot.position.debt;
  interestSnapshot = { ...interestSnapshot, position: { ...interestSnapshot.position,
    debt: debtAnchor + (debtAnchor + 9_999n) / 10_000n } };
  await interestEngine.scan();
  assert.equal(interestSimulations, 5, "one-basis-point debt growth independently retries before deadline");
  interestNow += 1;
  interestSnapshot = { ...interestSnapshot, position: { ...interestSnapshot.position,
    collateral: interestSnapshot.position.collateral + 1n } };
  await interestEngine.scan();
  assert.equal(interestSimulations, 6, "even tiny collateral changes remain exact actionable inputs");

  for (const threshold of [originalPosition.floorCR, 110n * 10n ** 16n, 150n * 10n ** 16n]) {
    let thresholdNow = 20_000_000;
    let thresholdSnapshot = { ...snapshot, position: { ...originalPosition,
      cr: threshold + 1n, redemptionZone: 8,
      guardTargetCR: threshold >= originalPosition.guardTargetCR ? threshold + 10n ** 17n : originalPosition.guardTargetCR } };
    let thresholdSimulations = 0;
    const thresholdEngine = new KeeperEngine({ ...options, now: () => thresholdNow, mode: "read-only", keeper: null }, {
      ...io, snapshot: async () => thresholdSnapshot,
      simulateGuard: async () => { thresholdSimulations++; return false; }, alert: async () => {},
    });
    await thresholdEngine.scan();
    thresholdNow += 1;
    thresholdSnapshot = { ...thresholdSnapshot, position: { ...thresholdSnapshot.position, cr: threshold - 1n } };
    await thresholdEngine.scan();
    assert.equal(thresholdSimulations, 2, "tiny guard-floor or protocol110%/150% boundary crossing bypasses backoff");
    thresholdSnapshot = { ...thresholdSnapshot, position: { ...thresholdSnapshot.position,
      cr: thresholdSnapshot.position.guardTargetCR } };
    await thresholdEngine.scan();
    assert.equal(thresholdSimulations, 2, "reaching the guard target clears the old risk episode");
    thresholdNow += 1;
    thresholdSnapshot = { ...thresholdSnapshot, position: { ...thresholdSnapshot.position,
      cr: thresholdSnapshot.position.guardTargetCR - 1n } };
    await thresholdEngine.scan();
    assert.equal(thresholdSimulations, 3, "one wei crossing below the guard target immediately reevaluates actionable rank risk");
  }
}
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
assert(alerts.some((message) => message.includes("confirmed guard")), "confirmed rescue transition still notifies");
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
