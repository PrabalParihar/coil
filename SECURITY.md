# Coil Labs security notes

Testnet only. Mezo matsnet, chain id 31611. These contracts are not audited. Do not point them at mainnet funds.

## Oracle

Coil reads BTC/USD from the MUSD `PriceFeed` proxy at `0x86bCF0841622a5dAC14A313a15f96A95421b9366`. `fetchPrice()` is a `view`. It returns USD per 1 BTC with 18 decimals (`TARGET_DIGITS = 18` in musd `PriceFeed.sol`). It does not return an 8-decimal Chainlink answer.

Checked on matsnet at block 16482230: `fetchPrice()` returned `77311892590000000000000`, about $77,311.89. The upstream `decimals()` value is also 18, so the feed's own scale step is a no-op today. Coil still treats the number as 18-decimal USD per 1 BTC.

The upstream is the Skip Connect aggregator at `0x7b7c000000000000000000000000000000000015`. The MUSD `PriceFeed` stores that address as a Chainlink-style aggregator and reads `latestRoundData()`. It is not the Pyth proxy. Coil does not call Skip Connect itself. It calls `PriceFeed.fetchPrice()` only. There is no hard-coded BTC price in the swap path.

Sources:

- musd `PriceFeed.sol` at `da7888a10949c8a5d3f884454cec8978cfa87e48`, lines 12, 13-14, and 46-58: https://github.com/mezo-org/musd/blob/da7888a10949c8a5d3f884454cec8978cfa87e48/solidity/contracts/PriceFeed.sol#L12
- Mezo oracle docs: https://mezo.org/docs/developers/architecture/oracles/
- How to read the feed: https://mezo.org/docs/developers/architecture/oracles/read-oracle/

## Staleness

`MAX_PRICE_DELAY` is 60 seconds. If `block.timestamp - updatedAt` is greater than 60, `fetchPrice` reverts with `PriceFeed: Oracle is stale.` It does not return a stored last-good price. The interface still mentions a last-good event. This implementation does not use one.

Coil does not catch that revert, and it does not keep its own last price. A loop, a quote, a rescue, or a close that needs the feed fails with that same string. A second call in a later block still fails if the feed is still stale. Nothing falls back to a zero `amountOutMin`.

`fetchPrice` does not reject a zero answer. Coil does. A zero price reverts `OraclePriceZero` before any swap is sized. A floor that rounds to zero reverts `Slippage` inside the router swap. The router is never called with a minimum of zero.

## Slippage bound

Router swaps (`loop`, and the paused-pool sale used by unwind and de-lever) set `amountOutMin` from the feed, not from `getAmountsOut`.

- Selling BTC for MUSD: `amountIn * price / 1e18 * (10_000 - slippageBps) / 10_000`
- Buying BTC with MUSD: `amountIn * 1e18 / price * (10_000 - slippageBps) / 10_000`

Both tokens are 18 decimals on this path. The same helpers scale a 6 or 8 decimal token if one is ever passed in. The live pair does not use those decimals.

The open default is 50 bps (0.50% under the oracle). The clone stores that at initialization, and the desk starts there. The owner can pass 1 to 300 bps on `loop` and `flashLoop`. 50 bps is the default because the testnet pool fee is 4 bps and the book is deep (well over 1,000 BTC). Half a percent covers the fee and a small lag. A 100 bps default would leave a wider window for a sandwich. The owner can still widen a single open up to 300 bps when they choose to.

Rescue sales (`guard`, `flashDeleverTo`, and the router sale when the pool factory is paused) use `rescueSlippageBps`. The default is 200 bps and the hard cap is 300 bps. Only the owner can set it. A keeper cannot. 200 bps stays the rescue default because this pool has sat about 140 bps under the oracle. A 50 bps rescue floor would skip those sales. The owner can tighten it.

Flash swaps do not take `amountOutMin`. The pool call names an exact amount out. Before that call, Coil checks the repayment against the same feed and the same bps cap. If the pool is outside the band, the transaction reverts `Slippage` (or skips the BTC sale after a reserve repayment, and emits `PartialRescue`). It does not swap at a zero floor.

## What a keeper can do

`guard()` is permissionless on the Wave 2 account. It de-levers toward the owner's guard target when the collateral ratio is under the floor or the trove sits inside the redemption zone. It reverts if the ratio falls (`NotSafer`). It pays `min(tipMezo, MEZO balance)` only when the ratio rose, and at most once per clone per block.

A keeper or stranger cannot:

- `loop` or `flashLoop`
- `unwind` or `flashUnwind`
- `sweep` or `withdrawTips`
- `deleverTo` / `flashDeleverTo` above `guardTargetCR`
- set `slippageBps`, `rescueSlippageBps`, or the peg bounds
- receive the clone's BTC or MUSD (`sweep` sends leftovers to the owner)

