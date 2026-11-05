const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const address = n => `0x${n.toString(16).padStart(40,'0')}`;
const hash = n => `0x${n.toString(16).padStart(64,'0')}`;
function fixtures() {
  const d = { chainId:31611, name:'Mezo Testnet', rpcUrl:'https://rpc.test.mezo.org', explorerUrl:'https://explorer.test.mezo.org', status:'ready', factory:address(10), deploymentBlock:'100', implementation:address(11), keeper:address(12), capabilities:{policy:true,coilFee:true,ownerActions:true}, contracts:{} };
  let n = 1; const testers = [1,2,3].map(i=>({address:address(i),recruited:true,consentRecorded:true}));
  const receipts=[];
  function receipt(action,i) { const tx=hash(n++); return {action,transactionHash:tx,tester:address(i),account:address(20+i),chainId:31611,factory:d.factory,blockNumber:'101',status:'success',receiptPath:`receipts/${tx}.json`}; }
  for(let i=1;i<=3;i++) for(const action of ['create','open']) receipts.push(receipt(action,i));
  for(const action of ['increase','setGuard','guard','claim','repay','repayRM','close']) receipts.push(receipt(action,1));
  return {d,e:{schemaVersion:1,chainId:31611,factory:d.factory,deploymentBlock:'100',testers,receipts}};
}
function api() { return require('./release-evidence.cjs'); }

test('valid offline evidence is explicitly not a verified live release',()=>{
  const {d,e}=fixtures();e.onlineVerified=true;
  const result=api().validateEvidence(d,e);
  assert.equal(result.testers,3);assert.equal(result.onlineVerified,false);assert.equal(result.readiness,'offline-validated');
});
test('empty placeholder ledger cannot count as release proof',()=>{
  const {d,e}=fixtures();e.factory=null;e.deploymentBlock=null;e.testers=[];e.receipts=[];
  assert.throws(()=>api().validateEvidence(d,e),/factory|pending|proof|tester/i);
});
test('legacy or pending deployment cannot be called post-P0 ready',()=>{
  const {d,e}=fixtures();d.status='legacy';assert.throws(()=>api().validateEvidence(d,e),/ready|legacy/i);
});
test('three unique consenting recruited tester wallets are required',()=>{
  for(const change of [e=>e.testers.pop(),e=>e.testers[2].address=e.testers[0].address,e=>e.testers[1].consentRecorded=false,e=>e.testers[0].recruited=false]){
    const {d,e}=fixtures();change(e);assert.throws(()=>api().validateEvidence(d,e),/tester|consent|recruit|distinct/i);
  }
});
test('each tester needs their own factory create and open activity',()=>{
  const {d,e}=fixtures();e.receipts=e.receipts.filter(r=>r.tester!==address(3));
  assert.throws(()=>api().validateEvidence(d,e),/tester|create|open/i);
});
test('every required PRD action needs successful chain-labelled proof',()=>{
  for(const action of ['increase','setGuard','guard','claim','repay','repayRM','close']){
    const {d,e}=fixtures();e.receipts=e.receipts.filter(r=>r.action!==action);assert.throws(()=>api().validateEvidence(d,e),new RegExp(action,'i'));
  }
});
test('mismatched chain, factory, block, caller, status and duplicate hashes fail',()=>{
  for(const change of [e=>e.receipts[0].chainId=31612,e=>e.receipts[0].factory=address(99),e=>e.receipts[0].blockNumber='99',e=>e.receipts[0].tester=address(99),e=>e.receipts[0].status='reverted',e=>e.receipts[1].transactionHash=e.receipts[0].transactionHash]){
    const {d,e}=fixtures();change(e);assert.throws(()=>api().validateEvidence(d,e));
  }
});
test('receipt evidence path cannot read arbitrary local files',()=>{
  const {d,e}=fixtures();e.receipts[0].receiptPath='../../.env';assert.throws(()=>api().validateEvidence(d,e),/path/i);
});
test('online proof cannot trust a self-declared success over the RPC receipt',async()=>{
  const {d,e}=fixtures();
  const client={getTransactionReceipt:async()=>({status:'reverted',blockNumber:101n}),getTransaction:async()=>({})};
  await assert.rejects(()=>api().verifyReceipt(client,d,e.receipts[0]),/revert|success/i);
});

