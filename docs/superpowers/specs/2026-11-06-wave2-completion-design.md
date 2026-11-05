# Coil Wave 2 completion design

Status: proposed design for approval. The Recovery Mode approach below was selected by Prabal in chat on 6 November 2026. The complete design has not yet been approved for implementation.

Base: `78a40edb6964638a3fcec73047c91b715d771f53`, `PrabalParihar/coil` main. Reference: the supplied Wave 2 PRD and `/workspace/coil-wave2-prd-gap-audit.md`.

## Intent and completion standard

Complete the missing engineering and submission work in the supplied PRD: surplus claims, fees, bounded flash swaps, useful Recovery Mode actions, quiet failed guard attempts, reliable public keeper health, consistent deployment configuration, mainnet readiness, and current submission materials. Preserve the existing Mezo integration, static-export website, non-upgradeable account model, and the rule that a keeper can only reduce risk.

Implementation, local/fork verification, public deployment verification, real-user evidence, and submission publication are separate completion states. A green test or a deployment script is not a live transaction proof. Record actual addresses, chain IDs, receipts, and verification results; leave an external proof pending until it exists. The implementation request does not supply real tester wallets, a deployer identity, mainnet funds, a WalletConnect project ID, or missing gauge addresses.

## Approaches and the selected Recovery Mode rule

The PRD and current code conflict on owner flash close. Current code deliberately permits an owner close at an out-of-bound pool price; A9 requires bounded flash closes. Follow the PRD: all pool-mediated owner closes must obey the oracle bound, with a direct MUSD-funded close available when protocol rules permit it. An unbounded emergency flash close would defeat A9 and is excluded.

Research of the deployed BorrowerOperations proxy and implementation found that `_closeTrove` calls `_requireNotInRecoveryMode` while BorrowerOperations remains on MUSD's mint list. A read of the current mint-list flag returned true. Pure debt repayment is permitted in Recovery Mode; collateral withdrawal is restricted. A Coil wrapper cannot promise a full Recovery Mode close against those protocol rules.

Two approaches were presented:

1. Safe owner MUSD repayment during Recovery Mode, with full close initiated by the owner once Mezo permits it. This requires an explicit repayment action and accurate UI messages.
2. Leave F2 blocked and implement only the other requirements. This provides less protection during Recovery Mode.

**Prabal selected approach 1.** No automatic deferred close or new keeper spending permission is implied. This replaces the literal "full owner exit in RM" acceptance with a protocol-compatible acceptance: opens blocked; owner can safely repay debt; permitted reserve repayment can reduce risk; a full close remains protocol-gated and is available after Recovery Mode when the protocol's other close conditions also pass.

The remaining architecture choices in this document are the builder's proposals, derived from the PRD, rather than additional decisions already made by Prabal. Extend the existing contracts and delegatecall-library pattern in reviewable increments. A protocol rewrite or changing Mezo's Recovery Mode rules is outside this work.

## Constraints

- Solidity 0.8.24, Shanghai, existing compiler optimization, Node 22, Next.js static export, viem, Foundry, and Railway remain the stack.
- Every deployed runtime must remain below EIP-170's 24,576-byte limit. Current compiled artifacts put CoilAccount at 21,760 bytes, CoilLegacy at 20,879, and CoilExit at 6,526. Move owner actions into another linked library if needed; do not solve size by removing checks.
- Count Mezo BTC/MEZO precompile calls for new paths. Existing constants are documentation, so validate changed execution paths as well as constants. Stay within 20 calls.
- Existing clones are not upgraded. New policy, fee, or owner-action code requires a fresh implementation and factory. Existing live accounts must remain visible with accurate legacy capability handling.
- Keep keeper/deployer keys out of source, chat, artifacts, status responses, and build inputs. Use configured identities and normal CLI/SDK authentication. No new transaction-signing identity is assumed to exist.
- Passport remains conditional. Keep the working OrangeKit fallback if the pinned Passport SDK still cannot compile. Enable savings/gauge integrations only for confirmed chain-specific addresses and tested interfaces.
- Cloud environment publication is separate from app releases; this work does not require republishing the cloud environment.

