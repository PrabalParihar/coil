# Changelog

Compared with Wave 1. Wave 1 is the factory at `0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e`. The live factory is `0xff3335576f998EE872596d4EB7ABECb71a0D5BC8` (block 16408314). This branch is newer than that factory and is not deployed.

## Quiet guard (this branch)

After a partial rescue emptied `CoilPark` while the collateral ratio was still under the floor, the next `guard()` reverted `Slippage()`. The keeper simulated that revert every 20 seconds. `CoilExit.stageDelever` now emits `RescueBlocked` and returns 0 when the oracle cap blocks the BTC sale and no parked MUSD was spent. `guard()` returns false. The keeper treats that as nothing to do, skips the alert, and stays quiet until the ratio changes or `KEEPER_QUIET_MS` (default 5 minutes) passes.

App and keeper defaults point at factory `0xff3335576f998EE872596d4EB7ABECb71a0D5BC8`, implementation `0xD4495f969995B3e48998573B5ADC6F3106672B80`, exit `0x43D76243f5E5383c37557a364647F16DfBe8D03a`, block 16408314. Log scans start at that block.

Storage layout is unchanged. The constructor arguments are unchanged. Clones are not upgradeable, so the quiet return needs a new factory. The live factory above still reverts `Slippage()` on this path.

## Close fixes (merged)

Found on the live factory while the pool sat about 234–236 bps below the oracle.

- `unwind` / `flashUnwind` draw parked MUSD before selling BTC. A full close sends any MUSD still in `CoilPark` back to the owner. The 50.24 MUSD left behind in the end-to-end run was this bug.
- If the oracle cap would reject the flash, the owner still closes when the BTC owed is strictly under the collateral. The rescue cap stays 300 bps and still binds `guard` and `flashDeleverTo`. A close is not stuck when the gap is 2.3% or 4%. The Wave 1 router sale remains the path when a flash does not fit in the collateral. Doing both on the happy path would threaten Mezo's 20-precompile limit, and the BTC precompile only allows one Wave 1 sale per transaction.
- If a rescue repays parked MUSD and the BTC sale would fail the oracle check, the sale is skipped. The repayment stays. `PartialRescue(musdSpent, crAfter)` is emitted. `guard` already accepts any rise in the ratio. An empty reserve reverted `Slippage` on that factory. The quiet-guard section above removes that revert.
- The desk shows the live pool-versus-oracle gap, explains `PegOff`, and offers `setPegBounds` with an open cap of 200, 300, 400, or 500 bps.
- Those fixes shipped on factory `0xff3335576f998EE872596d4EB7ABECb71a0D5BC8` (block 16408314). The factory they were written against was `0x2218D33d2f9279A4266b49dB572F5b1343d09De5` (block 16407578). `script/verify.sh` verifies `CoilPark`.

Storage layout is unchanged. The constructor arguments are unchanged. Clones are not upgradeable, so these fixes need a new factory broadcast from `script/Deploy.s.sol`. The decision logic lives in `CoilExit` (`stageUnwind`, `stageDelever`), a second delegatecall library, so both `CoilAccount` and `CoilLegacy` stay under EIP-170. `CoilExit` delegatecalls `CoilLegacy` for the router sale. That nested call is not a precompile.

## Wave 1

- One owner, one clone, a loop that stops after two Mezo Pools swaps.
- `deleverTo` and `unwind` sell BTC for MUSD over several transactions when the pool is thin.
- `guard()` is the owner or the factory keeper. It pays no MEZO.
- No flash swap, no public rescue log, no reserve.

## Wave 2, live factory

- `flashLoop`, `flashUnwind`, and `flashDeleverTo`. One transaction, about 4× when the pool can take it.
- Permissionless `guard()` that can only raise the collateral ratio, paid in MEZO when it does.
- Railway keeper, `/guard`, OrangeKit Bitcoin wallets, redemption preview.
- Exercised on testnet. See `DEPLOYMENTS.md`. Contracts are not verified on Blockscout.

## This branch

- Rescue slippage is separate from the open. Default 2%, hard cap 3%. The keeper cannot change it.
- `CoilPark` holds MUSD for the owner. `guard` repays that MUSD before it sells BTC. `sweep` cannot take it. An ERC-4626 adapter is ready. No sMUSD address is configured, because none was verified.
- `flashLoop` reverts when the pool is more than `maxPegDeviationBps` off the oracle (default 200, hard cap 500), and in Recovery Mode.
- `guard` can also act when MUSD is under $1 and the trove is near the redemption queue. The owner turns that on with `setPegBounds`. Zero disables it.
- `FlashSizer.sensibleTarget` caps leverage so the flash sale stays under 100 bps of impact. The desk shows that for the testnet pool and, read-only, for the mainnet pool.
- `/stats` counts accounts, open troves, rescues, MEZO tips, and heartbeats. Logs are fetched in 9,999-block chunks.
- Telegram alerts cover the floor, the redemption zone, the peg trigger, and the rescue result. The bot token is not logged. It is not in this repo.
- `foundry.toml` sets `bytecode_hash = "none"` so `CoilAccount` fits under EIP-170.

## Not in this branch

- A mainnet deploy. The mainnet card is a quote.
- A verified sMUSD address.
- A veMEZO or gauge call. The design is in `docs/GAUGE.md`.
- A switch onto the `@mezo-org/passport` package. Version 0.17.2 does not compile against the OrangeKit it depends on. The same Bitcoin connectors are wired directly.
