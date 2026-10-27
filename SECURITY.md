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

Rescue and close use `rescueSlippageBps` (default 200, hard cap 300). Only the owner can set it. The check still reverts `Slippage` when the BTC sold is worse than `fair * (1 + rescueSlippageBps)` against `PriceFeed`, so a keeper cannot push a rescue through a pool past that cap. Open uses `slippageBps` and is unchanged.

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
