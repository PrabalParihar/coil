# Coil Labs

BTC leverage on Mezo through MUSD borrowing and Mezo Pools. An owner-controlled account holds the trove; permissionless `guard()` can reduce risk and earn a funded MEZO tip after a real ratio improvement.

**Release candidate, unaudited.** Source changes are separate from an activated public release. The active matsnet factory is the paused Wave 2 completion release [`0x339ef0116e17BA42987c1E2E380Af59B38f62064`](https://explorer.test.mezo.org/address/0x339ef0116e17BA42987c1E2E380Af59B38f62064), block **16708730**, chain **31611**, from main `7fd588a`. Opening is paused. The previous production factory [`0xff3335576f998EE872596d4EB7ABECb71a0D5BC8`](https://explorer.test.mezo.org/address/0xff3335576f998EE872596d4EB7ABECb71a0D5BC8), block **16408315**, stays retained; its clones are not upgraded. Indexed full verification, funded feature receipts and recruited-tester evidence remain pending. Mainnet go-live is gated.

- Public app: https://coil.up.railway.app
- Public history: https://coil.up.railway.app/guard and https://coil.up.railway.app/stats
- Code: https://github.com/PrabalParihar/coil
- Release facts and historical receipts: [DEPLOYMENTS.md](DEPLOYMENTS.md)
- Submission draft, deck and 112-second pitch: [docs/SUBMISSION.md](docs/SUBMISSION.md)

## Product and release behavior

`createAccount()` gives an owner an EIP-1167 clone. The clone, rather than the wallet, owns the MUSD trove. `flashLoop` borrows BTC from the MUSD/BTC pool, opens or increases the trove, and repays the pool with minted MUSD in one atomic operation when liquidity and policy allow. Leverage is a result of collateral ratio, fees and available depth; historical 4× testnet execution is not a promise for a thin mainnet pool. The router fallback remains limited to two swaps because Mezo allows 20 native-precompile calls per transaction.

The completion release introduces:

| Surface | Release behavior |
| --- | --- |
| Coil fee | Factory-owner policy, default **25 bps (0.25%)**, permitted **1–50 bps**, maximum **50 bps (0.50%)**. Charged only on newly minted MUSD in successful open/increase borrowing. |
| Quote acceptance | Gross minted MUSD and Coil fee are separate; flash gross-up includes the fee in debt and CR. Transactions enforce the owner's accepted maximum fee. Legacy two-argument open selectors accept up to 50 bps. |
| Rescue and exits | **Zero Coil fee** on guard, reserve repayment, funded owner repayment/close, delever, unwind and surplus claim. Pool/protocol costs and gas are separate. |
| Oracle bounds | Planned and actual pool fills obey the same PriceMin oracle snapshot and owner bound, including flash callbacks and owner flash close. A pool quote does not widen the bound. |
| Owner actions | Surplus claim forwards only recovered collateral; MUSD-funded repayment reduces debt; direct MUSD-funded close is available only when Mezo permits it. Approve the account, not CoilPark. |
| Recovery Mode | New leverage is blocked. Safe pure MUSD repayment remains available subject to the debt floor. Full close remains protocol-gated; the owner submits it once permitted. There is no queued automatic close. |
| Pause and caps | New factories start paused with unset limits. Owner sets finite nonzero BTC-collateral and total-MUSD-debt limits before unpausing. Guardian may pause; only owner unpauses. Risk-reducing actions and direct collateral top-up remain available. |
| Guard | Funded reserve first; an unsafe sale with no improvement returns false without a tip. Tips require a genuine oracle-measured CR increase, are balance-capped and pay at most once per block. |
| Keeper | Simulation before submission, bounded retries/backoff, public scan freshness and authenticated configured-keeper heartbeats on new factories. Monitoring mode is labelled. |

These describe the completion release contract, not capabilities retroactively added to existing accounts. See [SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md) for exact limits and trust assumptions.

## Local development

Use Foundry, Solidity 0.8.24 and Node 22. The compiler target is Shanghai, optimizer 200 and via IR. Fork tests may require access to the configured Mezo RPC.

```bash
forge build --sizes
forge test
```

```bash
cd keeper
npm ci
npm run typecheck
npm run check
npm start
```

The keeper defaults to read-only simulation. Enable execution only with the selected chain's validated deployment configuration and an operator-provided keeper identity. Do not put keys, bot tokens or private RPC credentials into source, build arguments, status responses or submission artifacts.

```bash
cd web
npm ci
npm run dev
npm run build
```

The Next.js app exports static files. Railway uses the Docker/Nginx image with service-assigned `PORT`, extensionless routes and actual 404 responses. Use the service's supported root-directory and health settings. Rebuild/redeploying the web and keeper is a separate operation from editing this repository.

Use the canonical [public deployment manifest](deployments/manifest.json) for chain, factory, deployment block, libraries, keeper and capabilities. Override factory **and matching deployment block together**. Mainnet market reads do not enable mainnet transactions. Wallet and transaction-client chain IDs must match the selected supported chain. OrangeKit remains the fallback while the pinned Passport package is incompatible. WalletConnect needs a valid public project ID; it must not advertise a fabricated one. Savings/gauge integrations stay disabled without confirmed chain-specific addresses.

## Deployment configuration and release tools

Edit [deployments/manifest.json](deployments/manifest.json), then regenerate the checked-in copies consumed by web and keeper. Do not edit `web/src/lib/deployment.generated.ts` or `keeper/src/deployment.generated.ts` directly.

```bash
node scripts/deployments.cjs --generate
node scripts/deployments.cjs --check
```

Manifest fields include `chainId`, `status` (`legacy`, `pending`, `ready`), `factory`, decimal-string `deploymentBlock`, `implementation`, expected `keeper`, the `contracts` inventory and `capabilities` (`policy`, `coilFee`, `ownerActions`). The `retainedDeployments` catalog preserves old generations for owner selection and separately pinned keeper services. A ready release needs all seven components, including linked `CoilOwner`, plus its actual `parkGovernor`. The active matsnet entry is that paused completion release; mainnet is pending.

Keeper configuration uses `COIL_CHAIN_ID`, and paired `COIL_FACTORY` / `COIL_FACTORY_DEPLOY_BLOCK` overrides. The web uses `NEXT_PUBLIC_COIL_CHAIN_ID` and paired `NEXT_PUBLIC_COIL_FACTORY` / `NEXT_PUBLIC_COIL_FACTORY_DEPLOY_BLOCK`. Mainnet keeper execution additionally needs a ready known manifest deployment and `COIL_MAINNET_ENABLED=true`; web writes need `NEXT_PUBLIC_COIL_ENABLE_MAINNET_WRITES=true` with the configured ready deployment. These flags do not grant go-live approval.

Set optional `NEXT_PUBLIC_KEEPER_STATUS_URL` to the keeper's public HTTPS `/status` URL to show backend scan freshness, execution mode and safe counters alongside chain heartbeat evidence. The endpoint must be public HTTPS without credentials, query, fragment or custom port. Absent or invalid service data remains labelled separately; it does not create a healthy state. The UI validates selected chain/factory/expected keeper and uses chain evidence when the service is unavailable. On Railway, expose the keeper's assigned `PORT`; use `/health` for readiness and `/status` for public JSON. Configure the browser-facing public endpoint in a web rebuild.

The release checker has distinct offline, partial-collection and full online modes:

```bash
# Offline records/manifest validation only; deliberately fails the empty ledger.
node scripts/release-evidence.cjs --check
# After real partial records exist, fetch and save matching successful RPC receipts.
node scripts/release-evidence.cjs --collect --evidence docs/evidence/tester-proofs.json
# Full ready-release verification against RPC, source/compiler, keeper and public web.
node scripts/release-evidence.cjs --online --web-url https://coil.up.railway.app
```

An offline pass reports `onlineVerified: false`. `--collect` does not certify a ready release. The empty tester ledger still fails the readiness gate, and a paused factory fails online activation. See [DEPLOYMENTS.md](DEPLOYMENTS.md) for exact deploy/verification inputs and the [evidence guide](docs/evidence/README.md) for decimal-string blocks and relative receipt paths.

See the [19-requirement completion matrix](docs/WAVE2_STATUS.md) for implemented behavior and remaining public acceptance.

## Release and evidence gates

A new implementation/factory is required: clones are not upgradeable. New factory opens start paused. Validate every linked runtime below 24,576 bytes and changed execution paths within 20 Mezo precompile calls. A constant budget table alone is not execution evidence.

The release must bind one build to successful chain-specific deployment receipts, every linked library, live factory implementation, indexed full source verification, the public app's factory/block pair, the configured keeper and funded end-to-end transactions. Queued or partial explorer verification is incomplete. The [evidence ledger](docs/evidence/README.md) stays empty until real external inputs exist; developer activity and generated wallets do not establish 3–5 recruited testers.

Mainnet needs explicit go-live approval after the security, matsnet, depth/finite-cap, verification, keeper and rollback gates pass. Initial UI targeting is around 200% CR / 2×, subject to pool depth. No mainnet release is claimed here.

Team: **Prabal Pratap Singh, Nikhil Verma and Neha Singh**.

## License

[MIT](LICENSE). Copyright 2026 Prabal Pratap Singh.
