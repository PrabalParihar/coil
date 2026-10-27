# Coil Labs security notes

Testnet only. These contracts are not audited. Do not point them at mainnet funds.

## What a keeper can do

`guard()` is permissionless on the Wave 2 account. It de-levers toward the owner's guard target when the collateral ratio is under the floor or the trove sits inside the redemption zone. It reverts if the ratio falls (`NotSafer`). It pays `min(tipMezo, MEZO balance)` only when the ratio rose, and at most once per clone per block.

A keeper or stranger cannot:

- `loop` or `flashLoop`
- `unwind` or `flashUnwind`
- `sweep` or `withdrawTips`
- `deleverTo` / `flashDeleverTo` above `guardTargetCR`
- receive the clone's BTC or MUSD (`_sweep` sends leftovers to the owner)

The owner can always unwind and close.

## Tests that pin this

| Invariant | Test |
| --- | --- |
| Stranger `guard()` pays MEZO only when the ratio rises, and pays no BTC or MUSD | `test_strangerGuardPaysMezoOnlyWhenSafer` |
| An underfunded jar pays the balance and still rescues | `test_underfundedTipPaysBalance` |
| Keeper cannot loop, unwind, sweep, or withdraw tips, and cannot aim above the guard | `test_keeperCannotLoopUnwindOrTakeTips` |
| Fuzz: flash loop stays at or above the target | `testFuzz_flashLoopStaysAboveTarget` |
| Invariant: handler calls (`guard`, `deleverTo`, `flashDeleverTo`, and forbidden calls) never lower the ratio at a constant oracle, never send BTC or MUSD to the caller, and conserve MEZO | `invariant_keeperOnlyReducesRisk` |
| A spoofed pool callback reverts | `test_hookRejectsSpoof` |
| Tight slippage reverts instead of opening under the quote | `test_tightSlippageReverts` |
| Pool about 1.4% under the oracle: `guard()` reverts at 50 bps and succeeds at the 200 bps rescue default; 301 bps reverts; a stranger cannot set the cap | `test_guardSucceedsWhenPoolIsBelowOracle` |
| Owner close at 230 bps and 400 bps off the oracle | `test_closeWhenPoolIs230And400BpsOffOracle` |
| Full close spends the reserve and returns the leftover | `test_fullCloseSpendsReserveAndReturnsTheLeftover` |
| Partial reserve rescue skips a BTC sale that would fail the oracle cap | `test_partialReserveGuardSkipsTheBtcSale` |
| `flashLoop` reverts `PegOff` at 236 bps until the owner raises the cap to 500 | `test_pegOffBlocksOpenUntilTheOwnerRaisesTheCap` |

`guard` and `flashDeleverTo` use `rescueSlippageBps` (default 200, hard cap 300). Only the owner can set it. The check reverts `Slippage` when the BTC sold would be worse than `fair * (1 + rescueSlippageBps)` against `PriceFeed` and nothing was repaid from the reserve. If parked MUSD was repaid and the sale would fail that check, the repayment stands and `PartialRescue` is emitted. A keeper cannot push a rescue through a pool past that cap.

Owner `unwind` and `flashUnwind` spend parked MUSD first. They flash the remainder when the BTC owed is under the collateral, including when the pool is outside the rescue cap, so a close is not stuck behind 3%. Leftover park MUSD returns to the owner on a full close. Open uses `slippageBps` and is unchanged. `flashLoop` still reverts `PegOff` above `maxPegDeviationBps`.

`position()` keeps the Wave 1 tuple so existing decoders still work.

## Flash swap

`hook` accepts calls only from the immutable MUSD/BTC pool, and only when this account started the swap (`flashKind`). The in-flash flag is storage, not transient storage: Mezo is Shanghai and has no `TSTORE`. A revert rolls the flag back.

The pool must be passed nonempty `data` or `Pool.swap` skips the callback. Coil passes `hex"01"`.

## Precompile budget

Mezo allows 20 native precompile calls per transaction. Upper bounds in `CoilAccount.precompileBudget()`:

| Path | Calls |
| --- | --- |
| Flash loop, new trove | 7 |
| Flash unwind / close | 8 |
| Flash de-lever | 10 |
| `guard()` including the MEZO tip | 12 |

`loop()` still stops after two swaps (about 2×) and remains the fallback when the pool is paused.
