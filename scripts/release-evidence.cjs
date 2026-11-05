#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { isAddress, loadManifest } = require('./deployments.cjs');

const ACTIONS = ['create','open','increase','setGuard','guard','claim','repay','repayRM','close'];
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
  guard:['guard()'],claim:['claimCollateral()'],repay:['repayWithMUSD(uint256)'],repayRM:['repayWithMUSD(uint256)'],
  close:['closeWithMUSD(uint256)','unwind(uint256)','flashUnwind(uint256)'],
};

// Canonical constructor configuration is shared with the Solidity deployment script.
function marketFor(chainId) {
  const prefix={31611:'TESTNET_',31612:'MAINNET_'}[chainId];
  need(prefix,'Unsupported protocol market');
  const source=fs.readFileSync(path.join(__dirname,'../src/MezoAddresses.sol'),'utf8');
  const constants=Object.fromEntries([...source.matchAll(/address internal constant (\w+) = (0x[\da-fA-F]{40});/g)].map(m=>[m[1],m[2]]));
  const names={borrowerOperations:'BORROWER_OPERATIONS',troveManager:'TROVE_MANAGER',sortedTroves:'SORTED_TROVES',hintHelpers:'HINT_HELPERS',priceFeed:'PRICE_FEED',musd:'MUSD',btc:'BTC',mezo:'MEZO',router:'ROUTER',poolFactory:'POOL_FACTORY',pool:'MUSD_BTC_POOL'};
  return Object.fromEntries(Object.entries(names).map(([field,name])=>{
    const value=constants[(name==='BTC'||name==='MEZO'?'':prefix)+name];need(isAddress(value),`Missing canonical market ${field}`);return [field,value];
  }));
}
const EVENTS={
  created:'event AccountCreated(address indexed owner,address indexed account)',
  fee:'event CoilFeePaid(address indexed recipient,uint256 grossMinted,uint256 amount)',
  loop:'event Looped(address indexed owner,uint256 targetCR,uint256 collateral,uint256 debt,uint256 cr)',
  guarded:'event Guarded(address indexed caller,uint256 crBefore,uint256 crAfter,uint256 tip)',
  guardSet:'event GuardSet(uint256 floorCR,uint256 guardTargetCR,uint32 redemptionZone,uint256 tipMezo)',
  repaid:'event MUSDRepaid(address indexed owner,uint256 amount)',
  claimed:'event CollateralClaimed(address indexed owner,uint256 amount)',
  closed:'event ClosedWithMUSD(address indexed owner,uint256 ownerMUSD)',
  unwound:'event Unwound(address indexed owner,uint256 fractionWad,uint256 cr)',
  transfer:'event Transfer(address indexed from,address indexed to,uint256 value)',
  trove:'event TroveUpdated(address indexed _borrower,uint256 _principal,uint256 _interest,uint256 _coll,uint256 _stake,uint16 _interestRate,uint256 _lastInterestUpdateTime,uint8 _operation)',
};
const ZERO='0x'+'0'.repeat(40),WAD=10n**18n;

