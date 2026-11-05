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
  } };
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
  const { result } = run(m);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /contract|library|Coil/i);
});

test('ready deployment inventory must bind its declared factory and implementation', () => {
  const m = fixture(); const d = m.deployments['31611'];
  d.status = 'ready'; d.capabilities = { policy: true, coilFee: true, ownerActions: true };
  d.contracts = Object.fromEntries(['CoilFactory','CoilAccount','CoilLegacy','CoilExit','FlashSizer','CoilPark','CoilOwner'].map((name,i)=>[name,address(i+10)]));
  const { result } = run(m);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /factory|inventory|contract/i);
});

test('invalid RPC protocols and unknown capability flags cannot silently pass', () => {
  const m = fixture(); m.deployments['31611'].rpcUrl = 'file:///etc/passwd';
  let r = run(m).result; assert.notEqual(r.status, 0); assert.match(r.stderr, /https|URL|RPC/i);
  const m2 = fixture(); m2.deployments['31611'].capabilities.coilFee = 'true';
  r = run(m2).result; assert.notEqual(r.status, 0); assert.match(r.stderr, /capabilit|boolean/i);
});