## Contract policy, fees, caps, and pause

Use CoilFactory for the shared official-factory policy. Retain its two-address constructor where practical so deployment/verification tooling remains simple. Add a policy getter that returns fee rate, recipient, paused state, and position limits together, minimizing repeated reads.

Fee authority is the **factory owner**, not each account owner or keeper. Default `coilFeeBps` is 25. The setter accepts 1 through 50 inclusive and rejects zero or values above 50. The recipient defaults to the factory owner; the owner can change it to another nonzero address. A keeper/guardian cannot set fees, change the recipient, or withdraw user assets.

Charge the Coil fee only on MUSD newly received from successful open/increase borrowing. Do not charge it on protocol interest, gas compensation, a pure refinance without new MUSD, guard, reserve repayment, owner repayment, delever, unwind, surplus claim, or rescue. A reverted transaction must also revert fee transfers and events.

Use one rounding rule throughout quotes and execution: fee is `floor(grossMinted * feeBps / 10000)`. For flash borrowing, size gross MUSD so the post-fee amount still repays the pool. Use conservative integer rounding for gross-up, include the larger borrowing in protocol debt/CR sizing, and apply the protocol's minimum-debt rule. Legacy router loops swap the post-Coil-fee MUSD and calculate the resulting target ratio accordingly. The UI and contract quotes must return the gross minted amount and Coil fee explicitly; pool and protocol fees remain separate.

Snapshot the policy used by an operation. The frontend should pass the maximum Coil fee rate the owner accepted. Prefer additive overloads of `loop`/`flashLoop` with `maxCoilFeeBps` while preserving the old two-argument selectors for compatibility; those legacy selectors have an explicitly documented 50 bps maximum on the new factory. A policy change above the UI-accepted rate before mining must revert rather than silently charge more.

Factory opens start **paused**, with unset limits. Only the owner can configure limits and unpause. A guardian may pause risk-increasing opens but cannot unpause or set policy. Use nonzero per-account limits for total BTC collateral at a leveraged open/increase and total MUSD debt, including gas compensation and protocol fees. Check actual resulting protocol balances before an open/increase succeeds. Do not block debt reduction, claims, close, reserve withdrawal, or guard because a position is already above a newly lowered opening limit. A direct emergency collateral top-up is a risk-reducing action and is exempt from the opening collateral cap; document that exact surface.

Zero limits must never mean unlimited mainnet opening capacity. The mainnet release requires explicit operator-provided BTC/MUSD limits reviewed against current pool depth; it has no automatic unbounded fallback. Test/fork fixtures and the testnet dry-run can use clearly labelled finite test limits. A mainnet deploy remains paused until its final limits and go-live gate are satisfied. Existing external PoolFactory pause handling is not Coil's administrative pause.

## Owner actions and Recovery Mode

Add owner-only, nonreentrant actions, using a new linked owner-actions library if necessary:

- `claimCollateral`: call BorrowerOperations for the clone's surplus and forward only collateral actually recovered by that call to its owner. Preserve unrelated balances. Emit the amount claimed. Test no surplus, repeated claim, ownership, reentrancy, and native BTC handling.
- `repayWithMUSD(amount)`: pull owner-approved MUSD into the clone, repay a safe amount within the protocol minimum remaining debt constraint, and return unused owner funds. It must work as pure repayment in Recovery Mode without a collateral sale or Coil fee. Emit actual repayment. Approvals target the account, not CoilPark.
- `closeWithMUSD`: combine available account/reserve MUSD with owner-approved MUSD to repay the full net debt when protocol closing is allowed, return all close proceeds and leftover reserve to the owner, and charge no Coil fee. Preflight Recovery Mode for a clear error, but still respect protocol reverts. This action does not perform a pool sale, so the pool oracle cap is irrelevant to its execution.
- A direct owner collateral top-up, if needed to expose the protocol-safe action independently of paused loop methods.

Do not mask the protocol's minimum-debt, Recovery Mode, or system-ratio restrictions. The app must distinguish repay, full close, and surplus claim. It must not say that a full close is available in Recovery Mode or queue an automatic close. Once Recovery Mode ends, the owner can submit the close themselves.

