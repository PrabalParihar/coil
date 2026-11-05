# Coil Labs security notes

**Unaudited release candidate.** This document describes the Wave 2 completion security contract. Public legacy matsnet deployments are separate immutable builds; see [DEPLOYMENTS.md](DEPLOYMENTS.md). Source, tests, deployment and fully verified on-chain code are separate evidence gates. No mainnet go-live is authorized by this document.

## Oracle and pool fills

Coil uses MUSD `PriceFeed.fetchPrice()` as an 18-decimal USD-per-BTC price, not an 8-decimal raw answer. Matsnet feed proxy: `0x86bCF0841622a5dAC14A313a15f96A95421b9366`. Its upstream is the Mezo Skip Connect aggregator. Coil calls the MUSD feed and does not substitute a hard-coded or last-good price. The documented feed rejects a price older than 60 seconds; Coil lets feed errors propagate and rejects a zero price. These checks do not establish that a fresh feed is economically correct.

[PriceMin](src/libraries/PriceMin.sol) defines the pool-output floors. For 18-decimal BTC/MUSD, the conceptual bounds are:

- BTC sold for MUSD: `btcIn * price / 1e18 * (10000 - boundBps) / 10000`.
- MUSD spent for BTC: `musdIn * 1e18 / price * (10000 - boundBps) / 10000`.

Use the library's integer arithmetic and decimal handling, rather than rearranging these conceptual formulas. Pool price/fee and protocol borrowing fee are separate from this oracle bound.

The completion rule applies the same snapshotted valid oracle price and owner-selected bound before starting a flash and in the callback to the actual fill. It covers open/increase, flash delever, guard and owner flash close. A pool quote must not widen the oracle allowance. Callback violations revert all effects, including fees and tips. The former exception allowing an owner flash close outside the bound is removed. Direct MUSD-funded close performs no pool sale, but still obeys Mezo's closing rules.

Open slippage defaults to 50 bps and is owner-selected within the contract limit of 300 bps. Rescue slippage defaults to 200 bps and is owner-set, capped at 300 bps. A keeper cannot change either. The separate peg/deviation gate is an additional open check, not a replacement for PriceMin.

## Fee authority and accepted quote

The **factory owner** controls the shared Coil fee and recipient. The fee defaults to **25 bps**, accepts **1–50 bps inclusive**, and rejects zero and rates above 50. The recipient must be nonzero. Guardian, keeper and account owners cannot change that factory policy through their roles.

The Coil fee is `floor(gross newly minted MUSD * feeBps / 10000)` on successful open/increase borrowing only. Flash execution grosses up minted MUSD conservatively so the pool is repaid after the fee, and includes gross borrowing/protocol costs in debt and CR checks. A pure refinance without new MUSD, accrued interest, guard, rescue, reserve repayment, owner repayment, delever, unwind, close and claim charge **zero Coil fee**. Protocol/pool fees and gas remain separate costs.

Execution snapshots policy and enforces the owner's submitted maximum Coil fee. A policy increase above the accepted rate before inclusion must revert. Compatibility two-argument open selectors on the new factory use the documented **50 bps maximum**; clients seeking a tighter acceptance must call the additive fee-ceiling overload. A revert rolls back fee transfers/events as well as position changes.

## Pause and finite opening limits

A new factory starts with opens paused and unset limits. Owner must set finite nonzero per-account total BTC-collateral and total MUSD-debt limits before unpausing. Debt includes protocol fees and gas compensation. Actual resulting protocol balances must satisfy the limits after an open/increase. Zero is not unlimited capacity.

Guardian may pause risk-increasing opens; only owner unpauses and configures limits/fees. Administrative Coil pause differs from external PoolFactory pause. Lowering caps or pausing must not disable repayment, guard, claim, reserve withdrawal or close. The explicit direct owner collateral-top-up action is also exempt because it reduces risk; an open/increase route does not become a cap bypass merely by attaching BTC.

These powers do not let an administrator withdraw user BTC/MUSD or upgrade an existing clone. Policy authority still creates availability and fee-selection trust, bounded by on-chain rate limits and each transaction's accepted maximum.