The keeper calls `guard()` (and the factory `heartbeat()` after a successful pass). It cannot choose the pool or the buyer. The owner can always unwind and close.

## Known limitations

Owner `unwind` and `flashUnwind` can pay the live pool price when the BTC owed is strictly under the collateral. That is the owner's way out of a pool that sits outside the rescue cap, so a close is not stuck behind 3%. A keeper cannot call unwind. If the flash does not fit, the Wave 1 router sale runs, and that sale uses the oracle floor above. It does not use a zero minimum.

A reserve rescue that has already repaid parked MUSD will skip a BTC sale that fails the oracle check. The repayment stays. An empty reserve still reverts `Slippage`.

`flashLoop` also reverts `PegOff` when the pool and the oracle differ by more than `maxPegDeviationBps` (default 200, hard cap 500), and `RecoveryMode` when the protocol is in recovery. Those checks do not make the oracle honest. They fail closed when the feed reverts or returns zero.

Coil does not call `claimCollateral`. The function is on `IBorrowerOperations` so a later surplus claim can use selector `0x6f0b0c1c`. Nothing in this change sends that transaction.

The contracts are not upgradeable per clone. This branch is not deployed. The live factory does not include the oracle floor until a new factory is broadcast. No broadcast is part of this change.

## Tests that pin this

| Invariant | Test |
| --- | --- |
| 18-decimal BTC to MUSD, and the reverse, using the block 16482230 sample | `test_btc18ToMusd18UsesEighteenDecimalPrice` |
| 8-decimal asset scaled into 18-decimal MUSD | `test_eightDecimalAssetScalesIntoEighteenDecimalMusd` |
| 6-decimal stable scaled both ways | `test_sixDecimalStableScalesBothWays` |
| Zero price reverts `OraclePriceZero` | `test_zeroPriceReverts`, `test_zeroOracleDoesNotOpen` |
| 60 seconds is fresh, 61 seconds reverts `PriceFeed: Oracle is stale.` and is not caught | `test_sixtySecondsIsFreshAndSixtyOneReverts`, `test_staleOracleRevertsOnLoop` |
| A pool pushed outside the bound reverts, and a pool inside it opens | `test_sandwichOutsideOracleBoundReverts` |
| `claimCollateral` selector is `0x6f0b0c1c` | `test_claimCollateralSelector` |
| Stranger `guard()` pays MEZO only when the ratio rises, and pays no BTC or MUSD | `test_strangerGuardPaysMezoOnlyWhenSafer` |
| An underfunded jar pays the balance and still rescues | `test_underfundedTipPaysBalance` |
| Keeper cannot loop, unwind, sweep, or withdraw tips, and cannot aim above the guard | `test_keeperCannotLoopUnwindOrTakeTips` |
| Fuzz: flash loop stays at or above the target | `testFuzz_flashLoopStaysAboveTarget` |
| Invariant: handler calls never lower the ratio at a constant oracle, never send BTC or MUSD to the caller, and conserve MEZO | `invariant_keeperOnlyReducesRisk` |
| A spoofed pool callback reverts | `test_hookRejectsSpoof` |
| Tight slippage reverts instead of opening under the quote | `test_tightSlippageReverts` |
| Pool about 1.4% under the oracle: `guard()` reverts at 50 bps and succeeds at the 200 bps rescue default | `test_guardSucceedsWhenPoolIsBelowOracle` |
| Owner close at 230 bps and 400 bps off the oracle | `test_closeWhenPoolIs230And400BpsOffOracle` |

`position()` keeps the Wave 1 tuple so existing decoders still work.

## Flash swap

`hook` accepts calls only from the immutable MUSD/BTC pool, and only when this account started the swap (`flashKind`). The in-flash flag is storage, not transient storage: Mezo is Shanghai and has no `TSTORE`. A revert rolls the flag back.

The pool must be passed nonempty `data` or `Pool.swap` skips the callback. Coil passes `hex"01"`.

## Precompile budget

Mezo allows 20 native precompile calls per transaction. The oracle floor does not add a `fetchPrice`. The price is read once at the start of the call. Upper bounds in `CoilAccount.precompileBudget()`:

| Path | Calls |
| --- | --- |
| Flash loop, new trove | 7 |
| Flash unwind / close | 8 |
| Flash de-lever | 10 |
| `guard()` including the MEZO tip | 12 |

`loop()` still stops after two swaps (about 2x) and remains the fallback when the pool is paused.

## Reporting

Open a GitHub issue: https://github.com/PrabalParihar/coil/issues

Include the matsnet transaction hash (chain 31611), the account address, and what you expected. Do not include a private key, a seed phrase, or an API token. Do not use mainnet funds to demonstrate a problem. This repository is testnet only.
