# Coil Labs threat model

Scope: Wave 2 completion release candidate, its account/factory/linked libraries, MUSD reserve, web configuration and keeper. This is a design/security document, not an audit. The last review-established public deployment is legacy matsnet `0xff3335576f998EE872596d4EB7ABECb71a0D5BC8`, block 16408315, chain 31611; existing clones do not gain these changes. New deployment and mainnet proof remain pending.

## Assets and trust boundaries

Assets are BTC collateral and surplus, MUSD debt/reserve, owner-supplied repayment funds, MEZO tips, accepted fee terms, deployment identity and accurate public service state. The wallet authorizes its clone; the clone owns the protocol trove. Mezo BorrowerOperations, TroveManager, SortedTroves, feed, token precompiles and Mezo Pools are external dependencies. Linked libraries execute in account storage context, so their exact bytecode is part of the trusted build.

| Actor / boundary | Allowed authority | Principal failure or abuse | Constraint / residual risk |
| --- | --- | --- | --- |
| Account owner | Open within policy, configure guard/bounds, fund reserve/tips, repay, claim, top up, permitted close | Excess leverage, broad slippage, missing reserve/MEZO or unsafe settings | Contract bounds and protocol restrictions apply; owner still chooses exposure and funding. |
| Permissionless guard caller | Trigger configured risk reduction and receive a valid MEZO tip | Manipulate pool to sell cheaply or collect a no-op tip | Same PriceMin snapshot before flash and in callback; actual CR improvement; per-block/balance tip cap. Bounded execution can still realize market loss. |
| Factory owner | Fee 1–50 bps/recipient, finite opening limits, keeper/guardian, pause/unpause | Fee increase before inclusion, excessive limits, unavailable new opens | Transaction fee ceiling, hard fee cap, pause/cap checks, no user-asset withdrawal or clone upgrade. Owner policy remains trusted. |
| Guardian | Pause risk increases | Denial of new leverage | Cannot unpause/set fee/caps; risk reduction remains available. |
| Park governor / savings vault | Select shared MUSD ERC-4626 adapter | Malicious vault, illiquidity, unsafe switch stranding reserves | Asset check is necessary but insufficient; verify/audit vault and migration behavior before enabling. No confirmed live integration claimed. |
| Oracle / protocol | Supply price, debt and close/repay rules | Fresh but incorrect price, stale feed, RM close blocked, liquidation/redemption | Zero/stale failure, same snapshot fill bounds, honest RM UI. No availability or price guarantee. |
| Pool / callback | Fixed immutable venue and authenticated initiated callback | Adverse reserve change, spoofed callback, slippage widening | PriceMin checks actual amounts; flash-kind/authentication/reentrancy guards; atomic revert. Thin depth still limits trade size. |
| Keeper host / operator | Simulate/send guard and authenticated heartbeat | Stalled polling, low gas/tips, leaked key, false healthy state | Public scan freshness, mode/identity labels, pre-send simulation and bounded retry. Service uptime is not guaranteed. |
| Web / deployment metadata | Select chain, factory/block, capabilities and explorer | Chain mismatch, stale legacy ABI, false mainnet write availability | Validated paired metadata, selected-chain clients, explicit mainnet enablement and legacy capability labels. Compromised hosting remains a trust risk. |

## Core financial properties

Only newly minted MUSD from successful open/increase borrowing pays the Coil fee: floor of gross minted amount × bps / 10000. Default 25 bps; maximum 50 bps. Gross-up and protocol fees must appear in debt/CR sizing. Rescue, guard, claim, repayment and exit pay no Coil fee. Fees, tips and position effects roll back on revert. The owner can bind a lower accepted fee; compatibility open selectors on the new factory accept the documented 50 bps ceiling.

Opening policy starts paused with unset limits. Owner sets finite nonzero total-collateral and total-debt caps before unpause. Actual final balances are checked. Lowered caps and administrative pause do not strand risk reduction: repay/close/claim/reserve withdrawal/guard remain available, and direct collateral top-up is exempt. An open/increase through a leveraged method still follows policy.

A guard caller never receives BTC/MUSD or discretionary owner permissions. Tip eligibility follows actual oracle-measured improvement, never a successful transaction alone. Empty reserve plus unsafe sale returns false and pays no tip. A safe reserve repayment may survive a predictably skipped sale; arbitrary callback violations revert atomically. Reserve funding does not promise every rescue succeeds.

## Recovery Mode and exit availability

Mezo permits safe pure debt repayment but can forbid full close while in Recovery Mode. Coil must not imply that wrapping `closeTrove` bypasses that rule. Owner repayment pulls only the usable approved MUSD, respects minimum remaining net debt and leaves unused requested input with the owner. Reserve repayment in RM must not withdraw/sell collateral through forbidden protocol paths. Insufficient reserve can produce a safe no-op.

Full close remains subject to protocol Recovery Mode, system-ratio and other restrictions. The owner submits a later close once permitted; no automatic queued close exists. Outside RM, a pool-based owner flash close still obeys PriceMin. A direct funded close avoids the pool price but not protocol rules. No unconditional escape route is promised.

## Oracle, ordering and market risk

PriceMin sets an output floor for actual MUSD paid or BTC sold. A valid feed price and bound are snapshotted before flash initiation and reused in callback. Quote-relative widening or a second slippage allowance would violate the boundary. The peg check is additive and does not validate oracle correctness.

A sandwich can cause a revert or execute at a worse price still inside the owner bound. The property is bounded execution and no unearned tip, not MEV elimination. A stale feed fails closed, reducing availability during an emergency. Liquidation, redemption, minimum debt, pool depletion and rapidly moving prices can prevent the guard from reaching its target. The redemption search walks at most 32 troves; being outside that window is not an absence of redemption risk.

## Operational and public-health claims

Retries back off only while relevant inputs remain unchanged and reset promptly on new funding, owner settings, position or oracle changes. Simulation failure prevents sending. The keeper cannot turn a failed simulation into a rescue claim. Health responses expose only public identity/configuration, freshness and safe counters; never secrets or environment dumps. Monitoring mode is not active transaction protection.

New-factory heartbeat authentication identifies the configured keeper. A legacy permissionless heartbeat is historical activity, not authenticated health. Public pages must distinguish loading/error/unconfigured/stale from fresh. An old success or a Railway process start is not continuous uptime evidence. Telegram remains optional, chat-authorized and data-only; tokens must not enter logs/status/artifacts.

## Release boundary and evidence

A local/fork fixture can validate protocol-equivalent RM restrictions and adversarial paths, but is not a public matsnet receipt. The ledger must distinguish those sources. Tester evidence needs 3–5 recruited consenting public wallets with successful receipts bound to the exact chain/factory; generated addresses or developer runs are not user adoption.

The new linked build needs actual successful deployment receipts and full indexed verification for all components. The dated production review found Legacy unverified and implementation full verification false. A partial match or explorer queue is incomplete. Review runtime sizes below 24,576 bytes and changed native-precompile paths within 20 calls; historical constants and historical Slither output are insufficient for the new release.

Mainnet stays gated behind verified matsnet/security checks, current pool-depth review, explicit finite caps, separate chain-correct service identity, rollback drill and go-live approval. Initial UI targeting around 200% CR / 2× does not guarantee fills. Pausing stops risk increase; it cannot reverse immutable clones or guarantee a protocol-blocked close.

No independent audit, live savings/gauge integration, new recruited-user count, new source verification or new chain deployment is asserted by this document. See [SECURITY.md](SECURITY.md), [DEPLOYMENTS.md](DEPLOYMENTS.md) and the [proof ledger](docs/evidence/README.md).