During Recovery Mode, guard can use an already funded reserve to repay debt when that raises the ratio and satisfies protocol rules. It must not withdraw/sell collateral through a path Mezo disallows. An empty or insufficient reserve can result in a safe no-op rather than a promise of a successful rescue.

## Oracle bounds and guard behavior

Make PriceMin the common specification of acceptable pool fills. For MUSD-in/BTC-out, require actual BTC received to meet the feed-derived BTC floor for the actual MUSD paid. For BTC-in/MUSD-out, require actual MUSD obtained to meet the feed-derived floor for the BTC paid. Avoid ad hoc `(BPS + slip)` ceilings and quote-relative widening.

Snapshot a valid feed price and the owner's selected bound before initiating a flash. Validate the planned fill before starting and the actual fill in the callback against the **same** snapshot and bound. Do not widen that bound by adding a second slippage allowance to the pool quote. Enforce it for owner close, partial repay/delever sizing, open/increase, and the guard path. FlashSizer stays pool sizing math; callers are responsible for supplying/enforcing the oracle constraint. Keep pool callback authentication, flash-kind checks, and reentrancy protection.

Preserve the reserve-first improvement when a later BTC sale would be unsafe. For permissionless guard, a predictable unsafe sale with no reserve improvement should return false without paying a tip. Explicit owner delever/flash-close operations can revert with a useful error when their requested fill is outside the bound. Callback-time violations must fail atomically. Do not catch arbitrary protocol failures and label them safe no-ops.

Tip payment requires a genuine increase in the oracle-measured ratio from an allowed risk-reducing operation. It must remain capped by the configured tip/balance and paid at most once per block. A front-run that pushes the fill beyond the bound must not take collateral or tip; a no-op must not earn MEZO. A valid bounded risk reduction may earn its configured tip, as intended by the product.

The existing test that expects a 400 bps owner flash close to succeed must change to the approved strict-bound behavior. Add a separate direct MUSD-funded exit test so safety is not implemented by removing every usable exit.

## Keeper service and public health

Refactor the executable entry point so risk evaluation, retry state, and status handling can be tested independently. Keep 20-second polling as the normal starting cadence, but track per-account no-op/Slippage backoff with a bounded exponential delay. Reset the backoff promptly when risk-relevant inputs change, including position, oracle price, reserve funding, or owner settings. Do not let backoff suppress a newly actionable emergency. Suppress duplicate unchanged-failure alerts; simulation failure must continue to prevent transaction submission.

Expose a small HTTP health/status service on Railway's assigned PORT. Responses may include chain ID, factory, public keeper address, read-only/execution mode, last successful scan, last confirmed heartbeat, and safe counters. Do not expose keys, tokens, environment dumps, detailed private provider errors, or arbitrary command execution. Health should become stale when scanning stalls; successful process startup alone is insufficient. Monitoring mode must not claim active transaction protection.

On the new factory, accept health heartbeats from the configured keeper, and configure that address during the deployment workflow. Preserve permissionless risk-reducing guard. The UI should identify authenticated expected-keeper heartbeats; legacy permissionless heartbeat events are history, not proof that the configured keeper is healthy.

Add a public `/keeper` page and improve `/guard` with a clear latest-heartbeat age and fresh/stale/unconfigured state. A public status URL may provide operational details; chain heartbeat is the fallback when that URL is unavailable. Expose loading limits, retry, errors, and stale data honestly. Start with recent logs and paginate older history rather than withholding all data until a full historical scan completes. `/guard` and `/stats` must retain real public chain counts and error visibility.

## Deployment manifest, app, and mainnet readiness

Create one chain-specific public deployment manifest with chain ID, factory address, deployment block, implementation/library addresses, expected keeper, capability/version information, and public transaction/verification references. Consumers validate address/block pairs together. Update web, keeper, deployment scripts, release verification, and documentation from this source rather than unrelated hard-coded defaults. Public build-variable overrides must include the matching block; reject incomplete or invalid pairs rather than silently scanning from an unrelated deployment.

