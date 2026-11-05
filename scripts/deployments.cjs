#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BLOCK = /^[1-9][0-9]*$/;
const CHAINS = [31611, 31612];
const ROLES = ['CoilFactory', 'CoilAccount', 'CoilLegacy', 'CoilExit', 'FlashSizer', 'CoilPark', 'CoilOwner'];
const OUTPUTS = ['web/src/lib/deployment.generated.ts', 'keeper/src/deployment.generated.ts'];
function isAddress(value) { return typeof value === 'string' && ADDRESS.test(value) && !/^0x0{40}$/i.test(value); }
function requireAddress(value, label) { if (!isAddress(value)) throw Error(`${label}: valid nonzero address required`); }
function publicUrl(value, label) {
  let url; try { url = new URL(value); } catch { throw Error(`${label}: invalid URL`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw Error(`${label}: public HTTPS URL without credentials/query required`);
}
function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !manifest.deployments || typeof manifest.deployments !== 'object') throw Error('deployment schemaVersion must be 1');
  if (Object.keys(manifest.deployments).sort().join(',') !== '31611,31612') throw Error('manifest must contain exactly chains 31611 and 31612');
  if (!manifest.retainedDeployments || Object.keys(manifest.retainedDeployments).sort().join(',') !== '31611,31612') throw Error('retained deployments must contain arrays for chains 31611 and 31612');
  for (const chainId of CHAINS) {
    const retained = manifest.retainedDeployments[String(chainId)];
    if (!Array.isArray(retained)) throw Error(`chain ${chainId}: retained deployments must be an array`);
    const seen = new Set();
    for (const d of retained) {
      if (!d || d.status === 'pending' || !isAddress(d.factory)) throw Error(`chain ${chainId}: retained deployment must identify a deployed factory`);
      const key = d.factory.toLowerCase();
      if (seen.has(key)) throw Error(`chain ${chainId}: duplicate retained factory`);
      seen.add(key);
    }
    const identities = new Map();
    for (const d of [manifest.deployments[String(chainId)], ...retained]) {
      if (d?.chainId !== chainId) throw Error(`chain ${chainId}: metadata chain mismatch`);
      if (typeof d.name !== 'string' || !d.name.trim()) throw Error(`chain ${chainId}: name required`);
      publicUrl(d.rpcUrl, `chain ${chainId} RPC`); publicUrl(d.explorerUrl, `chain ${chainId} explorer`);
      if (!['legacy','ready','pending'].includes(d.status)) throw Error(`chain ${chainId}: invalid deployment status`);
      const hasFactory = d.factory !== null; const hasBlock = d.deploymentBlock !== null;
      if (hasFactory !== hasBlock) throw Error(`chain ${chainId}: factory address and deployment block must be supplied together`);
      if (hasFactory) { requireAddress(d.factory, `chain ${chainId} factory address`); if (typeof d.deploymentBlock !== 'string' || !BLOCK.test(d.deploymentBlock)) throw Error(`chain ${chainId}: positive decimal string deployment block required`); }
      if (d.status !== 'pending' && !hasFactory) throw Error(`chain ${chainId}: ${d.status} factory address/block missing`);
      for (const field of ['implementation','keeper']) if (d[field] !== null) requireAddress(d[field], `chain ${chainId} ${field} address`);
      if (d.parkGovernor !== undefined) requireAddress(d.parkGovernor, `chain ${chainId} Park governor address`);
      if (!d.capabilities || Object.keys(d.capabilities).sort().join(',') !== 'coilFee,ownerActions,policy' || Object.values(d.capabilities).some(x => typeof x !== 'boolean')) throw Error(`chain ${chainId}: capabilities must be policy/coilFee/ownerActions booleans`);
      if (!d.contracts || Array.isArray(d.contracts) || typeof d.contracts !== 'object') throw Error(`chain ${chainId}: contracts inventory required`);
      for (const [name, address] of Object.entries(d.contracts)) requireAddress(address, `chain ${chainId} contract ${name}`);
      if (d.status === 'ready') {
        requireAddress(d.implementation, `chain ${chainId} ready implementation`); requireAddress(d.keeper, `chain ${chainId} ready keeper`);
        requireAddress(d.parkGovernor, `chain ${chainId} ready Park governor`);
        if (!Object.values(d.capabilities).every(Boolean)) throw Error(`chain ${chainId}: ready policy contract capabilities missing`);
        for (const role of ROLES) requireAddress(d.contracts[role], `chain ${chainId} contract ${role}`);
        if (d.contracts.CoilFactory.toLowerCase() !== d.factory.toLowerCase() || d.contracts.CoilAccount.toLowerCase() !== d.implementation.toLowerCase()) throw Error(`chain ${chainId}: factory/implementation contract inventory mismatch`);
      }
      if (hasFactory) {
        const key = d.factory.toLowerCase();
        const identity = JSON.stringify(canonical(d));
        if (identities.has(key) && identities.get(key) !== identity) throw Error(`chain ${chainId}: conflicting active/retained metadata for factory ${d.factory}`);
        identities.set(key, identity);
      }
    }
  }
  return manifest;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return isAddress(value) ? value.toLowerCase() : value;
}
function renderTypeScript(manifest) {
  validateManifest(manifest);
  return `// Generated by scripts/deployments.cjs. Edit deployments/manifest.json instead.\nexport type Deployment = {\n  chainId: number; name: string; rpcUrl: string; explorerUrl: string;\n  status: "legacy" | "ready" | "pending";\n  factory: \`0x\${string}\` | null; deploymentBlock: string | null;\n  implementation: \`0x\${string}\` | null; keeper: \`0x\${string}\` | null;\n  parkGovernor?: \`0x\${string}\`;\n  contracts: Record<string, \`0x\${string}\`>;\n  capabilities: { policy: boolean; coilFee: boolean; ownerActions: boolean };\n};\nexport const DEPLOYMENTS: Record<string, Deployment> = ${JSON.stringify(manifest.deployments, null, 2)};\nexport const RETAINED_DEPLOYMENTS: Record<string, Deployment[]> = ${JSON.stringify(manifest.retainedDeployments, null, 2)};\n`;
}
function loadManifest(root) { return validateManifest(JSON.parse(fs.readFileSync(path.join(root, 'deployments/manifest.json'), 'utf8'))); }
function generate(root) {
  const source = renderTypeScript(loadManifest(root));
  for (const file of OUTPUTS) { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, source); }
}
function checkGenerated(root) {
  const expected = renderTypeScript(loadManifest(root));
  for (const file of OUTPUTS) if (!fs.existsSync(path.join(root,file)) || fs.readFileSync(path.join(root,file),'utf8') !== expected) throw Error(`${file}: generated deployment metadata is stale; run node scripts/deployments.cjs --generate`);
}
function main(args) {
  const rootIndex = args.indexOf('--root'); const root = rootIndex >= 0 ? args[rootIndex+1] : path.resolve(__dirname, '..');
  if (!root) throw Error('--root requires a path');
  const modes = args.filter(x => ['--validate','--generate','--check'].includes(x));
  if (modes.length > 1) throw Error('choose one deployment command');
  const mode = modes[0] || '--check';
  if (mode === '--generate') generate(root); else if (mode === '--check') checkGenerated(root); else loadManifest(root);
  console.log(`deployment metadata ${mode.slice(2)}: ok`);
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { isAddress, validateManifest, renderTypeScript, loadManifest, generate, checkGenerated, OUTPUTS, ROLES };