test('live verification binds transaction action, chain, owner and factory account',async()=>{
  const {toFunctionSelector}=require('../keeper/node_modules/viem');
  const {d,r,client}=effectFixture('create');
  const result=await api().verifyReceipt(client,d,r);assert.equal(result.status,'success');
  for(const patch of [
    {getChainId:async()=>31612},
    {getTransaction:async()=>({hash:r.transactionHash,to:d.factory,from:address(99),input:toFunctionSelector('createAccount()')})},
    {getTransaction:async()=>({hash:r.transactionHash,to:d.factory,from:r.tester,input:toFunctionSelector('transferOwnership(address)')})},
    {readContract:async()=>address(99)},
    {getTransactionReceipt:async()=>({status:'success',blockNumber:99n,transactionHash:r.transactionHash})},
  ])await assert.rejects(()=>api().verifyReceipt({...client,...patch},d,r));
});

test('a partial unwind cannot be presented as a full close',async()=>{
  const {encodeFunctionData,parseAbi}=require('../keeper/node_modules/viem');
  const {d,e}=fixtures();const r=e.receipts.find(x=>x.action==='close');
  const client={getChainId:async()=>31611,getTransactionReceipt:async()=>({status:'success',blockNumber:101n,transactionHash:r.transactionHash}),getTransaction:async()=>({hash:r.transactionHash,to:r.account,from:r.tester,input:encodeFunctionData({abi:parseAbi(['function unwind(uint256 fractionWad)']),functionName:'unwind',args:[5n*10n**17n]})}),readContract:async({functionName})=>functionName==='accountOf'?r.account:functionName==='owner'?r.tester:d.factory};
  await assert.rejects(()=>api().verifyReceipt(client,d,r),/full close|fraction/i);
});

function liveDeploymentFixture() {
  const {d}=fixtures();
  d.contracts={CoilFactory:d.factory,CoilAccount:d.implementation,CoilLegacy:address(13),CoilExit:address(14),FlashSizer:address(15),CoilPark:address(16),CoilOwner:address(17)};
  d.parkGovernor=address(19);
  const policy={feeBps:25,feeRecipient:address(18),opensPaused:false,maxCollateral:10n**18n,maxDebt:10000n*10n**18n};
  const client={getChainId:async()=>31611,readContract:async({functionName})=>({implementation:d.implementation,keeper:d.keeper,policy,...MARKET,park:d.contracts.CoilPark,sizer:d.contracts.FlashSizer,asset:MARKET.musd,governor:d.parkGovernor,btcIsToken0:false,token0:MARKET.musd,token1:MARKET.btc})[functionName],getCode:async({address:a,blockNumber})=>a===d.factory && blockNumber===99n?'0x':'0x1234'};
  const files={CoilFactory:'src/CoilFactory.sol',CoilAccount:'src/CoilAccount.sol',CoilLegacy:'src/libraries/CoilLegacy.sol',CoilExit:'src/libraries/CoilExit.sol',FlashSizer:'src/libraries/FlashMath.sol',CoilPark:'src/CoilPark.sol',CoilOwner:'src/libraries/CoilOwner.sol'};
  const fetchImpl=async url=>({ok:true,json:async()=>{
    const role=Object.entries(d.contracts).find(([,a])=>String(url).toLowerCase().includes(a.toLowerCase()))[0];
    return {is_verified:true,is_fully_verified:true,compiler_version:'v0.8.24+commit.e11b9ed9',compiler_settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},viaIR:true,metadata:{bytecodeHash:'none'}},source_code:fs.readFileSync(path.join(__dirname,'..',files[role]),'utf8'),additional_sources:[],external_libraries:({CoilAccount:['CoilLegacy','CoilExit','CoilOwner'],CoilExit:['CoilLegacy'],CoilOwner:['CoilLegacy','CoilExit']}[role]||[]).map(name=>({name,address_hash:d.contracts[name]}))};
  }});
  return {d,policy,client,fetchImpl};
}
test('live deployment verification pins creation block and operational policy',async()=>{
  const {d,client,policy,fetchImpl}=liveDeploymentFixture();
  await api().verifyDeployment(client,d,{fetchImpl});
  await assert.rejects(()=>api().verifyDeployment({...client,getCode:async()=> '0x1234'},d,{fetchImpl}),/block|creation/i);
  for(const patch of [{opensPaused:true},{maxDebt:0n},{maxCollateral:0n},{feeBps:51},{feeRecipient:address(0)}]){
    const bad={...client,readContract:async q=>q.functionName==='policy'?{...policy,...patch}:client.readContract(q)};
    await assert.rejects(()=>api().verifyDeployment(bad,d,{fetchImpl}),/policy|pause|limit|fee/i);
  }
});
test('a verified unrelated source or different compiler cannot count as this release',async()=>{
  const {d,client,fetchImpl}=liveDeploymentFixture();
  for(const mutate of [m=>m.source_code+='\ncontract Unrelated {}',m=>m.compiler_version='v0.8.25+commit.fake',m=>m.compiler_settings.optimizer.runs=1,m=>m.additional_sources=[{file_path:'../../.env',source_code:'secret'}]]){
    const badFetch=async url=>{const response=await fetchImpl(url),meta=await response.json();mutate(meta);return{ok:true,json:async()=>meta}};
    await assert.rejects(()=>api().verifyDeployment(client,d,{fetchImpl:badFetch}),/source|compiler|setting/i);
  }
});
test('keeper proof needs a recent heartbeat from the configured signer',async()=>{
  const {d}=fixtures();
  const client={getBlockNumber:async()=>10000n,getLogs:async()=>[{args:{keeper:d.keeper,timestamp:1000n},transactionHash:hash(99)}]};
  const good=await api().verifyKeeper(client,d,{nowSeconds:1010});assert.equal(good.ageSeconds,10);
  for(const logs of [[],[{args:{keeper:address(99),timestamp:1000n}}],[{args:{keeper:d.keeper,timestamp:1n}}],[{args:{keeper:d.keeper,timestamp:2000n}}]]){
    await assert.rejects(()=>api().verifyKeeper({...client,getLogs:async()=>logs},d,{nowSeconds:1010}),/heartbeat|keeper|future/i);
  }
});

