# AKINDO submission — Coil

Paste-ready answers for the Mezo Buildathon Wave 1 form. Deadline 26 October 2026, 8:30 PM IST.

## Title

Coil

## Category

One-click BTC leverage

## One-sentence TL;DR

Coil turns a BTC deposit into a leveraged BTC position in one transaction by minting MUSD, buying BTC on Mezo Pools, and posting that BTC back as collateral.

## How it works

A wallet creates one clone. The clone is the MUSD borrower. `loop` posts the user’s BTC, calls `BorrowerOperations` to mint MUSD, swaps that MUSD for BTC on the volatile Mezo Pools MUSD/BTC pair, and adds the BTC as collateral. It refinances so the borrow cap includes the new collateral, then borrows once more. Mezo allows 20 native-precompile calls per transaction; two borrow-and-swap rounds fill that budget, so the loop stops there and lands on or above the chosen collateral ratio.

De-lever and unwind sell collateral for MUSD and repay. `repayMUSD` burns MUSD. A full unwind ends in `closeTrove`, which burns the last 1,800 MUSD plus the 200 MUSD gas compensation. On live Mezo each of those calls sells once; the app sends the next transaction and links every hash on the explorer. A sale that cannot raise the ratio returns instead of reverting.

MUSD is the debt: every loop mints it and every repay burns it. Mezo Pools is the only venue, via `swapExactTokensForTokens` on the MUSD/BTC pool. The MEZO token is not spent in this wave. Wave 2 uses it for gauge rewards and keeper tips.

A keeper can call `deleverTo` only up to a guard the owner set. It cannot loop, unwind, or withdraw.

## Target group

BTC holders on Mezo who want leveraged BTC exposure against MUSD without hand-building a trove, a swap, an add-collateral, and a refinance, and who want a keeper that can only reduce risk.

## Tech stack

Solidity 0.8.24 (Foundry, EIP-1167 clones), Mezo MUSD BorrowerOperations and the Mezo Pools router, a TypeScript keeper (viem), Next.js 15 / React 19 / wagmi / viem, static export.

## Track

Mezo Buildathon, DeFi / MUSD leverage

## Chain

Mezo testnet (matsnet), chain id 31611

## Status

Live on Mezo testnet. Factory `0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e`. A 0.0475 BTC loop opened at 200.09%. `deleverTo(300%)` raised it to 288.04% (the 1,800 MUSD floor for that debt) and a second call succeeded without selling. A fresh 200% trove fully unwound in two transactions. Hashes are in `DEPLOYMENTS.md`.

## Readiness

Testnet prototype, submission-ready for Wave 1. Fork tests pass. The app builds as a static export and runs on Vercel with the project root set to `web`. Contracts are not audited and are not deployed on mainnet.

## Next 3 milestones

1. Always-on keeper and Telegram alerts when a trove crosses its floor or enters the redemption zone.
2. A vault share token, plus MEZO gauge rewards for the MUSD/BTC volume and MEZO tips for keepers that call `guard()`.
3. A capped mainnet beta sized to the thin MUSD/BTC pool.

## Team

Prabal Pratap Singh. Solo. X: https://x.com/0xPrabalParihar. GitHub: https://github.com/PrabalParihar. 6+ years of experience and 10 hackathon wins.

## Wave 2 update (draft, not posted)

Title stays Coil. The product name in the app is Coil Labs, so it is not confused with a different Wave 1 project that also used the name Coil.

What changed since Wave 1:

- `flashLoop` opens about 4× (collateral ratio 133.33%) in one transaction via a Mezo Pools flash swap. The old `loop` still stops after two swaps because a third swap blows the 20-precompile cap. Flash unwind and flash de-lever are one transaction each (8 and 10 precompile calls). `guard()` with a MEZO tip is 12. All sit under 20.
- `guard()` is permissionless. The caller earns MEZO only when the collateral ratio rose, at most once per block. The call cannot loop, unwind, or withdraw, and it cannot send BTC or MUSD to the caller.
- The keeper polls with `--watch`, simulates `guard()` before sending, and can alert Telegram when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are set. It runs with both unset. `keeper/Dockerfile` and `keeper/railway.json` are ready to deploy. The public page is `/guard`.
- The app connects Bitcoin and EVM wallets through Mezo Passport, shows a redemption-rank preview, and offers 4× / 3× / 2× presets.

Not done, and not claimed: a new testnet broadcast, a rescue transaction, a recut video, an AKINDO comment, a Railway service, a mainnet deploy, or a vault share token. The live factory is still `0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e`. Wave 2 needs a new factory because clones are not upgradeable.
