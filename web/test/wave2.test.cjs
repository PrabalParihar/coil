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
test('a policy account cannot submit a fresh estimate while the state-aware quote is pending, failed, or mismatched', () => {
  const fresh = { kind: 'ok', quote: increasedQuote, illustrative: false };
  const key = '31611:factory:account';
  const blocked = [
    null,
    { key: 'other', kind: 'ok', quote: increasedQuote },
    { key, kind: 'error', message: 'State-aware quote unavailable.' },
    { key, kind: 'loading' },
  ];
  for (const state of blocked) {
    const shown = positionQuotes.presentPositionPreview(true, key, state, fresh);
    assert.equal(shown.displayOnly, true);
    assert.equal(positionQuotes.canSubmitPositionPreview(shown), false);
    if (shown.kind === 'ok') assert.equal(shown.quote, increasedQuote);
  }
  const ready = positionQuotes.presentPositionPreview(true, key, { key, kind: 'ok', quote: increasedQuote }, fresh);
  assert.equal(ready.displayOnly, false);
  assert.equal(ready.illustrative, false);
  assert.equal(ready.kind, 'ok');
  assert.equal(positionQuotes.canSubmitPositionPreview(ready), true);
});
test('a fresh sample stays illustrative and cannot be submitted for a retained legacy account', () => {
  const sample = { kind: 'ok', quote: increasedQuote, illustrative: true };
  const kept = positionQuotes.selectPositionPreview(false, 'legacy', null, sample);
  assert.equal(kept, sample);
  assert.equal(kept.illustrative, true);
  const shown = positionQuotes.presentPositionPreview(false, 'legacy', null, sample);
  assert.equal(shown.illustrative, true);
  assert.equal(shown.displayOnly, false);
  assert.equal(positionQuotes.canSubmitPositionPreview(shown), false);
  const live = positionQuotes.selectPositionPreview(true, 'active', { key: 'active', kind: 'ok', quote: increasedQuote }, sample);
  assert.equal(live.kind, 'ok');
  assert.equal(live.illustrative, false);
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
  assert.deepEqual(states, [{ key: 'current', kind: 'loading' }, { key: 'current', kind: 'error', message: "We couldn't read the quote for your account. These numbers are a sample, so opening stays off." }]);
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
  assert.equal(statement, 'Coil fee: 0.25% of the MUSD you borrow when opening or adding leverage. The contract caps it at 0.5%. Protection, rescue, repay, de-lever, unwind and close: 0%. Mezo\'s borrowing fee, pool swap fee and gas are separate.');
  assert.equal(statement.includes('0.25%'), true);
  assert.equal(statement.includes('0.5%'), true);
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
    gapPercent: '6.64%',
    withinPercent: '2%',
    liquidationPrice: '$1',
    dropPercent: 45,
    feeLine: 'fees',
  });
  assert.equal(view.badge, 'Sample preview');
  assert.equal(view.liquidationPrice, '$1');
  assert.equal(view.dropLine, 'BTC can fall 45%');
  assert.match(view.pegMessage, /6\.64%/);
  assert.match(view.pegMessage, /within 2%/);
  assert.match(view.pegMessage, /Raising slippage will not help/);
});
test('quote card shows liquidation price, how far BTC can fall, and fees', () => {
  const view = quoteCard.quoteCardView({
    paused: false,
    pegBlocked: false,
    overLimit: false,
    liquidationPrice: '$50,000',
    dropPercent: 45,
    feeLine: 'Coil fee: 0.25% of the MUSD you borrow when opening or adding leverage. The contract caps it at 0.5%. Protection, rescue, repay, de-lever, unwind and close: 0%.',
    feeCapLabel: 'Max 0.5%, set on-chain',
  });
  assert.equal(view.badge, 'Quote');
  assert.equal(view.liquidationPrice, '$50,000');
  assert.equal(view.dropLine, 'BTC can fall 45%');
  assert.match(view.feeLine, /0\.25%/);
  assert.equal(view.feeCapLabel, 'Max 0.5%, set on-chain');
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
      gapPercent: '6.64%',
      withinPercent: '2%',
      feeLine: 'Coil fee: 0.25% of the MUSD you borrow when opening or adding leverage.',
    });
    assert.equal(view.badge, 'Sample preview');
    assert.equal(view.liquidationPrice, '$40,000');
    assert.equal(view.dropLine, 'BTC can fall 26.7%');
    assert.match(view.feeLine, /0\.25%/);
  }
});

