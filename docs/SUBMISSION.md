# AKINDO submission — Coil Labs

Paste-ready answers for the Mezo Buildathon Wave 2 form. Wave 2 build runs 2–15 November 2026. Judging runs 16–22 November. Wave 1 edits stay locked until 1 November 2026, 20:30 IST. Nothing in this file has been posted.

Product display name: **Coil Labs**. Repository, contracts, and URL stay Coil.

## Title

Coil Labs

## Category

BTC leverage looping (MUSD borrowing)

## One-sentence TL;DR

Coil Labs turns a BTC deposit into a ~4× leveraged BTC position on Mezo in one transaction: a flash swap from Mezo Pools' MUSD/BTC pair, a MUSD trove, and the pool repaid with freshly minted MUSD. A permissionless, MEZO-tipped `guard()` lets any keeper de-lever it before liquidation or redemption, but never take funds.

## How it works

1. `createAccount()` deploys one non-upgradeable EIP-1167 clone. The clone is the MUSD borrower. Nobody but the owner can withdraw. Anybody can make the position safer.
2. `flashLoop(targetCR, slippage)` with BTC attached flash-swaps BTC out of the Mezo Pools MUSD/BTC pair, opens or tops up the trove, mints MUSD, and repays the pool in that same transaction. The ratio lands on or above the target, or the transaction reverts. Coil will not target below 115%. Liquidation is 110%.
3. The owner sets a guard (`setGuard(floor, target, zone, tip)`) and funds a MEZO tip. When the ratio is under the floor, or the trove sits within `zone` places of the front of the redemption queue (max 32), anyone can call `guard()`. It flash-repays toward the target and pays the tip only if the ratio rose, at most once per block. It cannot loop, unwind, withdraw, or send BTC or MUSD to the caller.
4. `flashUnwind(1e18)` closes the trove in one transaction and returns BTC. `flashDeleverTo` raises the ratio in one transaction. If the pool factory is paused, the Wave 1 one-sale path is the fallback.

By hand, a 133.33% (4×) target is not reachable by repeating borrow-and-swap rounds, and 3× is on the order of 19 wallet transactions. Coil Labs does 4× in one `flashLoop`. On testnet, 0.015 BTC became 0.05183 BTC of collateral against 3,100.8 MUSD of debt at 133.33%, matching `quoteFlashLoop`.

## MUSD and MEZO

MUSD is the debt. Every loop mints it through `BorrowerOperations` and every repay or close burns it. The flash swap is repaid in MUSD, so each position adds MUSD supply and MUSD/BTC volume. Mezo Pools is the only venue: the pool `hook` for the flash, and the router on the paused-pool fallback. Only the immutable pool can call `hook`, and only when this account started the swap.

MEZO pays the keeper. `guard()` transfers `min(tipMezo, balance)` to the caller only after the collateral ratio has risen. The live keeper earned 1 MEZO for the rescue below. Wave 1 did not spend MEZO.

Mezo allows 20 native-precompile calls per transaction. Measured paths: `flashLoop` 7, `flashUnwind` 8, `flashDeleverTo` 10, `guard()` plus the MEZO tip 12. `precompileBudget()` exposes those on the account. The two-swap `loop` remains because a third MUSD→BTC swap is the 21st call.

The app also uses `TroveManager`, `SortedTroves`, `HintHelpers`, and `PriceFeed`. Bitcoin and EVM wallets connect through `@mezo-org/orangekit`.

## Target group

BTC holders on Mezo who want leveraged BTC exposure against MUSD without hand-building a trove, a swap, an add-collateral, and a refinance, and keepers who earn MEZO for a rescue that can only raise the ratio.

## Tech stack

Solidity 0.8.24 (Foundry, via_ir, Shanghai), EIP-1167 clones, a `DELEGATECALL` library (`CoilLegacy`) so `CoilAccount` fits EIP-170, and `FlashSizer` for the pool's constant-product check. Mezo MUSD (`BorrowerOperations`, `TroveManager`, `SortedTroves`, `HintHelpers`, `PriceFeed`), the Mezo Pools pair and router, and MEZO. Keeper: TypeScript and viem, Docker on Railway, optional Telegram. App: Next.js 15, React 19, wagmi, viem, `@mezo-org/orangekit`, static export. CI runs `forge build --sizes`, `forge test`, and a local-anvil dry-run of `forge script`.

