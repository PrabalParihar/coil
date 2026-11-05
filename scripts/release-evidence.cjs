#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isAddress, loadManifest } = require('./deployments.cjs');

const ACTIONS = ['create','open','increase','setGuard','guard','claim','repay','close'];
const HASH = /^0x[0-9a-fA-F]{64}$/;
const DECIMAL = /^[1-9][0-9]*$/;
const same = (a,b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const need = (ok,message) => { if (!ok) throw Error(message); };
const SOURCE_FILES={CoilFactory:'src/CoilFactory.sol',CoilAccount:'src/CoilAccount.sol',CoilLegacy:'src/libraries/CoilLegacy.sol',CoilExit:'src/libraries/CoilExit.sol',FlashSizer:'src/libraries/FlashMath.sol',CoilPark:'src/CoilPark.sol',CoilOwner:'src/libraries/CoilOwner.sol'};

function verifySource(role,metadata) {
  const root=path.resolve(__dirname,'..'),file=SOURCE_FILES[role];
  need(file,'Unknown release source role');
  const expected=fs.readFileSync(path.join(root,file),'utf8').replace(/\r\n/g,'\n');
  need(typeof metadata.source_code==='string' && metadata.source_code.replace(/\r\n/g,'\n')===expected,`Verified source differs from this checkout: ${role}`);
  const s=metadata.compiler_settings;
  need(/^v?0\.8\.24(?:\+|$)/.test(metadata.compiler_version||'') && s?.evmVersion==='shanghai' && s?.optimizer?.enabled===true && s.optimizer.runs===200 && s.viaIR===true && s.metadata?.bytecodeHash==='none',`Compiler/settings mismatch for release source ${role}`);
  for(const source of metadata.additional_sources||[]) {
    const relative=source.file_path;
    need(typeof relative==='string' && /^(src|lib)\/[^\\]*\.sol$/.test(relative) && !relative.split('/').includes('..'),'Unexpected verified source path');
    const target=path.resolve(root,relative);need(target.startsWith(root+path.sep) && fs.existsSync(target) && fs.realpathSync(target).startsWith(root+path.sep),'Verified source path is outside this checkout');
    need(typeof source.source_code==='string' && source.source_code.replace(/\r\n/g,'\n')===fs.readFileSync(target,'utf8').replace(/\r\n/g,'\n'),`Additional verified source differs from this checkout: ${role}`);
  }
  return crypto.createHash('sha256').update(expected).digest('hex');
}

function validateEvidence(deployment, evidence, { complete = true } = {}) {
  const d=deployment,e=evidence;
  need(d && (!complete || d.status==='ready'), 'A ready post-P0 deployment is required; legacy/pending is not release proof');
  need(e?.schemaVersion===1 && e.chainId===d.chainId, 'Evidence schema/chain mismatch');
  need(isAddress(e.factory) && same(e.factory,d.factory), 'Evidence factory is pending or mismatched');
  need(typeof e.deploymentBlock==='string' && DECIMAL.test(e.deploymentBlock) && e.deploymentBlock===d.deploymentBlock, 'Evidence deployment block mismatch');
  need(Array.isArray(e.testers) && Array.isArray(e.receipts), 'Tester and receipt arrays required');
  if (complete) need(e.testers.length>=3,'At least three distinct recruited tester wallets required');
  const testers=new Set();
  for(const t of e.testers) {
    need(isAddress(t.address),'Invalid tester address');
    need(t.recruited===true && t.consentRecorded===true,'Tester recruitment and consent must be recorded');
    const key=t.address.toLowerCase();need(!testers.has(key),'Tester wallets must be distinct');testers.add(key);
  }
  const hashes=new Set(),actions=new Set(),activity=new Map([...testers].map(t=>[t,new Set()]));
  for(const r of e.receipts) {
    need(ACTIONS.includes(r.action),'Unknown proof action');
    need(HASH.test(r.transactionHash),'Invalid transaction hash');
    const hash=r.transactionHash.toLowerCase();need(!hashes.has(hash),'Duplicate transaction hash');hashes.add(hash);
    need(isAddress(r.tester) && testers.has(r.tester.toLowerCase()),'Receipt tester is not a recorded tester');
    need(isAddress(r.account),'Invalid proof account address');
    need(r.chainId===d.chainId && same(r.factory,d.factory),'Receipt chain/factory mismatch');
    need(r.status==='success','Receipt must report success');
    need(typeof r.blockNumber==='string' && DECIMAL.test(r.blockNumber) && BigInt(r.blockNumber)>=BigInt(d.deploymentBlock),'Receipt predates the selected deployment block');
    need(r.receiptPath===`receipts/${r.transactionHash}.json`,'Receipt path must be its transaction hash under receipts/');
    actions.add(r.action);activity.get(r.tester.toLowerCase()).add(r.action);
  }
  if(complete) {
    for(const action of ACTIONS) need(actions.has(action),`Missing ${action} action proof`);
    for(const [tester,seen] of activity) need(seen.has('create') && (seen.has('open')||seen.has('increase')),`Tester ${tester} requires own create and open/increase proof`);
  }
  return {readiness:complete?'offline-validated':'partial-evidence',onlineVerified:false,testers:testers.size,receipts:hashes.size,chainId:d.chainId,factory:d.factory};
}

function sdk() { return require('../keeper/node_modules/viem'); }
const signatures = {
  create:['createAccount()'],
  open:['loop(uint256,uint256)','loop(uint256,uint256,uint16)','flashLoop(uint256,uint256)','flashLoop(uint256,uint256,uint16)'],
  increase:['loop(uint256,uint256)','loop(uint256,uint256,uint16)','flashLoop(uint256,uint256)','flashLoop(uint256,uint256,uint16)'],
  setGuard:['setGuard(uint256,uint256,uint32)','setGuard(uint256,uint256,uint32,uint256)'],
  guard:['guard()'],claim:['claimCollateral()'],repay:['repayWithMUSD(uint256)'],
  close:['closeWithMUSD(uint256)','unwind(uint256)','flashUnwind(uint256)'],
};

async function verifyReceipt(client, deployment, record) {
  const receipt=await client.getTransactionReceipt({hash:record.transactionHash});
  need(receipt.status==='success','RPC receipt reverted; declared success is not proof');
  need(receipt.blockNumber===BigInt(record.blockNumber) && receipt.blockNumber>=BigInt(deployment.deploymentBlock),'RPC receipt block mismatch');
  need(same(receipt.transactionHash,record.transactionHash),'RPC returned a different receipt hash');
  need(await client.getChainId()===deployment.chainId,'RPC chain mismatch');
  const tx=await client.getTransaction({hash:record.transactionHash});
  need(same(tx.hash,record.transactionHash),'RPC returned a different transaction');
  need(same(tx.to,record.action==='create'?deployment.factory:record.account),'Transaction targets a different factory/account');
  if(record.action!=='guard') need(same(tx.from,record.tester),'Owner transaction signer differs from tester');
  const {toFunctionSelector,parseAbi,decodeFunctionData}=sdk();
  const signature=signatures[record.action]?.find(s=>toFunctionSelector(s)===tx.input?.slice(0,10));
  need(signature,'Transaction action selector does not match the declared proof');
  if(record.action==='close' && signature!=='closeWithMUSD(uint256)') {
    const decoded=decodeFunctionData({abi:parseAbi([`function ${signature}`]),data:tx.input});
    need(decoded.args[0]===10n**18n,'A full close requires fractionWad = 1e18');
  }
  const abi=parseAbi(['function accountOf(address) view returns (address)','function owner() view returns (address)','function factory() view returns (address)']);
  const [account,owner,factory]=await Promise.all([
    client.readContract({address:deployment.factory,abi,functionName:'accountOf',args:[record.tester]}),
    client.readContract({address:record.account,abi,functionName:'owner'}),
    client.readContract({address:record.account,abi,functionName:'factory'}),
  ]);
  need(same(account,record.account) && same(owner,record.tester) && same(factory,deployment.factory),'RPC account owner/factory mapping mismatch');
  return receipt;
}

async function verifyDeployment(client,deployment,{fetchImpl=fetch}={}) {
  const {parseAbi}=sdk();
  need(await client.getChainId()===deployment.chainId,'RPC chain mismatch');
  const abi=parseAbi(['function implementation() view returns (address)','function keeper() view returns (address)']);
  const [implementation,keeper]=await Promise.all(['implementation','keeper'].map(functionName=>client.readContract({address:deployment.factory,abi,functionName})));
  need(same(implementation,deployment.implementation),'Live implementation differs from manifest');
  need(same(keeper,deployment.keeper),'Live keeper registration differs from manifest');
  const block=BigInt(deployment.deploymentBlock);
  const [before,created]=await Promise.all([client.getCode({address:deployment.factory,blockNumber:block-1n}),client.getCode({address:deployment.factory,blockNumber:block})]);
  need((!before||before==='0x') && created && created!=='0x','Factory creation block does not match manifest');
  const policyAbi=[{type:'function',name:'policy',stateMutability:'view',inputs:[],outputs:[{type:'tuple',components:[{name:'feeBps',type:'uint16'},{name:'feeRecipient',type:'address'},{name:'opensPaused',type:'bool'},{name:'maxCollateral',type:'uint256'},{name:'maxDebt',type:'uint256'}]}]}];
  const policy=await client.readContract({address:deployment.factory,abi:policyAbi,functionName:'policy'});
  need(policy && policy.opensPaused===false,'Opening policy is paused; live release activation is pending');
  need(Number.isInteger(Number(policy.feeBps)) && Number(policy.feeBps)>=1 && Number(policy.feeBps)<=50 && isAddress(policy.feeRecipient),'Live fee policy is invalid');
  need(BigInt(policy.maxCollateral)>0n && BigInt(policy.maxDebt)>0n,'Live position limits are missing');
  const api=new URL(deployment.explorerUrl);api.hostname=`api.${api.hostname}`;
  const libraries=[],sourceHashes={};
  for(const [name,address] of Object.entries(deployment.contracts)) {
    const code=await client.getCode({address});need(code && code!=='0x',`Missing live contract ${name}`);
    const response=await fetchImpl(`${api.origin}/api/v2/smart-contracts/${address}`,{signal:AbortSignal.timeout(25000)});
    need(response.ok,`Explorer verification unavailable for ${name}`);
    const meta=await response.json();
    need(meta.is_verified===true && meta.is_fully_verified===true,`Full source verification pending for ${name}`);
    sourceHashes[name]=verifySource(name,meta);
    if(name==='CoilAccount') libraries.push(...(meta.external_libraries||[]));
  }
  for(const role of ['CoilLegacy','CoilExit','CoilOwner']) need(libraries.some(x=>x.name===role && same(x.address_hash,deployment.contracts[role])),`Verified implementation library mismatch: ${role}`);
  return {implementation,keeper,sourceHashes};
}

async function verifyKeeper(client,deployment,{nowSeconds=Math.floor(Date.now()/1000),maxAgeSeconds=180}={}) {
  const {parseAbiItem}=sdk();
  const latest=await client.getBlockNumber();
  const start=latest>9999n?latest-9999n:0n;
  const fromBlock=start>BigInt(deployment.deploymentBlock)?start:BigInt(deployment.deploymentBlock);
  const logs=await client.getLogs({address:deployment.factory,event:parseAbiItem('event Heartbeat(address indexed keeper, uint256 timestamp)'),args:{keeper:deployment.keeper},fromBlock,toBlock:latest});
  const expected=logs.filter(log=>same(log.args?.keeper,deployment.keeper) && (!log.address||same(log.address,deployment.factory)));
  need(expected.length>0,'No heartbeat from configured keeper in recent blocks');
  const timestamp=Math.max(...expected.map(log=>Number(log.args.timestamp)));
  need(Number.isSafeInteger(timestamp) && timestamp<=nowSeconds+30,'Keeper heartbeat has an invalid/future timestamp');
  const ageSeconds=nowSeconds-timestamp;need(ageSeconds<=maxAgeSeconds,'Configured keeper heartbeat is stale');
  return {keeper:deployment.keeper,ageSeconds,timestamp};
}

async function verifyWeb(deployment,url,{fetchImpl=fetch}={}) {
  const base=new URL(url);need(base.protocol==='https:' && !base.username && !base.password,'Public web URL must use HTTPS without credentials');
  for(const route of ['/','/guard','/stats','/keeper']) {
    const response=await fetchImpl(new URL(route,base),{signal:AbortSignal.timeout(25000)});
    need(response.status===200,`Public route ${route} is not healthy`);
    const html=await response.text();need(html.includes('Coil Labs') && html.includes('</html>'),`Public route ${route} is incomplete`);
    if(route==='/guard'||route==='/stats') need(html.toLowerCase().includes(deployment.factory.toLowerCase()) && html.includes(deployment.deploymentBlock),`Public route ${route} factory/block does not match release`);
  }
  const unknown=await fetchImpl(new URL('/coil-release-check-unknown',base),{signal:AbortSignal.timeout(25000)});need(unknown.status===404,'Unknown route must return 404');
}

async function main(args) {
  const root=path.resolve(__dirname,'..');
  function option(name,fallback) {const i=args.indexOf(name);return i>=0?args[i+1]:fallback;}
  const evidencePath=path.resolve(option('--evidence',path.join(root,'docs/evidence/tester-proofs.json')));
  const evidence=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
  const manifest=loadManifest(root),deployment=manifest.deployments[String(evidence.chainId)];
  need(deployment,'Unsupported evidence chain');
  const collect=args.includes('--collect'),online=args.includes('--online');
  need(!(collect&&online),'Use --collect or --online, not both');
  const summary=validateEvidence(deployment,evidence,{complete:!collect});
  if(collect||online) {
    const {createPublicClient,http,defineChain}=sdk();
    const chain=defineChain({id:deployment.chainId,name:deployment.name,nativeCurrency:{name:'Bitcoin',symbol:'BTC',decimals:18},rpcUrls:{default:{http:[deployment.rpcUrl]}}});
    const client=createPublicClient({chain,transport:http(deployment.rpcUrl)});
    if(online) summary.deployment=await verifyDeployment(client,deployment);
    for(const record of evidence.receipts) {
      const receipt=await verifyReceipt(client,deployment,record);
      if(collect) {
        const target=path.join(path.dirname(evidencePath),record.receiptPath);fs.mkdirSync(path.dirname(target),{recursive:true});
        fs.writeFileSync(target,JSON.stringify(receipt,(_,value)=>typeof value==='bigint'?value.toString():value,2)+'\n');
      }
    }
    if(online) { await verifyKeeper(client,deployment); await verifyWeb(deployment,option('--web-url','https://coil.up.railway.app')); }
    summary.onlineVerified=true;summary.readiness=online?'live-release-verified':'collected-from-rpc';
  }
  console.log(JSON.stringify(summary,null,2));
}
if(require.main===module) main(process.argv.slice(2)).catch(error=>{
  // SDK errors may include credential-bearing provider URLs; show only safe validator messages.
  const message=error?.shortMessage?'Live RPC verification failed; check the configured public provider':error.message;
  console.error(message);process.exitCode=1;
});
module.exports={ACTIONS,validateEvidence,verifyReceipt,verifyDeployment,verifyKeeper,verifyWeb};