## Keeper and tip boundary

Permissionless `guard()` may use the owner's already funded MUSD reserve, then perform a permitted bounded sale toward the configured guard target. It cannot open leverage, sweep, perform an owner close, withdraw tips/reserves for itself or change owner settings. BTC and MUSD proceeds belong to the owner/account, never the guard caller.

Tip payment requires a genuine increase in oracle-measured CR from an allowed risk-reducing operation. It is capped by configured `tipMezo` and available MEZO and pays at most once per account per block. An unchanged position, unsafe empty-reserve sale or no-op pays no tip. Reserve repayment can remain when a predictable unsafe sale is skipped; arbitrary callback/protocol failures are not masked as safe success.

Keeper service simulation failure prevents submission. Repeated unchanged no-op/Slippage states use bounded backoff and alert deduplication; risk-relevant changes must reset the delay promptly. Public health distinguishes read-only monitoring from execution, stale scans from fresh scans, and configured expected-keeper heartbeats from legacy permissionless event history. Neither a process start nor an old heartbeat proves continuous protection. Guards can fail on oracle staleness, pool liquidity, debt floor, protocol restrictions, funding, gas or service availability.

## Owner actions and Recovery Mode

`claimCollateral` is owner-only and nonreentrant; it forwards only collateral actually recovered by the protocol claim, preserving unrelated balances. No surplus or repeat claims must not create a payment from other account funds.

`repayWithMUSD(amount)` pulls only the owner-approved MUSD that can be safely repaid above minimum remaining debt; unused requested input stays in the owner's wallet. Approve the clone, **not CoilPark**. `closeWithMUSD(maxOwnerMUSD)` combines permitted available funds and owner-approved MUSD up to that ceiling, closes only when the protocol allows it, and returns close proceeds and remaining reserve to the owner. `addCollateral()` is the separate payable owner top-up action.

**Recovery Mode is not a guaranteed full exit.** Mezo blocks full close under its active protocol rules. New leverage is blocked; safe pure debt repayment and permitted reserve repayment can improve CR without withdrawing/selling collateral. Minimum-debt and system-ratio conditions still apply. Full close is submitted by the owner after Mezo permits it; there is no deferred/automatic queued close and no new keeper spending approval.

## Reserve and integration trust

CoilPark holds reserves outside each clone, with balances keyed by the calling clone. `sweep` does not withdraw the park. Its implementation-deployer governor can select a shared ERC-4626 adapter whose `asset()` is MUSD. That check does not prove the vault honest, liquid or safe. A malicious/misconfigured vault or vault switch can strand reserve accounting/funds. No live savings-vault or gauge address is asserted; integration remains conditional on verified chain-specific addresses and interface tests.

Only the immutable pool may call the authenticated flash callback, and only during an initiated expected flash kind. State-changing account entry points retain reentrancy protection. Linked libraries execute with delegatecall and must be verified as part of the exact implementation build. Clones are non-upgradeable; new code requires a new implementation/factory.

## Verification obligations

Run the current meaningful suite and retain the controller's exact commands/results. Coverage must exercise claim ownership/balance preservation, actual protocol-equivalent RM restrictions, fee rounding/gross-up/accepted-ceiling races, pause/cap risk-reduction access, callback oracle checks, no-op/tip effects and adversarial guard movement. A selector-only test or a mocked RM flag that still permits forbidden close is insufficient. This document deliberately does not carry a test count that can drift.

Current regression source in [test/Coil.t.sol](test/Coil.t.sol) includes the following cases. This is a coverage map, not a new passing-test or public-transaction claim; the controller records the final run separately.

