# AKINDO submission draft: Coil Labs

**Draft only. Nothing in this file has been posted or sent externally.** Review the final controller verification and current public deployment before publication. Source implementation, local/fork tests, funded public receipts, recruited testers and publication are separate states.

## Title and category

**Coil Labs**. Track 1, DeFi: BTC leverage looping through MUSD borrowing on Mezo.

## One-sentence pitch

Coil Labs turns an owner-controlled BTC deposit into a leveraged BTC position through Mezo MUSD and Mezo Pools, with permissionless risk reduction, a transparent borrowing fee and explicit exit limits.

## Product and audience

BTC holders choose a collateral ratio instead of hand-building the borrow, swap and collateral-add sequence. A per-owner EIP-1167 account owns the protocol trove. An atomic flash loop borrows BTC from Mezo Pools, opens/increases the MUSD trove and repays the pool with minted MUSD when oracle bounds, liquidity and policy allow it.

Owners set guard thresholds, park MUSD and fund MEZO tips. Anyone may trigger permitted risk reduction, but a guard caller cannot take BTC/MUSD or change the owner's settings. The reserve is used first. A genuine oracle-measured CR improvement can earn a balance-capped MEZO tip, at most once per account per block. An unsafe empty-reserve attempt returns false without a tip. This is best-effort risk management, not guaranteed protection against liquidation or redemption.

Owner controls distinguish surplus claim, safe funded MUSD repayment and full close when protocol rules permit it. During Recovery Mode, new leverage is blocked and safe pure repayment can reduce debt subject to the minimum-debt rule. Mezo can block full close; the owner submits a later close when permitted. There is no automatic queued exit.

## Fee model

The factory owner controls the Coil fee and recipient. The default is **25 bps (0.25%)** and the permitted range is **1–50 bps**, with a **50 bps (0.50%) hard maximum**. The fee applies only to newly minted MUSD on successful open/increase borrowing. The quote separates gross minted MUSD and the Coil fee, and execution enforces the owner's accepted maximum fee. The new factory's legacy two-argument opening selectors use the documented 50 bps maximum.

**Zero Coil fee** applies to guard, rescue, reserve repayment, owner repayment, delever, unwind, close and surplus claim. Pool/protocol fees and gas remain separate. Flash gross-up includes the larger borrowing in debt and collateral-ratio sizing.

## Wave 2 completion delta

- Owner surplus claim, safe funded repayment, protocol-permitted funded close and direct collateral top-up.
- One PriceMin oracle snapshot/bound for planned pool fills and flash callbacks, including owner flash close. No quote-relative second widening.
- Factory-owner fee policy and transaction-enforced accepted ceiling.
- New factories start paused with unset limits; finite nonzero BTC-collateral/total-MUSD-debt caps are required to unpause. Guardian pauses; only owner unpauses. Risk reduction remains available.
- Keeper backoff for unchanged failures, pre-send simulation, public scan freshness, configured-keeper heartbeat identity and accurate monitoring/execution mode.
- Chain-specific deployment metadata, paired factory/block validation, legacy account capability labels and explicitly gated mainnet writes.
- Updated three-person team, deck PDF/PPTX and source, a **112-second text-guided illustrative pitch**, storyboard and empty proof ledger.

These describe the completion release candidate. Existing immutable public clones do not gain these capabilities from a source or web change.

## Technical integration

Solidity 0.8.24, Foundry, Shanghai/via IR, EIP-1167 accounts and linked libraries. MUSD BorrowerOperations owns the debt lifecycle; TroveManager, SortedTroves, HintHelpers and PriceFeed support CR and redemption information. Mezo Pools is the swap/flash venue. MUSD is newly minted debt; MEZO funds guard tips.

Every runtime must remain below EIP-170's 24,576-byte limit and changed execution paths within Mezo's 20 native-precompile-call limit. Historical budget constants are not proof of the changed paths. Keeper: TypeScript/viem, Docker/Railway and optional Telegram. Web: Next.js static export, Docker/Nginx, React/wagmi/viem and OrangeKit wallet paths. Passport and savings/gauge integrations remain conditional on compatible packages and confirmed chain-specific addresses. WalletConnect requires a valid project ID.

## Chain and current evidence

