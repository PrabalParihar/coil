# Changelog

Compared with Wave 1. Wave 1 is the factory at `0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e`. The live Wave 2 factory is `0x6A38f560cF8612cc81cF966831890DBb310e31F7`. This branch is newer than that factory and is not deployed.

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