async function verifyEffects(client,d,r,receipt,tx,decoded) {
  const {parseAbi,decodeEventLog,toEventSelector}=sdk(),market=marketFor(d.chainId);
  const n=receipt.blockNumber,pre=n-1n;
  const read=(address,signature,functionName,args=[],blockNumber=n)=>client.readContract({address,abi:parseAbi([`function ${signature}`]),functionName,args,blockNumber});
  // Block-end snapshots cannot attribute a transition inside a multi-transaction block.
  // Reject ambiguity instead of treating adjacent-block state as transaction-local state.
  const [block,parent]=await Promise.all([client.getBlock({blockNumber:n}),client.getBlock({blockNumber:pre})]);
  need(same(block.hash,receipt.blockHash) && same(tx.blockHash,block.hash) && tx.blockNumber===n && same(block.parentHash,parent.hash),'Historical receipt block/hash mismatch');
  need(block.transactions.length===1 && same(typeof block.transactions[0]==='string'?block.transactions[0]:block.transactions[0].hash,r.transactionHash),'Effect proof requires an isolated transaction block');
  need(tx.transactionIndex===0 && receipt.transactionIndex===0,'Isolated transaction index/order mismatch');
  const abi=parseAbi(['function accountOf(address) view returns (address)','function owner() view returns (address)','function factory() view returns (address)']);
  const [account,owner,factory]=await Promise.all([
    client.readContract({address:d.factory,abi,functionName:'accountOf',args:[r.tester],blockNumber:n}),
    client.readContract({address:r.account,abi,functionName:'owner',blockNumber:n}),
    client.readContract({address:r.account,abi,functionName:'factory',blockNumber:n}),
  ]);
  need(same(account,r.account) && same(owner,r.tester) && same(factory,d.factory),'RPC account owner/factory mapping mismatch');
  const checkLog=log=>need(log.removed!==true && same(log.transactionHash,r.transactionHash) && same(log.blockHash,block.hash) && log.blockNumber===n,'Effect log transaction/block attribution mismatch');
  need(Array.isArray(receipt.logs),'Effect receipt logs required');
  receipt.logs.forEach(checkLog);
  const blockLogs=await client.getLogs({address:[d.factory,r.account,market.borrowerOperations,market.troveManager,market.musd],fromBlock:n,toBlock:n});
  blockLogs.forEach(checkLog);
  const events=(kind,address)=>{
    const event=parseAbi([EVENTS[kind]])[0],topic=toEventSelector(event);
    return receipt.logs.filter(l=>same(l.address,address)&&same(l.topics[0],topic)).map(log=>decodeEventLog({abi:[event],data:log.data,topics:log.topics,strict:true}).args);
  };
  const one=(kind,address=r.account)=>{const rows=events(kind,address);need(rows.length===1,`Exactly one ${kind} effect event required`);return rows[0];};
  const owned=event=>need(same(event.owner,r.tester),'Effect event owner mismatch');
  const transfers=events('transfer',market.musd);
  const transferred=(from,to)=>transfers.filter(e=>same(e.from,from)&&same(e.to,to)).reduce((sum,e)=>sum+e.value,0n);
  const minted=transferred(ZERO,r.account),burned=transferred(r.account,ZERO),fees=events('fee',r.account);
  if(!['open','increase'].includes(r.action))need(fees.length===0,'Exit/owner action unexpectedly charged a Coil fee');
  if(r.action==='create') {
    const event=one('created',d.factory);owned(event);need(same(event.account,r.account),'Created account effect mismatch');
    const previous=await read(d.factory,'accountOf(address) view returns (address)','accountOf',[r.tester],pre);
    need(same(previous,ZERO),'Create effect requires a previously absent account');
  } else if(r.action==='setGuard') {
    const event=one('guardSet');
    const expected=[...decoded.args];if(expected.length===3)expected.push(await read(r.account,'tipMezo() view returns (uint256)','tipMezo',[],pre));
    const fields=['floorCR','guardTargetCR','redemptionZone','tipMezo'];
    need(event.floorCR>0n && event.guardTargetCR>=event.floorCR,'Guard effect requires a positive valid configuration');
    for(let i=0;i<fields.length;i++) {
      const field=fields[i],actual=await read(r.account,`${field}() view returns (${field==='redemptionZone'?'uint32':'uint256'})`,field);
      need(BigInt(event[field])===BigInt(expected[i]) && BigInt(actual)===BigInt(expected[i]),`Guard configuration effect mismatch: ${field}`);
    }
  } else if(r.action==='claim') {
    const event=one('claimed');owned(event);need(event.amount>0n,'Claim effect must return positive collateral');
    need(tx.value===0n,'Claim proof contains unexpected native value');
    const [accountBefore,accountAfter,ownerBefore,ownerAfter]=await Promise.all([[r.account,pre],[r.account,n],[r.tester,pre],[r.tester,n]].map(([address,blockNumber])=>client.getBalance({address,blockNumber})));
    need(accountBefore===accountAfter && ownerAfter+receipt.gasUsed*receipt.effectiveGasPrice===ownerBefore+event.amount,'Claim effect does not match native balance delivery');
  } else {
    const position=async blockNumber=>{
      const [status,collateral,debt]=await Promise.all(['getTroveStatus','getTroveColl','getTroveDebt'].map(fn=>read(market.troveManager,`${fn}(address) view returns (uint256)`,fn,[r.account],blockNumber)));
      return {status:Number(status),collateral,debt};
    };
    const [before,after]=await Promise.all([position(pre),position(n)]);
    const updates=events('trove',market.borrowerOperations).filter(e=>same(e._borrower,r.account));
    need(updates.length>0,'Protocol position effect event missing');
    const last=updates.at(-1);
    need(last._coll===after.collateral && last._principal+last._interest===after.debt,'Protocol effect and historical position state differ');
    if(r.action==='open'||r.action==='increase') {
      need(after.status===1 && after.collateral>0n && after.debt>before.debt,'Open/increase effect must grow an active debt position');
      if(r.action==='open')need(before.status!==1 && updates.some(e=>Number(e._operation)===0),'Open effect requires a fresh position');
      else need(before.status===1 && updates.every(e=>Number(e._operation)!==0) && updates.some(e=>Number(e._operation)===2),'Increase effect requires an already active position');
      const event=one('loop');owned(event);
      need(event.targetCR===decoded.args[0] && event.collateral===after.collateral && event.debt===after.debt && event.cr>=event.targetCR,'Loop effect/state/target mismatch');
      need(fees.length>0 && fees.every(e=>e.grossMinted>0n && e.amount>0n && isAddress(e.recipient)),'Fee-bearing mint effect missing');
      need(minted>0n && minted===fees.reduce((sum,e)=>sum+e.grossMinted,0n),'Protocol MUSD mint does not match fee gross amount');
      const ceiling=decoded.args.length===3?Number(decoded.args[2]):50;
      const policy=await read(d.factory,'policy() view returns ((uint16 feeBps,address feeRecipient,bool opensPaused,uint256 maxCollateral,uint256 maxDebt))','policy',[],pre);
      const bps=Number(policy.feeBps);
      need(policy.opensPaused===false && Number.isInteger(bps) && bps>=1 && bps<=50 && bps<=ceiling && fees.every(e=>same(e.recipient,policy.feeRecipient) && e.amount===e.grossMinted*BigInt(bps)/10000n),'Fee effect differs from historical policy or accepted fee ceiling');
      for(const recipient of new Set(fees.map(e=>e.recipient.toLowerCase()))) {
        const amount=fees.filter(e=>same(e.recipient,recipient)).reduce((sum,e)=>sum+e.amount,0n);
        need(transferred(r.account,recipient)>=amount,'Coil fee transfer effect missing');
      }
    } else if(r.action==='close') {
      need(before.status===1 && after.status===2 && after.debt===0n && after.collateral===0n && Number(last._operation)===1,'Full close effect requires a closed-by-owner position');
      need(burned>0n,'Full close protocol repayment effect missing');
      if(decoded.functionName==='closeWithMUSD') {const event=one('closed');owned(event);need(event.ownerMUSD<=decoded.args[0],'Close exceeds owner MUSD maximum');}
      else {const event=one('unwound');owned(event);need(event.fractionWad===WAD && event.cr===2n**256n-1n,'Unwind effect did not fully close');}
    } else {
      need(before.status===1 && after.status===1 && after.debt<before.debt && Number(last._operation)===2 && burned>0n,'Repay/guard effect must reduce active protocol debt');
      if(r.action==='guard') {
        const event=one('guarded');need(same(event.caller,tx.from) && event.crAfter>event.crBefore && after.collateral<=before.collateral && after.collateral*before.debt>before.collateral*after.debt,'Guard effect must improve collateral ratio');
      } else {
        const event=one('repaid');owned(event);
        need(event.amount>0n && event.amount<=decoded.args[0] && event.amount===burned && before.debt-after.debt<=burned && before.collateral===after.collateral,'Repayment effect/amount/state mismatch');
        if(r.action==='repayRM') {
          const [priceBefore,priceAfter]=await Promise.all([pre,n].map(blockNumber=>read(market.priceFeed,'fetchPrice() view returns (uint256)','fetchPrice',[],blockNumber)));
          need(priceBefore>0n && priceBefore===priceAfter,'Recovery Mode proof requires an unchanged positive historical oracle price');
          need(await read(market.troveManager,'checkRecoveryMode(uint256) view returns (bool)','checkRecoveryMode',[priceBefore],pre)===true,'Recovery Mode was not active before repayment');
        }
      }
    }
  }
  const canonical=await client.getBlock({blockNumber:n});
  need(same(canonical.hash,block.hash),'Historical effect proof changed during verification');
}

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
  const decoded=decodeFunctionData({abi:parseAbi([`function ${signature}`]),data:tx.input});
  if(record.action==='close' && signature!=='closeWithMUSD(uint256)') need(decoded.args[0]===WAD,'A full close requires fractionWad = 1e18');
  await verifyEffects(client,deployment,record,receipt,tx,decoded);
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
  const inventory=deployment.contracts;
  need(inventory && Object.keys(inventory).length===Object.keys(SOURCE_FILES).length && Object.keys(SOURCE_FILES).every(role=>isAddress(inventory[role])),'Complete release component inventory required');
  need(same(inventory.CoilFactory,deployment.factory) && same(inventory.CoilAccount,implementation),'Factory/account component inventory mismatch');
  need(new Set(Object.values(inventory).map(a=>a.toLowerCase())).size===Object.keys(SOURCE_FILES).length,'Release component addresses must be distinct');
  need(isAddress(deployment.parkGovernor),'Intended park governor required for release verification');
  const market=marketFor(deployment.chainId),bindings={...market,park:inventory.CoilPark,sizer:inventory.FlashSizer};
  for(const [field,expected] of Object.entries(bindings)) {
    const actual=await client.readContract({address:implementation,abi:parseAbi([`function ${field}() view returns (address)`]),functionName:field});
    need(same(actual,expected),`Implementation market/component immutable mismatch: ${field}`);
  }
  for(const [field,expected] of Object.entries({asset:market.musd,governor:deployment.parkGovernor})) {
    const actual=await client.readContract({address:inventory.CoilPark,abi:parseAbi([`function ${field}() view returns (address)`]),functionName:field});
    need(same(actual,expected),`Park ${field} mismatch`);
  }
  const [token0,token1,btcIsToken0]=await Promise.all([
    ...['token0','token1'].map(field=>client.readContract({address:market.pool,abi:parseAbi([`function ${field}() view returns (address)`]),functionName:field})),
    client.readContract({address:implementation,abi:parseAbi(['function btcIsToken0() view returns (bool)']),functionName:'btcIsToken0'}),
  ]);
  need((same(token0,market.btc)&&same(token1,market.musd)||same(token0,market.musd)&&same(token1,market.btc)) && btcIsToken0===same(token0,market.btc),'Pool market/token-order immutable mismatch');
  const api=new URL(deployment.explorerUrl);api.hostname=`api.${api.hostname}`;
  const graph={CoilAccount:['CoilLegacy','CoilExit','CoilOwner'],CoilExit:['CoilLegacy'],CoilOwner:['CoilLegacy','CoilExit']},sourceHashes={};
  for(const [name,address] of Object.entries(inventory)) {
    const code=await client.getCode({address});need(code && code!=='0x',`Missing live contract ${name}`);
    const response=await fetchImpl(`${api.origin}/api/v2/smart-contracts/${address}`,{signal:AbortSignal.timeout(25000)});
    need(response.ok,`Explorer verification unavailable for ${name}`);
    const meta=await response.json();
    need(meta.is_verified===true && meta.is_fully_verified===true,`Full source verification pending for ${name}`);
    sourceHashes[name]=verifySource(name,meta);
    const expected=graph[name]||[],links=meta.external_libraries||[];
    need(Array.isArray(links) && links.length===expected.length,`Verified library link graph mismatch: ${name}`);
    for(const role of expected) need(links.filter(x=>x.name?.split(':').at(-1)===role && same(x.address_hash,inventory[role])).length===1,`Verified library link mismatch: ${name} -> ${role}`);
  }
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
    summary.onlineVerified=true;summary.effectsVerified=true;summary.historicalProof='isolated-block-archive';summary.readiness=online?'live-release-verified':'collected-from-rpc';
  }
  console.log(JSON.stringify(summary,null,2));
}
if(require.main===module) main(process.argv.slice(2)).catch(error=>{
  // SDK errors may include credential-bearing provider URLs; show only safe validator messages.
  const message=error?.shortMessage?'Live RPC verification failed; check the configured public provider':error.message;
  console.error(message);process.exitCode=1;
});
module.exports={ACTIONS,validateEvidence,verifyReceipt,verifyDeployment,verifyKeeper,verifyWeb};
