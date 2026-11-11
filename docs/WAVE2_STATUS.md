# Wave 2 implementation and release status

This matrix follows the supplied Wave 2 PRD's 19 IDs and the approved completion design. The paused matsnet completion factory `0x339ef0116e17BA42987c1E2E380Af59B38f62064`, block 16708730, is the active chain 31611 deployment. Opening is paused. That record is not funded acceptance, indexed verification, or an activated live release. Existing public clones on retained factories are immutable legacy builds. Mainnet go-live remains a separate explicit decision.

| ID | Implemented in this change | Public acceptance still needed |
| --- | --- | --- |
| F1 | Owner-only recovered collateral claim, balance isolation and web action | Funded surplus-claim receipt on the completion factory |
| F2 | Safe owner MUSD repayment in actual protocol Recovery Mode, minimum-debt handling, explicit banner and later owner-initiated close | Funded `repayRM` and protocol-permitted full-close proofs |
| F3 | One oracle bound across router, flash sizing and callbacks | Deploy and verify the exact bounded build |
| F4 | Retry/backoff, simulation, confirmed writes, redacted health API and public status UI | New-generation always-on execution service, authenticated fresh heartbeat and real guard receipt |
| F5 | Seven-component deployment/verification commands and exact source/compiler/component/link graph release gate | Fully indexed verification of every completion-release component. FlashSizer and CoilPark have no top-level creation transaction |
| F6 | Static app and public routes, deployment provenance and honest capability labels | Completion-factory public release and actual AKINDO live-URL field |
| F7 | Owner-set 1–50 bps fee, 25 bps default, accepted-fee ceiling, gross debt sizing and fee preview | Funded new-factory open/increase fee receipts |
| F8 | Usable wallet onboarding/faucet/errors and consented tester-proof tooling | Recruit 3–5 real users and record their actual chain-labelled receipts |
| A9 | Flash close/sizer/open/guard oracle bounds, delivery adversaries and no-tip sandwich regression tests | Funded exact-build path measurements and matsnet acceptance before mainnet |
| A10 | Unsafe empty-reserve guard returns false without a tip; keeper deduplicates and backs off | Observe new-factory production behavior under the relevant market conditions |
| A11 | Validated factory/block pairs generated for web and keeper | Completion pair recorded: factory `0x339ef0116e17BA42987c1E2E380Af59B38f62064`, block 16708730. Public app/keeper rollout on that pair is still separate |
| A12 | Chain-checked paused bootstrap, finite limits, full library linking and local-fork deployment/readback | Paused matsnet factory is deployed with finite limits. Full verification and explicit app/keeper rollout remain |
| A13 | `/keeper`, authenticated chain evidence, optional service mode, stale/error handling | Configure a real public status endpoint and verify execution-mode freshness |
| A14 | Existing OrangeKit/injected fallback preserved; no fabricated WalletConnect ID | Passport remains conditional on a compatible compiling package |
| A15 | Existing asset-checked savings adapter preserved | Confirm real savings/gauge addresses before enabling a live integration |
| A16 | Three-person team, eight-slide PDF/PPTX/source, 112-second labelled illustrative pitch, Updates draft and changelog | Actual funded feature demo and authorized submission publication |
| A17 | Production static routing, four page routes and unknown-route 404 checked | Verify public routes on each rollout; automatic Railway GitHub trigger remains unconfigured |
| A18 | Updated security policy, threat model, fee/guard/exit risks and release boundaries | Independent audit is not claimed |
| A19 | Explicit mainnet selection, owner/guardian pause, finite caps, <=2x UI default, strict deployment/write gates and rollback instructions | Approved depth/caps, verified matsnet proofs, funded separate mainnet keeper, rollback drill and explicit go-live approval |

Legacy continuity is part of rollout: retain prior deployment generations in the manifest, let owners discover/select their existing accounts, and keep a separate compatible keeper image and service pinned to each generation that needs coverage. The current adapter supports the two reserve generations and new policy build; older flash/Wave 1 generations need a validated prior compatible image, with coverage explicitly unproven here. A new factory's health does not prove protection of older accounts.

The release gate rejects successful no-op action receipts and mismatched components. Every action conservatively requires an isolated transaction block and archived pre/post state; Recovery Mode additionally requires unambiguous protocol state and historical prices; unavailable public evidence stays pending. See [deployment gates](../DEPLOYMENTS.md), [evidence commands](evidence/README.md) and [submission materials](SUBMISSION.md).

Local verification: clean Foundry rebuild **78/78**; deployment/evidence tests **49/49**; web **40/40** plus lint/typecheck/production image; keeper typecheck/five suites and real HTTP health. The [labelled local-fork browser run](evidence/local-fork/README.md) covers 14 phases / 17 confirmed local transactions, including exact fee accounting, protocol Recovery Mode repayment and an owner exit from a retained clone. Final web image serves four routes and client assets with HTTP 200, and unknown routes 404. GitHub PR/CI records the integration result.