// Synthetic RPC fixtures only: these are regression tests, never public release evidence.
const WAD=10n**18n;
const MARKET={
  borrowerOperations:'0xCdF7028ceAB81fA0C6971208e83fa7872994beE5',troveManager:'0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
  sortedTroves:'0x722E4D24FD6Ff8b0AC679450F3D91294607268fA',hintHelpers:'0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6',
  priceFeed:'0x86bCF0841622a5dAC14A313a15f96A95421b9366',musd:'0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',
  btc:'0x7b7C000000000000000000000000000000000000',mezo:'0x7B7c000000000000000000000000000000000001',
  router:'0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9',poolFactory:'0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A',pool:'0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9',
};
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
function effectFixture(action) {
  const {encodeFunctionData,parseAbi,encodeEventTopics,encodeAbiParameters}=require('../keeper/node_modules/viem');
  const {d,e}=fixtures();
  const r=e.receipts.find(x=>x.action===action)||{...e.receipts.find(x=>x.action==='repay'),action};
  const f={d,r,before:{status:1,collateral:WAD,debt:5000n*WAD},after:{status:1,collateral:WAD,debt:4900n*WAD},recovery:action==='repayRM',price:10000n*WAD,extraBlockLogs:[]};
  const input={create:['createAccount()',[]],open:['flashLoop(uint256,uint256,uint16)',[15n*WAD/10n,50n,25]],increase:['flashLoop(uint256,uint256,uint16)',[15n*WAD/10n,50n,25]],setGuard:['setGuard(uint256,uint256,uint32,uint256)',[15n*WAD/10n,2n*WAD,0,0n]],guard:['guard()',[]],claim:['claimCollateral()',[]],repay:['repayWithMUSD(uint256)',[100n*WAD]],repayRM:['repayWithMUSD(uint256)',[100n*WAD]],close:['closeWithMUSD(uint256)',[10000n*WAD]]}[action];
  f.tx={hash:r.transactionHash,to:action==='create'?d.factory:r.account,from:action==='guard'?address(30):r.tester,blockNumber:101n,blockHash:hash(101),transactionIndex:0,value:0n,input:encodeFunctionData({abi:parseAbi([`function ${input[0]}`]),functionName:input[0].split('(')[0],args:input[1]})};
  f.receipt={status:'success',blockNumber:101n,blockHash:hash(101),transactionHash:r.transactionHash,transactionIndex:0,gasUsed:21000n,effectiveGasPrice:1n,logs:[]};
  f.log=(kind,emitter,args)=>{
    const item=parseAbi([EVENTS[kind]])[0];
    const nonIndexed=item.inputs.filter(x=>!x.indexed);
    return {address:emitter,topics:encodeEventTopics({abi:[item],eventName:item.name,args}),data:encodeAbiParameters(nonIndexed,nonIndexed.map(x=>args[x.name])),transactionHash:r.transactionHash,blockHash:hash(101),blockNumber:101n,logIndex:f.receipt.logs.length,removed:false};
  };
  const emit=(...args)=>f.receipt.logs.push(f.log(...args));
  const update=operation=>emit('trove',MARKET.borrowerOperations,{_borrower:r.account,_principal:f.after.debt,_interest:0n,_coll:f.after.collateral,_stake:f.after.collateral,_interestRate:0,_lastInterestUpdateTime:1000n,_operation:operation});
  if(action==='create') emit('created',d.factory,{owner:r.tester,account:r.account});
  if(action==='open'||action==='increase') {
    if(action==='open')f.before={status:0,collateral:0n,debt:0n};
    f.after={status:1,collateral:3n*WAD,debt:action==='open'?10210n*WAD:15011n*WAD};
    emit('transfer',MARKET.musd,{from:address(0),to:r.account,value:10000n*WAD});
    emit('fee',r.account,{recipient:address(18),grossMinted:10000n*WAD,amount:25n*WAD});
    emit('transfer',MARKET.musd,{from:r.account,to:address(18),value:25n*WAD});
    update(action==='open'?0:2);
    emit('loop',r.account,{owner:r.tester,targetCR:15n*WAD/10n,collateral:f.after.collateral,debt:f.after.debt,cr:f.after.collateral*f.price/f.after.debt});
  }
  if(action==='setGuard')emit('guardSet',r.account,{floorCR:15n*WAD/10n,guardTargetCR:2n*WAD,redemptionZone:0,tipMezo:0n});
  if(action==='guard') {
    f.after={status:1,collateral:9n*WAD/10n,debt:4000n*WAD};update(2);
    emit('transfer',MARKET.musd,{from:r.account,to:address(0),value:1000n*WAD});
    emit('guarded',r.account,{caller:f.tx.from,crBefore:2n*WAD,crAfter:225n*WAD/100n,tip:0n});
  }
  if(action==='repay'||action==='repayRM') {update(2);emit('transfer',MARKET.musd,{from:r.account,to:address(0),value:100n*WAD});emit('repaid',r.account,{owner:r.tester,amount:100n*WAD});}
  if(action==='claim') {f.before=f.after={status:3,collateral:0n,debt:0n};emit('claimed',r.account,{owner:r.tester,amount:WAD/10n});}
  if(action==='close') {f.after={status:2,collateral:0n,debt:0n};update(1);emit('transfer',MARKET.musd,{from:r.account,to:address(0),value:4800n*WAD});emit('closed',r.account,{owner:r.tester,ownerMUSD:4800n*WAD});}
  f.client={
    getChainId:async()=>d.chainId,getTransactionReceipt:async()=>f.receipt,getTransaction:async()=>f.tx,
    getBlock:async({blockNumber})=>({number:blockNumber,hash:hash(Number(blockNumber)),parentHash:hash(Number(blockNumber)-1),transactions:blockNumber===101n?[r.transactionHash]:[],timestamp:blockNumber===101n?1000n:999n}),
    getLogs:async()=>[...f.receipt.logs,...f.extraBlockLogs],
    getBalance:async({address:a,blockNumber})=>a.toLowerCase()===r.account.toLowerCase()?17n:100n*WAD+(blockNumber===101n?WAD/10n-21000n:0n),
    readContract:async({address:a,functionName,blockNumber})=>{
      const pre=blockNumber===100n,st=pre?f.before:f.after;
      if(functionName==='accountOf')return action==='create'&&pre?address(0):r.account;
      if(functionName==='owner')return r.tester;if(functionName==='factory')return d.factory;
      if(functionName==='getTroveStatus')return st.status;if(functionName==='getTroveColl')return st.collateral;if(functionName==='getTroveDebt')return st.debt;
      if(functionName==='policy')return {feeBps:25,feeRecipient:address(18),opensPaused:false,maxCollateral:10n*WAD,maxDebt:100000n*WAD};
      if(functionName==='fetchPrice')return f.price;if(functionName==='checkRecoveryMode')return f.recovery;
      if(functionName==='floorCR')return 15n*WAD/10n;if(functionName==='guardTargetCR')return 2n*WAD;if(functionName==='redemptionZone')return 0;if(functionName==='tipMezo')return 0n;
      throw Error(`Unexpected synthetic read ${a} ${functionName}`);
    },
  };
  return f;
}

