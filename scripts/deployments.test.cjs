const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const cli = path.join(__dirname, 'deployments.cjs');
const address = (n) => `0x${n.toString(16).padStart(40, '0')}`;
function fixture() {
  return { schemaVersion: 1, deployments: {
    '31611': { chainId: 31611, name: 'Mezo Testnet', rpcUrl: 'https://rpc.test.mezo.org', explorerUrl: 'https://explorer.test.mezo.org', status: 'legacy', factory: address(1), deploymentBlock: '16408315', implementation: address(2), keeper: address(3), contracts: { CoilLegacy: address(4) }, capabilities: { policy: false, coilFee: false, ownerActions: false } },
    '31612': { chainId: 31612, name: 'Mezo', rpcUrl: 'https://mezo.drpc.org', explorerUrl: 'https://explorer.mezo.org', status: 'pending', factory: null, deploymentBlock: null, implementation: null, keeper: null, contracts: {}, capabilities: { policy: false, coilFee: false, ownerActions: false } },
  }, retainedDeployments: {'31611': [], '31612': []} };
}
function run(manifest, mode = '--validate') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coil-deployments-'));
  try {
    fs.mkdirSync(path.join(root, 'deployments'));
    fs.writeFileSync(path.join(root, 'deployments/manifest.json'), JSON.stringify(manifest));
    const result = spawnSync(process.execPath, [cli, mode, '--root', root], { encoding: 'utf8' });
    return { result, files: ['web/src/lib/deployment.generated.ts', 'keeper/src/deployment.generated.ts'].map(p => fs.existsSync(path.join(root, p)) ? fs.readFileSync(path.join(root, p), 'utf8') : null) };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test('valid current and pending deployments generate identical package-local copies', () => {
  const { result, files } = run(fixture(), '--generate');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(files[0], files[1]);
  assert.match(files[0], /export const DEPLOYMENTS/);
  assert.match(files[0], /export type Deployment/);
  assert.match(files[0], /export const RETAINED_DEPLOYMENTS/);
  assert.match(files[0], /16408315/);
});

test('a deployment address and block must be supplied together', () => {
  const m = fixture(); m.deployments['31611'].deploymentBlock = null;
  const { result } = run(m);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /factory.*block|address.*block/i);
});

test('wrong chain metadata is rejected rather than writing to another chain', () => {
  const m = fixture(); m.deployments['31611'].chainId = 31612;
  const { result } = run(m);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /chain/i);
});

test('invalid and zero factory addresses are rejected', () => {
  for (const factory of ['0x123', address(0)]) {
    const m = fixture(); m.deployments['31611'].factory = factory;
    const { result } = run(m);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /address/i);
  }
});

test('negative, rounded or noncanonical deployment blocks are rejected', () => {
  for (const block of ['-1', '1.5', '1e7', '0', 16408315]) {
    const m = fixture(); m.deployments['31611'].deploymentBlock = block;
    const { result } = run(m);
    assert.notEqual(result.status, 0); assert.match(result.stderr, /block/i);
  }
});

test('pending mainnet cannot falsely advertise a ready deployment', () => {
  const m = fixture(); m.deployments['31612'].status = 'ready';
  const { result } = run(m);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /ready|factory|address/i);
});

test('new policy deployment requires its actual linked contract inventory', () => {
  const m = fixture(); const d = m.deployments['31611'];
  d.status = 'ready'; d.capabilities = { policy: true, coilFee: true, ownerActions: true };
  d.parkGovernor = address(7);
  const { result } = run(m);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /contract|library|Coil/i);
});

test('ready deployment inventory must bind its declared factory and implementation', () => {
  const m = fixture(); const d = m.deployments['31611'];
  d.status = 'ready'; d.capabilities = { policy: true, coilFee: true, ownerActions: true };
  d.parkGovernor = address(7);
  d.contracts = Object.fromEntries(['CoilFactory','CoilAccount','CoilLegacy','CoilExit','FlashSizer','CoilPark','CoilOwner'].map((name,i)=>[name,address(i+10)]));
  const { result } = run(m);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /factory|inventory|contract/i);
});

test('ready metadata records the actual nonzero Park governor', () => {
  const m = fixture(); const d = m.deployments['31611'];
  d.status = 'ready'; d.capabilities = { policy: true, coilFee: true, ownerActions: true };
  d.contracts = Object.fromEntries(['CoilFactory','CoilAccount','CoilLegacy','CoilExit','FlashSizer','CoilPark','CoilOwner'].map((name,i)=>[name,address(i+10)]));
  d.contracts.CoilFactory = d.factory; d.contracts.CoilAccount = d.implementation;
  assert.notEqual(run(m).result.status, 0);
  d.parkGovernor = address(7);
  assert.equal(run(m).result.status, 0);
  d.parkGovernor = address(0);
  assert.notEqual(run(m).result.status, 0);
});

test('invalid RPC protocols and unknown capability flags cannot silently pass', () => {
  const m = fixture(); m.deployments['31611'].rpcUrl = 'file:///etc/passwd';
  let r = run(m).result; assert.notEqual(r.status, 0); assert.match(r.stderr, /https|URL|RPC/i);
  const m2 = fixture(); m2.deployments['31611'].capabilities.coilFee = 'true';
  r = run(m2).result; assert.notEqual(r.status, 0); assert.match(r.stderr, /capabilit|boolean/i);
});

test('replacing the active factory retains prior chain-specific generations', () => {
  const m = fixture();
  const old = structuredClone(m.deployments['31611']);
  m.retainedDeployments['31611'].push(old);
  m.deployments['31611'] = {...old, factory: address(5), deploymentBlock: '16408316', implementation: address(6)};
  const {result, files} = run(m, '--generate');
  assert.equal(result.status, 0, result.stderr);
  assert.match(files[0], new RegExp(old.factory));
  assert.match(files[0], new RegExp(address(5)));
});

test('retained factories cannot silently change chain, creation block or identity', () => {
  for (const change of [
    m => m.retainedDeployments['31611'].push({...m.deployments['31611'], chainId: 31612}),
    m => m.retainedDeployments['31611'].push({...m.deployments['31611'], deploymentBlock: '16408316'}),
    m => m.retainedDeployments['31611'].push({...m.deployments['31611'], implementation: address(9)}),
    m => m.retainedDeployments['31611'].push({...m.deployments['31611'], factory: null, deploymentBlock: null, status: 'pending'}),
    m => m.retainedDeployments['31611'].push(m.deployments['31611'], m.deployments['31611']),
  ]) {
    const m = fixture(); change(m);
    const {result} = run(m);
    assert.notEqual(result.status, 0, 'invalid retained identity was accepted');
    assert.match(result.stderr, /retained|chain|conflict|duplicate/i);
  }
});

test('shipped factory generations stay reachable after future active replacement', () => {
  const {loadManifest} = require('./deployments.cjs');
  const m = loadManifest(path.resolve(__dirname, '..'));
  const retained = m.retainedDeployments['31611'];
  for (const [factory, block] of [
    ['0xff3335576f998EE872596d4EB7ABECb71a0D5BC8', '16408315'],
    ['0x2218D33d2f9279A4266b49dB572F5b1343d09De5', '16407578'],
    ['0x6A38f560cF8612cc81cF966831890DBb310e31F7', '16400160'],
    ['0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e', '16243828'],
  ]) assert.ok(retained.some(d => d.factory.toLowerCase() === factory.toLowerCase() && d.deploymentBlock === block), `Missing retained factory ${factory}`);
});