Current production is `0xff3335576f998EE872596d4EB7ABECb71a0D5BC8`, block 16408315. Preserve it as an explicitly labelled legacy deployment until a new release is actually confirmed. The repo's old `0x2218…9De5` default and block 16407578 must not be presented as the current production pair. Record new addresses only from actual deployment receipts.

The web exposes surplus claim, funded repayment/close, fee preview, caps/pause and Recovery Mode states, keeper health, and chain-specific transaction links. Mainnet transaction mode requires a configured deployment and explicit enablement; protocol-market reads alone do not enable writes. Mainnet starts around a 200% CR / 2x UI target and displays unaudited, thin-pool, and position-limit information. All wallet connectors and transaction clients must use the selected supported chain consistently; reject mismatches.

If a valid WalletConnect project ID is unavailable, preserve working injected/Bitcoin wallet paths and accurately show WalletConnect availability. Do not ship a made-up project ID as a working connection. Preserve the existing OrangeKit option where Passport cannot compile.

Make the keeper chain-aware and configure a separate mainnet service/environment identity at release time. Testnet and mainnet factories, RPCs, status, and explorer links must not be mixed. Deployment scripts need a validated network choice and explicit mainnet inputs rather than silently reusing testnet addresses.

The web remains a static Next.js export served by the tested Docker/Nginx image. Keep extensionless app routes, static-asset behavior, non-default PORT operation, and actual 404 responses. Extend CI for the new `/keeper` page and shared deployment validation. Avoid the deprecated Railway Config as Code settings rejected in this environment; document/apply root and health configuration through supported Railway service settings.

## Proofs, verification, and materials

Update verification tooling for every deployed library plus FlashSizer, Park, implementation, and factory. Do not treat an explorer submission, queued result, or partial match as full verification. A release checker should compare the selected manifest, live factory implementation, receipt chain/status, libraries, public app factory/block, keeper state, and verification metadata.

Provide a reproducible local/fork e2e and a separate funded matsnet evidence workflow for create, fee-bearing open/increase, setGuard, bounded guard, claim, safe RM repayment, and close when permitted. Label local/fork scenarios as such. A Recovery Mode test must exercise actual protocol restrictions or a purpose-built protocol-equivalent fixture; mocking only a flag while allowing forbidden close is not proof.

Build a proof collector/validator for user-provided tester addresses and successful receipts tied to the selected factory and chain. Require the PRD's 3–5 distinct tester wallets before declaring that evidence complete. Generated test wallets or existing developer activity must not be described as recruited real users. Prabal's tester recruitment remains an external input.

Prepare a deck source and reviewable PDF/PPTX, an updated <=120-second demo/pitch asset and script, chain-labelled screenshots, refreshed changelog, and paste-ready AKINDO Updates. The team is Prabal Pratap Singh, Nikhil Verma, and Neha Singh. Include the actual on-chain fee model and Wave 2 delta. Keep claims, addresses, test counts, and verification state current. Source footage from a local/fork demo must carry that label; a matsnet transaction claim requires the actual receipt. Submission publication is not implied by writing the draft.

Update SECURITY.md and THREAT_MODEL.md for exact oracle bounds, tip rules, fee authority, pause/cap surface, RM limits, reserve/governor trust, legacy deployments, and the new test coverage. Materials must distinguish matsnet and mainnet and avoid fabricated usage or audit claims.

## Acceptance and validation

PRD traceability for the implementation plan:

| PRD items | Implementation / acceptance location |
| --- | --- |
| F1 | Owner surplus claim, authorization tests, and actual claim proof when available |
| F2 | Approved protocol-compatible RM repayment, blocked close, and later permitted owner close |
| F3, A9 | Shared PriceMin fill rules, four flash/guard tests, callback checks, and deployment proof |
| F4, A10, A13 | Running keeper, no-op/backoff behavior, health endpoint, public freshness/status UI, and real rescue proof |
| F5, A12 | Exact linked deployment, source verification, manifests, and funded matsnet e2e evidence |
| F6, A11, A17 | Factory/address/block pair, live routes, production image, public URL, and accurate submission draft |
| F7 | On-chain 25/50 bps fee policy, charging/quotes/UI, zero-fee rescue and exit tests |
| F8 | Onboarding and proof validation; actual tester recruitment and receipts remain required inputs |
| A14, A15 | Conditional Passport fallback and confirmed-address savings/gauge integrations |
| A16 | Team/fee/chain-correct deck, <=120-second video, screenshots, changelog, and Updates draft |
| A18 | Security/threat-model updates matching the implemented behavior and deployment evidence |
| A19 | Caps/pause, chain-aware app/keeper/scripts, verified mainnet readiness, and separate go-live gate |