test('effects: successful selector-only no-op guard and repay are rejected',async()=>{
  for(const action of ['guard','repay']) {const f=effectFixture(action);f.receipt.logs=[];f.after=f.before;await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/effect|event|improv|repay|guard/i);}
});
test('effects: full-close selector and claimed success cannot cover a still-active position',async()=>{
  const f=effectFixture('close');f.after={...f.before};await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/clos|effect|state/i);
});
test('effects: a second fresh open cannot be labelled as increase',async()=>{
  const f=effectFixture('open');f.r.action='increase';await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/increase|active|open/i);
});
test('effects: exact-account positive semantic outcomes pass for every action',async()=>{
  for(const action of ['create','open','increase','setGuard','guard','claim','repay','repayRM','close']) {
    const f=effectFixture(action);assert.equal((await api().verifyReceipt(f.client,f.d,f.r)).status,'success',action);
  }
});
test('effects: foreign clone events and foreign protocol mint/burn logs cannot prove an action',async()=>{
  for(const action of ['open','increase','guard','repay','claim','close']) {
    const f=effectFixture(action);f.receipt.logs=f.receipt.logs.map(l=>({...l,address:address(99)}));
    await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/event|effect|mint|clos|repay|claim|guard/i);
  }
});
test('effects: normal repayment cannot be relabelled as Recovery Mode repayment',async()=>{
  const f=effectFixture('repayRM');f.recovery=false;await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/recovery/i);
});
test('effects: RM proof fails closed for nonisolated blocks or unavailable historical state',async()=>{
  const f=effectFixture('repayRM');
  await assert.rejects(()=>api().verifyReceipt({...f.client,getBlock:async q=>({...await f.client.getBlock(q),transactions:[hash(77),f.r.transactionHash]})},f.d,f.r),/isolat|index|order/i);
  await assert.rejects(()=>api().verifyReceipt({...f.client,readContract:async q=>{if(q.blockNumber===100n)throw Error('historical state unavailable');return f.client.readContract(q);}},f.d,f.r),/historical/i);
});
test('effects: another transaction touching the same position prevents block-state attribution',async()=>{
  const f=effectFixture('repay');f.extraBlockLogs=[{...f.receipt.logs[0],transactionHash:hash(99)}];
  await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/attribut|transaction|same block/i);
});
test('deployment bindings: verified substitute Park or Sizer is rejected',async()=>{
  for(const field of ['park','sizer']) {
    const f=liveDeploymentFixture();const client={...f.client,readContract:async q=>q.functionName===field?address(999):f.client.readContract(q)};
    await assert.rejects(()=>api().verifyDeployment(client,f.d,{fetchImpl:f.fetchImpl}),/park|sizer|component|immutable/i);
  }
});
test('deployment bindings: every protocol immutable, park asset and governor is pinned',async()=>{
  for(const field of [...Object.keys(MARKET),'asset','governor']) {
    const f=liveDeploymentFixture();const client={...f.client,readContract:async q=>q.functionName===field?address(999):f.client.readContract(q)};
    await assert.rejects(()=>api().verifyDeployment(client,f.d,{fetchImpl:f.fetchImpl}),/market|protocol|immutable|asset|governor/i);
  }
});
test('deployment bindings: Exit and Owner transitive library substitutions are rejected',async()=>{
  for(const [role,dependency] of [['CoilExit','CoilLegacy'],['CoilOwner','CoilLegacy'],['CoilOwner','CoilExit']]) {
    const f=liveDeploymentFixture();const fetchImpl=async url=>{const response=await f.fetchImpl(url),meta=await response.json();if(url.endsWith(f.d.contracts[role]))meta.external_libraries=meta.external_libraries.map(x=>x.name===dependency?{...x,address_hash:address(999)}:x);return {ok:true,json:async()=>meta};};
    await assert.rejects(()=>api().verifyDeployment(f.client,f.d,{fetchImpl}),/library|link/i);
  }
});

