// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Sizing for a Mezo Pools volatile flash swap.
/// @dev `solve` and `fits` are public so they run in their own call frame. Inlining
///      them into CoilAccount overflows the EVM stack under via_ir.
///      Pool.swap skims the fee out of the pair and then requires `x * y >= k`
///      on what remains. Fee division rounds down, so this bumps `amountIn`
///      until the post-fee product covers `k`.
contract FlashSizer {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;

    struct Ctx {
        uint256 deposit;
        uint256 collNow;
        uint256 debtNow;
        uint256 targetCR;
        uint256 price;
        uint256 fee;
        uint256 reserveMusd;
        uint256 reserveBtc;
        uint256 rate;
        uint256 minAmt;
        uint256 gasComp;
        uint256 mcr;
        uint256 openHeadroom;
        bool exists;
    }

    function amountIn(uint256 reserveIn, uint256 reserveOut, uint256 amountOut, uint256 feeBps)
        public
        pure
        returns (uint256 guess)
    {
        if (amountOut == 0 || amountOut >= reserveOut || feeBps >= BPS || reserveIn == 0) return 0;
        uint256 outLeft = reserveOut - amountOut;
        uint256 net = BPS - feeBps;
        guess = (reserveIn * amountOut * BPS) / (outLeft * net) + 1;
        // Pool.swap requires (reserveIn + amountInAfterFee) * (reserveOut - amountOut) >= k.
        // Fee division rounds down, so walk forward a few wei until that holds.
        for (uint256 i; i < 8; ++i) {
            uint256 fee = guess * feeBps / BPS;
            if (fee >= guess) return 0;
            uint256 kept = guess - fee;
            if (reserveIn > type(uint256).max - kept) return 0;
            uint256 balIn = reserveIn + kept;
            if (balIn > type(uint256).max / outLeft || reserveIn > type(uint256).max / reserveOut) return 0;
            if (balIn * outLeft >= reserveIn * reserveOut) return guess;
            unchecked {
                ++guess;
            }
        }
        return 0;
    }

    function solve(Ctx memory c) public pure returns (uint256 flashBtc, uint256 owed, uint256 minted, bool fitsOk) {
        if (c.reserveBtc < 5 || c.price == 0) return (0, 0, 0, false);
        uint256 hi = c.reserveBtc / 5;
        uint256 lo;
        uint256 best;
        for (uint256 i; i < 72; ++i) {
            uint256 mid = (lo + hi + 1) / 2;
            (bool ok,,) = fits(c, mid);
            if (ok) {
                best = mid;
                lo = mid;
            } else if (mid == 0) {
                break;
            } else {
                hi = mid - 1;
            }
        }
        (fitsOk, owed, minted) = fits(c, best);
        if (!fitsOk) (fitsOk, owed, minted) = fits(c, 0);
        else flashBtc = best;
    }

    function fits(Ctx memory c, uint256 flash) public pure returns (bool ok, uint256 owed, uint256 minted) {
        if (c.price == 0) return (false, 0, 0);
        if (flash > 0) {
            owed = amountIn(c.reserveMusd, c.reserveBtc, flash, c.fee);
            if (owed == 0) return (false, 0, 0);
        }
        minted = owed < c.minAmt ? c.minAmt : owed;
        uint256 coll = c.collNow + c.deposit + flash;
        if (coll == 0) return (false, 0, 0);
        if (c.exists && minted == 0) {
            if (c.debtNow == 0) return (true, 0, 0);
            return (coll * c.price / c.debtNow >= c.targetCR, 0, 0);
        }
        uint256 debt = _debt(c.exists ? c.debtNow : 0, minted, c.rate, c.gasComp);
        if (debt == 0) return (false, 0, 0);
        uint256 capDenom = c.exists ? c.mcr : c.mcr + c.openHeadroom;
        if (debt > coll * c.price / capDenom) return (false, 0, 0);
        if (coll * c.price / debt < c.targetCR) return (false, 0, 0);
        return (true, owed, minted);
    }

    /// @notice Smallest MUSD flash that lifts the ratio to `targetCR`, or the largest
    ///         flash that still raises it when the minimum-debt floor blocks the target.
    function sizeRepay(
        uint256 coll,
        uint256 debt,
        uint256 room,
        uint256 targetCR,
        uint256 price,
        uint256 reserveMusd,
        uint256 reserveBtc,
        uint256 fee,
        uint256 gasComp,
        uint256 mcrBuffer
    ) public pure returns (uint256 musdOut) {
        if (room == 0 || coll == 0 || debt == 0 || price == 0) return 0;
        uint256 hi = room;
        if (hi > reserveMusd / 5) hi = reserveMusd / 5;
        uint256 crNow = coll * price / debt;
        uint256 lo;
        uint256 best;
        for (uint256 i; i < 72; ++i) {
            uint256 mid = (lo + hi + 1) / 2;
            uint256 crMid = crAfterRepay(coll, debt, mid, price, reserveMusd, reserveBtc, fee, gasComp, mcrBuffer);
            if (crMid > crNow) {
                best = mid;
                lo = mid;
            } else if (mid == 0) {
                break;
            } else {
                hi = mid - 1;
            }
        }
        if (best == 0) return 0;
        if (crAfterRepay(coll, debt, best, price, reserveMusd, reserveBtc, fee, gasComp, mcrBuffer) < targetCR) {
            return best;
        }
        lo = 0;
        hi = best;
        for (uint256 i; i < 72; ++i) {
            uint256 mid = (lo + hi) / 2;
            if (
                mid == 0
                    || crAfterRepay(coll, debt, mid, price, reserveMusd, reserveBtc, fee, gasComp, mcrBuffer) < targetCR
            ) lo = mid + 1;
            else hi = mid;
        }
        return hi;
    }

    function crAfterRepay(
        uint256 coll,
        uint256 debt,
        uint256 musdOut,
        uint256 price,
        uint256 reserveMusd,
        uint256 reserveBtc,
        uint256 fee,
        uint256 gasComp,
        uint256 mcrBuffer
    ) public pure returns (uint256) {
        if (musdOut == 0 || musdOut >= debt) return 0;
        uint256 btcIn = amountIn(reserveBtc, reserveMusd, musdOut, fee);
        if (btcIn == 0 || btcIn >= coll) return 0;
        uint256 newDebt = debt - musdOut;
        if (newDebt <= gasComp) return 0;
        uint256 cr = (coll - btcIn) * price / newDebt;
        if (cr < mcrBuffer) return 0;
        return cr;
    }

    /// @notice Price impact of selling `amountIn` of the input reserve, in bps of the spot output.
    function impactBps(uint256 reserveIn, uint256 reserveOut, uint256 amountIn_, uint256 feeBps)
        public
        pure
        returns (uint256)
    {
        if (amountIn_ == 0 || reserveIn == 0 || reserveOut == 0 || feeBps >= BPS) return 0;
        uint256 spot = amountIn_ * reserveOut / reserveIn;
        if (spot == 0) return BPS;
        uint256 fee = amountIn_ * feeBps / BPS;
        if (fee >= amountIn_) return BPS;
        uint256 kept = amountIn_ - fee;
        uint256 outAmt = reserveOut * kept / (reserveIn + kept);
        if (outAmt >= spot) return 0;
        return (spot - outAmt) * BPS / spot;
    }

    /// @notice Highest leverage whose flash sale stays within `maxImpactBps`.
    ///         Tries 4×, 3×, 2×, 1.5×, then 1.33×. When none fit under the cap,
    ///         `capped` is false and the return is the gentlest size that still opens
    ///         (so the UI can show that impact instead of pretending 4× is fine).
    ///         A zero `targetCR` means no leverage clears the debt floor.
    function sensibleTarget(Ctx memory c, uint256 maxImpactBps)
        public
        pure
        returns (uint256 targetCR, uint256 impact, uint256 leverageWad, bool capped)
    {
        uint256[5] memory targets = [uint256(4e18) / 3, 1.5e18, 2e18, 3e18, 4e18];
        uint256 bestImpact = type(uint256).max;
        uint256 bestCR;
        for (uint256 i; i < targets.length; ++i) {
            c.targetCR = targets[i];
            (, uint256 owed,, bool fitsOk) = solve(c);
            if (!fitsOk) continue;
            uint256 bps = impactBps(c.reserveMusd, c.reserveBtc, owed, c.fee);
            if (bps < bestImpact) {
                bestImpact = bps;
                bestCR = targets[i];
            }
            if (bps <= maxImpactBps) {
                targetCR = targets[i];
                impact = bps;
                capped = true;
                break;
            }
        }
        if (!capped) {
            targetCR = bestCR;
            impact = bestImpact;
        }
        if (targetCR <= WAD) return (targetCR, impact, 0, capped);
        leverageWad = targetCR * WAD / (targetCR - WAD);
    }

    function _debt(uint256 debt, uint256 amount, uint256 rate, uint256 gasComp) private pure returns (uint256) {
        uint256 fee = amount * rate / WAD;
        return (debt == 0 ? gasComp : debt) + amount + fee;
    }
}
