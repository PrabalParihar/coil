# Evidence ledger and release commands

This directory contains reviewable material and a deliberately empty funded-release proof ledger. It does not establish a new deployment, real users or completed source verification. The collector and release checker are implemented in [scripts/release-evidence.cjs](../../scripts/release-evidence.cjs); their input is [tester-proofs.json](tester-proofs.json).

- [tester-proofs.schema.json](tester-proofs.schema.json) validates record shape. Structural validation alone never establishes release readiness.
- [historical-deployments.md](historical-deployments.md) preserves superseded notes; [DEPLOYMENTS.md](../../DEPLOYMENTS.md) is the current authority.
- [screenshots](screenshots/) contains labelled illustrative legacy UI, not receipts. Static redesign captures include placeholder hashes.
- [artifact-validation.json](artifact-validation.json) records local deck/video checks, not chain evidence.
- [Local-fork browser evidence](local-fork/README.md) records 14 phases and 17 synthetic local transactions, including Recovery Mode repayment and retained-account exit. Its hashes and wallets do not establish a public deployment or real recruited users.

## Three distinct CLI modes

Run from the repository root after installing the keeper's viem dependencies (`cd keeper && npm ci`). All modes select the canonical [deployment manifest](../../deployments/manifest.json) using the evidence ledger's chain ID. None signs a transaction.

| Command | What it establishes |
| --- | --- |
| `node scripts/release-evidence.cjs` or `--check` | Offline manifest/record consistency only. Requires a `ready` release and complete tester/action records; a pass still reports `onlineVerified: false`. |
| `node scripts/release-evidence.cjs --collect --evidence docs/evidence/tester-proofs.json` | Online **partial** receipt collection. Validates matching RPC receipt/transaction/account identity and action-specific financial effects and writes receipt JSON. Does not certify a ready release or require the complete action/tester set. |
| `node scripts/release-evidence.cjs --online --web-url https://coil.up.railway.app` | Full ready-release verification: complete records, live deployment/policy, indexed source/compiler/link identity, successful matching receipts with semantic effects and historical Recovery Mode evidence, expected-keeper heartbeat and public routes/config. |

`--collect` and `--online` are mutually exclusive. `--evidence` selects another ledger file if needed; receipt paths remain relative to that ledger's directory. The current empty ledger intentionally fails readiness and collection until actual matching tester and action records exist. The active matsnet manifest entry is the paused completion factory; that `ready` label records its policy inventory and is not an activated live release. Do not treat a passing offline check, or a paused bootstrap, as online verification.

The online gate compares actual factory creation block, implementation and registered keeper; opening must be activated with finite limits and a valid fee policy. Each of CoilFactory, CoilAccount, CoilLegacy, CoilExit, CoilOwner, FlashSizer and CoilPark must report both indexed `is_verified` and `is_fully_verified`, with source equal to this checkout and Solidity 0.8.24 / Shanghai / optimizer 200 / via IR / `bytecodeHash: none`. The implementation must use the declared Park and FlashSizer, the selected chain’s protocol addresses, and the recorded `parkGovernor`; Park must hold the selected MUSD asset. Direct and transitive links must match: implementation → Legacy/Exit/Owner, Exit → Legacy, Owner → Legacy/Exit. It checks a fresh expected-keeper heartbeat and public `/`, `/guard`, `/stats`, `/keeper` plus unknown-route 404, with matching factory/block in guard/stats HTML. A paused bootstrap is not yet an activated live release.

## Exact record fields

The ledger contains `schemaVersion: 1`, numeric `chainId`, `factory`, `deploymentBlock`, `testers` and `receipts`. **Block numbers are positive decimal strings, not JSON numbers.** Pending `factory` and `deploymentBlock` are null together; once known, deployment block must exactly match the manifest's string.

Tester entries are `{address, recruited: true, consentRecorded: true}`. Receipt entries are `{action, transactionHash, tester, account, chainId, factory, blockNumber, status: "success", receiptPath}`. Canonical actions are `create`, `open`, `increase`, `setGuard`, `guard`, `claim`, `repay`, `repayRM`, `close`.