Keep all existing meaningful regression coverage, updating deliberately changed behavior rather than deleting tests. Use test-first implementation for substantive changes. Required coverage includes:

- Owner-only claim, actual collateral forwarding, and unsuccessful/repeated claim behavior.
- RM refusal of opens, pure owner repayment, protocol-blocked full close, eventual permitted close, and no collateral withdrawal through an RM rescue.
- Fee default 25, setting 50, rejecting 0/51 and unauthorized setters, correct recipient, exact minted-notional charge, gross-up/rounding, UI-accepted fee ceiling, and zero fee on every rescue/exit path.
- All four PRD A9 path tests: owner flash close beyond the bound, FlashSizer delever bound, flashLoop callback bound, and a guard sandwich that cannot steal tip. Add boundary and rounding cases for the common PriceMin rule.
- Empty-reserve unsafe guard returns false without transfers/tip; funded reserve progress survives a skipped sale; real failures remain visible.
- Caps on risk-increasing operations; unauthorized/guardian actions; pause/unpause and exact allowed rescue/exit/top-up behavior.
- Keeper no-op backoff/reset, alert deduplication, stale health, confirmed-heartbeat handling, and chain/factory separation.
- Valid and invalid deployment manifest/override pairs; frontend fee/claim/RM/cap/health states; wallet availability and chain correctness.
- Full Foundry suite, invariants, bytecode sizes, compiler checks, keeper checks, production web build/container routes/404, and browser flows on a local fork.
- A separate release verification for actual matsnet and, only if gated, mainnet deployments. Verify health plus intended commit/source/address rather than relying on CLI exit code alone.

## Delivery order and release boundaries

Implement in this order within the authorized overall scope: common oracle policy and guard behavior; owner claim and funded RM-safe actions; fee-aware sizing/charging and policy/caps/pause; shared deployment configuration and deployment tooling; keeper and web integration; e2e/proof tools and materials; reviewed release verification. Independent UI/material work may be delegated after interfaces are fixed, but financial contract changes require a coherent review of the final combined behavior.

Matsnet rollout requires completed tests and a usable authorized deployer identity. Replace only the intended web/keeper deployment after new addresses and receipts are confirmed. Existing live clones remain reachable and clearly labelled.

Mainnet remains a separate final gate from the PRD: A9 and full tests green, matsnet e2e/verification healthy, explicit caps and pause configuration, funded mainnet keeper, rollback readiness, and Prabal's go-live approval at that time. The current implementation request authorizes preparing this track; it does not substitute for that moment-of-go-live decision.

Real-user proofs, a missing configured signing identity, unavailable third-party project IDs/addresses, and actual external submission fields must be reported as external dependencies if still absent. Complete all independently buildable work and make the release artifact reviewable before requesting any release-specific action.

## Builder-discretion decisions and known external state

The proposed factory policy shape, optional owner-actions library, additive fee-limit overloads, initial paused state, explicit nonzero opening limits, per-account backoff details, `/keeper` page, and manifest schema are builder choices for review. Exact file splits, bounded retry timings, UI component placement, and test-fixture organization can be settled during planning without changing the product rules above.

Mainnet numeric limits are deliberately release inputs, not invented mainnet operating recommendations. No mainnet opens can be enabled with absent limits. Passport and gauge/savings addresses remain conditional as allowed by the PRD.

At design preparation time GitHub API access through `gh` returned HTTP 401, while the configured Git remote successfully confirmed main at the pinned SHA. Local work can proceed; authenticated PR/API publication will require working repository credentials if that state persists. Railway deployment authentication must also be rechecked before a release. No credential values were inspected.