test('a peg block says the pool price is off the oracle and that raising slippage will not help', () => {
  const view = quoteCard.quoteCardView({
    paused: false,
    pegBlocked: true,
    overLimit: false,
    liquidationPrice: '$40,000',
    dropPercent: 26.7,
    gapPercent: '6.64%',
    withinPercent: '2%',
    feeLine: 'Coil fee: 0.25% of the MUSD you borrow when opening or adding leverage.',
  });
  assert.equal(view.pegMessage, productCopy.priceCheckStatus('6.64%', '2%'));
  assert.match(view.pegMessage, /pool price is 6\.64% away from the BTC price feed/);
  assert.match(view.pegMessage, /within 2%/);
  assert.match(view.pegMessage, /Raising slippage will not help/);
  assert.equal(view.slippageMessage, null);
  assert.equal(view.overLimitMessage, null);
  assert.equal(view.badge, 'Sample preview');
});

test('a deposit over the factory limit gets its own message', () => {
  const view = quoteCard.quoteCardView({
    paused: false,
    pegBlocked: false,
    overLimit: true,
    liquidationPrice: '$80,000',
    dropPercent: 45,
    limitBtc: '0.05',
    feeLine: 'Coil fee: 0.25% of the MUSD you borrow when opening or adding leverage.',
  });
  assert.equal(view.overLimitMessage, 'The most you can deposit is 0.05 BTC.');
  assert.equal(view.overLimitMessage, productCopy.depositLimitMessage('0.05'));
  assert.doesNotMatch(view.overLimitMessage, /slippage/i);
  const slipped = quoteCard.quoteCardView({
    paused: false, pegBlocked: false, slippageMiss: true, slippagePercent: '0.5%', overLimit: false,
    liquidationPrice: '$1', dropPercent: 10, feeLine: 'fees',
  });
  assert.equal(slipped.slippageMessage, 'The pool would fill worse than your 0.5% limit. Try a higher limit or a lower leverage.');
  assert.equal(slipped.pegMessage, null);
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
  const allow = new Set(['flashLoop', 'setPegBounds', 'loop', 'flashUnwind', 'unwind', 'bps']);
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
    { name: 'Mainnet depth', re: /Mainnet depth|Mainnet starts at 200%/ },
    { name: 'guaranteed protection', re: /guaranteed protection/i },
    { name: 'unaudited', re: /unaudited/i },
    { name: 'bps', re: /\bbps\b/i },
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
        if (rule.name === 'bps' && !/\.(tsx|css)$/.test(file) && !file.endsWith('product-copy.ts')) continue;
        if (rule.re.test(text)) hits.push(`${path.relative(root, file)}: ${rule.name}: ${text.slice(0, 180)}`);
      }
      if (/\baudited\b/i.test(text.replace(/not audited/ig, ''))) hits.push(`${path.relative(root, file)}: audited: ${text.slice(0, 180)}`);
    }
  }
  assert.deepEqual(hits, []);
  const landing = fs.readFileSync(path.join(root, 'components/landing.tsx'), 'utf8');
  assert.match(landing, /<h1[^>]*>\{HERO_TITLE\}<\/h1>/);
  assert.equal(productCopy.HERO_TITLE, 'Leverage your BTC in one transaction.');
  assert.equal(productCopy.HERO_SUBLINE, 'Coil borrows MUSD against your bitcoin, buys more BTC on Mezo Pools and posts it back, all in one transaction, inside an account only you control. A protection keeper can only make your position safer.');
  assert.equal(productCopy.heroEyebrow(31611), 'Mezo testnet · chain 31611 · not audited');
  assert.equal(productCopy.BLOCKED_CARD_LABEL, 'Sample preview');
  assert.equal(productCopy.poolWarning(663, 200), 'Pool price is 6.6% away from the BTC price feed. Opens need under 2%.');
  assert.equal(productCopy.poolGapOneDecimal(665), '6.7%');
  assert.equal(productCopy.MOAT_CARDS.length, 4);
  assert.doesNotMatch(landing + productCopy.HERO_TITLE + productCopy.HERO_SUBLINE + productCopy.MOAT_CARDS.map(card => card.title + card.body).join('\n'), /Turn your BTC into more BTC/);
});

