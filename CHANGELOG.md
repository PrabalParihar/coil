# Changelog

## Wave 2 completion release candidate (unreleased)

Source implementation, local verification, public deployment proof and submission publication are distinct states. No new on-chain address, recruited tester or audit is established by this changelog. Existing clones are not upgraded.

- Add owner surplus claim, funded MUSD repayment, protocol-permitted funded close and direct collateral top-up.
- Use the approved Recovery Mode flow: block new leverage; allow safe pure debt repayment; keep full close subject to Mezo's actual restrictions, with no automatic queued transaction.
- Introduce a factory-owner Coil fee: default 25 bps, accepted range 1–50 bps. Charge only newly minted MUSD on open/increase; rescue, repayment, claim and exit carry zero Coil fee. Include fee gross-up in debt/CR and transaction-enforce the accepted fee ceiling.
- Apply one PriceMin oracle snapshot/bound to planned fills and flash callbacks, including owner flash close. Remove the former owner-close exception for out-of-bound pool prices. Direct funded close avoids a pool sale when protocol closing is allowed.
- Preserve reserve-first rescue improvement; unsafe empty-reserve guard is a false/no-tip result. Callback violations revert atomically.
- Start new factories paused with unset limits; require finite nonzero collateral/debt limits before unpausing. Guardian pauses; owner configures/unpauses. Repayment, exit, claim, guard and direct collateral top-up remain available.
- Add keeper scan freshness/status, configured-keeper heartbeats, simulation before sending and bounded unchanged-failure backoff.
- Centralize chain-specific public deployment metadata and validate factory/block overrides together. Mainnet transaction mode needs a configured deployment and explicit enablement.
- Implement manifest generation/staleness checks, partial RPC receipt collection and the separate full online source/compiler/keeper/web release gate. Offline checks do not certify live readiness. Deployment preflight requires explicit chain/RPC agreement and always leaves opens paused; verification now includes all seven components with distinct `OWNER_LIB` and `OWNER` inputs.
- Refresh team, fee, chain and evidence copy; add deck source, PDF/PPTX, a 112-second text-guided illustrative pitch, storyboard and an empty proof ledger. AKINDO Updates remain a draft.

## Production baseline recorded by the 5 November 2026 PRD gap review

Legacy matsnet production factory `0xff3335576f998EE872596d4EB7ABECb71a0D5BC8`, block 16408315, chain 31611. Its implementation source predates the completion work. Verification was partial: five contracts reported verified, Legacy was unverified and implementation full verification was false. This observation is dated; it is not a current release certificate.

## Historical Wave 2

Flash loop, unwind and delever, permissionless MEZO-tipped guard, MUSD reserve, peg checks, Railway keeper and public chain history. A 27 October matsnet run on an earlier factory exercised flash open, rescue and close. Those receipts do not prove the completion release's fees, claim or Recovery Mode actions. See [DEPLOYMENTS.md](DEPLOYMENTS.md).

## Wave 1

Owner clone, two-swap router loop, multi-transaction delever/unwind, restricted guard and no MEZO tip. Original media remains historical or illustrative; it is not the new release proof.

## Pending release inputs

Exact new deployment/verification receipts; funded matsnet create/open/increase/guard/claim/repay/close proofs; 3–5 recruited tester wallets and receipts; public app/keeper readback; mainnet caps/go-live approval; confirmed savings/gauge addresses. Not independently audited.
