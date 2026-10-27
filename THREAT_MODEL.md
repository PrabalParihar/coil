# Threat model

Coil Labs is a testnet leverage desk. Clones are not upgradeable. A new factory is a new set of clones. The live Wave 2 factory does not include this branch.

## What a stranger can do

`guard()` is permissionless. It may repay the owner's parked MUSD and sell the clone's BTC collateral, and it may take the MEZO tip. It reverts unless the collateral ratio rises (`NotSafer`). It cannot loop, unwind, withdraw the reserve, or set slippage. The tip is capped by the clone's MEZO balance and by `tipMezo`, and it is paid at most once per block.

The reserve lives in `CoilPark`, not in the clone. `sweep` sends the clone's own MUSD and BTC to the owner and leaves the park. `withdrawTo` and `draw` are callable only by the clone that owns the balance, because the park keys balances by `msg.sender`.

## What the owner can do

The owner can loop, unwind, withdraw the reserve, set both slippage caps, and set the peg bounds. Open slippage and rescue slippage are each capped at 300 bps. The peg deviation cap is 500 bps and cannot be zero, so `flashLoop` always has a bound. `pegGuardBps` may be zero, which turns the peg trigger off.

A rescue still checks the BTC it sells against the oracle using the rescue cap. Raising that cap lets a keeper sell more BTC into a bad pool. It does not let the keeper choose the buyer. The owner sets it.

## What the park governor can do

`CoilPark.governor` is the address that deployed the implementation, which is the deployer in `script/Deploy.s.sol`. `setVault` points every clone's reserve at one ERC-4626. A vault whose `asset()` is not MUSD is rejected. A vault that returns the right asset and then keeps the tokens would strand the reserve. Set a vault only after its address is verified. The governor cannot withdraw a clone's balance.

## Oracle, peg, and the pool

`flashLoop` reads `PriceFeed.fetchPrice` and the pool reserves. If the absolute gap exceeds `maxPegDeviationBps`, it reverts `PegOff`. Recovery Mode reverts `RecoveryMode` before the flash. These checks do not make the oracle honest. A stale oracle can still open a trove inside the band.

The depth quote refuses to call a leverage "sensible" when selling the minted MUSD would move the pool by more than 100 bps. On the published mainnet reserves that cap rejects 4×. The quote is not a guarantee of the next block's reserves.

Redemption rank walks at most 32 troves. A trove outside that window is treated as not at risk. A peg trigger uses the same window (or the owner's zone). A depeg does not delever a trove that sits further back.

## Precompile budget

Mezo allows 20 precompile calls per transaction. The reserve path adds up to two `repayMUSD` price fetches on top of the guard-plus-tip budget of 12, for 16. MUSD itself is an ERC-20 and does not count. The tests assert the published budgets and that 16 is under 20.

## Keeper and Telegram

The keeper key can send only `guard()` and `heartbeat()` in this process. Telegram is optional. The bot token is placed in the Telegram URL and is not written to the log. Chat commands are accepted only from `TELEGRAM_CHAT_ID`. Message text is data. It cannot change the factory or the key. `/watch` adds an address to the scan list. The keeper still only calls `guard()`.

## Slither

Slither 0.11.6, solc 0.8.24, `slither . --exclude-dependencies --exclude-informational --exclude-low --fail-none`. 19 contracts, 50 results. The raw log is `docs/SLITHER.txt`.

The high detectors that fired are accepted:

- `arbitrary-send-erc20` on `CoilPark.depositFor`. The caller names the `payer`. The app approves the clone, and the clone pulls MUSD before the park pulls from the clone. Approving the park itself would let a stranger assign that MUSD to their own key. Approve the clone.
- `arbitrary-send-eth` on `sweep` (BTC to the owner), on `openTrove` / `addColl` (the user's deposit into BorrowerOperations), and on the BTC precompile `deposit()`. Those recipients are fixed by the protocol, not chosen by a stranger.
- `reentrancy-balance` and `reentrancy-no-eth` on the loop and the tip. `nonReentrant` guards the account entry points. `lastTipBlock` is written after the MEZO transfer so a reentering tip in the same block still sees the old block and pays once.
- `uninitialized-local` flags Solidity locals that are zero by default (`best`, `lo`, `ahead`). They are initialized by the language.
- `divide-before-multiply` and `incorrect-equality` are the existing sizing and zero checks.

Slither does not model the 20-precompile cap or the oracle. Re-run it after a contract edit.

## Out of scope

Mainnet deployment, Blockscout verification of the live factory, and a second end-to-end run of this branch. The live 23,101-byte implementation is not this bytecode.
