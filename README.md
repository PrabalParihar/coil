# Coil

One-click BTC leverage on [MUSD](https://mezo.org/docs/users/musd). Deposit Bitcoin, and a single transaction opens a Mezo trove, swaps the borrowed MUSD for BTC on Mezo Pools, and posts that BTC back as collateral until a collateral ratio you choose. Unwind and de-lever are the reverse path. A keeper can only make a position safer.

Built by [Prabal Pratap Singh](https://prabal.pro) ([GitHub](https://github.com/PrabalParihar), [X](https://x.com/0xPrabalParihar)) for Mezo Buildathon Wave 1. Deadline 26 October 2026, 8:30 PM IST.

This wave uses MUSD. Every loop mints MUSD and routes it through the MUSD/BTC pool, which adds MUSD supply and pool volume. The MEZO token is not part of this build.

## Architecture

```
wallet
  │  createAccount()
  ▼
CoilFactory ── EIP-1167 clone ── CoilAccount   ← this address owns the trove
                                    │
                                    ├─ BorrowerOperations.openTrove / addColl / refinance / repayMUSD / closeTrove
                                    ├─ TroveManager, SortedTroves, HintHelpers, PriceFeed
                                    └─ Mezo Pools Router.swapExactTokensForTokens
                                         route: MUSD ↔ BTC, volatile, factory = PoolFactory
```

`msg.sender` has to be the trove owner, and a trove cannot add and withdraw collateral in the same `adjustTrove`. The clone is the borrower, so borrow, swap, and add-collateral share one transaction. Immutables (the Mezo addresses) live in the implementation. The clone stores the owner, the per-account keeper, slippage, and the guard.

| Call | Who | What it does |
| --- | --- | --- |
| `createAccount()` | wallet | Deploys that wallet's clone. One account per owner. |
| `loop(targetCR, maxSlippageBps)` + BTC | owner | Opens or tops up, then levers until the next mint would land under `targetCR`. |
| `unwind(fractionWad)` | owner | Repays that fraction of net debt. `1e18` closes the trove and returns BTC. |
| `deleverTo(targetCR)` | owner or keeper | Sells collateral, swaps to MUSD, repays, until the ratio is at least the target. |
| `guard()` | owner or keeper | If the ratio is under the floor, or the trove is inside the redemption zone, calls the same de-lever up to the guard target. |
| `setGuard(floor, target, zone)` | owner | `zone` is how many places from the lowest-CR end of `SortedTroves` count as redemption risk (max 32). All zeros disables the guard. |

Collateral ratios use Liquity's scale: `1e18` is 100%. Coil refuses a target under 115% (`MIN_TARGET_CR`). Mezo liquidates at 110% (`MCR`). Leverage shown in the app is `CR / (CR − 1)`: 200% is 2.00×, 150% is 3.00×.

### How a loop is sized

`openTrove` sets `maxBorrowingCapacity` from the collateral in that call only. Adding collateral later does not raise the cap. Only `refinance()` recomputes it from the current collateral. Coil therefore adds the swapped BTC, then refinances, then borrows again.

The first open is capped at `collateral * price / 1.105e18`, a little above the 110% line, so the swap has room to land above the user's target. Each step binary-searches a borrow amount whose projected ratio, after slippage and the refinance fee, stays at or above the target. Refinance runs only when the ratio is more than 0.3% above the target, so the fee cannot push the position under the target on the last step. At most six iterations. Ending safer than the target is allowed. Ending under it reverts with `BelowTarget`. If the 1,800 MUSD minimum debt cannot be opened without crossing under the target, the call reverts with `CannotOpen`.

`openTrove(uint256 debtAmount, address upperHint, address lowerHint)` takes the MUSD minted to the borrower. There is no `maxFeePercentage` argument. The protocol adds the borrowing fee and 200 MUSD of gas compensation on top. Net debt (minted amount plus fee, excluding gas compensation) must be at least 1,800 MUSD. Hints come from `HintHelpers.getApproxHint` (12 trials) and `SortedTroves.findInsertPosition`.

Repaying and closing burn MUSD from the caller. `BorrowerOperations` is on MUSD's burn list, so the clone does not approve MUSD to repay. A full unwind sells collateral until the remainder can be closed: `repayMUSD` cannot repay the last 1,800 MUSD of net debt, and `closeTrove` burns that remainder. `closeTrove` can revert in Recovery Mode, and Coil refuses to open a loop while Recovery Mode is on.

### Native BTC

On Mezo the gas token is BTC, and the ERC-20 at `0x7b7C000000000000000000000000000000000000` reports that same balance. Checked on testnet on 19 October 2026: `balanceOf` of the MUSD/BTC pool equals its native balance, and that equals the pool's BTC reserve. `deposit()` and `withdraw()` are not on the precompile. The router is the Tigris router (`swapExactTokensForTokens` with a `Route[]` of `{from, to, stable, factory}`). It pulls BTC with `transferFrom`. Trove collateral is `msg.value`.

After a MUSD→BTC swap, Coil measures the native balance. If it did not increase, it calls `withdraw(uint256)` on the BTC token. Before a BTC→MUSD swap, if the ERC-20 balance is short, it calls `deposit()` payable. On Mezo those branches do not run, because `balanceOf` already matches the native balance. Anvil cannot execute the precompile, so the fork tests etch a WETH-style token at the BTC address and exercise the wrap path instead.

### Keeper

`keeper/` is a dry-run by default. It reads `CoilFactory.accounts`, calls `position()`, and prints the ratio, floor, guard target, and redemption rank. With `--execute` (or `COIL_EXECUTE=true`) it sends `deleverTo(guardTargetCR)` when the ratio is under the floor, or when the rank is inside the redemption zone and the ratio is still under the guard target. A keeper cannot `loop`, `unwind`, or aim above the owner's guard target. Swept BTC and MUSD go to the owner.

The account accepts either its own `keeper` or `CoilFactory.keeper()`.

## Risks

- **Liquidation.** A trove can be liquidated at 110%. Coil will not target below 115%, and the guard is off until the owner sets one. A keeper de-lever can fail if the pool cannot fill the swap inside the slippage limit (default 0.50%, owner-settable up to 3%).
- **Redemption ordering.** Redemptions hit the lowest nominal collateral ratio first (`SortedTroves` tail). A tight coil sits at the front of that queue. The guard walks at most 32 troves from the tail. Rank `2^256−1` means the trove was outside that window.
- **Minimum debt.** Net debt cannot drop below 1,800 MUSD except by closing. A small BTC deposit cannot open a high target ratio. Partial unwind stops at the same floor.
- **Borrowing and refinance fees.** On testnet the borrowing rate is 0.1% (`1e15`). The refinance fee is 20% of net debt, and the borrowing rate is charged on that slice, about 0.02% of net debt. Interest is a separate annual rate (100 = 1% APR) and is not charged inside the loop transaction.
- **Pool fee and depth.** The router fee is read from `PoolFactory.getFee`, not hardcoded. On 19 October 2026 the testnet volatile MUSD/BTC pool charged 4 bps (reserves on the order of 100M MUSD and 1,300 BTC). The same pool on mainnet charged 30 bps, with roughly 0.71 BTC and 59,000 MUSD. A mainnet loop of any size moves the price. The testnet deploy script does not target mainnet.
- **Oracle versus pool.** Collateral ratio uses `PriceFeed`, which reads the Mezo oracle precompile. The swap uses pool reserves. When those prices differ, the executed ratio differs from a quote that assumes they match. The in-app preview uses the live oracle and the live reserves, with slippage taken off the quoted BTC out.
- **Recovery Mode.** Opens are refused while the system is in Recovery Mode. Closing can revert there too.
- **Clone trust.** The implementation is pinned at construction. The factory owner can set the factory keeper and transfer ownership. The factory keeper still cannot withdraw to itself.

## What was checked against Mezo

Checked on 19 October 2026 against `mezo-org/musd` (`solidity/contracts`, matsnet and mainnet deployment files), `mezo-org/tigris` (`IRouter`, `Router`, `Pool`), and live `eth_call`s.

| | Testnet (31611) | Mainnet (31612) |
| --- | --- | --- |
| MUSD | `0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503` | `0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186` |
| BorrowerOperations | `0xCdF7028ceAB81fA0C6971208e83fa7872994beE5` | `0x44b1bac67dDA612a41a58AAf779143B181dEe031` |
| TroveManager | `0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0` | `0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193` |
| SortedTroves | `0x722E4D24FD6Ff8b0AC679450F3D91294607268fA` | `0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f` |
| HintHelpers | `0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6` | `0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3` |
| PriceFeed | `0x86bCF0841622a5dAC14A313a15f96A95421b9366` | `0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88` |
| Router | `0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9` | `0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706` |
| PoolFactory | `0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A` | `0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248` |
| MUSD/BTC pool | `0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9` | `0x52e604c44417233b6CcEDDDc0d640A405Caacefb` |

BTC precompile `0x7b7C000000000000000000000000000000000000`. Oracle precompile `0x7b7c000000000000000000000000000000000015`. Testnet RPC `https://rpc.test.mezo.org`. Explorer `https://explorer.test.mezo.org`. Faucet `https://faucet.test.mezo.org`.

Verified on the live testnet RPC: chain id, `minNetDebt` of 1,800 MUSD, borrowing rate 0.1%, refinance fee 20, MCR 110%, gas compensation 200 MUSD, pool token order (MUSD is `token0` on testnet, BTC is `token0` on mainnet), volatile pool, router `defaultFactory`, and `balanceOf` matching native balances. `PriceFeed.fetchPrice` succeeded on the live RPC (about $82,700 that day). `deposit` / `withdraw` on the BTC precompile returned "method not found".

Assumed, because it was not sent with a funded key: a MUSD→BTC swap on live Mezo itself. Fork tests swap through the real router and the real pool after the BTC precompile is replaced, so they do not prove the precompile's `transferFrom` path. Anvil also rejects the oracle precompile, so fork tests mock `fetchPrice` to the pool spot (`reserveMUSD * 1e18 / reserveBTC`). Direct `openTrove` in those tests uses the real `BorrowerOperations`.

The deploy script has been broadcast on an Anvil fork of testnet (Shanghai hardfork, public Anvil account). It has not been broadcast to `https://rpc.test.mezo.org`.

## Setup

[Foundry](https://book.getfoundry.sh/getting-started/installation) (this repo was built with 1.8.5) and Node 22.

```bash
forge build
forge test
```

`forge test` forks `https://rpc.test.mezo.org`. Mezo blocks omit Cancun blob fields, so `foundry.toml` pins `evm_version = "shanghai"`. A local Anvil fork needs the same flag:

```bash
anvil --fork-url https://rpc.test.mezo.org --hardfork shanghai --port 18545
```

### Deploy (testnet)

Copy `.env.example`. Put a testnet key you control in `PRIVATE_KEY`. Do not commit it. The Anvil default key is only for a local fork.

```bash
# local fork (broadcast already exercised this way)
PRIVATE_KEY=0x… forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:18545 --broadcast

# Mezo testnet, once the key holds faucet BTC
PRIVATE_KEY=0x… forge script script/Deploy.s.sol --rpc-url https://rpc.test.mezo.org --broadcast
```

The script deploys `CoilAccount` with the testnet addresses in `src/MezoAddresses.sol`, then `CoilFactory(implementation, deployer)`. It logs the implementation and the factory.

### Keeper

```bash
cd keeper
npm install
COIL_FACTORY=0x… npm start                  # dry run
COIL_FACTORY=0x… KEEPER_PRIVATE_KEY=0x… npm start -- --execute
```

`KEEPER_PRIVATE_KEY` must be the factory keeper or the account keeper. Set the factory keeper with `CoilFactory.setKeeper` from the factory owner.

### Frontend

```bash
cd web
npm install
# optional, after a testnet deploy:
# echo 'NEXT_PUBLIC_COIL_FACTORY=0x…' > .env.local
npm run dev
```

The dev server listens on port 43123. Without `NEXT_PUBLIC_COIL_FACTORY` the page still quotes a loop from the live oracle, pool reserves, and pool fee, and it tells you that loop and unwind are waiting on a deploy.

```bash
cd web && npm run build
cd keeper && npx tsc --noEmit
```

## Tests

`test/Coil.t.sol` forks Mezo testnet and then:

- reads live protocol parameters and pool reserves
- opens a trove directly against `BorrowerOperations`
- loops 0.2 BTC to a 200% target and checks the quote against execution
- reverts when a small deposit cannot clear minimum debt at a high target
- fully closes, and partially unwinds without breaking the 1,800 MUSD floor
- rejects a keeper who tries to unwind or to de-lever past the guard target
- de-levers through `guard()` after a mocked price drop
- tops up an existing trove
- gives two users two clones

## Still to do before a live demo

1. Faucet BTC at `https://faucet.test.mezo.org` into the deployer wallet.
2. Broadcast `script/Deploy.s.sol` to `https://rpc.test.mezo.org` with that key.
3. Put the factory address in `web/.env.local` as `NEXT_PUBLIC_COIL_FACTORY` and in the keeper environment as `COIL_FACTORY`.
4. From the factory owner, `setKeeper` to the keeper address.
5. Connect a wallet on chain 31611, create an account, loop, set a guard, and run the keeper once in dry-run and once with `--execute`.
6. Record the transaction hashes for the submission form.

Mainnet is a different address set and a thin pool. This repository does not deploy there.
