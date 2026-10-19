# Coil on Mezo testnet

Chain **31611** (matsnet). RPC `https://rpc.test.mezo.org`. Explorer `https://explorer.test.mezo.org/tx/<hash>`.

Throwaway deployer, testnet only: `0xFc58045fFB104D983de0e78F748Ab8e9cb6Bfc61`. The private key is in gitignored `.env` and is not in this repository. Do not reuse it on mainnet.

The factory the frontend and keeper use is **`0x0bF9984BA4b68Afee3d697b866a2a1d24A5c027c`**.

`eth_getTransactionReceipt` on this RPC sometimes returns null for a transaction that is already in a block. Every hash below was read back out of its block.

## Funding

| | Hash | Block |
| --- | --- | --- |
| 0.05 BTC faucet | [`0x92c2373157546c17d7c15801fb957e0e07e4d33c2fd5a92837a73221beaea0e5`](https://explorer.test.mezo.org/tx/0x92c2373157546c17d7c15801fb957e0e07e4d33c2fd5a92837a73221beaea0e5) | 16242384 |
| 100 MEZO | [`0x9b62ef9e277c4982cefd3b1bb586226dcc024a11b9e4626adc522dfb8f8a484c`](https://explorer.test.mezo.org/tx/0x9b62ef9e277c4982cefd3b1bb586226dcc024a11b9e4626adc522dfb8f8a484c) | 16242390 |

Coil does not spend MEZO. The BTC balance was confirmed before deploy (about 0.05 BTC; gas on this chain is hundreds of wei).

## Live factory

| Step | Address or result | Hash | Block |
| --- | --- | --- | --- |
| `CoilAccount` implementation | `0x37c5c0366FbBD3BD216E4B34BAaa88391f5b770F` | [`0xf2cc81544f3334fe43eb7b148536ba251fbee61440855fcdd5d76a701f9480c7`](https://explorer.test.mezo.org/tx/0xf2cc81544f3334fe43eb7b148536ba251fbee61440855fcdd5d76a701f9480c7) | 16243367 |
| `CoilFactory` | `0x0bF9984BA4b68Afee3d697b866a2a1d24A5c027c` | [`0x875326c9be5017c6f567f114755a301f84784f6063cb57a0b0e4f04b63c24d79`](https://explorer.test.mezo.org/tx/0x875326c9be5017c6f567f114755a301f84784f6063cb57a0b0e4f04b63c24d79) | 16243377 |
| `setKeeper` (the deployer) | keeper `0xFc58045fFB104D983de0e78F748Ab8e9cb6Bfc61` | [`0xf58542a690bf67fbc73708956025381a76e78389d3eeb917004e646669ae0978`](https://explorer.test.mezo.org/tx/0xf58542a690bf67fbc73708956025381a76e78389d3eeb917004e646669ae0978) | 16243378 |
| `createAccount` | clone `0x1D19B717f7F700d67b0d187Af03785890D9Be436` | [`0xa2d3a95f5039e24834ef648e7dc2d1a30056c8553b543ff6c0d4b3197e133f49`](https://explorer.test.mezo.org/tx/0xa2d3a95f5039e24834ef648e7dc2d1a30056c8553b543ff6c0d4b3197e133f49) | 16243379 |
| `loop(200%, 100 bps)` with 0.049 BTC | see position below | [`0xa421361ffe00903867dbdb70ef9e1e9c8bf7b82bba5e9687a69c25c7c90b5089`](https://explorer.test.mezo.org/tx/0xa421361ffe00903867dbdb70ef9e1e9c8bf7b82bba5e9687a69c25c7c90b5089) | 16243382 |
| `setGuard(210%, 250%, zone 8)` | | [`0x63ae966f2d8bac4cf28d9c1261dd0b93026650272ff485ad77b969c5ca8b6e74`](https://explorer.test.mezo.org/tx/0x63ae966f2d8bac4cf28d9c1261dd0b93026650272ff485ad77b969c5ca8b6e74) | 16243394 |
| Keeper `--execute` `deleverTo(250%)` | gas used 1,831,436 | [`0xa3e4c71b13723196e9ba629660653d8b26c9989ec8bf4b4f383c0da4d08b6738`](https://explorer.test.mezo.org/tx/0xa3e4c71b13723196e9ba629660653d8b26c9989ec8bf4b4f383c0da4d08b6738) | 16243397 |
| Owner `deleverTo(280%)` | | [`0xa5aff49a3b6036e008866eba5f0cd66ceae008e0718e32018cb0becadf713347`](https://explorer.test.mezo.org/tx/0xa5aff49a3b6036e008866eba5f0cd66ceae008e0718e32018cb0becadf713347) | 16243405 |
| `unwind(100%)` | trove closed | [`0x89ae6c71836cd45f68cb79f656bde9bb6fca73f3066996e5807d906ee8f5748c`](https://explorer.test.mezo.org/tx/0x89ae6c71836cd45f68cb79f656bde9bb6fca73f3066996e5807d906ee8f5748c) | 16243408 |

The keeper dry-run, before `--execute`, printed one account and `deleverTo 250.00% because collateral ratio is under the floor`. It sent no transaction.

Position read after each mined call:

| After | Collateral | Debt | Collateral ratio |
| --- | --- | --- | --- |
| loop | 0.096937650962887166 BTC | 3,980.627705926599875264 MUSD | 200.09% |
| keeper delever | 0.079296987721559888 BTC | 2,592.109947853692184638 MUSD | 251.34% |
| owner delever | 0.073823801471358635 BTC | 2,161.316510446033673293 MUSD | 280.56% |
| unwind | trove closed | 0 | — |

After unwind the clone held nothing. The deployer wallet held about 0.04965 BTC and 19.81 MUSD (swap surplus swept home). Liquidation price right after the loop was about $45,170.

0.05 BTC is enough. 0.049 BTC was deposited and 0.001 BTC was left for gas; gas actually cost a few million wei. That opened a real 200% trove above the 1,800 MUSD minimum. The rough “0.10 BTC collateral and 4,200 MUSD” sketch is a slightly larger position: at this oracle and pool, the same 200% loop produced about 1.978 BTC of collateral and about 81,240 MUSD of debt per BTC deposited, so that sketch needs about **0.052 BTC** in. The wallet did not have 0.052.

## Earlier factories (do not use)

These implementations still tried a third borrow inside `loop`. The pool reverted and the clones are not upgradeable. The frontend does not point at them.

First attempt. A keeper dry-run and `--execute` against this factory ran while it had zero accounts, so no delever was sent.

| Step | Address | Hash | Block |
| --- | --- | --- | --- |
| Implementation | `0x180471dd3a268e22C58fC7566e694A251aD11CFB` | [`0x2447cf5a8b28d0860b20ce3d39572ee0833427acc00aaff61e8c6f3dd9eb38bc`](https://explorer.test.mezo.org/tx/0x2447cf5a8b28d0860b20ce3d39572ee0833427acc00aaff61e8c6f3dd9eb38bc) | 16242412 |
| Factory | `0x5e680FB6B41E041bF68F837D857E1Db91e9118a9` | [`0xe695d329a7ac5cc7bf4023164376746bd90792d94b34913fa44bbdfb8eb18255`](https://explorer.test.mezo.org/tx/0xe695d329a7ac5cc7bf4023164376746bd90792d94b34913fa44bbdfb8eb18255) | 16242413 |
| `setKeeper` | | [`0x2498f8182acaaaa3bede647154daa36a5bc2d913b0d2a063ea813b549891fb25`](https://explorer.test.mezo.org/tx/0x2498f8182acaaaa3bede647154daa36a5bc2d913b0d2a063ea813b549891fb25) | 16242426 |
| `createAccount` | `0xD62E7E64fc2566b34d51601c5F4708dbA63E733A` | [`0xbee2647189f30595b2f07722b9ca2636c38f945d8a2a584153dc9cb5d990a9ef`](https://explorer.test.mezo.org/tx/0xbee2647189f30595b2f07722b9ca2636c38f945d8a2a584153dc9cb5d990a9ef) | 16242433 |

Second attempt, after caching the oracle read. `loop` still reverted `SafeERC20: low-level call failed`.

| Step | Address | Hash | Block |
| --- | --- | --- | --- |
| Implementation | `0xF79eFe185f4B8360B71595C702DbB18b01CC476A` | [`0x9b209d529d5f97d7bd5c0ac8a7ada5e4bc70b0783939ff26a95c84a68195dfed`](https://explorer.test.mezo.org/tx/0x9b209d529d5f97d7bd5c0ac8a7ada5e4bc70b0783939ff26a95c84a68195dfed) | 16243018 |
| Factory | `0xEF57f91D137df87e154c0b9cf9049E5d723c65B3` | [`0x264f7feb115399383d410e938d240956a389c013d3c786005a82e578e5e29442`](https://explorer.test.mezo.org/tx/0x264f7feb115399383d410e938d240956a389c013d3c786005a82e578e5e29442) | 16243021 |
| `setKeeper` | | [`0xaae490abd42acf92269984ae8bf6bcdccb24582bca19cf80e77ff4a26f348086`](https://explorer.test.mezo.org/tx/0xaae490abd42acf92269984ae8bf6bcdccb24582bca19cf80e77ff4a26f348086) | 16243024 |
| `createAccount` | `0x57757E9556e12C41CC94d9461C1511f713Db1D16` | [`0x628d0bdc467d121e5f12767974b33f5b53de3fe43cf2c92606583314ccc00f98`](https://explorer.test.mezo.org/tx/0x628d0bdc467d121e5f12767974b33f5b53de3fe43cf2c92606583314ccc00f98) | 16243026 |

Nonces 4 through 46 were measurement contracts (precompile budget, swap probes, hint probes). They are not part of the app. The budget probe is `0x8D874Eca23f1348f1ad391c299D9b93c01a24F22`, tx [`0x925f9cc848de4d900998744c8bb63af6928181bdb27d2dcf28b5006800d575c1`](https://explorer.test.mezo.org/tx/0x925f9cc848de4d900998744c8bb63af6928181bdb27d2dcf28b5006800d575c1).

## What the live chain required

A Mezo transaction may call native precompiles **20 times**. Call 21 reverts with empty data. Measured on the budget probe: `balanceOf` succeeds 20 times and the 21st reverts; `EXTCODEHASH` does not count; `getAmountsOut` does not count. `PriceFeed.fetchPrice` is two calls (`latestRoundData` and `decimals`). In the MUSD/BTC pool (`0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9`, MUSD is token0), a MUSD→BTC swap is three BTC calls: the output transfer and two `balanceOf` reads. Open, add collateral, refinance, and withdraw each fetch the price once inside BorrowerOperations.

Two borrow-and-swap rounds use 18 of the 20 calls and land on the 200% target. A third round exists only to shave a few basis points (the swap beats the slippage floor, so the ratio sits just above the target). That third BTC transfer is the 21st precompile call. The pool wraps it as `SafeERC20: low-level call failed` and the whole loop reverts. `loop` now stops after two swaps. Ending a little above the target is the intended result. Hints are ordinary contract calls, so they stay; empty hints make `SortedTroves` walk the list and can pass the 10,000,000 block gas limit.

BTC at `0x7b7C000000000000000000000000000000000000` has no `deposit()` or `withdraw()`. The router’s transfer credits native BTC, and `balanceOf` matches `address.balance`. The MUSD→BTC path returns that native gain and does not also call `balanceOf`. The reverse path skips `balanceOf` when the codehash is the live mirror, because that call does count. Fork tests etch a WETH-style mock at the same address (different codehash) and still wrap.

Other live limits, left as-is in the deployed bytecode:

- `deleverTo` from 200% to 250% fits in one swap. From 200% to 300% the second swap’s `approve` is past the cap and reverts `TransferFailed`. 251% → 280% fits, which is the owner delever above.
- `unwind(100%)` from the fresh 200% / ~3,981 MUSD trove does not fit in one transaction (empty revert at 9M and at 30M gas). The same call succeeds after the keeper has raised the ratio. Partial unwind of 40% or 50% fits from the fresh trove; 70% reverts `MinDebt` because it would leave less than 1,800 MUSD without closing.
- `cast estimate` is not usable here. It returned 173,722 gas for both the reverting loop and the succeeding one. Broadcasts were sent only after `eth_call` returned success, with an explicit gas limit under the 10M block cap.
- `forge create` on this RPC tries `http://localhost:8545`. The contracts were deployed with `cast send --create`. `cast send --json` often returns a null body for a transaction that still gets mined.
