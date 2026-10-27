# Coil on Mezo testnet

Chain **31611** (matsnet). RPC `https://rpc.test.mezo.org`. Explorer `https://explorer.test.mezo.org/tx/<hash>`.

Throwaway deployer, testnet only: `0xFc58045fFB104D983de0e78F748Ab8e9cb6Bfc61`. The private key is in gitignored `.env` and is not in this repository. Do not reuse it on mainnet.

The factory the frontend and keeper use is the Wave 2 factory **`0x6A38f560cF8612cc81cF966831890DBb310e31F7`**. Live app: https://coil.up.railway.app. The Wave 1 factory `0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e` is still on chain and is not what the app defaults to.

`eth_getTransactionReceipt` on this RPC sometimes returns null for a transaction that is already in a block. Hashes below were read back out of their blocks. Gas figures that came back as a round half of the gas limit are omitted. This RPC has done that.

## Funding

| | Hash | Block |
| --- | --- | --- |
| 0.05 BTC faucet | [`0x92c2373157546c17d7c15801fb957e0e07e4d33c2fd5a92837a73221beaea0e5`](https://explorer.test.mezo.org/tx/0x92c2373157546c17d7c15801fb957e0e07e4d33c2fd5a92837a73221beaea0e5) | 16242384 |
| 100 MEZO | [`0x9b62ef9e277c4982cefd3b1bb586226dcc024a11b9e4626adc522dfb8f8a484c`](https://explorer.test.mezo.org/tx/0x9b62ef9e277c4982cefd3b1bb586226dcc024a11b9e4626adc522dfb8f8a484c) | 16242390 |

The Wave 1 contracts do not spend MEZO. Wave 2 pays a keeper tip in MEZO. Gas on this chain is hundreds of wei.

## Wave 1 factory (not the app default)

Deployed after the one-sale de-lever fix. A sale is skipped when the repay room cannot raise the collateral ratio, including when only a few wei sit above the 1,800 MUSD floor.

| Step | Address or result | Hash | Block |
| --- | --- | --- | --- |
| `CoilAccount` implementation | `0x1bc9Ba4c62D62296aba1441fBB16BC9651a460Ce` | [`0x78994cd91e7c10ef00a7172af8c3917846447f65c37dfbc3162bc5728f8d0fb7`](https://explorer.test.mezo.org/tx/0x78994cd91e7c10ef00a7172af8c3917846447f65c37dfbc3162bc5728f8d0fb7) | 16243821 |
| `CoilFactory` | `0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e` | [`0x87d50bc5cbb6e02fcecbbeb92bad583fd7057cfd7ae8c53dfc6f2c6b70851186`](https://explorer.test.mezo.org/tx/0x87d50bc5cbb6e02fcecbbeb92bad583fd7057cfd7ae8c53dfc6f2c6b70851186) | 16243828 |
| `setKeeper` (the deployer) | keeper `0xFc58045fFB104D983de0e78F748Ab8e9cb6Bfc61` | [`0x30ca6c1763edba8473583ef663eaffa815ad66272fca343d877d046b494a4879`](https://explorer.test.mezo.org/tx/0x30ca6c1763edba8473583ef663eaffa815ad66272fca343d877d046b494a4879) | 16243832 |
| `createAccount` | clone `0xC8ad8f93174C27c39FCC8463be05451C5E637650` | [`0x9c251447f077d2e9c77b607b6257678063c2fe12c5459cfd926eaad32f90c267`](https://explorer.test.mezo.org/tx/0x9c251447f077d2e9c77b607b6257678063c2fe12c5459cfd926eaad32f90c267) | 16243840 |
| `loop(200%, 100 bps)` with 0.0475 BTC | CR 200.09%, debt 3,859.73 MUSD | [`0xfb9af4255b2317ea89feb36c530c29bfeace97b0098a3c6074fec015f52d7f85`](https://explorer.test.mezo.org/tx/0xfb9af4255b2317ea89feb36c530c29bfeace97b0098a3c6074fec015f52d7f85) | 16243849 |
| `deleverTo(300%)` sale 1 | CR 288.04%, debt exactly 2,000 MUSD | [`0x8e742936951d59555c236f9c03dfd20d7d3d28d3a91b74e29f7863c18a6885a8`](https://explorer.test.mezo.org/tx/0x8e742936951d59555c236f9c03dfd20d7d3d28d3a91b74e29f7863c18a6885a8) | 16243853 |
| `deleverTo(300%)` sale 2 | status success, no `Delevered` log, ratio unchanged | [`0xbafe5283fbcb373b167591cec8015b80606e5b970742bb17aa76ea70f47ff060`](https://explorer.test.mezo.org/tx/0xbafe5283fbcb373b167591cec8015b80606e5b970742bb17aa76ea70f47ff060) | 16243856 |
| `unwind(100%)` of that floor position | closed in one sale, BTC returned | [`0xa357c043d9fa7b0d3e3401fb4c2195a7336f867f8512c0177ccc481093081848`](https://explorer.test.mezo.org/tx/0xa357c043d9fa7b0d3e3401fb4c2195a7336f867f8512c0177ccc481093081848) | 16243864 |
| `loop(200%, 100 bps)` with 0.046 BTC | fresh trove, CR 200.09%, debt 3,732.34 MUSD | [`0xd72758f1114ac3add69ed08a519603d1059c41c2fa959b9e225fc88769d9fd89`](https://explorer.test.mezo.org/tx/0xd72758f1114ac3add69ed08a519603d1059c41c2fa959b9e225fc88769d9fd89) | 16243868 |
| `unwind(100%)` step 1 | still open, debt exactly 2,000 MUSD, CR 281.99% | [`0x3ff34e57f63d0278bf5932442f786bd346e08028f40bae0cbb5dc1f5d2efc2fd`](https://explorer.test.mezo.org/tx/0x3ff34e57f63d0278bf5932442f786bd346e08028f40bae0cbb5dc1f5d2efc2fd) | 16243870 |
| `unwind(100%)` step 2 | trove closed | [`0xd55cdf5fb1d882f36f7c6cc66ff62960eeab30b8a4122240aa09329bcc8defdc`](https://explorer.test.mezo.org/tx/0xd55cdf5fb1d882f36f7c6cc66ff62960eeab30b8a4122240aa09329bcc8defdc) | 16243873 |

Position reads:

| After | Collateral | Debt | Collateral ratio |
| --- | --- | --- | --- |
| First loop | 0.093904863301373738 BTC | 3,859.730755186508934879 MUSD | 200.09% |
| First de-lever | 0.070038705769635456 BTC | 2,000.000000000000000000 MUSD | 288.04% |
| Second de-lever | unchanged, apart from a few wei of interest | 2,000.000010140396322179 MUSD | 288.01% |
| Fresh loop | 0.090789621347525274 BTC | 3,732.337990604752309313 MUSD | 200.09% |
| Fresh unwind step 1 | 0.068558261865713750 BTC | 2,000.000000000000000000 MUSD | 281.99% |
| Fresh unwind step 2 | trove closed | 0 | — |

288% is the ceiling for that first trove, not a missed sale. Repaying a 200% position down to the 2,000 MUSD composite floor (1,800 net plus 200 gas compensation) leaves about `(debt + 2,000) / 2,000`. For 3,860 MUSD that is 293% before the pool fee, and 288% after it. Clearing 300% from a 200% start needs debt of about 4,000 MUSD before fees, which at this oracle (about $82,250) is a deposit of about **0.050 BTC**. The wallet held about 0.0483 BTC when this factory was exercised. The second `deleverTo(300%)` was simulated, broadcast, and mined with status success. It did not revert.

The clone is idle after the fresh unwind. Wallet balance after that close was 0.04746 BTC.

## Demo recording

Same factory and clone, driven from the app in a browser. Deposit 0.04 BTC, target 200%, slippage 1%. The first de-lever repaid to the 2,000 MUSD floor (CR about 258% at that block's oracle). The next three `deleverTo(300%)` calls mined successfully and did not sell. `unwind(100%)` then closed the trove in one sale, because the debt was already at the floor. A fresh 200% unwind that needs two sales is the pair at blocks 16243870 and 16243873 above.

| Step | Hash | Block |
| --- | --- | --- |
| `loop` 0.04 BTC, CR 200.08%, debt 3,225.92 MUSD | [`0xff8d4e10ba1e7efcddb8dd1e11df6955729ec5487ca8629f3bdd7291a4ddb575`](https://explorer.test.mezo.org/tx/0xff8d4e10ba1e7efcddb8dd1e11df6955729ec5487ca8629f3bdd7291a4ddb575) | 16243989 |
| `deleverTo(300%)` sale | [`0x4646758c20fb1c31ab29e75b76dd5d19e2045a50aca2b3e114b9555d1949a777`](https://explorer.test.mezo.org/tx/0x4646758c20fb1c31ab29e75b76dd5d19e2045a50aca2b3e114b9555d1949a777) | 16243996 |
| `deleverTo(300%)` no further sale | [`0x88f03b428ea483a97152665100e57961c0ed8a401b4f619989b760ff8cfad151`](https://explorer.test.mezo.org/tx/0x88f03b428ea483a97152665100e57961c0ed8a401b4f619989b760ff8cfad151) | 16244000 |
| `deleverTo(300%)` no further sale | [`0x8489e76f7e264a6842a9eacd3d25492355fbd11721a2fa61c4c8274bffd01968`](https://explorer.test.mezo.org/tx/0x8489e76f7e264a6842a9eacd3d25492355fbd11721a2fa61c4c8274bffd01968) | 16244004 |
| `deleverTo(300%)` no further sale, status success, no logs | [`0x4fcdfe78c08b5bd3ae7146283cf9ad99344eda12d3b515884f7459eb4e14eae9`](https://explorer.test.mezo.org/tx/0x4fcdfe78c08b5bd3ae7146283cf9ad99344eda12d3b515884f7459eb4e14eae9) | 16244007 |
| `unwind(100%)` closed | [`0x83a5dc72247ee9f43905823ce6ed36d544d933a582b7d090c7586cd24e92ef9d`](https://explorer.test.mezo.org/tx/0x83a5dc72247ee9f43905823ce6ed36d544d933a582b7d090c7586cd24e92ef9d) | 16244015 |

## Factories from the one-sale attempt (do not use)

These clones are not upgradeable. The frontend does not point at them.

First chunked build. A fresh 200% unwind took two transactions and closed. A second `deleverTo` once debt was already at the floor reverted.

| Step | Address or result | Hash | Block |
| --- | --- | --- | --- |
| Implementation | `0x1CA6614461F6b531058fAa4E815545961c857585` | [`0x8b01e8a07c49300f35338f8a8360342439cab67b62c5b66c5addd68bf857dd58`](https://explorer.test.mezo.org/tx/0x8b01e8a07c49300f35338f8a8360342439cab67b62c5b66c5addd68bf857dd58) | |
| Factory | `0x8Ab6106391A8D1DCc360193E39db8D8864016fEB` | [`0x56698d4a1c496dfe33e6008da0d48b43f44a117716d5bad6d728ec48ac4c5060`](https://explorer.test.mezo.org/tx/0x56698d4a1c496dfe33e6008da0d48b43f44a117716d5bad6d728ec48ac4c5060) | |
| `setKeeper` | | [`0x338b897526198e21c867fab188898fbc0d4f40913fbb79a536af54ea168ba9b3`](https://explorer.test.mezo.org/tx/0x338b897526198e21c867fab188898fbc0d4f40913fbb79a536af54ea168ba9b3) | 16243650 |
| `createAccount` | `0xe0805407b07881dA898a09C927Ccc1e4a717ad93` | [`0x5d9872c5e35093f4ff3f8348a4d24a473a372f6f711dacc4a734f4ed1a0f6167`](https://explorer.test.mezo.org/tx/0x5d9872c5e35093f4ff3f8348a4d24a473a372f6f711dacc4a734f4ed1a0f6167) | 16243651 |
| `loop` 0.04 BTC | CR 200.08% | [`0xee86db069a0fd78eed8598a166febe1f462e0b7f30f57d5ffa4bbe4ca2a655b3`](https://explorer.test.mezo.org/tx/0xee86db069a0fd78eed8598a166febe1f462e0b7f30f57d5ffa4bbe4ca2a655b3) | 16243653 |
| `unwind` step 1 | debt at the floor, CR 257.51% | [`0x68188fec2e3107d924703937badb2f8eb435e2d7e0bec72caf6a0db470704836`](https://explorer.test.mezo.org/tx/0x68188fec2e3107d924703937badb2f8eb435e2d7e0bec72caf6a0db470704836) | 16243654 |
| `unwind` step 2 | closed | [`0x9a2aed9844d1f9eab5dd899f92920a639d4870366fb302f1d08db616964e8676`](https://explorer.test.mezo.org/tx/0x9a2aed9844d1f9eab5dd899f92920a639d4870366fb302f1d08db616964e8676) | 16243656 |
| second `loop` | CR 200.08% | [`0x55f44e5cfc23d629c03a54dbcca037987acb603e94372d868b343eeab34f1dbc`](https://explorer.test.mezo.org/tx/0x55f44e5cfc23d629c03a54dbcca037987acb603e94372d868b343eeab34f1dbc) | 16243660 |
| `deleverTo` sale 1 | CR 257.51%, debt 2,000 MUSD | [`0x0849fa2709d6de7e0ee45258f3a71c4a88be0bd13d86537658638e5593520e59`](https://explorer.test.mezo.org/tx/0x0849fa2709d6de7e0ee45258f3a71c4a88be0bd13d86537658638e5593520e59) | 16243663 |
| `deleverTo` sale 2 | **reverted** | [`0x6476eb9fa0985936914237d9bd79f6cc211c5431ed3f43d6a6353e14af5136df`](https://explorer.test.mezo.org/tx/0x6476eb9fa0985936914237d9bd79f6cc211c5431ed3f43d6a6353e14af5136df) | 16243665 |
| recovery `unwind` | closed | [`0xb95a944078aaadbba9eea7bf19a3ca23aa5a903d260f35a4e00b555448b2b9fc`](https://explorer.test.mezo.org/tx/0xb95a944078aaadbba9eea7bf19a3ca23aa5a903d260f35a4e00b555448b2b9fc) | 16243676 |

Second attempt. The early return treated a zero repay as "stop", but a few wei of interest still counted as room. The sale withdrew collateral, repaid dust, the ratio fell, and `NotSafer` reverted.

| Step | Address or result | Hash | Block |
| --- | --- | --- | --- |
| Implementation | `0x16772E1B2C8295F0364e5ED580BC96946826743b` | [`0xc06c9df41e679ff78ef6521d0aab07d97764067138a10bc07522a45d72494eb1`](https://explorer.test.mezo.org/tx/0xc06c9df41e679ff78ef6521d0aab07d97764067138a10bc07522a45d72494eb1) | |
| Factory | `0x83C3F77008272CCEA077b147B5D4C2a0185b8Cc1` | [`0xfc9ddabc9bec9d481cdac79a0163877f36145d597ad66a8b6b8d3f65eb3d845c`](https://explorer.test.mezo.org/tx/0xfc9ddabc9bec9d481cdac79a0163877f36145d597ad66a8b6b8d3f65eb3d845c) | |
| `setKeeper` | | [`0x66482d9aea8aedbdc95439a82fa0032940dd2e98850960bd601bfe09f55a8bbe`](https://explorer.test.mezo.org/tx/0x66482d9aea8aedbdc95439a82fa0032940dd2e98850960bd601bfe09f55a8bbe) | 16243703 |
| `createAccount` | `0x99309873924cC57fCDc56C341aC4487cE02A7471` | [`0x06b4f78ec402dac59ca7ea44c2397bea810aa8efe496e205c614e710e33865fd`](https://explorer.test.mezo.org/tx/0x06b4f78ec402dac59ca7ea44c2397bea810aa8efe496e205c614e710e33865fd) | 16243709 |
| `loop` 0.046 BTC | CR 200.14%, debt 3,734.40 MUSD | [`0x1eaa69141fed27b92dac1e0376aff695f2b74220fa61322bfc76bc2a5fce9bc6`](https://explorer.test.mezo.org/tx/0x1eaa69141fed27b92dac1e0376aff695f2b74220fa61322bfc76bc2a5fce9bc6) | 16243718 |
| `deleverTo(300%)` sale 1 | CR 282.10%, debt 2,000.0000000095 MUSD | [`0xcc42aa5b3844e7cfef8220b074def53a1eae733bf6b3b387e538c4f6ede2a5f8`](https://explorer.test.mezo.org/tx/0xcc42aa5b3844e7cfef8220b074def53a1eae733bf6b3b387e538c4f6ede2a5f8) | 16243726 |
| `deleverTo(300%)` sale 2 | **reverted `NotSafer`** | [`0xff81dd4d0e0298200d30d187b94e1bd89a9b01cabc9424379ce26af044dc0b24`](https://explorer.test.mezo.org/tx/0xff81dd4d0e0298200d30d187b94e1bd89a9b01cabc9424379ce26af044dc0b24) | 16243730 |
| recovery `unwind` | closed | [`0x939371fedcb0cd01153b72729eb81aff5ace34e3b552c30d64f3bc3b86adcad8`](https://explorer.test.mezo.org/tx/0x939371fedcb0cd01153b72729eb81aff5ace34e3b552c30d64f3bc3b86adcad8) | 16243808 |

The current implementation sizes the sale to the repay room and skips it when the slippage-worsened quote would not raise the ratio. That is the call that succeeded at block 16243856.

## Two-swap factory (do not use)

`loop` on this factory stops after two swaps and was the first live 200% open. De-lever and unwind could still revert when they needed a second collateral sale inside one transaction.

| Step | Address or result | Hash | Block |
| --- | --- | --- | --- |
| Implementation | `0x37c5c0366FbBD3BD216E4B34BAaa88391f5b770F` | [`0xf2cc81544f3334fe43eb7b148536ba251fbee61440855fcdd5d76a701f9480c7`](https://explorer.test.mezo.org/tx/0xf2cc81544f3334fe43eb7b148536ba251fbee61440855fcdd5d76a701f9480c7) | 16243367 |
| Factory | `0x0bF9984BA4b68Afee3d697b866a2a1d24A5c027c` | [`0x875326c9be5017c6f567f114755a301f84784f6063cb57a0b0e4f04b63c24d79`](https://explorer.test.mezo.org/tx/0x875326c9be5017c6f567f114755a301f84784f6063cb57a0b0e4f04b63c24d79) | 16243377 |
| `setKeeper` | | [`0xf58542a690bf67fbc73708956025381a76e78389d3eeb917004e646669ae0978`](https://explorer.test.mezo.org/tx/0xf58542a690bf67fbc73708956025381a76e78389d3eeb917004e646669ae0978) | 16243378 |
| `createAccount` | `0x1D19B717f7F700d67b0d187Af03785890D9Be436` | [`0xa2d3a95f5039e24834ef648e7dc2d1a30056c8553b543ff6c0d4b3197e133f49`](https://explorer.test.mezo.org/tx/0xa2d3a95f5039e24834ef648e7dc2d1a30056c8553b543ff6c0d4b3197e133f49) | 16243379 |
| `loop(200%, 100 bps)` with 0.049 BTC | CR 200.09%, debt 3,980.63 MUSD | [`0xa421361ffe00903867dbdb70ef9e1e9c8bf7b82bba5e9687a69c25c7c90b5089`](https://explorer.test.mezo.org/tx/0xa421361ffe00903867dbdb70ef9e1e9c8bf7b82bba5e9687a69c25c7c90b5089) | 16243382 |
| `setGuard(210%, 250%, zone 8)` | | [`0x63ae966f2d8bac4cf28d9c1261dd0b93026650272ff485ad77b969c5ca8b6e74`](https://explorer.test.mezo.org/tx/0x63ae966f2d8bac4cf28d9c1261dd0b93026650272ff485ad77b969c5ca8b6e74) | 16243394 |
| Keeper `--execute` `deleverTo(250%)` | gas used 1,831,436 | [`0xa3e4c71b13723196e9ba629660653d8b26c9989ec8bf4b4f383c0da4d08b6738`](https://explorer.test.mezo.org/tx/0xa3e4c71b13723196e9ba629660653d8b26c9989ec8bf4b4f383c0da4d08b6738) | 16243397 |
| Owner `deleverTo(280%)` | CR 280.56% | [`0xa5aff49a3b6036e008866eba5f0cd66ceae008e0718e32018cb0becadf713347`](https://explorer.test.mezo.org/tx/0xa5aff49a3b6036e008866eba5f0cd66ceae008e0718e32018cb0becadf713347) | 16243405 |
| `unwind(100%)` | closed. This trove had already been de-levered, so one sale was enough | [`0x89ae6c71836cd45f68cb79f656bde9bb6fca73f3066996e5807d906ee8f5748c`](https://explorer.test.mezo.org/tx/0x89ae6c71836cd45f68cb79f656bde9bb6fca73f3066996e5807d906ee8f5748c) | 16243408 |

## Earlier factories (do not use)

These implementations still tried a third borrow inside `loop`. The pool reverted.

| Step | Address | Hash | Block |
| --- | --- | --- | --- |
| Implementation | `0x180471dd3a268e22C58fC7566e694A251aD11CFB` | [`0x2447cf5a8b28d0860b20ce3d39572ee0833427acc00aaff61e8c6f3dd9eb38bc`](https://explorer.test.mezo.org/tx/0x2447cf5a8b28d0860b20ce3d39572ee0833427acc00aaff61e8c6f3dd9eb38bc) | 16242412 |
| Factory | `0x5e680FB6B41E041bF68F837D857E1Db91e9118a9` | [`0xe695d329a7ac5cc7bf4023164376746bd90792d94b34913fa44bbdfb8eb18255`](https://explorer.test.mezo.org/tx/0xe695d329a7ac5cc7bf4023164376746bd90792d94b34913fa44bbdfb8eb18255) | 16242413 |
| `setKeeper` | | [`0x2498f8182acaaaa3bede647154daa36a5bc2d913b0d2a063ea813b549891fb25`](https://explorer.test.mezo.org/tx/0x2498f8182acaaaa3bede647154daa36a5bc2d913b0d2a063ea813b549891fb25) | 16242426 |
| `createAccount` | `0xD62E7E64fc2566b34d51601c5F4708dbA63E733A` | [`0xbee2647189f30595b2f07722b9ca2636c38f945d8a2a584153dc9cb5d990a9ef`](https://explorer.test.mezo.org/tx/0xbee2647189f30595b2f07722b9ca2636c38f945d8a2a584153dc9cb5d990a9ef) | 16242433 |
| Implementation | `0xF79eFe185f4B8360B71595C702DbB18b01CC476A` | [`0x9b209d529d5f97d7bd5c0ac8a7ada5e4bc70b0783939ff26a95c84a68195dfed`](https://explorer.test.mezo.org/tx/0x9b209d529d5f97d7bd5c0ac8a7ada5e4bc70b0783939ff26a95c84a68195dfed) | 16243018 |
| Factory | `0xEF57f91D137df87e154c0b9cf9049E5d723c65B3` | [`0x264f7feb115399383d410e938d240956a389c013d3c786005a82e578e5e29442`](https://explorer.test.mezo.org/tx/0x264f7feb115399383d410e938d240956a389c013d3c786005a82e578e5e29442) | 16243021 |
| `setKeeper` | | [`0xaae490abd42acf92269984ae8bf6bcdccb24582bca19cf80e77ff4a26f348086`](https://explorer.test.mezo.org/tx/0xaae490abd42acf92269984ae8bf6bcdccb24582bca19cf80e77ff4a26f348086) | 16243024 |
| `createAccount` | `0x57757E9556e12C41CC94d9461C1511f713Db1D16` | [`0x628d0bdc467d121e5f12767974b33f5b53de3fe43cf2c92606583314ccc00f98`](https://explorer.test.mezo.org/tx/0x628d0bdc467d121e5f12767974b33f5b53de3fe43cf2c92606583314ccc00f98) | 16243026 |

Nonces 4 through 46 were measurement contracts. The budget probe is `0x8D874Eca23f1348f1ad391c299D9b93c01a24F22`, tx [`0x925f9cc848de4d900998744c8bb63af6928181bdb27d2dcf28b5006800d575c1`](https://explorer.test.mezo.org/tx/0x925f9cc848de4d900998744c8bb63af6928181bdb27d2dcf28b5006800d575c1).

## What the live chain required

A Mezo transaction may call native precompiles **20 times**. Call 21 reverts with empty data. `balanceOf` succeeds 20 times and the 21st reverts. `EXTCODEHASH` does not count. `getAmountsOut` does not count. `PriceFeed.fetchPrice` is two calls. In the MUSD/BTC pool (`0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9`, MUSD is token0), a MUSD→BTC swap is three BTC calls. Open, add collateral, refinance, and withdraw each fetch the price once inside BorrowerOperations.

`loop` stops after two swaps. De-lever and unwind sell collateral once per transaction on the live BTC mirror and return. The app and the keeper send the next transaction. Empty hints make `SortedTroves` walk the list and can pass the 10,000,000 block gas limit, so hints stay.

BTC at `0x7b7C000000000000000000000000000000000000` has no `deposit()` or `withdraw()`. The router’s transfer credits native BTC, and `balanceOf` matches `address.balance`. The MUSD→BTC path returns that native gain and does not also call `balanceOf`. The reverse path skips `balanceOf` when the codehash is the live mirror. Fork tests etch a WETH-style token at the BTC address and still wrap.

`forge create` on this RPC tries `http://localhost:8545`. The Wave 1 contracts were deployed with `cast send --create`. The next factory has to be `forge script script/Deploy.s.sol --rpc-url https://rpc.test.mezo.org --broadcast`. That one broadcast also deploys and links `CoilLegacy`. Raw creation bytecode is not linked.

## Wave 2 factory (live)

Deployed 27 October 2026, blocks **16400159–16400160**, with `forge script script/Deploy.s.sol --broadcast`. Deployer `0xf74E746a8d7A46A8b0f745C6d5944Ee672c1a3AF`. Keeper `0x1D2621480011C44693a47801C1158E70b25b4B4F`. The private keys are not in this repository.

An earlier broadcast reverted in `eth_estimateGas` because `CoilAccount` was 33,413 bytes, over EIP-170's 24,576. The deployed implementation is 23,101 bytes. `CoilLegacy` holds the router loop, sale unwind, quotes, hints, and sweep. `CoilAccount` reaches it with `DELEGATECALL`, which is not a precompile call. `precompileBudget()` is still on the account. `FlashSizer` is created in the implementation constructor (nonce 1), so it has no separate transaction.

| Step | Address | Hash | Block |
| --- | --- | --- | --- |
| `CoilLegacy` | `0xdb2e13c3199C28E69f6EaF39fb6df05900Dd7969` | [`0x6baa682e4972ad287a493c4b87d40127b45efda7f26476cdbae42ab03a9bc4d6`](https://explorer.test.mezo.org/tx/0x6baa682e4972ad287a493c4b87d40127b45efda7f26476cdbae42ab03a9bc4d6) | 16400159 |
| `CoilAccount` implementation | `0x522DED4F0cF62cfc12456A28FbF82b044178564b` | [`0x5e32f0d0a591f768907fc3bc9e5d3e6623f522e0871f5616f0aaf3e1dba3ec5d`](https://explorer.test.mezo.org/tx/0x5e32f0d0a591f768907fc3bc9e5d3e6623f522e0871f5616f0aaf3e1dba3ec5d) | 16400159 |
| `FlashSizer` | `0x3d1006Ec18E64238aFD2a176b438F40FBfa6F326` | created inside the implementation constructor | 16400159 |
| `CoilFactory` | `0x6A38f560cF8612cc81cF966831890DBb310e31F7` | [`0xaaaae8e3f0f8390f7595f7b2629159fa50893a219e652ba7e301367d76272f6b`](https://explorer.test.mezo.org/tx/0xaaaae8e3f0f8390f7595f7b2629159fa50893a219e652ba7e301367d76272f6b) | 16400160 |

`script/verify.sh` was run. Blockscout returned “Fail - Unable to verify” / “Pending in queue”. The local creation bytecode of this deployed build matched the on-chain factory. Wave 1 is also unverified. Do not treat these addresses as verified source.

### End-to-end, 27 October 2026

User `0x52D21D3FE99C6CF66fBa07a8342015FEB9a57756`. Clone `0xEeE34fbAD36f46d648453914d658AbE314cA710c`. The trove was closed at the end.

| Step | Result | Hash |
| --- | --- | --- |
| `createAccount` | clone above | [`0x21e4960535628d16d67b02a833d814d82ede3957e94ea8130421b4970b313d49`](https://explorer.test.mezo.org/tx/0x21e4960535628d16d67b02a833d814d82ede3957e94ea8130421b4970b313d49) |
| `flashLoop(133.33%, 50 bps)` + 0.015 BTC | 0.05183 BTC collateral, 3,100.8 MUSD debt, CR 133.33% | [`0x576e5383d45538f63658ffdc110d256a4d1a41779efbd7df9c4e0b3d55af0eef`](https://explorer.test.mezo.org/tx/0x576e5383d45538f63658ffdc110d256a4d1a41779efbd7df9c4e0b3d55af0eef) |
| `approve` MEZO | | [`0xd7c8df63a14100dbfc4b34611543417b746c3d1d08477734e40c871a398b7cb5`](https://explorer.test.mezo.org/tx/0xd7c8df63a14100dbfc4b34611543417b746c3d1d08477734e40c871a398b7cb5) |
| `fundTips` 5 MEZO | | [`0xdc1ca051be38054aa0343ae074340e6b1920ee8a4fcb8b6c3a44b508615dc7a4`](https://explorer.test.mezo.org/tx/0xdc1ca051be38054aa0343ae074340e6b1920ee8a4fcb8b6c3a44b508615dc7a4) |
| `setGuard` floor 140%, target 150%, tip 1 MEZO | | [`0x058ccf26ff27c8a5d69a3232943de41a74e382be450014d9fb08cdad14233d20`](https://explorer.test.mezo.org/tx/0x058ccf26ff27c8a5d69a3232943de41a74e382be450014d9fb08cdad14233d20) |
| `setSlippage(200)` | required; keeper `guard()` had reverted `Slippage()` (`0x7dd37f70`) at 50 bps | [`0xf0db4179b8d6101e3fe7df63bf2ea2dfa55ef6147fafa06c0854468380ad25fb`](https://explorer.test.mezo.org/tx/0xf0db4179b8d6101e3fe7df63bf2ea2dfa55ef6147fafa06c0854468380ad25fb) |
| keeper `guard()` | CR 133.30% → 150.00%, 1 MEZO tip, block 16401501 | [`0xcb90da8575306d82209d7ba49c0d21caef14e5d5527ec5b9486c4689d71fb54a`](https://explorer.test.mezo.org/tx/0xcb90da8575306d82209d7ba49c0d21caef14e5d5527ec5b9486c4689d71fb54a) |
| `flashUnwind` | trove closed, about 0.014934 BTC returned, round-trip cost about 0.000066 BTC | [`0x296bb52c8458bbdd0f00bd8c58f425655cccabb6409c3068bb87e36a9209c3d2`](https://explorer.test.mezo.org/tx/0x296bb52c8458bbdd0f00bd8c58f425655cccabb6409c3068bb87e36a9209c3d2) |
| `withdrawTips` | | [`0x7304d1c9b4655dee674128adda78b5f59b5c2d66ccee448c4b3433378f324e0e`](https://explorer.test.mezo.org/tx/0x7304d1c9b4655dee674128adda78b5f59b5c2d66ccee448c4b3433378f324e0e) |

The pool price was about 78,646 MUSD per BTC and the oracle about 79,744, roughly 1.4% under the oracle. Buying BTC on the open is the favorable direction, so 50 bps was enough to open. Selling BTC to repay was not.

### Next factory

This branch adds `rescueSlippageBps` (default 200 bps, owner-set, hard cap 300) and uses it for `guard`, `flashUnwind`, and `flashDeleverTo`. Clones of `0x522DED4F0cF62cfc12456A28FbF82b044178564b` are not upgradeable, so the split needs a new implementation and a new factory from the same `script/Deploy.s.sol`. That script's behaviour is unchanged. Until that broadcast, the live accounts still share one slippage, and the app's slippage control calls `setSlippage` on them.

| Path | Precompile calls | One transaction |
| --- | --- | --- |
| `flashLoop` on a new trove | 7 | about 4.00× at collateral ratio `4e18/3`, and 3.00× at 150% |
| `flashUnwind` / close | 8 | full close |
| `flashDeleverTo` | 10 | whole raise |
| `guard()` plus MEZO tip | 12 | rescue, tip only if the ratio rose |

The rescue slippage check is local arithmetic on the oracle price. It does not add a precompile call.

The testnet MUSD/BTC pool is `0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9` (volatile, fee 4 bps, MUSD is token0). MEZO is `0x7B7c000000000000000000000000000000000001`. Faucet: https://faucet.test.mezo.org.