test('deposit field names each invalid amount and hides risk and results', () => {
  const wei = 10n ** 18n;
  assert.equal(quoteCard.classifyDeposit('abc').message, 'Enter a number, like 0.05.');
  assert.equal(quoteCard.classifyDeposit('1.2.3').message, 'Enter a number, like 0.05.');
  assert.equal(quoteCard.classifyDeposit('0').message, 'Enter an amount above 0.');
  assert.equal(quoteCard.classifyDeposit('-1').message, 'Enter an amount above 0.');
  assert.equal(quoteCard.classifyDeposit('0.0000000000000000001', { minWei: 1n }).message, 'The least you can deposit is 0.000000000000000001 BTC.');
  assert.equal(quoteCard.classifyDeposit('0.01', { minWei: 5n * 10n ** 16n }).message, 'The least you can deposit is 0.05 BTC.');
  assert.equal(quoteCard.classifyDeposit('5', { maxWei: wei }).message, 'The most you can deposit is 1 BTC.');
  assert.equal(quoteCard.classifyDeposit('0.04', { maxWei: wei }).ok, true);
  for (const message of ['Enter a number, like 0.05.', 'Enter an amount above 0.', 'The least you can deposit is 0.05 BTC.', 'The most you can deposit is 1 BTC.']) {
    const view = quoteCard.quoteCardView({
      paused: false,
      pegBlocked: false,
      overLimit: false,
      inputError: message,
      liquidationPrice: '$80,000',
      dropPercent: 45,
      feeLine: 'Coil fee: 0.25% of the MUSD you borrow when opening or adding leverage.',
    });
    assert.equal(view.inputError, message);
    assert.equal(view.showRisk, false);
    assert.equal(view.showResults, false);
    assert.equal(view.liquidationPrice, null);
    assert.equal(view.dropLine, null);
    assert.equal(view.feeLine, null);
  }
});

test('a display-only account quote is a sample preview, shows the reason, and cannot be submitted', () => {
  const fresh = { kind: 'ok', quote: increasedQuote, illustrative: false };
  const key = '31611:factory:account';
  const reason = "We couldn't read the quote for your account. These numbers are a sample, so opening stays off.";
  const failed = positionQuotes.presentPositionPreview(true, key, { key, kind: 'error', message: reason }, fresh);
  assert.equal(failed.displayOnly, true);
  assert.equal(failed.reason, reason);
  assert.equal(positionQuotes.canSubmitPositionPreview(failed), false);
  assert.equal(positionQuotes.openButtonReason(failed), reason);
  const pending = positionQuotes.presentPositionPreview(true, key, { key, kind: 'loading' }, fresh);
  assert.equal(pending.displayOnly, true);
  assert.equal(positionQuotes.canSubmitPositionPreview(pending), false);
  assert.match(pending.reason, /still loading/);
  assert.equal(positionQuotes.openButtonReason(pending), pending.reason);
  const view = quoteCard.quoteCardView({
    paused: false,
    pegBlocked: false,
    illustrative: false,
    displayOnly: true,
    overLimit: false,
    sampleReason: failed.reason,
    liquidationPrice: '$50,000',
    dropPercent: 45,
    feeLine: 'fees',
  });
  assert.equal(view.badge, 'Sample preview');
  assert.equal(view.sampleReason, reason);
  assert.equal(view.showResults, true);
  assert.equal(view.showRisk, false);
  const pendingView = quoteCard.quoteCardView({
    paused: false,
    pegBlocked: false,
    illustrative: false,
    displayOnly: true,
    overLimit: false,
    sampleReason: pending.reason,
    liquidationPrice: '$50,000',
    dropPercent: 45,
    feeLine: 'fees',
  });
  assert.equal(pendingView.showRisk, false);
  assert.equal(quoteCard.quoteCardView({
    paused: false, pegBlocked: false, illustrative: false, displayOnly: false, overLimit: false,
    liquidationPrice: '$50,000', dropPercent: 45, feeLine: 'fees',
  }).showRisk, true);
  const ready = positionQuotes.presentPositionPreview(true, key, { key, kind: 'ok', quote: increasedQuote }, fresh);
  assert.equal(ready.displayOnly, false);
  assert.equal(positionQuotes.canSubmitPositionPreview(ready), true);
  assert.equal(positionQuotes.openButtonReason(ready), null);
});

