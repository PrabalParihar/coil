/* eslint-disable @typescript-eslint/no-require-imports -- Node built-in test runner loads TypeScript without another dependency. */
const ts = require('typescript');
const fs = require('node:fs');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, file);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const quote = require('../src/lib/quote.ts');
const readiness = require('../src/lib/readiness.ts');
const W = 10n ** 18n;
const market = { price: 100000n * W, borrowRate: 5n * 10n ** 15n, minNetDebt: 1800n * W, refiPct: 0n, reserveMusd: 1000000000n * W, reserveBtc: 10000n * W, feeBps: 30n };
test('Coil fee gross-up repays the requested net with integer rounding', () => {
  assert.equal(typeof quote.grossUpCoilFee, 'function');
  assert.equal(quote.grossUpCoilFee(10000n, 25n), 10026n);
  assert.equal(quote.grossUpCoilFee(1n, 50n), 2n);
  assert.throws(() => quote.grossUpCoilFee(1n, 10000n));
});
test('legacy previews have zero separate Coil fee and preserve debt', () => {
  const legacy = quote.quoteFlashLoop(W / 10n, 2n * W, 100n, market);
  assert.equal(legacy.coilFeeMusd, 0n);
  const explicit = quote.quoteFlashLoop(W / 10n, 2n * W, 100n, { ...market, coilFeeBps: 0n });
  assert.deepEqual(legacy, explicit);
});
test('flash preview sizes gross debt including the separately shown Coil fee', () => {
  const legacy = quote.quoteFlashLoop(W / 10n, 2n * W, 100n, market);
  const paid = quote.quoteFlashLoop(W / 10n, 2n * W, 100n, { ...market, coilFeeBps: 50n });
  assert.equal(paid.coilFeeMusd, paid.musdMinted * 50n / 10000n);
  assert.ok(paid.flashBtc < legacy.flashBtc);
  assert.ok(paid.cr >= 2n * W);
  assert.equal(paid.debt, 200n * W + paid.musdMinted + paid.musdMinted * market.borrowRate / W);
});
test('router preview swaps post-Coil-fee MUSD', () => {
  const paid = quote.quoteLoop(W / 10n, 2n * W, 100n, { ...market, coilFeeBps: 50n });
  assert.ok(paid.coilFeeMusd > 0n);
  assert.ok(paid.cr >= 2n * W);
});
test('deployment overrides reject partial, zero and malformed address/block pairs', () => {
  assert.equal(typeof readiness.resolveDeployment, 'function');
  const base = { chainId: 31611, factory: '0xff3335576f998EE872596d4EB7ABECb71a0D5BC8', deploymentBlock: '16408315', status: 'legacy' };
  assert.throws(() => readiness.resolveDeployment(base, '0x1111111111111111111111111111111111111111', undefined));
  assert.throws(() => readiness.resolveDeployment(base, undefined, '1'));
  assert.throws(() => readiness.resolveDeployment(base, '0x0000000000000000000000000000000000000000', '1'));
  assert.throws(() => readiness.resolveDeployment(base, base.factory, '-1'));
  assert.equal(readiness.resolveDeployment(base).deploymentBlock, '16408315');
});
test('unsupported or pending mainnet deployment never enables transactions', () => {
  assert.equal(typeof readiness.canWrite, 'function');
  assert.equal(readiness.canWrite({ chainId: 31612, status: 'pending', factory: null, deploymentBlock: null }, true), false);
  assert.equal(readiness.canWrite({ chainId: 31612, status: 'ready', factory: '0x1111111111111111111111111111111111111111', deploymentBlock: '1' }, false), false);
  assert.equal(readiness.canWrite({ chainId: 1, status: 'ready', factory: '0x1111111111111111111111111111111111111111', deploymentBlock: '1' }, true), false);
});
test('policy capability selects accepted-fee overload and legacy keeps two arguments', () => {
  assert.equal(typeof readiness.loopArguments, 'function');
  assert.deepEqual(readiness.loopArguments(2n * W, 50n, 25, true), [2n * W, 50n, 25]);
  assert.deepEqual(readiness.loopArguments(2n * W, 50n, 0, false), [2n * W, 50n]);
});
test('RM offers owner repayment but never a full or automatic close', () => {
  assert.equal(typeof readiness.ownerActionState, 'function');
  assert.deepEqual(readiness.ownerActionState(true, true, true), { repay: true, close: false, claim: true, topUp: true });
  assert.equal(readiness.ownerActionState(false, true, true).close, false);
  assert.equal(readiness.ownerActionState(true, false, true).close, true);
});
test('heartbeat requires authenticated expected keeper and expires without fresh chain evidence', () => {
  assert.equal(typeof readiness.heartbeatState, 'function');
  const keeper = '0x1111111111111111111111111111111111111111';
  assert.equal(readiness.heartbeatState({ now: 1000, timestamp: 990, sender: keeper, expectedKeeper: keeper, authenticated: false }).state, 'unconfigured');
  assert.equal(readiness.heartbeatState({ now: 1000, timestamp: 990, sender: keeper, expectedKeeper: keeper, authenticated: true }).state, 'fresh');
  assert.equal(readiness.heartbeatState({ now: 2000, timestamp: 990, sender: keeper, expectedKeeper: keeper, authenticated: true }).state, 'stale');
  assert.equal(readiness.heartbeatState({ now: 1000, timestamp: 1010, sender: keeper, expectedKeeper: keeper, authenticated: true }).state, 'stale');
});
test('owner-funded repayment approves the clone and close cannot be submitted during RM', () => {
  assert.equal(typeof readiness.ownerTransactions, 'function');
  const clone = '0x1111111111111111111111111111111111111111';
  const token = '0x2222222222222222222222222222222222222222';
  assert.deepEqual(readiness.ownerTransactions('repay', clone, token, 100n, false), [
    { address: token, functionName: 'approve', args: [clone, 100n] },
    { address: clone, functionName: 'repayWithMUSD', args: [100n] },
  ]);
  assert.throws(() => readiness.ownerTransactions('close', clone, token, 100n, true));
  assert.throws(() => readiness.ownerTransactions('repay', clone, token, 0n, true));
  assert.deepEqual(readiness.ownerTransactions('claim', clone, token, 0n, true), [{ address: clone, functionName: 'claimCollateral', args: [] }]);
});
test('recent history shows a bounded latest window before paginating older blocks', () => {
  assert.deepEqual(readiness.recentRange(20000n, 10n), { fromBlock: 10002n, toBlock: 20000n });
  assert.deepEqual(readiness.recentRange(20000n, 10n, 10002n), { fromBlock: 10n, toBlock: 10001n });
});

