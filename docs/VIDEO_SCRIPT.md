# Coil demo voiceover

2:44, 1920×1080, on the redesigned desk. Recording: [docs/media/coil-demo.mp4](media/coil-demo.mp4).

The spiral, the preview meter, and the step rail are the new UI. Spoken figures are what that UI prints. The 200% and 150% quotes are `quoteLoop` against the Mezo oracle and pool at block 16,243,988, with 0.04 BTC and 1% slippage. Position figures are `position()` on clone `0xC8ad8f93174C27c39FCC8463be05451C5E637650` at the block of each hash in [DEPLOYMENTS.md](../DEPLOYMENTS.md). The app truncates; it does not round. A 200.079% ratio prints as 200.07%. Debt of 3,732.337… MUSD prints as 3,732.33.

| Start | Section |
| --- | --- |
| 0:00 | Hero, coil draw, spiral at 2.00× |
| 0:11 | Why it is one call |
| 0:22 | Connect the testnet wallet |
| 0:33 | 1% slippage, 200% preview |
| 0:45 | Slider to 150%, spiral reads 3.00× |
| 0:54 | Back to 200%, 2.00× |
| 0:58 | Loop, explorer link |
| 1:17 | Open position |
| 1:30 | De-lever step rail |
| 1:48 | Fresh 0.046 BTC loop |
| 2:08 | Two-step unwind |
| 2:19 | Keeper guard |
| 2:32 | Repo and live factory |
| 2:44 | End |

---

Coil is one transaction that turns Bitcoin into a leveraged Bitcoin position on Mezo. The spiral is the coil. Two hundred percent is two times leverage.

You post bitcoin. Coil borrows MUSD, buys more bitcoin on Mezo Pools, and posts it back as collateral. The preview is the oracle and the pool, before you sign.

Connecting the testnet wallet. The clone owns the trove, so borrow, swap, and add-collateral share one loop. Coil stops after two swaps. A third would revert.

Slippage, one percent, the same as the mined loop. The quote shows zero point zero seven seven five bitcoin, and three thousand one hundred ninety-four point nine one MUSD.

With two swaps, this pool lands nearer one hundred fifty-eight percent, about two point seven times. The spiral reads three times.

Back to two hundred percent. Two times leverage.

Looping four hundredths of a bitcoin. The mined result is on the explorer link. Two hundred point zero seven percent, zero point zero seven eight three bitcoin, three thousand two hundred twenty-five point nine two MUSD. Liquidation, forty-five thousand two hundred seventy-nine dollars.

Collateral, debt, ratio, liquidation price, and rank. This trove sat outside the first thirty-two. Liquidation is one hundred ten percent. Coil will not target below one hundred fifteen.

De-lever sells collateral and repays, one sale per transaction. The first sale repaid to exactly two thousand MUSD. The ratio rose to two hundred fifty-eight percent, the ceiling at the eighteen hundred MUSD floor. The next call did not sell, so Coil stops.

A fresh two hundred percent trove, on the same factory. Zero point zero four six bitcoin in, closed in two transactions. Collateral, zero point zero nine zero seven bitcoin. Debt, three thousand seven hundred thirty-two point three three MUSD. Ratio, two hundred point zero eight percent.

First repay: two thousand MUSD, and a ratio of two hundred eighty-one point nine nine percent. The second returns the bitcoin. The trove is closed.

A keeper can only make this safer, up to a guard you set. It cannot unwind, or take the funds. The testnet guard is a floor of two hundred ten percent, a de-lever to two hundred fifty, and zone eight.

MUSD is minted by every loop, and burned by every repay. Mezo testnet, chain three one six one one. The repo and the live factory are on screen.

---

Hashes on the lower thirds:

| Step | Hash |
| --- | --- |
| `loop` 0.04 BTC | `0xff8d4e10ba1e7efcddb8dd1e11df6955729ec5487ca8629f3bdd7291a4ddb575` |
| `deleverTo` sale | `0x4646758c20fb1c31ab29e75b76dd5d19e2045a50aca2b3e114b9555d1949a777` |
| `deleverTo` no further sale | `0x88f03b428ea483a97152665100e57961c0ed8a401b4f619989b760ff8cfad151` |
| Fresh `loop` 0.046 BTC | `0xd72758f1114ac3add69ed08a519603d1059c41c2fa959b9e225fc88769d9fd89` |
| `unwind` step 1 | `0x3ff34e57f63d0278bf5932442f786bd346e08028f40bae0cbb5dc1f5d2efc2fd` |
| `unwind` step 2 | `0xd55cdf5fb1d882f36f7c6cc66ff62960eeab30b8a4122240aa09329bcc8defdc` |
| `setGuard(210%, 250%, zone 8)` | `0x63ae966f2d8bac4cf28d9c1261dd0b93026650272ff485ad77b969c5ca8b6e74` |

The guard transaction was mined on the earlier clone `0x1D19B717f7F700d67b0d187Af03785890D9Be436`. The arguments are the ones in that transaction. The live factory is `0xE29fAf17ed44B43c94D2Ff0e43E289aE49D98a3e`.
