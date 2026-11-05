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
  for(const action of ['increase','setGuard','guard','claim','repay','close']) receipts.push(receipt(action,1));
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
  for(const action of ['increase','setGuard','guard','claim','repay','close']){
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
  const {d,e}=fixtures();const r=e.receipts[0];
  const client={
    getChainId:async()=>31611,
    getTransactionReceipt:async()=>({status:'success',blockNumber:101n,transactionHash:r.transactionHash}),
    getTransaction:async()=>({hash:r.transactionHash,to:d.factory,from:r.tester,input:toFunctionSelector('createAccount()')}),
    readContract:async({functionName})=>functionName==='accountOf'?r.account:functionName==='owner'?r.tester:d.factory,
  };
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
  const policy={feeBps:25,feeRecipient:address(18),opensPaused:false,maxCollateral:10n**18n,maxDebt:10000n*10n**18n};
  const client={getChainId:async()=>31611,readContract:async({functionName})=>functionName==='implementation'?d.implementation:functionName==='keeper'?d.keeper:policy,getCode:async({address:a,blockNumber})=>a===d.factory && blockNumber===99n?'0x':'0x1234'};
  const files={CoilFactory:'src/CoilFactory.sol',CoilAccount:'src/CoilAccount.sol',CoilLegacy:'src/libraries/CoilLegacy.sol',CoilExit:'src/libraries/CoilExit.sol',FlashSizer:'src/libraries/FlashMath.sol',CoilPark:'src/CoilPark.sol',CoilOwner:'src/libraries/CoilOwner.sol'};
  const fetchImpl=async url=>({ok:true,json:async()=>{
    const role=Object.entries(d.contracts).find(([,a])=>String(url).toLowerCase().includes(a.toLowerCase()))[0];
    return {is_verified:true,is_fully_verified:true,compiler_version:'v0.8.24+commit.e11b9ed9',compiler_settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},viaIR:true,metadata:{bytecodeHash:'none'}},source_code:fs.readFileSync(path.join(__dirname,'..',files[role]),'utf8'),additional_sources:[],external_libraries:['CoilLegacy','CoilExit','CoilOwner'].map(name=>({name,address_hash:d.contracts[name]}))};
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
