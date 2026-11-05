#!/usr/bin/env node
'use strict';
// LOCAL/FORK evidence only. Never accepts a remote signing endpoint or real key.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { chromium } = require('playwright');
const { encodeFunctionData, decodeFunctionResult, decodeFunctionData, decodeEventLog, parseAbi, keccak256, encodeAbiParameters, toHex, padHex } = require('../web/node_modules/viem');
const ROOT = path.resolve(__dirname, '..');
const WORK = path.join(ROOT, '.superpowers/sdd/2026-11-06-wave2-completion/browser');
const RPC = 'http://127.0.0.1:28747';
const WEB_PORT = 43127;
const STATUS_FIXTURE_URL = 'https://keeper-status.example.org/status'; // Playwright interception only; never live service evidence.
const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'; // Standard public Anvil account 0.
const POOL = '0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9';
const BTC = '0x7b7C000000000000000000000000000000000000';
const MEZO = '0x7B7c000000000000000000000000000000000001';
const MUSD = '0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503';
const FEED = '0x86bCF0841622a5dAC14A313a15f96A95421b9366';
const TROVE_MANAGER = '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0';
const WAD = 10n ** 18n;
fs.mkdirSync(WORK, { recursive: true });
let sequence = 0;
const evidence = { scope: 'LOCAL ANVIL FORK ONLY — synthetic public-test-account fixture, not live matsnet or user evidence', rpc: RPC, webPort: WEB_PORT, chainId: 31611, phases: [], transactions: [], pageErrors: [], fixtureChanges: [], mainnetWrites: 0 };
const artifact = (source, name) => JSON.parse(fs.readFileSync(path.join(ROOT, 'out', `${source}.sol`, `${name}.json`)));
function rpc(method, params = []) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: '2.0', id: ++sequence, method, params });
    const req = http.request(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => { try { const data = JSON.parse(text); if (data.error) reject(new Error(JSON.stringify(data.error))); else resolve(data.result); } catch (error) { reject(error); } });
    });
    req.setTimeout(60_000, () => req.destroy(new Error(`Local RPC timed out: ${method}`)));
    req.on('error', reject); req.end(body);
  });
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check, name, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  do { if (await check()) return; await sleep(500); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${name}`);
}
function passed(phase) { evidence.phases.push(phase); console.log(`PASS LOCAL/FORK: ${phase}`); }
function saveEvidence() { fs.writeFileSync(path.join(WORK, 'result.json'), JSON.stringify(evidence, (_, value) => typeof value === 'bigint' ? value.toString() : value, 2)); }
async function assertLocalFork() {
  assert.equal(await rpc('eth_chainId'), '0x7b7b', 'Only the separate chain-31611 Anvil fixture is supported');
  assert.match(await rpc('web3_clientVersion'), /anvil/i, 'Refuse non-Anvil transaction target');
}
async function read(address, abi, functionName, args = []) {
  return decodeFunctionResult({ abi, functionName, data: await rpc('eth_call', [{ to: address, data: encodeFunctionData({ abi, functionName, args }) }, 'latest']) });
}
async function refreshClock() {
  const latest = await rpc('eth_getBlockByNumber', ['latest', false]);
  const timestamp = Math.max(Math.floor(Date.now() / 1000), Number(BigInt(latest.timestamp)) + 1);
  await rpc('evm_setNextBlockTimestamp', [timestamp]); await rpc('evm_mine');
  await rpc('anvil_setStorageAt', [FEED, padHex('0x1', { size: 32 }), padHex(toHex(timestamp), { size: 32 })]);
}
async function setPrice(price) {
  await refreshClock();
  await rpc('anvil_setStorageAt', [FEED, padHex('0x0', { size: 32 }), padHex(toHex(price), { size: 32 })]);
}
async function receipt(hash) {
  let result;
  await waitFor(async () => { result = await rpc('eth_getTransactionReceipt', [hash]); return result !== null; }, 'local transaction receipt');
  assert.equal(result.status, '0x1', `Local transaction reverted: ${hash}`);
  return result;
}
async function sendLocal(address, abi, functionName, args = [], value = 0n) {
  await assertLocalFork(); await refreshClock();
  const hash = await rpc('eth_sendTransaction', [{ from: OWNER, to: address, data: encodeFunctionData({ abi, functionName, args }), value: toHex(value), gas: '0x989680' }]);
  const result = await receipt(hash);
  evidence.transactions.push({ scope: 'local/fork', origin: 'fixture/operator', functionName, hash, blockNumber: result.blockNumber, status: 'success' });
  return result;
}
function events(receipt, abi, name) {
  return receipt.logs.flatMap(log => { try { const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }); return decoded.eventName === name ? [decoded.args] : []; } catch { return []; } });
}
async function prepare() {
  await assertLocalFork();
  const poolAbi = parseAbi(['function getReserves() view returns (uint256,uint256,uint256)', 'function token0() view returns (address)']);
  assert.equal((await read(POOL, poolAbi, 'token0')).toLowerCase(), MUSD.toLowerCase());
  const [reserveMusd, reserveBtc] = await read(POOL, poolAbi, 'getReserves');
  const code = item => `0x${item.deployedBytecode.object.replace(/^0x/, '')}`;
  const mirror = code(artifact('Coil.t', 'MockWbtc'));
  await rpc('anvil_setCode', [BTC, mirror]); await rpc('anvil_setCode', [MEZO, mirror]);
  const poolSlot = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [POOL, 0n]));
  await rpc('anvil_setStorageAt', [BTC, poolSlot, padHex(toHex(reserveBtc), { size: 32 })]);
  await rpc('anvil_setBalance', [BTC, toHex(5000n * WAD)]);
  await rpc('anvil_setCode', [FEED, code(artifact('MockStalePriceFeed', 'MockStalePriceFeed'))]);
  const spot = reserveMusd * WAD / reserveBtc;
  await setPrice(spot);
  await rpc('anvil_setBlockTimestampInterval', [1]);
  // Discover the real fork token's owner balance slot by tracing balanceOf; preserve its real protocol implementation.
  const tokenAbi = parseAbi(['function balanceOf(address) view returns (uint256)']);
  const trace = await rpc('debug_traceCall', [{ to: MUSD, data: encodeFunctionData({ abi: tokenAbi, functionName: 'balanceOf', args: [OWNER] }) }, 'latest', { disableMemory: true, disableStorage: true }]);
  const loads = trace.structLogs.filter(item => item.op === 'SLOAD');
  assert(loads.length, 'Real MUSD balance storage trace is required for local-only synthetic funding');
  const balanceSlot = `0x${loads.at(-1).stack.at(-1).replace(/^0x/, '')}`;
  await rpc('anvil_setStorageAt', [MUSD, padHex(balanceSlot, { size: 32 }), padHex(toHex(100_000n * WAD), { size: 32 })]);
  assert.equal(await read(MUSD, tokenAbi, 'balanceOf', [OWNER]), 100_000n * WAD);
  const fixture = { scope: evidence.scope, rpc: RPC, chainId: 31611, owner: OWNER, spot: spot.toString(), reserveMusd: reserveMusd.toString(), reserveBtc: reserveBtc.toString(), musdBalanceSlot: balanceSlot, fork: 'matsnet block 16595146', standIns: ['repository MockWbtc at BTC and MEZO', 'repository MockStalePriceFeed at feed', 'synthetic MUSD owner balance only'] };
  fs.writeFileSync(path.join(WORK, 'fixture.json'), JSON.stringify(fixture, null, 2));
  passed('Prepared BTC/MEZO/oracle stand-ins and synthetic MUSD funding on separate localhost fork');
}
function localDeployment() {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'broadcast/Deploy.s.sol/31611/run-latest.json')));
  const transaction = data.transactions.find(item => item.contractName === 'CoilFactory');
  assert(transaction?.contractAddress && transaction.hash, 'Local deployment receipt is required');
  const result = data.receipts.find(item => item.transactionHash.toLowerCase() === transaction.hash.toLowerCase());
  assert(result && result.status === '0x1', 'Successful local factory receipt required');
  return { factory: transaction.contractAddress, block: BigInt(result.blockNumber).toString(), hash: transaction.hash };
}
function startWeb(deployment) {
  const app = path.join(WORK, 'app');
  if (fs.existsSync(app)) fs.rmSync(app, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'web'), app, { recursive: true, filter: file => !['node_modules', '.next', 'out'].includes(path.basename(file)) });
  fs.symlinkSync(path.join(ROOT, 'web/node_modules'), path.join(app, 'node_modules'), 'dir');
  // Match the retained runtime's trusted-CA Turbopack setup while keeping all generated files isolated.
  fs.writeFileSync(path.join(app, 'next.config.ts'), `import type { NextConfig } from "next";
const base: NextConfig = require(${JSON.stringify(path.join(ROOT, 'web/next.config.ts'))}).default;
export default { ...base, transpilePackages: [...new Set([...(base.transpilePackages ?? []), "@mezo-org/orangekit-contracts"])], turbopack: { ...base.turbopack, root: ${JSON.stringify(ROOT)} } };
`);
  const log = fs.openSync(path.join(WORK, 'next.log'), 'w');
  const env = { ...process.env, NEXT_PUBLIC_COIL_FACTORY: deployment.factory, NEXT_PUBLIC_COIL_FACTORY_DEPLOY_BLOCK: deployment.block, NEXT_PUBLIC_COIL_CHAIN_ID: '31611', NEXT_PUBLIC_COIL_ENABLE_MAINNET_WRITES: 'false', NEXT_PUBLIC_KEEPER_STATUS_URL: STATUS_FIXTURE_URL };
  delete env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
  const child = spawn(process.execPath, [path.join(ROOT, 'web/node_modules/next/dist/bin/next'), 'dev', '--turbopack', '-p', String(WEB_PORT), '--hostname', '127.0.0.1'], { cwd: app, env, detached: true, stdio: ['ignore', log, log] });
  fs.closeSync(log);
  return child;
}
async function run() {
  await assertLocalFork();
  const fixture = JSON.parse(fs.readFileSync(path.join(WORK, 'fixture.json')));
  const deployment = localDeployment();
  assert.notEqual(await rpc('eth_getCode', [deployment.factory, 'latest']), '0x');
  const liveDeploymentReceipt = await rpc('eth_getTransactionReceipt', [deployment.hash]);
  assert(liveDeploymentReceipt && liveDeploymentReceipt.status === '0x1', 'The deployment receipt must belong to this local fork');
  assert.equal(BigInt(liveDeploymentReceipt.blockNumber).toString(), deployment.block, 'Local factory/block receipt pair must match');
  evidence.deployment = { ...deployment, scope: 'local/fork' }; evidence.fixtureChanges = fixture.standIns;
  const factoryAbi = artifact('CoilFactory', 'CoilFactory').abi;
  const accountAbi = artifact('CoilAccount', 'CoilAccount').abi;
  const erc20Abi = parseAbi(['function balanceOf(address) view returns (uint256)', 'function approve(address,uint256) returns (bool)']);
  const recoveryAbi = parseAbi(['function checkRecoveryMode(uint256) view returns (bool)']);
  const policy = await read(deployment.factory, factoryAbi, 'policy');
  assert.equal(policy.opensPaused, true); assert(policy.maxCollateral > 0n && policy.maxDebt > 0n); assert.equal(policy.feeBps, 25);
  evidence.initialPolicy = policy;
  fs.writeFileSync(path.join(WORK, 'checkpoint.json'), JSON.stringify({ scope: 'local/fork', id: await rpc('evm_snapshot') }));
  const server = startWeb(deployment);
  let browser, page;
  let failLogs = false;
  let serviceFixture = "monitoring";
  let pauseNextWalletSend = false;
  let resumeWalletSend;
  try {
    await waitFor(() => new Promise(resolve => { const req = http.get(`http://127.0.0.1:${WEB_PORT}/`, res => { res.resume(); resolve(res.statusCode === 200); }); req.on('error', () => resolve(false)); req.setTimeout(10_000, () => { req.destroy(); resolve(false); }); }), 'isolated local Next app startup', 180_000);
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'], proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: '127.0.0.1,localhost' } : undefined });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
    page = await context.newPage();
    page.on('pageerror', error => evidence.pageErrors.push(error.message.slice(0, 400)));
    const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS' };
    await context.route(STATUS_FIXTURE_URL, async route => {
      if (serviceFixture === 'unavailable') return route.fulfill({ status: 503, headers, body: '{"error":"LOCAL/FORK simulated public status outage"}' });
      const now = Date.now();
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ chainId: 31611, factory: deployment.factory, keeper: null, mode: 'read-only', lastScanAt: serviceFixture === 'stale' ? now - 120000 : now - 1000, lastHeartbeatAt: null, status: serviceFixture === 'stale' ? 'stale' : 'monitoring', counters: { scans: 1, scanFailures: 0, simulations: 0, skipped: 0, failures: 0, confirmedGuards: 0, confirmedHeartbeats: 0 } }) });
    });
    await context.route('https://rpc.test.mezo.org/**', async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const input = route.request().postDataJSON();
      const forward = async call => { try { if (/sendTransaction|sendRawTransaction/.test(call.method)) throw new Error('Read-only public transport cannot submit transactions'); if (failLogs && call.method === 'eth_getLogs') throw new Error('LOCAL FIXTURE: simulated history RPC outage'); return { jsonrpc: '2.0', id: call.id, result: await rpc(call.method, call.params) }; } catch (error) { return { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: error.message } }; } };
      await route.fulfill({ status: 200, headers, body: JSON.stringify(Array.isArray(input) ? await Promise.all(input.map(forward)) : await forward(input)) });
    });
    await context.route(url => ['rpc-http.mezo.boar.network', 'mezo.drpc.org'].includes(url.hostname), async route => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const input = route.request().postDataJSON();
      const calls = Array.isArray(input) ? input : [input];
      assert(!calls.some(call => /sendTransaction|sendRawTransaction/.test(call.method)), 'No mainnet writes permitted');
      // The optional mainnet market comparison is not pointed at a testnet fork.
      return route.fulfill({ status: 503, body: 'LOCAL/FORK harness: mainnet comparison deliberately unavailable; no mainnet mutation.' });
    });
    await context.exposeBinding('__coilLocalRequest', async (_source, payload) => {
      if (payload.method === 'eth_sendTransaction') {
        const transaction = payload.params[0];
        assert.equal(transaction.from.toLowerCase(), OWNER.toLowerCase());
        if (pauseNextWalletSend) { pauseNextWalletSend = false; await new Promise(resolve => { resumeWalletSend = resolve; }); }
        await assertLocalFork(); await refreshClock();
        const hash = await rpc(payload.method, payload.params);
        evidence.transactions.push({ scope: 'local/fork', origin: 'browser/public-Anvil-wallet', hash, to: transaction.to, data: transaction.data });
        return hash;
      }
      assert(!/sendRawTransaction|personal_sign|signTypedData|eth_sign/.test(payload.method), 'Only unlocked public-Anvil fixture transactions are allowed');
      return rpc(payload.method, payload.params);
    });
    await context.addInitScript(({ owner }) => {
      let connected = false; const listeners = new Map();
      const provider = { isMetaMask: true, isConnected: () => true, _metamask: { isUnlocked: async () => true }, on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); return provider; }, removeListener(event, fn) { listeners.get(event)?.delete(fn); return provider; }, async request({ method, params = [] }) {
        if (method === 'eth_requestAccounts') { connected = true; for (const fn of listeners.get('accountsChanged') ?? []) fn([owner]); return [owner]; }
        if (method === 'eth_accounts') return connected ? [owner] : [];
        if (method === 'eth_chainId') return '0x7b7b'; if (method === 'net_version') return '31611';
        if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') { if (params[0].chainId !== '0x7b7b') throw new Error('LOCAL/FORK harness refuses other chains'); return null; }
        if (method === 'wallet_requestPermissions') { connected = true; return [{ parentCapability: 'eth_accounts' }]; }
        if (method === 'wallet_getPermissions') return connected ? [{ parentCapability: 'eth_accounts' }] : [];
        if (method === 'wallet_watchAsset') return true;
        return window.__coilLocalRequest({ method, params });
      } };
      Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
      window.dispatchEvent(new Event('ethereum#initialized'));
      window.addEventListener('DOMContentLoaded', () => { const label = document.createElement('div'); label.textContent = 'LOCAL ANVIL FORK · synthetic test fixture · no live-chain/user evidence'; Object.assign(label.style, { position: 'fixed', bottom: '0', left: '0', right: '0', zIndex: '2147483647', padding: '8px', textAlign: 'center', background: '#4c2100', color: '#fff', pointerEvents: 'none', font: 'bold 14px sans-serif' }); document.body.appendChild(label); });
    }, { owner: OWNER });
    const screen = async name => page.screenshot({ path: path.join(WORK, `${name}.png`), fullPage: true });
    const go = async route => { const response = await page.goto(`http://127.0.0.1:${WEB_PORT}${route}`, { waitUntil: 'domcontentloaded', timeout: 180_000 }); assert.equal(response.status(), 200); };
    await go('/'); await page.locator('#btc').waitFor({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Connect', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor({ timeout: 30_000 });
    const walletOptions = await dialog.getByRole('button').allTextContents();
    for (const name of ['Unisat', 'OKX', 'Xverse']) assert(walletOptions.some(option => option.includes(name)), `Missing Bitcoin wallet: ${name}`);
    assert(walletOptions.some(option => /Browser Wallet|MetaMask|Injected/.test(option)), 'Injected wallet remains available');
    assert(!walletOptions.some(option => /WalletConnect/.test(option)), 'Unconfigured WalletConnect must not appear usable');
    evidence.walletOptions = walletOptions;
    await screen('00-wallet-options-local-fork');
    passed('No project ID: Unisat, OKX, Xverse and injected wallets available; WalletConnect absent');
    await dialog.getByRole('button', { name: /Browser Wallet|MetaMask|Injected/ }).first().click();
    await page.locator('#owner-deployment').selectOption(`${31611}:${deployment.factory.toLowerCase()}:${deployment.block}`);
    const create = page.getByRole('button', { name: 'Create your Coil account', exact: true }).first();
    await waitFor(() => create.isEnabled(), 'public-Anvil wallet and new policy capability');
    await create.click();
    let clone;
    await waitFor(async () => { clone = await read(deployment.factory, factoryAbi, 'accountOf', [OWNER]); return !/^0x0{40}$/i.test(clone); }, 'browser account create');
    evidence.clone = clone;
    await page.getByText('Account created.', { exact: true }).first().waitFor({ timeout: 60_000 });
    await waitFor(() => page.getByText(/Factory opens are paused/).count().then(Boolean), 'initial paused UI');
    await screen('01-created-paused-local-fork'); passed('Browser create; finite-limit factory starts paused and policy is visible');
    await sendLocal(deployment.factory, factoryAbi, 'unpauseOpens');
    await page.locator('#btc').fill('0.1');
    const loop = page.getByRole('button', { name: /^Loop to 200%/ }).first();
    await waitFor(() => loop.isEnabled(), 'new fee-aware open quote');
    pauseNextWalletSend = true;
    await loop.click();
    await waitFor(() => Boolean(resumeWalletSend), 'local wallet consent gate');
    assert.equal(await page.locator('#owner-deployment').isDisabled(), true, 'Generation is locked during fee consent');
    assert.equal(await page.getByRole('button', { name: 'Retry account discovery', exact: true }).isDisabled(), true);
    resumeWalletSend(); resumeWalletSend = undefined;
    await waitFor(async () => (await read(clone, accountAbi, 'position')).active, 'browser fee-bearing open');
    await page.getByText('Loop confirmed.', { exact: true }).first().waitFor({ timeout: 60_000 });
    const opened = await read(clone, accountAbi, 'position'); evidence.open = opened;
    assert(opened.cr >= 2n * WAD);
    const openTransaction = evidence.transactions.filter(item => item.origin === 'browser/public-Anvil-wallet').at(-1);
    const decodedOpen = decodeFunctionData({ abi: accountAbi, data: openTransaction.data });
    assert.equal(decodedOpen.functionName, 'flashLoop'); assert.equal(decodedOpen.args.length, 3); assert.equal(decodedOpen.args[2], 25);
    const openReceipt = await receipt(openTransaction.hash);
    const fees = events(openReceipt, accountAbi, 'CoilFeePaid'); assert.equal(fees.length, 1); assert.equal(fees[0].amount, fees[0].grossMinted * 25n / 10_000n); assert(fees[0].amount > 0n); evidence.openFee = fees[0];
    await screen('02-fee-open-local-fork'); passed('Browser fee-bearing open; receipt proves exact 25 bps fee and total protocol position');
    await page.locator('#btc').fill('0.01');
    await waitFor(() => loop.isEnabled(), 'active state-aware increase quote');
    assert.match(await page.locator('body').innerText(), /State-aware contract quote includes existing collateral, total debt and refinancing/);
    const increaseQuote = await read(clone, accountAbi, 'quoteFlashLoopWithFee', [WAD / 100n, 2n * WAD, 50n]);
    assert(increaseQuote[0].debt >= opened.debt); evidence.increaseQuote = increaseQuote;
    await loop.click();
    await waitFor(async () => (await read(clone, accountAbi, 'position')).collateral > opened.collateral, 'browser fee-bearing increase');
    await page.getByText('Loop confirmed.', { exact: true }).first().waitFor({ timeout: 60_000 });
    evidence.increased = await read(clone, accountAbi, 'position'); passed('Browser active-position increase uses state-aware WithFee quote');
    await sendLocal(deployment.factory, factoryAbi, 'pauseOpens');
    await setPrice(BigInt(fixture.spot) / 1000n);
    assert.equal(await read(TROVE_MANAGER, recoveryAbi, 'checkRecoveryMode', [BigInt(fixture.spot) / 1000n]), true);
    await waitFor(() => page.getByText(/Mezo is in Recovery Mode\. Opens and full close are blocked/).count().then(Boolean), 'actual protocol RM UI');
    const close = page.getByRole('button', { name: 'Approve & close with MUSD', exact: true });
    assert.equal(await close.isEnabled(), false);
    const beforeRepay = await read(clone, accountAbi, 'position');
    await page.locator('#owner-musd').fill('100');
    const repay = page.getByRole('button', { name: 'Approve & repay MUSD', exact: true });
    assert.equal(await repay.isEnabled(), true);
    const txStart = evidence.transactions.length;
    await repay.click();
    await waitFor(async () => (await read(clone, accountAbi, 'position')).debt < beforeRepay.debt - 99n * WAD, 'browser RM repayment');
    await page.getByText(/Repayment confirmed\./).first().waitFor({ timeout: 60_000 });
    const repaid = await read(clone, accountAbi, 'position'); assert.equal(repaid.collateral, beforeRepay.collateral); evidence.repaidInRM = repaid;
    const repaymentTransactions = evidence.transactions.slice(txStart).filter(transaction => transaction.origin === 'browser/public-Anvil-wallet');
    assert.equal(repaymentTransactions.length, 2);
    const approval = decodeFunctionData({ abi: erc20Abi, data: repaymentTransactions[0].data });
    assert.equal(approval.functionName, 'approve'); assert.equal(approval.args[0].toLowerCase(), clone.toLowerCase()); assert.equal(approval.args[1], 100n * WAD);
    const repaymentEvents = events(await receipt(repaymentTransactions[1].hash), accountAbi, 'MUSDRepaid');
    assert.equal(repaymentEvents.length, 1); assert.equal(repaymentEvents[0].amount, 100n * WAD);
    for (const transaction of repaymentTransactions) assert.equal(events(await receipt(transaction.hash), accountAbi, 'CoilFeePaid').length, 0);
    await screen('03-recovery-repay-local-fork'); passed('Real protocol RM: browser MUSD approval/repay lowers debt without collateral sale or Coil fee; full close disabled');
    await setPrice(BigInt(fixture.spot));
    await waitFor(() => close.isEnabled(), 'protocol-permitted direct owner close');
    // Fund/configure an actual bounded guard through the UI while opens remain paused.
    await page.getByRole('tab', { name: 'Guard', exact: true }).click();
    await page.locator('#floor').fill('205'); await page.locator('#guard-target').fill('220'); await page.locator('#zone').fill('0');
    await page.getByRole('button', { name: 'Save guard', exact: true }).click();
    await page.getByText('Guard saved.', { exact: true }).first().waitFor({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Park MUSD', exact: true }).click();
    await page.getByText('MUSD parked. A rescue spends this before it sells BTC.', { exact: true }).first().waitFor({ timeout: 60_000 });
    const beforeGuard = await read(clone, accountAbi, 'position');
    const guardReceipt = await sendLocal(clone, accountAbi, 'guard');
    const guarded = await read(clone, accountAbi, 'position'); assert(guarded.cr > beforeGuard.cr); assert(guarded.debt < beforeGuard.debt);
    assert.equal(events(guardReceipt, accountAbi, 'CoilFeePaid').length, 0); assert.equal(events(guardReceipt, accountAbi, 'Guarded').length, 1); evidence.guarded = guarded;
    passed('Browser guard settings/reserve funding plus actual local bounded guard increase CR with zero Coil fee');
    await sendLocal(deployment.factory, factoryAbi, 'heartbeat');
    await page.locator('#owner-musd').fill('100000');
    const closeTxStart = evidence.transactions.length;
    await close.click();
    await waitFor(async () => !(await read(clone, accountAbi, 'position')).active, 'browser MUSD full close');
    await page.getByText('Close confirmed.', { exact: true }).first().waitFor({ timeout: 60_000 });
    assert((await read(MUSD, erc20Abi, 'balanceOf', [OWNER])) > 0n);
    const closeTransactions = evidence.transactions.slice(closeTxStart).filter(transaction => transaction.origin === 'browser/public-Anvil-wallet');
    assert.equal(closeTransactions.length, 2);
    assert.equal(events(await receipt(closeTransactions[1].hash), accountAbi, 'ClosedWithMUSD').length, 1);
    for (const transaction of closeTransactions) assert.equal(events(await receipt(transaction.hash), accountAbi, 'CoilFeePaid').length, 0);
    await screen('04-direct-close-local-fork'); passed('Browser account-scoped MUSD approval/direct close succeeds after RM; unused maximum stays in wallet');
    await go('/guard');
    await waitFor(() => page.getByText('Heartbeat history', { exact: true }).count().then(Boolean), 'recent heartbeat history');
    await waitFor(() => page.getByText('Rescue', { exact: true }).count().then(Boolean), 'actual rescue history');
    await screen('05-guard-history-local-fork'); passed('/guard renders actual recent local rescue and heartbeat with bounded-history provenance');
    await go('/keeper');
    await page.getByRole('button', { name: 'Refresh keeper evidence', exact: true }).click();
    await waitFor(() => page.getByRole('heading', { name: 'Chain heartbeat evidence: fresh', exact: true }).count().then(Boolean), 'trusted keeper freshness');
    await waitFor(() => page.getByRole('heading', { name: 'Public service status: monitoring', exact: true }).count().then(Boolean), 'validated optional read-only service fixture');
    assert.match(await page.locator('body').innerText(), /Mode: read-only monitoring\. This service does not submit guard transactions/);
    await screen('06-keeper-fresh-local-fork'); passed('/keeper separates fresh authenticated chain heartbeat from optional read-only monitoring service fixture');
    serviceFixture = 'stale';
    await page.getByRole('button', { name: 'Refresh keeper evidence', exact: true }).click();
    await waitFor(() => page.getByRole('heading', { name: 'Public service status: stale', exact: true }).count().then(Boolean), 'stale service scan fixture');
    assert(await page.getByRole('heading', { name: 'Chain heartbeat evidence: fresh', exact: true }).count());
    await screen('06b-service-stale-local-fork'); passed('Stale service scan shown without erasing separately fresh chain evidence');
    serviceFixture = 'unavailable';
    await page.getByRole('button', { name: 'Refresh keeper evidence', exact: true }).click();
    await waitFor(() => page.getByRole('heading', { name: 'Public service status: unavailable', exact: true }).count().then(Boolean), 'public service outage fixture');
    assert(await page.getByRole('heading', { name: 'Chain heartbeat evidence: fresh', exact: true }).count());
    await screen('06c-service-unavailable-local-fork'); passed('Unavailable public service honestly loses service mode/freshness while chain evidence remains separately labelled');
    serviceFixture = 'monitoring';
    await page.getByRole('button', { name: 'Refresh keeper evidence', exact: true }).click();
    await waitFor(() => page.getByRole('heading', { name: 'Public service status: monitoring', exact: true }).count().then(Boolean), 'service retry recovery');
    failLogs = true;
    await page.getByRole('button', { name: 'Refresh keeper evidence', exact: true }).click();
    await waitFor(() => page.getByRole('heading', { name: 'Chain heartbeat evidence: stale', exact: true }).count().then(Boolean), 'RPC failure makes health stale');
    await screen('07-keeper-rpc-error-local-fork'); passed('/keeper RPC error retains stale evidence and never reports false fresh status');
    failLogs = false;
    await page.getByRole('button', { name: 'Refresh keeper evidence', exact: true }).click();
    await waitFor(() => page.getByRole('heading', { name: 'Chain heartbeat evidence: fresh', exact: true }).count().then(Boolean), 'keeper retry recovery');
    await go('/stats');
    await waitFor(async () => {
      const accounts = await page.locator('dt').filter({ hasText: /^Accounts$/ }).locator('..').locator('dd').textContent().catch(() => null);
      const open = await page.locator('dt').filter({ hasText: /^Open troves$/ }).locator('..').locator('dd').textContent().catch(() => null);
      return accounts?.trim() === '1' && open?.trim() === '0';
    }, 'actual stats account/open counts');
    await screen('08-stats-local-fork'); passed('/stats renders public local-chain counts with provenance and read limits');
    // Regression: a new empty current clone must not hide a funded retained legacy clone.
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'deployments/manifest.json')));
    const legacy = manifest.retainedDeployments['31611'].find(entry => entry.factory.toLowerCase() === '0xff3335576f998ee872596d4eb7abecb71a0d5bc8');
    assert(legacy, 'Documented retained legacy generation is required');
    let oldClone = await read(legacy.factory, factoryAbi, 'accountOf', [OWNER]);
    if (/^0x0{40}$/i.test(oldClone)) { await sendLocal(legacy.factory, factoryAbi, 'createAccount'); oldClone = await read(legacy.factory, factoryAbi, 'accountOf', [OWNER]); }
    const currentPoolReserves = await read(POOL, parseAbi(['function getReserves() view returns (uint256,uint256,uint256)']), 'getReserves');
    await setPrice(currentPoolReserves[0] * WAD / currentPoolReserves[1]);
    if (!(await read(oldClone, accountAbi, 'position')).active) await sendLocal(oldClone, accountAbi, 'flashLoop', [2n * WAD, 50n], WAD / 10n);
    const oldFunded = await read(oldClone, accountAbi, 'position'); assert(oldFunded.active);
    assert.equal((await read(clone, accountAbi, 'position')).active, false, 'Current clone remains empty after its confirmed close');
    await go('/');
    await page.getByRole('button', { name: 'Connect', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /Browser Wallet|MetaMask|Injected/ }).first().click();
    const oldKey = `${31611}:${legacy.factory.toLowerCase()}:${legacy.deploymentBlock}`;
    await waitFor(async () => await page.locator('#owner-deployment').inputValue() === oldKey && await page.getByText('Retained legacy', { exact: false }).count() > 0, 'funded retained account selected ahead of empty new clone');
    assert.match(await page.locator('body').innerText(), new RegExp(oldClone, 'i'));
    evidence.retainedSelection = { scope: 'local/fork', factory: legacy.factory, deploymentBlock: legacy.deploymentBlock, clone: oldClone, fundedPosition: oldFunded, currentEmptyClone: clone };
    await screen('09-retained-funded-selected-local-fork');
    await page.getByRole('tab', { name: 'Unwind', exact: true }).click();
    await page.getByRole('button', { name: 'Unwind and close', exact: true }).click();
    await waitFor(async () => !(await read(oldClone, accountAbi, 'position')).active, 'browser exit targets retained funded clone');
    const oldExit = evidence.transactions.filter(item => item.origin === 'browser/public-Anvil-wallet').at(-1);
    assert.equal(oldExit.to.toLowerCase(), oldClone.toLowerCase()); assert.notEqual(oldExit.to.toLowerCase(), clone.toLowerCase());
    evidence.retainedSelection.closed = true;
    passed('Funded retained legacy clone defaults ahead of new empty account; browser exit binds the retained clone/factory');
    const localReceipts = [];
    for (const transaction of evidence.transactions) {
      const confirmed = await receipt(transaction.hash);
      transaction.status = 'success'; transaction.blockNumber = confirmed.blockNumber;
      localReceipts.push({ scope: 'local/fork', rpc: RPC, ...confirmed });
    }
    fs.writeFileSync(path.join(WORK, 'receipts-local-fork.json'), JSON.stringify(localReceipts, null, 2));
    assert.deepEqual(evidence.pageErrors, [], 'No browser runtime page errors');
    evidence.success = true;
  } catch (error) {
    evidence.success = false; evidence.error = error.message;
    if (page) { evidence.visibleText = (await page.locator('body').innerText().catch(() => '')).slice(-20_000); await page.screenshot({ path: path.join(WORK, 'failure-local-fork.png'), fullPage: true }).catch(() => {}); }
    throw error;
  } finally {
    if (browser) await browser.close();
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
    saveEvidence();
  }
}
(async () => {
  if (process.argv[2] === '--prepare') await prepare();
  else if (process.argv[2] === '--reset') { await assertLocalFork(); await rpc('anvil_reset', [{ forking: { jsonRpcUrl: 'https://rpc.test.mezo.org', blockNumber: 16595146 } }]); }
  else if (process.argv[2] === '--restore') { await assertLocalFork(); const snapshot = JSON.parse(fs.readFileSync(path.join(WORK, 'checkpoint.json'))); assert.equal(await rpc('evm_revert', [snapshot.id]), true); }
  else if (process.argv[2] === '--run') await run();
  else throw new Error('Use --prepare before local deployment, then --run after local Deploy.s.sol broadcast. --restore reverts only this dedicated local fixture checkpoint.');
})().catch(error => { evidence.success = false; evidence.error = error.message; saveEvidence(); console.error(error.stack); process.exitCode = 1; });
