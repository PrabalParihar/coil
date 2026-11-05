# Coil Labs pitch script and storyboard

**Final asset: [coil-wave2-pitch.mp4](pitch/coil-wave2-pitch.mp4), 112 seconds, 1600×900, text-guided with no audio.** Eight deliberately paced scenes form a complete product narrative. Every frame is labelled illustrative, release candidate and not chain proof. No historical recording was blindly truncated.

The optional [SRT transcript](pitch/coil-wave2-pitch.srt) matches the on-screen guide. Source and timing are in [slides.json](pitch/slides.json). The [deck PDF](pitch/coil-wave2-deck.pdf) and [PPTX](pitch/coil-wave2-deck.pptx) contain the same eight scenes.

## 0:00–0:14 | BTC exposure. A clearer way to reduce risk.

Visual: [scene 1](pitch/frames/01.png). An owner-controlled account borrows MUSD against BTC and routes through Mezo Pools. Permissionless guards can reduce risk within the owner's settings.

On-screen guide / optional voiceover:

Start with the product: BTC holders choose exposure; the account holds the trove. This is an illustrative walkthrough, not a new transaction recording.

## 0:14–0:28 | 01  Review, then open.

Visual: [scene 2](pitch/frames/02.png). Choose BTC size and collateral ratio. Review gross MUSD minted, the separate Coil fee, depth, caps and pause state before signing.

On-screen guide / optional voiceover:

The transaction enforces the accepted fee ceiling. A flash open succeeds atomically only when pool liquidity, oracle bounds and opening policy allow it.

## 0:28–0:42 | 02  Fund a guard. Keep ownership.

Visual: [scene 3](pitch/frames/03.png). Set a guard floor and target, park MUSD and fund MEZO tips. Anyone may trigger permitted risk reduction; the caller cannot take BTC or MUSD.

On-screen guide / optional voiceover:

A guard is a best-effort risk tool, not guaranteed liquidation protection. With an empty reserve and unsafe sale, it returns false without a tip.

## 0:42–0:56 | 03  Repay, claim, or close.

Visual: [scene 4](pitch/frames/04.png). Approve MUSD to the account for safe repayment. Claim only recovered surplus. Close with funded MUSD only when Mezo permits the protocol close.

On-screen guide / optional voiceover:

Recovery Mode blocks new leverage and can block full close. It does not imply a guaranteed exit. Rescue, repayment, claim and exit carry zero Coil fee.

## 0:56–1:10 | One bound. Explicit operational limits.

Visual: [scene 5](pitch/frames/05.png). All pool fills use the same PriceMin snapshot before flash and in callback, including owner flash close. No second slippage widening.

On-screen guide / optional voiceover:

Public keeper status must show scan freshness and execution mode. A process start, old heartbeat or monitoring-only service is not active transaction protection.

## 1:10–1:24 | Historical execution is useful evidence.

Visual: [scene 6](pitch/frames/06.png). An October testnet run recorded flash open, a ratio-improving guard with a 1 MEZO tip, and close. Those receipts belong to an older factory.

On-screen guide / optional voiceover:

Historical receipts do not prove the completion release's fees, claim or Recovery Mode flow. Exact links and limitations are in DEPLOYMENTS.md.

## 1:24–1:38 | A release earns its proof.

Visual: [scene 7](pitch/frames/07.png). The new build still needs funded matsnet feature receipts, full indexed source verification, matching app and keeper metadata, and 3-5 recruited testers.

On-screen guide / optional voiceover:

Existing clones are not upgradeable. Mainnet stays gated, starts paused and requires a separate go-live decision after the release checks pass. The contracts are unaudited.

## 1:38–1:52 | Build the BTC leverage desk with us.

Visual: [scene 8](pitch/frames/08.png). Prabal Pratap Singh   /   Nikhil Verma   /   Neha Singh

On-screen guide / optional voiceover:

Explore the public app and repository. This pitch is illustrative release-candidate material; no new deployment, independent audit or recruited-user count is claimed.

## Provenance and claim boundaries

All product screens in this pitch are explanatory diagrams of the release candidate. The historical slide refers only to the older October matsnet build, chain 31611, with exact links in [DEPLOYMENTS.md](../DEPLOYMENTS.md). It does not show new fee, claim or Recovery Mode transactions. New funded feature proofs and recruited users remain pending. Mainnet chain 31612 is not live and remains gated. No independent audit or continuous uptime claim is made.

The original [171.76-second Wave 1 recording](media/coil-demo.mp4) remains unchanged as historical media. The separately redesigned static captures may contain placeholder hashes, so the [labelled screenshot sheets](evidence/screenshots/) explicitly call them illustrative legacy UI, not transaction evidence.

Team: **Prabal Pratap Singh, Nikhil Verma, Neha Singh**. Fee copy: default **25 bps**, factory-owner range **1–50 bps**, zero Coil fee on rescue/guard/repayment/claim/exit. Publication remains a separate step.
