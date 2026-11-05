import assert from "node:assert/strict";
import type { Deployment } from "./deployment.generated.js";
import { selectDeployment, assertRpcChain } from "./config.js";
const factory = "0x0000000000000000000000000000000000000021";
const other = "0x0000000000000000000000000000000000000022";
const base: Deployment = { chainId: 31611, name: "Testnet", rpcUrl: "https://rpc.test.mezo.org", explorerUrl: "https://explorer.test.mezo.org", status: "legacy" as const, factory, deploymentBlock: "123", implementation: null, keeper: null, contracts: {}, capabilities: { policy: false, coilFee: false, ownerActions: false } };
const catalog = { "31611": base, "31612": { ...base, chainId: 31612, status: "pending" as const, factory: null, deploymentBlock: null } };
assert.equal(selectDeployment({}, catalog).factory, factory);
for (const env of [
  { COIL_CHAIN_ID: "1" }, { COIL_CHAIN_ID: "31611.0" }, { COIL_FACTORY: other },
  { COIL_FACTORY_DEPLOY_BLOCK: "100" }, { COIL_FACTORY: other, COIL_FACTORY_DEPLOY_BLOCK: "-1" },
  { COIL_FACTORY: "0x0000000000000000000000000000000000000000", COIL_FACTORY_DEPLOY_BLOCK: "100" },
  { COIL_FACTORY: factory, COIL_FACTORY_DEPLOY_BLOCK: "999" },
  { COIL_CHAIN_ID: "31612", COIL_FACTORY: factory, COIL_FACTORY_DEPLOY_BLOCK: "123" },
  { COIL_CHAIN_ID: "31612", COIL_EXECUTE: "true" },
  { COIL_EXPECTED_KEEPER: "bad" }, { PORT: "-1" }, { KEEPER_POLL_MS: "bad" },
]) assert.throws(() => selectDeployment(env, catalog), `reject invalid configuration ${Object.keys(env).join(",")}`);
assert.throws(() => assertRpcChain(31611, 31612), /chain/i);
const selected = selectDeployment({ COIL_FACTORY: other, COIL_FACTORY_DEPLOY_BLOCK: "456", COIL_RPC_URL: "https://rpc.example" }, catalog);
assert.equal(selected.factory, other);
assert.equal(selected.deploymentBlock, 456n);
assert.equal(selected.rpcUrl, "https://rpc.example");
assert.equal(selected.expectedKeeper, null, "unlisted factory cannot inherit a known deployment's signer");
assert.equal(selectDeployment({ COIL_EXECUTE: "true" }, catalog).execute, true);
console.log("keeper chain/factory/block configuration checks passed");

const collision = { ...catalog, "31612": { ...base, chainId: 31612, status: "ready" as const } };
assert.equal(selectDeployment({}, collision).chainId, 31611, "same address on two chains is valid when selected manifest pair matches");
const readyMainnet = { ...catalog, "31612": { ...base, chainId: 31612, factory: other as `0x${string}`, status: "ready" as const } };
assert.throws(() => selectDeployment({ COIL_CHAIN_ID: "31612", COIL_EXECUTE: "true" }, readyMainnet), /Mainnet/);
assert.equal(selectDeployment({ COIL_CHAIN_ID: "31612", COIL_EXECUTE: "true", COIL_MAINNET_ENABLED: "true" }, readyMainnet).chainId, 31612);

// A factory replacement must preserve independent services for accounts on the retained generation.
const oldImplementation = "0x0000000000000000000000000000000000000031" as const;
const oldKeeper = "0x0000000000000000000000000000000000000041" as const;
const newImplementation = "0x0000000000000000000000000000000000000032" as const;
const newKeeper = "0x0000000000000000000000000000000000000042" as const;
const retainedLegacy: Deployment = { ...base, implementation: oldImplementation, keeper: oldKeeper,
  rpcUrl: "https://old-generation-rpc.example", explorerUrl: "https://old-generation-explorer.example" };
const replacement: Deployment = { ...base, factory: other as `0x${string}`, deploymentBlock: "456", status: "ready",
  implementation: newImplementation, keeper: newKeeper, capabilities: { policy: true, coilFee: true, ownerActions: true } };
const afterReplacement = { ...catalog, "31611": replacement };
const retained = { "31611": [retainedLegacy], "31612": [] };
const oldServiceEnv = { COIL_CHAIN_ID: "31611", COIL_FACTORY: factory, COIL_FACTORY_DEPLOY_BLOCK: "123", COIL_EXECUTE: "true" };
const oldService = selectDeployment(oldServiceEnv, afterReplacement, false, retained);
assert.equal(oldService.expectedKeeper, oldKeeper, "retained service binds original expected signer after active replacement");
assert.equal(oldService.implementation, oldImplementation, "retained service validates original implementation");
assert.equal(oldService.deploymentBlock, 123n);
assert.equal(oldService.deployment.factory, factory);
assert.equal(oldService.deployment.capabilities.policy, false, "retained generation cannot inherit active capabilities");
assert.equal(oldService.rpcUrl, "https://old-generation-rpc.example");
assert.equal(oldService.explorerUrl, "https://old-generation-explorer.example");
const newService = selectDeployment({}, afterReplacement, false, retained);
assert.equal(newService.factory, other);
assert.equal(newService.expectedKeeper, newKeeper);
assert.equal(newService.implementation, newImplementation);
for (const env of [
  { ...oldServiceEnv, COIL_FACTORY_DEPLOY_BLOCK: "124" },
  { ...oldServiceEnv, COIL_CHAIN_ID: "31612" },
  { ...oldServiceEnv, COIL_EXPECTED_KEEPER: newKeeper },
]) assert.throws(() => selectDeployment(env, afterReplacement, false, retained), "retained service rejects incorrect creation pair/chain/signer");
// The same numeric factory on two chains is still allowed when both pairs are known.
const retainedCollision = { ...retained, "31612": [{ ...retainedLegacy, chainId: 31612 }] };
assert.equal(selectDeployment(oldServiceEnv, afterReplacement, false, retainedCollision).chainId, 31611);
const oldMainnet = { ...retainedLegacy, chainId: 31612, status: "ready" as const };
const mainnetRetained = { "31612": [oldMainnet] };
assert.equal(selectDeployment({ ...oldServiceEnv, COIL_CHAIN_ID: "31612", COIL_MAINNET_ENABLED: "true" }, readyMainnet, false, mainnetRetained).expectedKeeper, oldKeeper,
  "existing enabled mainnet service can continue protecting retained ready accounts");
assert.throws(() => selectDeployment({ ...oldServiceEnv, COIL_CHAIN_ID: "31612" }, readyMainnet, false, mainnetRetained), /Mainnet/);
console.log("keeper retained deployment rollout checks passed");

assert.throws(() => selectDeployment({ ...oldServiceEnv, COIL_CHAIN_ID: "31612", COIL_MAINNET_ENABLED: "true" }, readyMainnet, false,
  { "31612": [{ ...oldMainnet, status: "legacy" }] }), /Mainnet/, "retention cannot promote legacy mainnet status to execution-ready");