`receiptPath` must be exactly `receipts/<transactionHash>.json`, relative to the ledger directory, so the default ledger stores captured receipts under `docs/evidence/receipts/`. The CLI additionally checks that the filename hash equals the record's `transactionHash`; JSON Schema only enforces its shape. Record actual successful transaction hashes and blocks, not example/fake values. The empty arrays deliberately contain no placeholder addresses or hashes.

Full offline/online readiness requires at least **three distinct recruited consenting testers**, **all nine canonical actions** across the record set, and each tester's own `create` plus `open` or `increase` proof. The PRD recruitment target is **3–5 real testers**. Duplicate wallet/hash records, missing consent, wrong chains/factories/blocks and failed receipts are rejected. Receipt checks validate selector, actual sender/target and account owner/factory mapping. Owner actions must be signed by their recorded tester; permissionless `guard` may have another sender. Flash/router unwind close proofs must request the full `1e18` fraction and actually close the position. Successful no-op guards, zero repayments, and an attempted full unwind that leaves an active trove cannot count. Open and increase must prove their distinct historical position transitions plus positive fee-bearing minting. `repayRM` requires positive debt reduction without collateral sale and verifiable Recovery Mode at transaction time, separately from an ordinary repayment.

## External inputs and financial effects

Prabal must recruit the real testers, record their consent to public wallet/receipt attribution and provide their actual funded matsnet wallets/transactions. Use public addresses only; never collect keys or seed phrases. Existing developer activity and generated/fork wallets are not recruited users. A consent flag records the team's assertion, not proof of identity or a signature.

The completion-release factory and block are recorded in the manifest. The proof ledger's factory and block stay null until consented tester receipts exist for that factory. Some scenarios need actual surplus or actual Recovery Mode. Protocol-equivalent fixture/fork tests support local behavior verification; funded public-chain proof stays pending until it exists. Never relabel fixture data as matsnet receipts.

The collector checks action-specific decoded events from exact account/protocol addresses and historical state. Every collected action conservatively requires an isolated transaction block and archive pre/post state with canonical block/hash/index checks. This avoids assigning another transaction’s effects to the selected receipt. Recovery Mode proof additionally requires agreeing nonzero historical feed prices and protocol Recovery Mode true before execution. Unavailable archive state or ambiguous transaction-time conditions fail closed; they keep the funded scenario pending. Review actual amounts and the wider economic context as well:

| Event | Review use |
| --- | --- |
| `CoilFeePaid(recipient,grossMinted,amount)` | Actual recipient and floor(gross minted × accepted bps / 10000) on fee-bearing borrowing. Gross mint/debt/CR must remain consistent. |
| `CollateralClaimed(owner,amount)` | Only collateral recovered by that protocol claim reaches the owner; unrelated balance is preserved. |
| `MUSDRepaid(owner,amount)` | Actual debt reduction and minimum-debt handling; zero Coil fee; no forbidden collateral sale in RM. |
| `ClosedWithMUSD(owner,ownerMUSD)` | Actual owner contribution, permitted protocol close and returned collateral/reserve. |

Review guard's actual collateral/debt/MEZO effects: an improved CR may earn a tip, a successful no-op must not. Bind evidence to the exact build/chain/factory, not only an event name. The collector does not create surplus, force protocol Recovery Mode, recruit users or replace the automated effect checks or the wider economic review.

## Remaining release boundaries

Record exact source/build identity, successful linked deployment receipts, runtime sizes, changed native-precompile execution measurements and full indexed verification. Public app/keeper readback must match that release. Mainnet additionally requires current depth review, explicit finite limits, a separate service identity, rollback drill and explicit go-live approval.

Historical receipts establish only their recorded older actions/build. Baseline verification is partial and a queued explorer result is incomplete. No independent audit is claimed. Submission writing is not publication; no external posting occurred here.