test('reserve-funded direct close works with a zero owner allowance', () => {
  assert.deepEqual(readiness.ownerTransactions('close', '0x1111111111111111111111111111111111111111', '0x2222222222222222222222222222222222222222', 0n, false), [{ address: '0x1111111111111111111111111111111111111111', functionName: 'closeWithMUSD', args: [0n] }]);
});
test('an override clears unrelated deployment keeper and capability provenance', () => {
  const overridden = readiness.resolveDeployment({ chainId: 31611, factory: '0x1111111111111111111111111111111111111111', deploymentBlock: '1', status: 'legacy', keeper: '0x2222222222222222222222222222222222222222', implementation: '0x2222222222222222222222222222222222222222', capabilities: { policy: true, coilFee: true, ownerActions: true } }, '0x3333333333333333333333333333333333333333', '20');
  assert.equal(overridden.keeper, null);
  assert.equal(overridden.implementation, null);
  assert.deepEqual(overridden.capabilities, { policy: false, coilFee: false, ownerActions: false });
});
test('new ABI encodes owner-approved fee ceiling on both loop paths', () => {
  const { encodeFunctionData, decodeFunctionData } = require('viem');
  const { coilAccountAbi } = require('../src/lib/mezo.ts');
  for (const functionName of ['loop', 'flashLoop']) {
    const data = encodeFunctionData({ abi: coilAccountAbi, functionName, args: readiness.loopArguments(2n * W, 50n, 25, true) });
    assert.deepEqual(decodeFunctionData({ abi: coilAccountAbi, data }).args, [2n * W, 50n, 25]);
  }
});
test('selected mainnet uses mainnet protocol/explorer and pending metadata blocks writes', () => {
  const keys = ['NEXT_PUBLIC_COIL_CHAIN_ID', 'NEXT_PUBLIC_COIL_ENABLE_MAINNET_WRITES', 'NEXT_PUBLIC_COIL_FACTORY', 'NEXT_PUBLIC_COIL_FACTORY_DEPLOY_BLOCK', 'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const modules = ['../src/lib/network.ts', '../src/lib/mezo.ts'];
  try {
    keys.forEach(key => delete process.env[key]);
    process.env.NEXT_PUBLIC_COIL_CHAIN_ID = '31612';
    process.env.NEXT_PUBLIC_COIL_ENABLE_MAINNET_WRITES = 'true';
    modules.forEach(file => delete require.cache[require.resolve(file)]);
    const n = require('../src/lib/network.ts');
    const m = require('../src/lib/mezo.ts');
    assert.deepEqual({ chain: n.selectedChain.id, write: n.writesEnabled, factory: m.factoryAddress ?? null, explorer: n.explorerUrl, musd: m.addr.musd, walletConnect: n.walletConnectProjectId ?? null }, { chain: 31612, write: false, factory: null, explorer: 'https://explorer.mezo.org', musd: '0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186', walletConnect: null });
  } finally {
    keys.forEach(key => saved[key] === undefined ? delete process.env[key] : process.env[key] = saved[key]);
    modules.forEach(file => delete require.cache[require.resolve(file)]);
  }
});
test('an RPC failure cannot downgrade a new factory to fee-free legacy selectors', () => {
  assert.equal(typeof readiness.isUnsupportedPolicy, 'function');
  const { ContractFunctionZeroDataError, ContractFunctionRevertedError, BaseError } = require('viem');
  assert.equal(readiness.isUnsupportedPolicy(new BaseError('unavailable', { cause: new Error('RPC unavailable') })), false);
  assert.equal(readiness.isUnsupportedPolicy(new ContractFunctionZeroDataError({ functionName: 'policy' })), true);
  assert.equal(readiness.isUnsupportedPolicy(new ContractFunctionRevertedError({ abi: [], functionName: 'policy', data: '0x' })), true);
});
test('keeper state stays stale with an old RPC block even when heartbeat time looks fresh', () => {
  assert.equal(typeof readiness.chainEvidenceFresh, 'function');
  assert.equal(readiness.chainEvidenceFresh(1000, 990), true);
  assert.equal(readiness.chainEvidenceFresh(1000, 700), false);
  assert.equal(readiness.chainEvidenceFresh(1000, 1100), false);
});
test('a different mainnet override cannot inherit a confirmed release write gate', () => {
  const changed = readiness.resolveDeployment({ chainId: 31612, factory: '0x1111111111111111111111111111111111111111', deploymentBlock: '1', status: 'ready' }, '0x2222222222222222222222222222222222222222', '2');
  assert.equal(readiness.canWrite(changed, true), false);
});
let positionQuotes = {}; try { positionQuotes = require('../src/lib/position-quote.ts'); } catch {}
const increasedQuote = { collateral: 3n * W / 10n, debt: 15000n * W, cr: 2n * W, liquidationPrice: 55000n * W, musdMinted: 4010n * W, iterations: 1n };
const freshEstimate = { kind: 'error', message: 'Fresh deposit is below minimum debt' };
test('active fee-bearing account uses state-aware total debt and gross fee instead of fresh estimate', async () => {
  assert.equal(typeof positionQuotes.readStateAwareQuote, 'function');
  const request = { account: '0x1111111111111111111111111111111111111111', chainId: 31611, deposit: W / 100n, target: 2n * W, slippage: 50n, flash: true };
  const actual = await positionQuotes.readStateAwareQuote({ readContract: async call => {
    assert.equal(call.address, request.account);
    assert.equal(call.functionName, 'quoteFlashLoopWithFee');
    assert.deepEqual(call.args, [W / 100n, 2n * W, 50n]);
    return [increasedQuote, W / 20n, 12n * W, 10025n * W / 1000n];
  } }, request);
  assert.equal(actual.debt, 15000n * W);
  assert.equal(actual.musdMinted, 4010n * W);
  assert.equal(actual.coilFeeMusd, 10025n * W / 1000n);
  assert.equal(actual.flashBtc, W / 20n);
  assert.equal(actual.poolFeeMusd, 12n * W);
  assert.equal(actual.iterations, 1);
  const selected = positionQuotes.selectPositionPreview(true, 'active', { key: 'active', kind: 'ok', quote: actual }, freshEstimate);
  assert.equal(selected.kind, 'ok');
  assert.equal(selected.quote.debt, 15000n * W);
});
test('router increase uses state-aware fee quote and keeps protocol total debt', async () => {
  assert.equal(typeof positionQuotes.readStateAwareQuote, 'function');
  const actual = await positionQuotes.readStateAwareQuote({ readContract: async call => {
    assert.equal(call.functionName, 'quoteLoopWithFee');
    return [increasedQuote, 10025n * W / 1000n];
  } }, { account: '0x1111111111111111111111111111111111111111', chainId: 31611, deposit: W / 100n, target: 2n * W, slippage: 50n, flash: false });
  assert.equal(actual.debt, 15000n * W);
  assert.equal(actual.coilFeeMusd, 10025n * W / 1000n);
  assert.equal(actual.flashBtc, 0n);
});
test('active fee consent fails closed on unavailable or input-stale on-chain quotes', () => {
  assert.equal(typeof positionQuotes.selectPositionPreview, 'function');
  assert.equal(positionQuotes.selectPositionPreview(true, 'new-input', { key: 'old-input', kind: 'ok', quote: increasedQuote }, freshEstimate).kind, 'loading');
  assert.equal(positionQuotes.selectPositionPreview(true, 'active', null, freshEstimate).kind, 'loading');
  assert.deepEqual(positionQuotes.selectPositionPreview(true, 'active', { key: 'active', kind: 'error', message: 'Quote RPC failed' }, { kind: 'ok', quote: increasedQuote }), { kind: 'error', message: 'Quote RPC failed' });
  assert.equal(positionQuotes.selectPositionPreview(false, 'fresh', null, freshEstimate), freshEstimate);
});
test('cancelled quote read cannot publish a previous account or chain result', async () => {
  assert.equal(typeof positionQuotes.startPositionQuote, 'function');
  let finish;
  const deferred = new Promise(resolve => { finish = resolve; });
  const states = [];
  const cancel = positionQuotes.startPositionQuote('old-account-chain-input', () => deferred, state => states.push(state));
  cancel();
  finish(increasedQuote);
  await deferred; await Promise.resolve();
  assert.deepEqual(states, [{ key: 'old-account-chain-input', kind: 'loading' }]);
});
test('quote refresh clears fee consent while loading and publishes errors without stale data', async () => {
  assert.equal(typeof positionQuotes.startPositionQuote, 'function');
  const states = [];
  positionQuotes.startPositionQuote('current', async () => { throw new Error('provider unavailable'); }, state => states.push(state));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(states, [{ key: 'current', kind: 'loading' }, { key: 'current', kind: 'error', message: 'State-aware quote unavailable. Refresh or wait for the selected chain RPC to recover.' }]);
});
let keeperService = {}; try { keeperService = require('../src/lib/keeper-service.ts'); } catch {}
const statusNow = 1_800_000_000_000;
const statusIdentity = { chainId: 31611, factory: '0x1111111111111111111111111111111111111111', expectedKeeper: '0x2222222222222222222222222222222222222222' };
const publicStatus = { chainId: 31611, factory: statusIdentity.factory, keeper: null, mode: 'read-only', lastScanAt: statusNow - 1000, lastHeartbeatAt: null, status: 'monitoring', counters: { scans: 1, scanFailures: 0, simulations: 0, skipped: 0, failures: 0, confirmedGuards: 0, confirmedHeartbeats: 0 } };
test('optional keeper URL only accepts public HTTPS without credentials or secret-bearing parameters', () => {
  assert.equal(typeof keeperService.publicStatusUrl, 'function');
  assert.equal(keeperService.publicStatusUrl(undefined), null);
  assert.equal(keeperService.publicStatusUrl('https://keeper.example.org/status'), 'https://keeper.example.org/status');
  for (const url of ['http://keeper.example.org/status', 'https://localhost/status', 'https://127.0.0.1/status', 'https://[::1]/status', 'https://service.internal/status', 'https://user:password@keeper.example.org/status', 'https://keeper.example.org/status?token=secret', 'https://keeper.example.org/status#secret', 'https://keeper.example.org:8443/status']) assert.throws(() => keeperService.publicStatusUrl(url));
});
test('read-only service status validates independently and never becomes execution protection', () => {
  assert.equal(typeof keeperService.validatePublicStatus, 'function');
  const status = keeperService.validatePublicStatus(publicStatus, statusIdentity, statusNow);
  assert.deepEqual(keeperService.serviceStatusView(status, statusNow), { status: 'monitoring', mode: 'read-only', scanAgeMs: 1000, heartbeatAgeMs: null });
});
test('public service rejects mismatched chain/factory/keeper, malformed timestamps/counters and impossible mode states', () => {
  assert.equal(typeof keeperService.validatePublicStatus, 'function');
  for (const changed of [{ chainId: 31612 }, { factory: '0x3333333333333333333333333333333333333333' }, { keeper: '0x3333333333333333333333333333333333333333' }, { lastScanAt: statusNow + 60000 }, { lastScanAt: 1800000000 }, { counters: { ...publicStatus.counters, scans: -1 } }, { mode: 'execute', status: 'monitoring' }, { status: 'healthy' }, { key: 'must not expose arbitrary fields' }]) assert.throws(() => keeperService.validatePublicStatus({ ...publicStatus, ...changed }, statusIdentity, statusNow));
});
test('execution service requires expected keeper identity and stale scans override an old healthy response', () => {
  assert.equal(typeof keeperService.serviceStatusView, 'function');
  const status = keeperService.validatePublicStatus({ ...publicStatus, keeper: statusIdentity.expectedKeeper, mode: 'execute', status: 'healthy', lastHeartbeatAt: statusNow - 1000 }, statusIdentity, statusNow);
  assert.equal(keeperService.serviceStatusView(status, statusNow).status, 'healthy');
  assert.equal(keeperService.serviceStatusView(status, statusNow + 61000).status, 'stale');
  assert.throws(() => keeperService.validatePublicStatus(status, { ...statusIdentity, expectedKeeper: null }, statusNow));
});
test('service fetch is credential-free GET and validates the public response before returning it', async () => {
  assert.equal(typeof keeperService.fetchPublicStatus, 'function');
  const data = await keeperService.fetchPublicStatus('https://keeper.example.org/status', statusIdentity, new AbortController().signal, async (url, options) => {
    assert.equal(url, 'https://keeper.example.org/status'); assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    return { ok: true, headers: new Headers({ 'content-type': 'application/json' }), text: async () => JSON.stringify(publicStatus) };
  }, statusNow);
  assert.equal(data.mode, 'read-only'); assert.equal(data.lastScanAt, statusNow - 1000);
});
test('service cancellation aborts transport and prevents late identity-stale results from replacing current evidence', async () => {
  assert.equal(typeof keeperService.startPublicStatusRead, 'function');
  let finish; let signal;
  const pending = new Promise(resolve => { finish = resolve; });
  const states = [];
  const cancel = keeperService.startPublicStatusRead('old-chain-factory-keeper', async currentSignal => { signal = currentSignal; return pending; }, state => states.push(state));
  cancel(); assert.equal(signal.aborted, true); finish(publicStatus);
  await pending; await Promise.resolve();
  assert.deepEqual(states, [{ key: 'old-chain-factory-keeper', kind: 'loading' }]);
  assert.deepEqual(keeperService.selectServiceRead('new-chain-factory-keeper', { key: 'old-chain-factory-keeper', kind: 'ok', data: publicStatus }), { kind: 'loading' });
});
test('unavailable public service reports an error without promoting retained chain evidence to service health', async () => {
  assert.equal(typeof keeperService.startPublicStatusRead, 'function');
  const states = [];
  keeperService.startPublicStatusRead('current', async () => { throw new Error('private upstream details'); }, state => states.push(state));
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(states, [{ key: 'current', kind: 'loading' }, { key: 'current', kind: 'error', message: 'Public keeper service unavailable or invalid. Chain heartbeat evidence is shown separately.' }]);
});
test('a timed-out public service becomes unavailable even if its transport ignores cancellation', async () => {
  assert.equal(typeof keeperService.startPublicStatusRead, 'function');
  const states = [];
  const cancel = keeperService.startPublicStatusRead('slow', () => new Promise(() => {}), state => states.push(state), 2);
  await new Promise(resolve => setTimeout(resolve, 15));
  cancel();
  assert.equal(states.at(-1).kind, 'error');
});
test('known canonical factory requires its recorded deployment block and preserves matching provenance', () => {
  const canonical = { chainId: 31611, factory: '0x1111111111111111111111111111111111111111', deploymentBlock: '10', status: 'legacy', keeper: '0x2222222222222222222222222222222222222222', capabilities: { policy: false, coilFee: false, ownerActions: false } };
  assert.throws(() => readiness.resolveDeployment(canonical, canonical.factory, '11'));
  assert.throws(() => readiness.resolveDeployment(canonical, '0x3333333333333333333333333333333333333333', '0'));
  assert.deepEqual(readiness.resolveDeployment(canonical, canonical.factory, '10'), canonical);
});
test('a factory belonging only to another chain cannot be used as a selected-chain override', () => {
  const testnet = { chainId: 31611, factory: '0x1111111111111111111111111111111111111111', deploymentBlock: '10', status: 'legacy' };
  const mainnet = { chainId: 31612, factory: '0x2222222222222222222222222222222222222222', deploymentBlock: '20', status: 'ready' };
  const catalog = { 31611: testnet, 31612: mainnet };
  assert.throws(() => readiness.resolveDeployment(testnet, mainnet.factory, '20', catalog));
  assert.throws(() => readiness.resolveDeployment(mainnet, testnet.factory, '10', catalog));
});
test('the same canonical address on two chains uses selected-chain block provenance', () => {
  const testnet = { chainId: 31611, factory: '0x1111111111111111111111111111111111111111', deploymentBlock: '10', status: 'legacy' };
  const mainnet = { chainId: 31612, factory: testnet.factory, deploymentBlock: '20', status: 'ready' };
  const catalog = { 31611: testnet, 31612: mainnet };
  assert.deepEqual(readiness.resolveDeployment(mainnet, mainnet.factory, '20', catalog), mainnet);
  assert.throws(() => readiness.resolveDeployment(mainnet, mainnet.factory, '10', catalog));
});
let ownerAccounts = {}; try { ownerAccounts = require('../src/lib/owner-accounts.ts'); } catch {}
const oldFactory = { chainId: 31611, name: 'Testnet legacy', rpcUrl: 'https://rpc.test.mezo.org', explorerUrl: 'https://explorer.test.mezo.org', status: 'legacy', factory: '0x1111111111111111111111111111111111111111', deploymentBlock: '10', implementation: null, keeper: null, contracts: {}, capabilities: { policy: false, coilFee: false, ownerActions: false } };
const newFactory = { ...oldFactory, name: 'Testnet current', factory: '0x2222222222222222222222222222222222222222', deploymentBlock: '20', status: 'ready', capabilities: { policy: true, coilFee: true, ownerActions: true } };
const accountOwner = '0x3333333333333333333333333333333333333333';
const fundedOldClone = '0x4444444444444444444444444444444444444444';
const emptyNewClone = '0x5555555555555555555555555555555555555555';
const oldPosition = { active: true, collateral: W / 10n, debt: 5000n * W, cr: 2n * W, liquidationPrice: 55000n * W, redemptionRank: 12n, floorCR: 17n * W / 10n, guardTargetCR: 22n * W / 10n, redemptionZone: 8, slippageBps: 50, owner: accountOwner };
test('after active deployment changes, an old funded clone stays visible and selected ahead of a new empty clone', async () => {
  assert.equal(typeof ownerAccounts.ownerDeploymentCatalog, 'function');
  const catalog = ownerAccounts.ownerDeploymentCatalog(newFactory, [oldFactory, newFactory, oldFactory]);
  assert.equal(catalog.length, 2);
  const found = await ownerAccounts.discoverOwnerAccounts({ readContract: async call => {
    if (call.functionName === 'accountOf') { assert.deepEqual(call.args, [accountOwner]); return call.address === oldFactory.factory ? fundedOldClone : emptyNewClone; }
    if (call.functionName === 'position') return call.address === fundedOldClone ? oldPosition : { ...oldPosition, active: false, collateral: 0n, debt: 0n, owner: accountOwner };
    throw new Error('unexpected RPC');
  } }, accountOwner, catalog);
  const selected = ownerAccounts.selectOwnerDeployment(found);
  assert.equal(selected.account, fundedOldClone);
  assert.equal(selected.deployment.factory, oldFactory.factory);
  assert.equal(selected.deployment.deploymentBlock, '10');
  assert.deepEqual(selected.deployment.capabilities, { policy: false, coilFee: false, ownerActions: false });
  assert.equal(selected.position.debt, 5000n * W);
  const explicitNew = ownerAccounts.selectOwnerDeployment(found, found.find(item => item.current).key);
  assert.equal(explicitNew.account, emptyNewClone);
  assert.equal(explicitNew.deployment.factory, newFactory.factory);
  assert.equal(explicitNew.deployment.capabilities.coilFee, true);
});
test('retained discovery keeps unreadable legacy accounts visible rather than declaring no old funds', async () => {
  assert.equal(typeof ownerAccounts.discoverOwnerAccounts, 'function');
  const catalog = ownerAccounts.ownerDeploymentCatalog(newFactory, [oldFactory]);
  const found = await ownerAccounts.discoverOwnerAccounts({ readContract: async call => {
    if (call.functionName === 'accountOf') return call.address === oldFactory.factory ? fundedOldClone : '0x0000000000000000000000000000000000000000';
    throw new Error('RPC unavailable');
  } }, accountOwner, catalog);
  const selected = ownerAccounts.selectOwnerDeployment(found);
  assert.equal(selected.account, fundedOldClone);
  assert.match(selected.readError, /position unavailable/i);
});
test('owner discovery filters another chain and never binds a returned position to a different owner', async () => {
  assert.equal(typeof ownerAccounts.ownerDeploymentCatalog, 'function');
  const catalog = ownerAccounts.ownerDeploymentCatalog(newFactory, [{ ...oldFactory, chainId: 31612 }, oldFactory]);
  assert.equal(catalog.length, 2);
  const found = await ownerAccounts.discoverOwnerAccounts({ readContract: async call => call.functionName === 'accountOf' ? fundedOldClone : { ...oldPosition, owner: emptyNewClone } }, accountOwner, catalog);
  assert(found.every(item => !item.position && item.readError));
});
let statsReader = {}; try { statsReader = require('../src/lib/stats-reader.ts'); } catch {}
test('stats publishes factory and position counts before slow history and reads a bounded recent window', async () => {
  assert.equal(typeof statsReader.loadPublicStats, 'function');
  let finishLogs;
  const slowHistory = new Promise(resolve => { finishLogs = resolve; });
  const snapshots = []; const ranges = [];
  const client = { getBlockNumber: async () => 20000n, readContract: async call => {
    if (call.functionName === 'accountsLength') return 2n;
    if (call.functionName === 'accounts') return call.args[0] === 0n ? fundedOldClone : emptyNewClone;
    if (call.functionName === 'position') return { ...oldPosition, active: call.address === fundedOldClone };
    throw new Error('unexpected read');
  }, getLogs: async call => { ranges.push([call.fromBlock, call.toBlock]); return slowHistory; } };
  let completed = false;
  const loading = statsReader.loadPublicStats(client, { factory: newFactory.factory, deploymentBlock: 10n }, snapshot => snapshots.push(snapshot)).then(page => { completed = true; return page; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completed, false);
  assert.equal(snapshots[0].accounts, 2);
  assert.equal(snapshots.at(-1).open, 1);
  assert.equal(snapshots.at(-1).scanned, 2);
  assert.deepEqual(ranges, [[10002n, 20000n], [10002n, 20000n], [10002n, 20000n]]);
  finishLogs([]);
  const recent = await loading;
  assert.equal(recent.fromBlock, 10002n);
  const olderRanges = [];
  const older = await statsReader.loadPublicStats({ ...client, getLogs: async call => { olderRanges.push([call.fromBlock, call.toBlock]); return []; } }, { factory: newFactory.factory, deploymentBlock: 10n, before: recent.fromBlock }, () => {});
  assert.equal(older.toBlock, 10001n);
  assert.deepEqual(olderRanges, [[10n, 10001n], [10n, 10001n], [10n, 10001n]]);
});
test('stats refresh deduplicates overlapping events and does not double count rescue tips', () => {
  assert.equal(typeof statsReader.mergeStatsEvents, 'function');
  const rescue = { kind: 'rescue', log: { address: fundedOldClone, transactionHash: '0x1234', logIndex: 2, blockNumber: 19990n, args: { tip: 5n * W } } };
  const heartbeat = { kind: 'heartbeat', log: { address: newFactory.factory, transactionHash: '0x5678', logIndex: 0, blockNumber: 19991n, args: {} } };
  const merged = statsReader.mergeStatsEvents([rescue], [{ ...rescue }, heartbeat]);
  assert.deepEqual(statsReader.summarizeStatsEvents(merged), { accountLogs: 0, heartbeats: 1, rescues: 1, tips: 5n * W });
});
test('generated testnet deployment is the paused completion factory and keeps the previous factory retained', () => {
  const generated = require('../src/lib/deployment.generated.ts');
  const active = generated.DEPLOYMENTS['31611'];
  assert.equal(active.status, 'ready');
  assert.equal(active.factory, '0x339ef0116e17BA42987c1E2E380Af59B38f62064');
  assert.equal(active.deploymentBlock, '16708730');
  assert.equal(active.keeper, '0x1D2621480011C44693a47801C1158E70b25b4B4F');
  assert.deepEqual(active.capabilities, { policy: true, coilFee: true, ownerActions: true });
  assert.equal(generated.DEPLOYMENTS['31612'].status, 'pending');
  assert.equal(generated.DEPLOYMENTS['31612'].factory, null);
  const previous = generated.RETAINED_DEPLOYMENTS['31611'].find(entry => entry.factory.toLowerCase() === '0xff3335576f998ee872596d4eb7abecb71a0d5bc8');
  assert.equal(previous.deploymentBlock, '16408315');
  assert.equal(previous.status, 'legacy');
  assert.equal(previous.capabilities.policy, false);
  const selected = readiness.resolveDeployment(active, active.factory, active.deploymentBlock, generated.DEPLOYMENTS);
  assert.equal(selected.keeper, '0x1D2621480011C44693a47801C1158E70b25b4B4F');
});
test('open fee copy formats coilFeeBps as a percent and states the hard 50 bps cap', () => {
  const fee = require('../src/lib/open-fee.ts');
  assert.equal(fee.COIL_OPEN_FEE_CAP_BPS, 50);
  assert.equal(fee.formatOpenFeePercent(25), '0.25%');
  assert.equal(fee.formatOpenFeePercent(50), '0.5%');
  assert.equal(fee.formatOpenFeePercent(1), '0.01%');
  assert.equal(fee.formatOpenFeePercent(10), '0.1%');
  assert.equal(fee.readFeeBps(25n), 25);
  assert.equal(fee.readFeeBps(10_001), null);
  const statement = fee.coilOpenFeeStatement(25);
  assert.equal(statement, 'Coil open fee: 0.25% of newly minted MUSD (owner-capped at 0.5%). Rescue and exit: 0 (guard, owner exit, repay, unwind).');
  for (const text of [statement, fee.coilOpenFeePendingStatement(), fee.coilOpenFeeUnavailableStatement(), fee.coilOpenFeeLegacyStatement()]) {
    assert.equal(text.includes('\u2014'), false);
    assert.equal(text.includes('WitLabs'), false);
  }
  assert.equal(fee.coilOpenFeePendingStatement().includes('unavailable'), false);
  assert.equal(fee.coilOpenFeePendingStatement().includes('paused'), false);
});
test('fee snapshot uses coilFeeBps and does not invent a paused state', async () => {
  const { readOpenFeeFromClient } = require('../src/lib/factory-policy.ts');
  const factory = '0x339ef0116e17BA42987c1E2E380Af59B38f62064';
  const calls = [];
  const snapshot = await readOpenFeeFromClient({
    readContract: async ({ functionName }) => {
      calls.push(functionName);
      if (functionName === 'coilFeeBps') return 25;
      if (functionName === 'opensPaused') return false;
      if (functionName === 'policy') return { feeBps: 99, opensPaused: true, maxCollateral: 10n ** 18n, maxDebt: 1000n * 10n ** 18n };
      throw new Error(functionName);
    },
  }, factory);
  assert.deepEqual(calls.sort(), ['coilFeeBps', 'opensPaused', 'policy']);
  assert.equal(snapshot.feeBps, 25);
  assert.equal(snapshot.opensPaused, false);
  assert.equal(snapshot.maxCollateral, (10n ** 18n).toString());
  const pausedGetterDown = await readOpenFeeFromClient({
    readContract: async ({ functionName }) => {
      if (functionName === 'coilFeeBps') return 40;
      if (functionName === 'opensPaused') throw new Error('rpc down');
      return { opensPaused: true, maxCollateral: 1n, maxDebt: 2n };
    },
  }, factory);
  assert.equal(pausedGetterDown.feeBps, 40);
  assert.equal(pausedGetterDown.opensPaused, true);
  const feeDown = await readOpenFeeFromClient({
    readContract: async ({ functionName }) => {
      if (functionName === 'coilFeeBps') throw new Error('rpc down');
      if (functionName === 'opensPaused') return false;
      return { opensPaused: false, maxCollateral: 1n, maxDebt: 2n, feeBps: 25 };
    },
  }, factory);
  assert.equal(feeDown, null);
});
test('same-owner discovery refresh preserves the funded view while changed-owner refresh discards old consent', () => {
  assert.equal(typeof ownerAccounts.ownerDiscoveryView, 'function');
  const catalog = ownerAccounts.ownerDeploymentCatalog(newFactory, [oldFactory]);
  const known = [{ ...catalog[1], account: fundedOldClone, position: oldPosition }, catalog[0]];
  const state = { ownerKey: '31611:owner-a', key: '31611:owner-a:0', choices: known };
  const refreshing = ownerAccounts.ownerDiscoveryView('31611:owner-a', '31611:owner-a:1', state, catalog);
  assert.equal(refreshing.pending, false);
  assert.equal(refreshing.refreshing, true);
  assert.equal(refreshing.choices, known);
  const changedOwner = ownerAccounts.ownerDiscoveryView('31611:owner-b', '31611:owner-b:0', state, catalog);
  assert.equal(changedOwner.pending, true);
  assert.equal(changedOwner.choices, catalog);
});

const quoteCard = require('../src/lib/quote-card.ts');
const productCopy = require('../src/lib/product-copy.ts');
const path = require('node:path');

test('an off-oracle pool still yields a sample liquidation price', () => {
  const skewed = { ...market, reserveBtc: 1000n * W };
  assert.throws(() => quote.quoteFlashLoop(W / 10n, 2n * W, 50n, skewed));
  const sample = quote.quoteFlashLoop(W / 10n, 2n * W, 50n, skewed, true);
  assert.ok(sample.liquidationPrice > 0n);
  assert.ok(sample.collateral > 0n);
  const view = quoteCard.quoteCardView({
    paused: false,
    pegBlocked: true,
    illustrative: true,
    overLimit: false,
    liquidationPrice: '$1',
    dropPercent: 45,
    feeLine: 'fees',
  });
  assert.equal(view.badge, 'Sample');
  assert.equal(view.liquidationPrice, '$1');
  assert.equal(view.dropLine, 'BTC can fall 45%');
});
test('quote card shows liquidation price, how far BTC can fall, and fees', () => {
  const view = quoteCard.quoteCardView({
    paused: false,
    pegBlocked: false,
    overLimit: false,
    liquidationPrice: '$50,000',
    dropPercent: 45,
    feeLine: quoteCard.quoteFeeLine('12.50', '1.20', '0.25%'),
  });
  assert.equal(view.badge, 'Quote');
  assert.equal(view.liquidationPrice, '$50,000');
  assert.equal(view.dropLine, 'BTC can fall 45%');
  assert.match(view.feeLine, /0\.25%/);
  assert.match(view.feeLine, /12\.50 MUSD/);
  assert.match(view.feeLine, /1\.20 MUSD/);
  assert.equal(view.pegMessage, null);
  assert.equal(view.overLimitMessage, null);
});

test('paused or peg-blocked opens are labelled Sample and still show the outcome', () => {
  for (const flags of [{ paused: true, pegBlocked: false }, { paused: false, pegBlocked: true }]) {
    const view = quoteCard.quoteCardView({
      ...flags,
      overLimit: false,
      liquidationPrice: '$40,000',
      dropPercent: 26.7,
      feeLine: quoteCard.quoteFeeLine('3.00', '0.40', '0.25%'),
    });
    assert.equal(view.badge, 'Sample');
    assert.equal(view.liquidationPrice, '$40,000');
    assert.equal(view.dropLine, 'BTC can fall 26.7%');
    assert.match(view.feeLine, /Pool fee 0\.40 MUSD/);
  }
});

test('a peg block says the pool price is off the oracle and that raising slippage will not help', () => {
  const view = quoteCard.quoteCardView({
    paused: false,
    pegBlocked: true,
    overLimit: false,
    liquidationPrice: '$40,000',
    dropPercent: 26.7,
    feeLine: 'Coil fee 0.25% (3.00 MUSD on newly minted debt). Pool fee 0.40 MUSD. Exit fee 0.',
  });
  assert.equal(view.pegMessage, productCopy.PEG_BLOCK_MESSAGE);
  assert.match(view.pegMessage, /pool price is off the oracle price/);
  assert.match(view.pegMessage, /Raising slippage will not help/);
  assert.equal(view.overLimitMessage, null);
  assert.equal(view.badge, 'Sample');
});

test('a deposit over the factory limit gets its own message', () => {
  const view = quoteCard.quoteCardView({
    paused: false,
    pegBlocked: false,
    overLimit: true,
    liquidationPrice: '$80,000',
    dropPercent: 45,
    feeLine: quoteCard.quoteFeeLine('9.00', '2.00', '0.25%'),
  });
  assert.equal(view.overLimitMessage, productCopy.OVER_LIMIT_MESSAGE);
  assert.notEqual(view.overLimitMessage, productCopy.PEG_BLOCK_MESSAGE);
  assert.doesNotMatch(view.overLimitMessage, /slippage/i);
  assert.equal(view.pegMessage, null);
  assert.equal(view.badge, 'Quote');
  assert.equal(view.liquidationPrice, '$80,000');
  const wad = 10n ** 18n;
  assert.equal(quoteCard.exceedsFactoryLimit('1.5', 15n * wad / 10n, wad), true);
  assert.equal(quoteCard.exceedsFactoryLimit('0.01', wad / 100n, wad), false);
  assert.equal(quoteCard.exceedsFactoryLimit('5', null, wad), true);
});

test('leverage choices are 2x then 3x then 4x, with LTV next to CR', () => {
  assert.deepEqual(productCopy.LEVERAGE_CHOICES.map(choice => choice.multiple), ['2x', '3x', '4x']);
  for (const choice of productCopy.LEVERAGE_CHOICES) {
    assert.match(choice.crLabel, /% CR$/);
    assert.match(choice.ltvLabel, /% LTV$/);
  }
  assert.equal(productCopy.HERO_TITLE, 'Leverage your BTC in one transaction.');
  assert.notEqual(productCopy.HERO_TITLE, 'Turn your BTC into more BTC.');
  assert.equal(productCopy.btcCanFallLine(45), 'BTC can fall 45%');
});

test('user-facing strings omit banned jargon, mainnet claims, and the em dash', () => {
  const root = path.join(__dirname, '../src');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  const allow = new Set(['flashLoop', 'setPegBounds', 'loop', 'flashUnwind', 'unwind']);
  const banned = [
    { name: 'PegOff', re: /PegOff/ },
    { name: 'setPegBounds', re: /setPegBounds/ },
    { name: 'flashLoop', re: /flashLoop/ },
    { name: 'clone', re: /\bclone\b/i },
    { name: 'trove', re: /\btrove\b/i },
    { name: 'first 40 accounts', re: /first 40 accounts/i },
    { name: 'em dash', re: /\u2014/ },
    { name: 'WitLabs', re: /WitLabs/i },
    { name: 'mainnet claim', re: /\bmainnet\b/i },
  ];
  const hits = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const lines = source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    const chunks = [];
    const quoted = /`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g;
    for (const match of lines.matchAll(quoted)) chunks.push(match[0].slice(1, -1));
    for (const match of lines.matchAll(/>([^<>{}]+)</g)) chunks.push(match[1]);
    for (const chunk of chunks) {
      const text = chunk.trim();
      if (!text || allow.has(text)) continue;
      for (const rule of banned) {
        if (rule.re.test(text)) hits.push(`${path.relative(root, file)}: ${rule.name}: ${text.slice(0, 180)}`);
      }
    }
  }
  assert.deepEqual(hits, []);
  const landing = fs.readFileSync(path.join(root, 'components/landing.tsx'), 'utf8');
  assert.match(landing, /<h1[^>]*>\{HERO_TITLE\}<\/h1>/);
  assert.equal(productCopy.HERO_TITLE, 'Leverage your BTC in one transaction.');
  assert.doesNotMatch(landing + productCopy.HERO_TITLE + productCopy.HERO_SUBLINE + productCopy.MOAT_LINES.join('\n'), /Turn your BTC into more BTC/);
});