test('one percent formatter shows 5.43 as 5.4%', () => {
  assert.equal(productCopy.formatOneDecimalPercent(5.43), '5.4%');
  assert.equal(productCopy.formatBpsOneDecimal(543), '5.4%');
  const warning = productCopy.poolWarning(543, 200);
  assert.match(warning, /5\.4%/);
  assert.doesNotMatch(warning, /5\.43/);
  assert.equal(productCopy.priceCheckStatus(productCopy.formatBpsOneDecimal(543), productCopy.formatBpsOneDecimal(200)), 'Opening is paused by a safety check. The Mezo pool price is 5.4% away from the BTC price feed, and Coil only opens within 2%. Existing positions, protection and exits are not affected. Raising slippage will not help.');
  assert.equal(productCopy.btcCanFallLine(45), 'BTC can fall 45%');
});

test('main UI copy has no em dash and none of the removed jargon', () => {
  const root = path.join(__dirname, '../src');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx|ts)$/.test(entry.name) && (full.includes(`${path.sep}components${path.sep}`) || full.includes(`${path.sep}app${path.sep}`) || full.endsWith(`${path.sep}product-copy.ts`))) files.push(full);
    }
  };
  walk(root);
  const removed = [
    'Coil fee (minted notional)',
    'Gross MUSD minted',
    'BorrowerOperations',
    'State-aware contract quote includes existing collateral',
    'State-aware quote unavailable',
    'Writes stay off until this deployment is confirmed and explicitly enabled',
    'MEZO tips ship with the Wave 2 factory',
    'Historical legacy testnet receipts',
    'recruited user evidence',
    'AccountCreated logs',
    'latest 9,999-block window',
    'Last successful base snapshot',
    'Snapshot block',
    'Selected-factory events',
    'service mode unavailable',
    'Public service status: unconfigured',
    'Chain evidence only',
    'ready deployment',
    'factory ready',
    'Public chain observations are not real-user recruitment evidence',
  ];
  const hits = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    let visible = source;
    let previous;
    do {
      previous = visible;
      visible = visible.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, '');
    } while (visible !== previous);
    const chunks = [];
    for (const match of visible.matchAll(/`(?:\\.|[^`\\])*`|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g)) chunks.push(match[0].slice(1, -1));
    for (const match of visible.matchAll(/>([^<>{}]+)</g)) chunks.push(match[1]);
    const text = chunks.join('\n');
    if (text.includes('\u2014')) hits.push(`${path.relative(root, file)}: em dash`);
    if (/\boracle\b/i.test(text)) hits.push(`${path.relative(root, file)}: oracle`);
    for (const phrase of removed) {
      if (text.includes(phrase)) hits.push(`${path.relative(root, file)}: ${phrase}`);
    }
  }
  assert.deepEqual(hits, []);
  const landing = fs.readFileSync(path.join(root, 'components/landing.tsx'), 'utf8');
  assert.match(landing, /Built by/);
  assert.match(landing, /Prabal Pratap Singh/);
  assert.equal(productCopy.HERO_TITLE, 'Leverage your BTC in one transaction.');
  assert.equal(productCopy.TESTNET_NOTE, 'Coil runs on Mezo testnet and is not audited. Use test funds only.');
});
