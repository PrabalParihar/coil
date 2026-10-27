# veMEZO and gauge rewards

Wave 1's submission mentioned gauge rewards. This branch does not call a gauge.

## What was checked

Mezo's published testnet addresses in `src/MezoAddresses.sol` cover MUSD, BorrowerOperations, TroveManager, SortedTroves, HintHelpers, the price feed, the router, the pool factory, and the MUSD/BTC pool. They do not include a veMEZO token or a gauge. `@mezo-org/passport` 0.17.2 and `@mezo-org/musd-contracts` 1.1.0 do not publish one either. A web search of the Mezo docs surface used for this branch did not produce a testnet gauge address that could be called and checked.

No address is invented here. A wrong gauge address would be worse than no call.

## Design, if an address is verified later

Keep it out of `CoilAccount`. The account is at the EIP-170 ceiling.

A separate `CoilGauge` would:

1. Hold MEZO the owner chooses to lock. It does not take the tip jar. Tips pay the keeper.
2. Call the verified veMEZO `createLock` or `increaseAmount` from the owner, never from `guard`.
3. Read the gauge's `balanceOf` and `earned` and show them on `/stats`. A vote or a bribe is a separate owner transaction.
4. Stay under the 20-precompile cap on its own transaction. A gauge call that itself touches BTC or MEZO precompiles has to be counted before it is merged into `guard`.

Until that address exists on testnet and a `cast call` against the documented interface succeeds, Coil does not pretend to stake.