**Matsnet: chain 31611.** The active factory is the paused completion release [`0x339ef0116e17BA42987c1E2E380Af59B38f62064`](https://explorer.test.mezo.org/address/0x339ef0116e17BA42987c1E2E380Af59B38f62064), deployment block **16708730**, implementation `0xf61CEf72Fc0CA52dBFC86C0eDE7F7a3fC8C64b45`, from main `7fd588a`. Opening is paused. Keeper `0x1D2621480011C44693a47801C1158E70b25b4B4F`. The 5 November 2026 PRD gap review's legacy production factory [`0xff3335576f998EE872596d4EB7ABECb71a0D5BC8`](https://explorer.test.mezo.org/address/0xff3335576f998EE872596d4EB7ABECb71a0D5BC8), block **16408315**, implementation `0xd4495f969995b3e48998573b5adc6f3106672b80`, is retained. The older `0x2218…9De5` / 16407578 pair is historical.

The PRD gap review observed the public app and chain heartbeats for that retained legacy build. It found partial source verification of that build: five components reported verified, Legacy was unverified and implementation full verification was false. Those dated observations are not verification of the completion factory. Full indexed verification of the new components is not claimed. FlashSizer and CoilPark have no top-level creation transaction.

A separate October run on an older matsnet factory recorded flash open, a guard with a 1 MEZO tip, and close. Its receipts are in [DEPLOYMENTS.md](../DEPLOYMENTS.md). They do not prove the completion release's fee, claim or Recovery Mode behavior. The original media is Wave 1; redesigned static captures contain illustrative UI states and placeholder hashes. They are labelled as illustrations in the new materials.

**Recorded, still paused:** the completion-release factory, implementation, libraries, limits and keeper above. **Pending:** full indexed source verification, owner unpause, funded new-feature e2e receipts, public app/keeper readback on this factory and 3–5 recruited testers. The [proof ledger](evidence/tester-proofs.json) is intentionally empty. Local/fork fixtures and generated wallets are not real-user or public transaction evidence.

**Mainnet: Mezo chain 31612. Not released.** Go-live remains separately gated behind security/matsnet verification, measured depth, explicit finite caps, chain-correct configuration, a separate keeper identity, rollback drill and explicit approval. Initial mainnet UI targeting is around 200% CR / 2×, subject to depth. Read-only protocol market data is not a Coil deployment or write enablement. **Unaudited.** No independent review claim is made.

## Team

**Prabal Pratap Singh, Nikhil Verma and Neha Singh.**

Project contact: [Prabal on GitHub](https://github.com/PrabalParihar), [X](https://x.com/0xPrabalParihar), [LinkedIn](https://www.linkedin.com/in/0xprabal/).

## Reviewable materials

- [Deck PDF](pitch/coil-wave2-deck.pdf), [PPTX](pitch/coil-wave2-deck.pptx), [editable content source](pitch/slides.json), [renderer](pitch/generate.py), [deck source notes](pitch/README.md).
- [112-second pitch MP4](pitch/coil-wave2-pitch.mp4), [script/storyboard](VIDEO_SCRIPT.md), [storyboard frames](pitch/frames/), [subtitle file](pitch/coil-wave2-pitch.srt).
- [Chain-labelled illustrative screenshots](evidence/screenshots/), [artifact validation](evidence/artifact-validation.json).
- [Changelog](../CHANGELOG.md), [security notes](../SECURITY.md), [threat model](../THREAT_MODEL.md).

## Paste-ready Updates draft

```text
Coil Labs | Wave 2 completion release candidate

Team: Prabal Pratap Singh, Nikhil Verma, Neha Singh.

We are completing the owner-controlled BTC leverage desk on Mezo: surplus claim, funded MUSD repayment and protocol-permitted close; one PriceMin bound across pool fills and flash callbacks; reserve-first, no-op/no-tip guard behavior; and public keeper freshness.

The Coil fee defaults to 25 bps on newly minted MUSD for successful open/increase borrowing. Factory-owner policy is capped at 50 bps and the transaction enforces the accepted ceiling. Rescue, guard, repayment, claim and exit carry zero Coil fee. Pool/protocol costs and gas are separate.

New factories start paused. Finite nonzero collateral/debt limits are required before owner unpause; a guardian may pause risk increases. Recovery Mode permits safe repayment subject to protocol rules, not a guaranteed full close or queued exit.

Public app: https://coil.up.railway.app
Code: https://github.com/PrabalParihar/coil

The active matsnet factory is the paused completion release 0x339ef0116e17BA42987c1E2E380Af59B38f62064 at block 16708730, chain 31611. Opening is paused. The 5 November legacy factory 0xff3335576f998EE872596d4EB7ABECb71a0D5BC8 at block 16408315 is retained and is not upgraded. Full source verification, owner unpause, funded feature proofs, matching public app/keeper readback and 3-5 recruited testers remain pending. Historical receipts are labelled by build; the proof ledger is empty until actual inputs arrive.

Deck PDF/PPTX and source plus a 112-second text-guided illustrative product pitch are in docs/pitch. The pitch is not new on-chain transaction proof.

Unaudited. Mainnet is not live and remains behind its separate depth, caps, verification, keeper, rollback and approval gates.
```

Before publication, replace pending statements only when successful receipts and fresh verification/readback exist. Do not insert synthetic user counts, placeholder addresses, queued verification success or unexecuted transaction claims.
