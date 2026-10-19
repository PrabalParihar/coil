# Coil demo voiceover

About two and a half minutes of reading, paced over the 2:52 recording at [docs/media/coil-demo.mp4](media/coil-demo.mp4). The recording is the live Mezo testnet app: hero, connect, the leverage preview, a loop, the position, a de-lever, and a full unwind.

---

Coil is one transaction that turns Bitcoin into a leveraged Bitcoin position on Mezo.

You post BTC. Coil borrows MUSD, buys more BTC on the Mezo Pools MUSD-BTC market, and posts that BTC back as collateral. You pick the collateral ratio. Two hundred percent is two times leverage. The preview is the live oracle and the live pool, before you sign.

The account on screen is a clone. The clone owns the trove, so borrow, swap, and add-collateral fit in a single loop. Mezo only allows twenty precompile calls in a transaction, and a third swap would be the one that reverts, so Coil stops after two and lands on the ratio you asked for.

That position is collateral, debt, the ratio, a liquidation price, and where you sit in the redemption queue. Redemptions pay the lowest-ratio troves first. A tight coil is at the front of that line. Liquidation is one hundred ten percent. Coil will not target below one hundred fifteen.

De-lever sells a slice of collateral, swaps it back to MUSD, and repays. A large move, from two hundred percent toward three hundred, can need more than one sale. Each transaction sells once, the screen shows the hash, and the next transaction continues. If the trove is already at Mezo’s eighteen hundred MUSD minimum debt, another sale cannot raise the ratio, so Coil stops instead of reverting. Closing, rather than pushing the ratio, is unwind. A fresh two hundred percent trove closes in two transactions: the first repays down to the floor, the second buys the rest of the MUSD and returns the BTC.

A keeper can only make this safer, and only up to a guard you set. It cannot unwind, and it cannot take the funds.

MUSD is the debt every loop mints and every repay burns. Mezo Pools is where that MUSD becomes BTC. The MEZO token is the next wave: keeper tips and gauge rewards. This build is on Mezo testnet, and the contracts are verified by the transactions on screen.
