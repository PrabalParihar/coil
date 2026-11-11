# Deployment and evidence status

The active deployment is the Wave 2 **completion release** on **Mezo testnet (matsnet), chain 31611**, from main `7fd588a`. Opening is **paused**. This is a testnet bootstrap, not an activated live release and not mainnet. Indexed full source verification, funded feature receipts and recruited-tester evidence are still outstanding. No mainnet deployment is claimed.

| State | Chain | Factory | Deployment block |
| --- | --- | --- | --- |
| Completion release, opening paused | matsnet 31611 | [`0x339ef0116e17BA42987c1E2E380Af59B38f62064`](https://explorer.test.mezo.org/address/0x339ef0116e17BA42987c1E2E380Af59B38f62064) | **16708730** |
| Previous production baseline, retained legacy | matsnet 31611 | [`0xff3335576f998EE872596d4EB7ABECb71a0D5BC8`](https://explorer.test.mezo.org/address/0xff3335576f998EE872596d4EB7ABECb71a0D5BC8) | **16408315** |
| Earlier reserve build, historical | matsnet 31611 | `0x2218D33d2f9279A4266b49dB572F5b1343d09De5` | 16407578 |
| Earlier flash e2e build, historical | matsnet 31611 | `0x6A38f560cF8612cc81cF966831890DBb310e31F7` | 16400160 |
| Wave 1 / original walkthrough | matsnet 31611 | `0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e` | 16243828 |
| Mainnet | Mezo 31612 | **Not released; go-live gated** | Not configured |

## Completion release on matsnet

Manifest status is `ready`: this build supports policy, the Coil fee and owner actions, and the inventory lists all seven components plus the park governor. That schema label is not the online gate's activated release. Opening is still paused, the tester ledger is empty, and full indexed verification is not claimed.

| Component | Address | Creation |
| --- | --- | --- |
| CoilFactory | [`0x339ef0116e17BA42987c1E2E380Af59B38f62064`](https://explorer.test.mezo.org/address/0x339ef0116e17BA42987c1E2E380Af59B38f62064) | [`0xdd276bd8…`](https://explorer.test.mezo.org/tx/0xdd276bd8ce30b67716530dfcba7e1c43a6d85dd8094bc4191ca0b690071f1ff5), block **16708730** |
| CoilAccount implementation | [`0xf61CEf72Fc0CA52dBFC86C0eDE7F7a3fC8C64b45`](https://explorer.test.mezo.org/address/0xf61CEf72Fc0CA52dBFC86C0eDE7F7a3fC8C64b45) | [`0x05c89c34…`](https://explorer.test.mezo.org/tx/0x05c89c3450f18f6302853522617b3eb0eab551d6fd4753b1fa6ee13ef409a169), block **16708729** |
| CoilLegacy | [`0x1cC3017eb259ab6A457315455a5691483df4b477`](https://explorer.test.mezo.org/address/0x1cC3017eb259ab6A457315455a5691483df4b477) | [`0x015eb977…`](https://explorer.test.mezo.org/tx/0x015eb977b6bc0a39e709e4acc6f7d9a7a6a263b92cd5bce634229b0a7fa9f6d6), block **16708726** |
| CoilExit | [`0x3e6327B725Af704D35C06d9D8680901a6C86B946`](https://explorer.test.mezo.org/address/0x3e6327B725Af704D35C06d9D8680901a6C86B946) | [`0x3fc29e84…`](https://explorer.test.mezo.org/tx/0x3fc29e846c7e57b53e7236e916be911685b4154ad4d443d8e2b04ca27df9b851), block **16708727** |
| CoilOwner | [`0x5fF7a683c2D7bd20524Ce86dCb7B3991bc5f8d3b`](https://explorer.test.mezo.org/address/0x5fF7a683c2D7bd20524Ce86dCb7B3991bc5f8d3b) | [`0x6163727f…`](https://explorer.test.mezo.org/tx/0x6163727f6c5af1148f93327ba986c3c88b90e2cd810864de3e6912f1270a99ea), block **16708728** |
| FlashSizer | [`0xdfab302Ee41dFD1BA3732F23B8b5f7eDe40E7699`](https://explorer.test.mezo.org/address/0xdfab302Ee41dFD1BA3732F23B8b5f7eDe40E7699) | Created inside the implementation constructor. No top-level creation transaction. |
| CoilPark | [`0x9FfA606C93dCF30D3E34159020f6A1667C21f50b`](https://explorer.test.mezo.org/address/0x9FfA606C93dCF30D3E34159020f6A1667C21f50b) | Created inside the implementation constructor. No top-level creation transaction. |

On-chain owner, guardian, fee recipient and park governor are the deployer `0xf74E746a8d7A46A8b0f745C6d5944Ee672c1a3AF`. Keeper is `0x1D2621480011C44693a47801C1158E70b25b4B4F`. Coil fee is the 25 bps default. Opens are paused. Limits are 1 BTC collateral (`1000000000000000000`) and 100,000 MUSD debt (`100000000000000000000000`).

| Configuration | Transaction | Block |
| --- | --- | --- |
| `setPositionLimits` (1 BTC / 100,000 MUSD) | [`0x1da3e1d2…`](https://explorer.test.mezo.org/tx/0x1da3e1d2852f8bd3d9df1b09b4409e7523c7579bd8de056e82fcb7d0b9a92124) | 16708731 |
| `setKeeper` (deployer; later replaced) | [`0x5883cab9…`](https://explorer.test.mezo.org/tx/0x5883cab9440fc2d3116e03be46008c36a627e4d95420b282073ed824b51db942) | 16708743 |
| `setGuardian` (deployer) | [`0x76125356…`](https://explorer.test.mezo.org/tx/0x76125356a18b734699ee4ff596a3d7d0e0b26e40e55c7356f565b26678922614) | 16708744 |
| `setKeeper` (`0x1D2621480011C44693a47801C1158E70b25b4B4F`) | [`0x017fc3e8…`](https://explorer.test.mezo.org/tx/0x017fc3e82caa2c33f544709c74d9fc6dfa2a89d60abd6c7a8d1f2dce8a633735) | **16709012** |

FlashSizer and CoilPark are constructor `CREATE`s of the implementation (nonces 1 and 2), so they have no top-level creation transaction. Explorer verification that looks up a creation transaction can miss them. Matching them may require a local bytecode comparison against this checkout, with Sourcify as the fallback. Completion of that check is not claimed here.

The previous production implementation [`0xd4495f969995b3e48998573b5adc6f3106672b80`](https://explorer.test.mezo.org/address/0xd4495f969995b3e48998573b5adc6f3106672b80) stays on the retained legacy factory. The 5 November 2026 PRD gap review matched that implementation's primary source to pre-completion revision `b3f672a45f0f234289d03fe42de904b045ff3df4`. Existing clones of that factory cannot acquire new fees, claim or owner-action capabilities through a web release. That review found Factory, implementation, FlashSizer, Park and Exit reporting `is_verified: true`; Legacy `0xb75d1F6Fe5D9Ab999CbcdDE99589976e66B25eC4` was unverified and the implementation reported `is_fully_verified: false`. **That verification was partial** and applies to the retained legacy build, not to the completion factory. A submission to an explorer, a queue response or partial verification is not full verified-source evidence. No independent audit is claimed.

## Public services and configuration

Public URL: https://coil.up.railway.app. The PRD gap review observed `/`, `/guard` and `/stats` returning HTTP 200, an unknown route returning 404, and the then-current legacy factory in rendered HTML. It also observed recent keeper heartbeats and Railway successful releases. Those are dated observations of the retained legacy build, not a guarantee of present uptime or proof that the completion factory is served. Historical factory heartbeats were permissionless; they do not authenticate the expected keeper.

Use the canonical [deployment manifest](deployments/manifest.json) as the source for chain ID, factory, matching deployment block, implementation/libraries, keeper and capability/version metadata. The active testnet factory is `0x339ef011…2064` at block **16708730**. Never pair the retained legacy `0xff3335…5BC8` address with the older **16407578** block, and never pair the completion factory with block **16408315**. Public overrides supply and validate the address/block pair together. The app discovers connected-wallet accounts across the active and retained generations and lets their owner select each clone with its original capabilities. Retained generations are not silently upgraded.

Keeper adapter compatibility is separate from retention. The current adapter's required getters apply to the completion factory and the retained reserve generations `0xff3335…5BC8` and `0x2218…9De5`. The older `0x6A38…31F7` and Wave 1 `0xE29f…8a3e` lack reserve/flash inputs; retain a prior compatible image for any still-funded accounts there and validate its own operation before claiming coverage. The new binary must not replace those compatible old services merely because their factory is retained. No prior-image or active coverage proof for those two historical generations is claimed here. A keeper pointed at the completion factory must use expected signer `0x1D2621480011C44693a47801C1158E70b25b4B4F`. See [keeper rollout compatibility](keeper/README.md).

Matsnet RPC: `https://rpc.test.mezo.org`; explorer: `https://explorer.test.mezo.org`. Mainnet RPC/explorer and protocol addresses must come from mainnet configuration, never testnet defaults. Credentials are operator inputs and are excluded from this document.

## Implemented release tooling

The canonical manifest is [deployments/manifest.json](deployments/manifest.json). `schemaVersion` is 1; active `deployments` and append-only `retainedDeployments` are keyed by `31611` and `31612`. Retained arrays preserve prior deployed generations, their original factory/block/implementation/keeper and capabilities when the active entry changes; conflicting identities or duplicate retained factories are rejected. Each entry carries chain name/public RPC/explorer, `status`, factory and matching **positive decimal-string** deployment block, implementation, keeper, component inventory and boolean `policy`/`coilFee`/`ownerActions` capabilities. `pending` may use null address/block pairs. `ready` additionally requires the actual nonzero `parkGovernor`, full policy capabilities and all seven components: CoilFactory, CoilAccount, CoilLegacy, CoilExit, CoilOwner, FlashSizer and CoilPark.

```bash
node scripts/deployments.cjs --generate
node scripts/deployments.cjs --check
```

Generation exports both `DEPLOYMENTS` and `RETAINED_DEPLOYMENTS` and writes `web/src/lib/deployment.generated.ts` and `keeper/src/deployment.generated.ts`. `--check` validates the manifest and fails stale copies; it performs no chain read or deploy.

### Deploy preflight and paused bootstrap

[script/Deploy.s.sol](script/Deploy.s.sol) requires explicit `COIL_CHAIN_ID=31611` or `31612` and rejects an actual RPC chain mismatch before parsing the signing key. The operator supplies the configured signing identity through the normal environment; no credential is shown here. A matsnet simulation and a separately authorized broadcast use the same script:

```bash
COIL_CHAIN_ID=31611 forge script script/Deploy.s.sol --rpc-url https://rpc.test.mezo.org
# Only when an actual funded matsnet deployment is authorized:
COIL_CHAIN_ID=31611 forge script script/Deploy.s.sol --rpc-url https://rpc.test.mezo.org --broadcast
```

Testnet-only defaults are finite: `COIL_MAX_COLLATERAL=1000000000000000000` (1 BTC) and `COIL_MAX_DEBT=100000000000000000000000` (100,000 MUSD). Units are raw 18-decimal token amounts. Both limits must be positive and below `uint256.max`; these fixture defaults are not mainnet recommendations. Optional testnet `COIL_KEEPER` and `COIL_GUARDIAN` default to the deployer when omitted.

Mainnet requires **explicit** finite `COIL_MAX_COLLATERAL` and `COIL_MAX_DEBT`, nonzero `COIL_KEEPER` and `COIL_GUARDIAN`, `COIL_CHAIN_ID=31612`, a chain-matched RPC, and `COIL_MAINNET_APPROVED=true`. The approval flag is an operator assertion, not authorization supplied by this document. Public market reads do not satisfy the gate.

The script deploys/links the build, sets position limits, keeper and guardian, and **always leaves opening paused**. It never automatically unpauses on either chain. It prints `legacy`, `exit`, `ownerLibrary`, `sizer`, `park`, `implementation`, `factory` and public policy/role values. Record the actual successful receipts and readbacks before editing the manifest. The owner may activate opening separately only after the relevant release/go-live review.

### Verify all seven components

[script/verify.sh](script/verify.sh) requires the selected `COIL_CHAIN_ID` and actual public addresses `LEGACY`, `EXIT`, `OWNER_LIB`, `SIZER`, `PARK`, `IMPL`, `FACTORY`, `OWNER`. **`OWNER_LIB` means linked CoilOwner; `OWNER` means factory owner / implementation deployer.** Do not substitute one for the other.

After setting those actual public values, preview without an explorer submission:

```bash
COIL_CHAIN_ID=31611 ./script/verify.sh --dry-run
```

The dry run encodes constructor arguments and prints all seven verification commands. Running without `--dry-run` submits the selected-chain linked libraries, FlashSizer, CoilPark, implementation and factory to Blockscout. No signing key is needed for verification. Dependency links include Exit → Legacy, Owner → Legacy + Exit and implementation → all three libraries. Completion of the command is not a full indexed source-verification certificate; inspect each explorer result and run the online release gate.

### Evidence and public readback modes

```bash
# Default and --check are offline only.
node scripts/release-evidence.cjs --check
# Partial matching receipt collection, after actual public records are supplied.
node scripts/release-evidence.cjs --collect --evidence docs/evidence/tester-proofs.json
# Complete ready-release RPC + source/compiler + keeper + web checks.
node scripts/release-evidence.cjs --online --web-url https://coil.up.railway.app
```

The empty tester ledger still fails full readiness: manifest `ready` records the paused completion factory, and it does not supply tester or action proofs. Offline success would still report `onlineVerified: false`. A paused factory fails the online activation check. `--collect` verifies declared receipt identity/action/ownership against RPC and saves JSON relative to the ledger; it does not require the complete tester/action set and does not certify a ready release. `--online` requires a `ready` deployment, complete tester/action records, matching live implementation/keeper and creation block, enabled opening policy with finite limits, all seven fully indexed sources matching this checkout and compiler settings, expected linked libraries, fresh expected-keeper heartbeat, `/`, `/guard`, `/stats`, `/keeper` and unknown-route 404 readback. The gate also checks actual Park/Sizer/protocol/governor bindings and direct/transitive library links. Action proofs require positive financial effects, historical open versus increase transitions, actual full close, and separately verified Recovery Mode repayment (`repayRM`). Every action requires an isolated transaction block and archived pre/post state; Recovery Mode additionally requires matching historical prices and actual pre-execution RM. Missing historical state or ambiguous transaction-time Recovery Mode leaves proof pending; a successful no-op is rejected. Tests and wider event/state review remain necessary. A paused deployment is intentionally not a live activated release.

## Completion-release gate

1. Build and validate the exact linked artifacts, all runtimes below 24,576 bytes and changed execution paths within 20 Mezo precompile calls.
2. Select the chain explicitly. Deploy the linked libraries, FlashSizer, Park, implementation and factory with the configured signing identity. Record successful receipts and chain IDs. No new signing identity or funded key is assumed here.
3. New factories start paused with unset opening limits. Set finite nonzero BTC-collateral and total-MUSD-debt caps and configure guardian, fee recipient and expected keeper. Only owner unpauses. Mainnet stays paused until the separate approved gate passes.
4. Fully verify every deployed component and linked implementation. Read back implementation/library addresses and policy from chain; record indexed explorer results.
5. Retain the previous active deployment before switching the manifest. Keep its compatible keeper container image/source revision and original factory/block pinned together; start a separate chain-and-factory-specific service for the new generation. Confirm coverage for each generation with active positions, including independent health/heartbeats, before retiring any service. Foreign-factory `/watch` does not provide cross-generation coverage. Bind the new app and keeper to that same manifest and factory/block pair. Verify public HTML/config, chain-matched transactions, health freshness and authenticated expected-keeper heartbeat. Read-only monitoring must not claim active execution protection.
6. Collect funded matsnet receipts for create, fee-bearing open/increase, setGuard, bounded guard, surplus claim, safe Recovery Mode repayment and protocol-permitted close. Where live protocol conditions do not permit a scenario, preserve a clearly labelled fixture/fork proof and keep the funded proof pending.
7. Collect 3–5 distinct recruited testers' consented public wallets and successful receipts. Generated test wallets and historical developer wallets are not recruited real-user evidence.
8. Record rollback: pause risk increases, keep risk reduction available, switch manifest/web/keeper to the last reviewed configuration and explicitly label each clone generation. Clones themselves are not upgraded or rolled back.

See [evidence requirements and empty ledger](docs/evidence/README.md). Mainnet approval follows verified matsnet/security checks, measured current depth, explicit caps, complete verification, separate chain-specific keeper identity and rollback drill. Around 200% CR / 2× is the initial mainnet UI target, not a liquidity guarantee.

## Historical receipts (not completion proof)

A 27 October 2026 matsnet run used factory `0x6A38f560cF8612cc81cF966831890DBb310e31F7`, clone `0xEeE34fbAD36f46d648453914d658AbE314cA710c`. These hashes are carried forward from the prior record and were not freshly validated in this materials task.

| Historical action | Receipt link |
| --- | --- |
| Create account | [0x21e49605…](https://explorer.test.mezo.org/tx/0x21e4960535628d16d67b02a833d814d82ede3957e94ea8130421b4970b313d49) |
| Flash open, 0.015 BTC, target CR 133.33% | [0x576e5383…](https://explorer.test.mezo.org/tx/0x576e5383d45538f63658ffdc110d256a4d1a41779efbd7df9c4e0b3d55af0eef) |
| Guard, recorded CR 133.30% → 150%, 1 MEZO | [0xcb90da85…](https://explorer.test.mezo.org/tx/0xcb90da8575306d82209d7ba49c0d21caef14e5d5527ec5b9486c4689d71fb54a) |
| Full flash unwind | [0x296bb52c…](https://explorer.test.mezo.org/tx/0x296bb52c8458bbdd0f00bd8c58f425655cccabb6409c3068bb87e36a9209c3d2) |

That rescue needed an owner slippage change first. It does not establish current bounded-callback behavior or new fee/claim/RM transactions. Original video `docs/media/coil-demo.mp4` is 171.76 seconds and is Wave 1 material. The redesigned static screenshots contain illustrative UI states and placeholder hashes; do not use them as transaction proofs.

The [archived deployment notes](docs/evidence/historical-deployments.md) retain earlier addresses, failed attempts and detailed historical transactions, with a superseded warning. They are not current configuration instructions.