## Track

Track 1, DeFi (Borrowing, Lending, Looping, and Yield)

## Chain

Mezo testnet (matsnet), chain id 31611. The factory this submission exercised was [`0x6A38f560cF8612cc81cF966831890DBb310e31F7`](https://explorer.test.mezo.org/address/0x6A38f560cF8612cc81cF966831890DBb310e31F7). The app default is now [`0x2218D33d2f9279A4266b49dB572F5b1343d09De5`](https://explorer.test.mezo.org/address/0x2218D33d2f9279A4266b49dB572F5b1343d09De5) (block 16407578).

## Status

Built during the Mezo Buildathon. Wave 1 shipped the two-swap loop. Wave 2 adds one-transaction flash loop, unwind, and de-lever, a MEZO-tipped permissionless guard, and an always-on keeper. Live app: https://coil.up.railway.app.

Deployed 27 October 2026, blocks 16400159–16400160:

- Factory `0x6A38f560cF8612cc81cF966831890DBb310e31F7`
- CoilAccount `0x522DED4F0cF62cfc12456A28FbF82b044178564b` (23,101 bytes; the pre-split build was 33,413)
- CoilLegacy `0xdb2e13c3199C28E69f6EaF39fb6df05900Dd7969`
- FlashSizer `0x3d1006Ec18E64238aFD2a176b438F40FBfa6F326` (created in the implementation constructor)

End to end on that factory, one fresh wallet:

- `createAccount` [`0x21e49605…`](https://explorer.test.mezo.org/tx/0x21e4960535628d16d67b02a833d814d82ede3957e94ea8130421b4970b313d49) → clone `0xEeE34fbAD36f46d648453914d658AbE314cA710c`
- `flashLoop` 0.015 BTC to 133.33% [`0x576e5383…`](https://explorer.test.mezo.org/tx/0x576e5383d45538f63658ffdc110d256a4d1a41779efbd7df9c4e0b3d55af0eef)
- Keeper `guard()` 133.30% → 150.00%, 1 MEZO, block 16401501 [`0xcb90da85…`](https://explorer.test.mezo.org/tx/0xcb90da8575306d82209d7ba49c0d21caef14e5d5527ec5b9486c4689d71fb54a)
- `flashUnwind` closed the trove [`0x296bb52c…`](https://explorer.test.mezo.org/tx/0x296bb52c8458bbdd0f00bd8c58f425655cccabb6409c3068bb87e36a9209c3d2). Round-trip cost about 0.000066 BTC.

That rescue reverted `Slippage()` until the owner called `setSlippage(200)`, because `guard()` reused the 0.5% open slippage while the pool sat about 1.4% under the oracle (78,646 vs 79,744). This branch gives rescue and close their own cap. It is not on the factory above yet.

## Readiness

Testnet deployment, live app, keeper running on Railway, one end-to-end run on chain. 27 Foundry tests pass, including a case where the pool is about 1.4% under the oracle. Not audited. Not on mainnet. Contracts are not verified on Blockscout (`Unable to verify` / `Pending in queue`). The creation bytecode of the deployed build matched the chain. This branch's `CoilAccount` is larger than that deployment and does not match it.

## Updates in this Wave

```
Coil Labs, Wave 2: what changed since Wave 1 (Mezo testnet, chain 31611)

1) 4x in ONE transaction. flashLoop flash-borrows BTC from the Mezo Pools MUSD/BTC pair, opens the trove and repays the pool with freshly minted MUSD. Wave 1 loop stopped near 2x because a third swap is the 21st precompile call. flashLoop uses 7 of 20; flashUnwind 8, flashDeleverTo 10, guard()+MEZO tip 12.

2) MEZO now has a job. guard() is permissionless: anyone can rescue a trove under its floor or in the redemption zone and earns a MEZO tip, paid only if the collateral ratio rose. It cannot loop, unwind, withdraw or take BTC/MUSD.

3) Deployed (Oct 27, blocks 16400159–16400160):
Factory https://explorer.test.mezo.org/address/0x6A38f560cF8612cc81cF966831890DBb310e31F7
CoilAccount https://explorer.test.mezo.org/address/0x522DED4F0cF62cfc12456A28FbF82b044178564b
CoilLegacy https://explorer.test.mezo.org/address/0xdb2e13c3199C28E69f6EaF39fb6df05900Dd7969
FlashSizer https://explorer.test.mezo.org/address/0x3d1006Ec18E64238aFD2a176b438F40FBfa6F326
EIP-170: CoilAccount went from 33,413 to 23,101 bytes via a DELEGATECALL library. Blockscout has not verified them. Local creation bytecode of that build matched the chain.

4) Always-on keeper on Railway. One live rescue paid 1 MEZO.

5) End-to-end on testnet, fresh wallet:
Create account https://explorer.test.mezo.org/tx/0x21e4960535628d16d67b02a833d814d82ede3957e94ea8130421b4970b313d49
flashLoop 0.015 BTC to CR 133.33% (4x), 3,100.8 MUSD debt https://explorer.test.mezo.org/tx/0x576e5383d45538f63658ffdc110d256a4d1a41779efbd7df9c4e0b3d55af0eef
Keeper rescue, 133.30% to 150.00%, 1 MEZO tip https://explorer.test.mezo.org/tx/0xcb90da8575306d82209d7ba49c0d21caef14e5d5527ec5b9486c4689d71fb54a
flashUnwind, trove closed, BTC returned https://explorer.test.mezo.org/tx/0x296bb52c8458bbdd0f00bd8c58f425655cccabb6409c3068bb87e36a9209c3d2
Round-trip cost about 0.000066 BTC.

6) App: https://coil.up.railway.app

Found in that run: guard() reused the 0.5% open slippage and reverted Slippage() while the pool sat ~1.4% under the oracle. The owner raised it to 2% and the keeper rescued on the next poll. This branch adds owner-set rescueSlippageBps (default 2%, hard cap 3%) so a keeper cannot change it and cannot sell past the oracle cap. That needs a new factory: clones are not upgradeable. Not redeployed, and not re-run on chain. /guard now pages logs in chunks under Mezo's 10,000-block getLogs cap, from factory block 16400159, and shows RPC errors. The keeper logs the decoded revert (Slippage()) and mentions the Wave 1 owner-only guard only on NotKeeper(). Those two are in the repo; the live Railway web app and keeper process do not have them until rebuilt.

Code: https://github.com/PrabalParihar/coil
```

## Next milestones

Wave 2 build (2–15 November 2026):

1. Redeploy the new `CoilAccount` and factory (the slippage split is in this branch and is not live). Repeat the end-to-end run with no manual `setSlippage`.
2. Verify the contracts on Blockscout. The last attempt failed or stayed queued.
3. Rebuild the Railway web app and keeper so `/guard` paging and the decoded revert line are what the public site and the process run.
4. Deck and a pitch video. The current walkthrough is 2:52.

After the buildathon, not built: an independent review, a capped mainnet beta sized to the thin MUSD/BTC pool, a vault share token, and MEZO gauge incentives if Mezo's gauge system allows them.

## Team

Prabal Pratap Singh, solo. He designed, wrote, deployed, and tested the contracts, the keeper, and the app. 10 hackathon wins.

- X: https://x.com/0xPrabalParihar
- LinkedIn: https://www.linkedin.com/in/0xprabal/
- Site: https://prabal.pro
- GitHub: https://github.com/PrabalParihar

## Links

- Live app: https://coil.up.railway.app
- Guard log: https://coil.up.railway.app/guard (the paging fix is in this branch; the live page gets it when the site is rebuilt)
- Code: https://github.com/PrabalParihar/coil
- Deployments and hashes: `DEPLOYMENTS.md`