| Boundary | Regression source |
| --- | --- |
| Paused start, fee bounds and role restrictions | `test_wave2_policyStartsPausedAndRejectsInvalidAuthority`, `test_wave2_guardianCanPauseOnlyAndHeartbeatAuthenticates` |
| Accepted-fee drift, gross-up, recipient and quote accounting | `test_wave2_feeDriftAndExactFlashFee`, `test_wave2_quoteFeesMatchGrossAndRecipientOnBothOpenPaths`, `test_wave2_flashIncreaseAccountsForFeeAndRefinance` |
| Fork protocol RM repayment, blocked close and later permitted funded close | `test_wave2_realRecoveryRepayAndLaterDirectClose` (injected oracle price drives the forked protocol's RM calculation) |
| Minimum-debt repayment and unrelated balance preservation | `test_wave2_ownerRepayCapsAtMinimumAndPreservesBalances` |
| Claim authorization, native recovered amount and reentrancy | `test_wave2_claimOnlyRecoveredNativeAndRejectRepeated`, `test_wave2_claimReentrancyBlocked` |
| Out-of-bound owner flash close/delever and adverse open callback | `test_wave2_A9_ownerFlashCloseOutsideBound`, `test_wave2_A9_flashSizerDeleverOutsideBound`, `test_wave2_A9_flashLoopCallbackCannotWidenOracleBound` |
| Unsafe empty-reserve guard returns false with unchanged balances/debt and no tip | `test_wave2_A9_guardUnsafeEmptyReserveNoTip` |
| Lowered caps/pause preserve direct top-up and repayment | `test_wave2_loweredCapsPauseStillAllowOwnerRiskReduction` |
| Instrumented changed owner-path native-call budget | `test_wave2_changedPathPrecompileBudgetMeasured` |

These tests supplement the existing keeper invariant, oracle-decimal/staleness, spoofed-callback and reserve-first tests. Fork/precompile substitutes and instrumented native-call estimates remain local evidence and must not be labelled as live matsnet execution.

Every runtime must remain below EIP-170's **24,576 bytes**. Mezo allows **20 native-precompile calls per transaction**; changed execution paths must be measured/instrumented, including reserve and tip branches. Historical budget constants alone do not prove new paths. Historical `docs/SLITHER.txt` is a dated tool output, not an independent audit or a current clean security result.

The release also requires actual funded matsnet receipts and full indexed verification of every library, FlashSizer, Park, implementation and factory. The baseline production review found partial verification; queued or partial source verification must not be called complete. Mainnet additionally needs reviewed finite caps against current depth, chain-correct app/keeper configuration, rollback drill and explicit go-live approval.

## Release-tool evidence boundary

The implemented manifest generator/checker is `node scripts/deployments.cjs --generate|--check`. The release CLI defaults to offline validation (`--check`), supports partial online receipt capture with `--collect`, and performs the full ready-release RPC/source/compiler/keeper/web comparison with `--online`. Offline success is explicitly `onlineVerified: false`; partial collection is not full release verification. Null deployment inputs, legacy status and missing real-user proofs fail readiness honestly. See the [exact ledger fields and modes](docs/evidence/README.md).

Account events expose `CoilFeePaid(recipient,grossMinted,amount)`, `CollateralClaimed(owner,amount)`, `MUSDRepaid(owner,amount)` and `ClosedWithMUSD(owner,ownerMUSD)`. A successful receipt/selector check does not replace review of actual state and event amounts. The collector cannot establish a genuine rescue solely from successful `guard()` execution.

Optional web `NEXT_PUBLIC_KEEPER_STATUS_URL` reads the keeper's public `/status` endpoint. The client validates chain/factory/expected signer, epoch-millisecond timestamps and the allowed public schema, expires stale status and keeps service mode separate from chain evidence. `/health` returns availability based on fresh successful scans, not process startup; monitoring mode remains labelled. No key, environment dump or credential-bearing endpoint belongs in these responses or this public build variable.

## Reporting

Report issues at https://github.com/PrabalParihar/coil/issues. Include public chain ID, factory/account, transaction hash, expected behavior and observed behavior. Do not include keys, seed phrases, tokens or private RPC credentials. Use local/fork or testnet reproduction; do not use mainnet funds to demonstrate a problem.

Reference oracle behavior: [MUSD PriceFeed source](https://github.com/mezo-org/musd/blob/da7888a10949c8a5d3f884454cec8978cfa87e48/solidity/contracts/PriceFeed.sol), [Mezo oracle documentation](https://mezo.org/docs/developers/architecture/oracles/).