test('effects: a Guarded event cannot hide a worsened position',async()=>{
  const f=effectFixture('guard');f.after.collateral=WAD/10n;
  f.receipt.logs[0]=f.log('trove',MARKET.borrowerOperations,{_borrower:f.r.account,_principal:f.after.debt,_interest:0n,_coll:f.after.collateral,_stake:f.after.collateral,_interestRate:0,_lastInterestUpdateTime:1000n,_operation:2});
  await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/guard|ratio|improv/i);
});
test('effects: protocol logs must use the selected market and exact borrower',async()=>{
  for(const action of ['open','increase','guard','repay','close'])for(const kind of ['transfer','trove']) {
    const f=effectFixture(action),emitter=kind==='transfer'?MARKET.musd:MARKET.borrowerOperations;
    f.receipt.logs=f.receipt.logs.map(l=>l.address===emitter?{...l,address:address(999)}:l);
    await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/effect|protocol|mint/i);
  }
  const f=effectFixture('repay');f.receipt.logs[0]=f.log('trove',MARKET.borrowerOperations,{_borrower:address(999),_principal:f.after.debt,_interest:0n,_coll:f.after.collateral,_stake:f.after.collateral,_interestRate:0,_lastInterestUpdateTime:1000n,_operation:2});
  await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/effect|protocol/i);
});
test('effects: zero repayment events and forged parsed arguments never prove repayment',async()=>{
  const f=effectFixture('repay');
  f.receipt.logs[2]={...f.log('repaid',f.r.account,{owner:f.r.tester,amount:0n}),args:{owner:f.r.tester,amount:100n*WAD}};
  await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/repayment|amount/i);
});
test('effects: fee mint totals, transfer delivery and calldata ceilings are enforced',async()=>{
  const {encodeFunctionData,parseAbi}=require('../keeper/node_modules/viem');
  for(const mutate of [
    f=>f.tx.input=encodeFunctionData({abi:parseAbi(['function flashLoop(uint256,uint256,uint16)']),functionName:'flashLoop',args:[15n*WAD/10n,50n,10]}),
    f=>f.receipt.logs[0]=f.log('transfer',MARKET.musd,{from:address(0),to:f.r.account,value:9999n*WAD}),
    f=>f.receipt.logs[2]=f.log('transfer',MARKET.musd,{from:f.r.account,to:address(19),value:25n*WAD}),
  ]) {const f=effectFixture('open');mutate(f);await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/fee|mint/i);}
});
test('effects: claim event must represent positive native delivery to the owner',async()=>{
  const f=effectFixture('claim');
  await assert.rejects(()=>api().verifyReceipt({...f.client,getBalance:async()=>100n*WAD},f.d,f.r),/claim|delivery/i);
  f.receipt.logs=[f.log('claimed',f.r.account,{owner:f.r.tester,amount:0n})];
  await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/claim|positive/i);
});
test('effects: successful full unwind and preserved legacy guard tip remain valid',async()=>{
  const {encodeFunctionData,parseAbi}=require('../keeper/node_modules/viem');
  for(const method of ['unwind','flashUnwind']) {
    const f=effectFixture('close');f.tx.input=encodeFunctionData({abi:parseAbi([`function ${method}(uint256)`]),functionName:method,args:[WAD]});
    f.receipt.logs[2]=f.log('unwound',f.r.account,{owner:f.r.tester,fractionWad:WAD,cr:2n**256n-1n});
    assert.equal((await api().verifyReceipt(f.client,f.d,f.r)).status,'success');
    f.after=f.before;await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/state|close|effect/i);
  }
  const f=effectFixture('setGuard');f.tx.input=encodeFunctionData({abi:parseAbi(['function setGuard(uint256,uint256,uint32)']),functionName:'setGuard',args:[15n*WAD/10n,2n*WAD,0]});
  f.receipt.logs=[f.log('guardSet',f.r.account,{floorCR:15n*WAD/10n,guardTargetCR:2n*WAD,redemptionZone:0,tipMezo:123n})];
  const read=f.client.readContract;f.client.readContract=q=>q.functionName==='tipMezo'?123n:read(q);
  assert.equal((await api().verifyReceipt(f.client,f.d,f.r)).status,'success');
});
test('effects: RM proof rejects changed or zero prices despite a true mode flag',async()=>{
  for(const price of [0n,9000n*WAD]) {
    const f=effectFixture('repayRM'),read=f.client.readContract;
    f.client.readContract=q=>q.functionName==='fetchPrice'&&q.blockNumber===101n?price:read(q);
    await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/recovery|price/i);
  }
});
test('effects: all transition proofs fail closed on nonisolated or reorged blocks',async()=>{
  for(const action of ['create','open','increase','setGuard','guard','claim','repay','close']) {
    const f=effectFixture(action),get=f.client.getBlock;
    f.client.getBlock=async q=>({...await get(q),transactions:[f.r.transactionHash,hash(999)]});
    await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/isolated/i);
  }
  const f=effectFixture('repay'),get=f.client.getBlock;let reads=0;
  f.client.getBlock=async q=>q.blockNumber===101n&&++reads>1?{...await get(q),hash:hash(999)}:get(q);
  await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/changed/i);
});
test('deployment bindings: missing or duplicated components, governor and links fail closed',async()=>{
  for(const mutate of [f=>delete f.d.parkGovernor,f=>delete f.d.contracts.CoilPark,f=>f.d.contracts.CoilPark=f.d.contracts.FlashSizer,f=>f.d.contracts.CoilAccount=address(999)]) {
    const f=liveDeploymentFixture();mutate(f);await assert.rejects(()=>api().verifyDeployment(f.client,f.d,{fetchImpl:f.fetchImpl}),/component|inventory|governor/i);
  }
  for(const mutate of [m=>m.external_libraries.pop(),m=>m.external_libraries.push(m.external_libraries[0]),m=>m.external_libraries[0].name='Unrelated']) {
    const f=liveDeploymentFixture(),fetchImpl=async url=>{const response=await f.fetchImpl(url),meta=await response.json();if(url.endsWith(f.d.implementation))mutate(meta);return {ok:true,json:async()=>meta};};
    await assert.rejects(()=>api().verifyDeployment(f.client,f.d,{fetchImpl}),/library|link/i);
  }
});
test('deployment bindings: token pair and immutable ordering must match the selected pool',async()=>{
  for(const field of ['token0','token1','btcIsToken0']) {
    const f=liveDeploymentFixture(),read=f.client.readContract;f.client.readContract=q=>q.functionName===field?(field==='btcIsToken0'?true:address(999)):read(q);
    await assert.rejects(()=>api().verifyDeployment(f.client,f.d,{fetchImpl:f.fetchImpl}),/pool|market|order/i);
  }
});


test('effects: fee events are bound to the historical opening policy, not current policy',async()=>{
  for(const patch of [{feeBps:26},{feeRecipient:address(99)},{opensPaused:true}]) {
    const f=effectFixture('open'),read=f.client.readContract;
    f.client.readContract=async q=>q.functionName==='policy'&&q.blockNumber===100n?{...await read(q),...patch}:read(q);
    await assert.rejects(()=>api().verifyReceipt(f.client,f.d,f.r),/fee|policy/i);
  }
  const f=effectFixture('open'),read=f.client.readContract;
  f.client.readContract=async q=>q.functionName==='policy'&&q.blockNumber===101n?{...await read(q),feeBps:49,feeRecipient:address(99)}:read(q);
  assert.equal((await api().verifyReceipt(f.client,f.d,f.r)).status,'success');
});
