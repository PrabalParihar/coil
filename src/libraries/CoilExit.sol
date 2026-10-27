// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBorrowerOperations, ITroveManager, IPool, IPoolFactory, IERC20} from "../interfaces/Mezo.sol";
import {FlashSizer} from "./FlashMath.sol";
import {CoilLegacy} from "./CoilLegacy.sol";
import {CoilPark} from "../CoilPark.sol";

/// @notice Owner close and rescue sale decisions. Linked into CoilAccount with
///         DELEGATECALL, separate from CoilLegacy so both stay under EIP-170.
/// @dev Calls into CoilLegacy are nested delegatecalls. `address(this)` stays the clone.
library CoilExit {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant MCR = 1.1e18;
    uint256 internal constant GAS_COMPENSATION = 200e18;
    uint256 internal constant BPS = 10_000;

    event ReserveReturned(address indexed owner, uint256 amount);
    /// @notice `guard` repaid parked MUSD and skipped the BTC sale.
    ///         The sale would have failed the oracle slippage check, so the reserve improvement stands.
    event PartialRescue(uint256 musdSpent, uint256 crAfter);

    error MinDebt();
    error Slippage();

    /// @notice Pull up to `need` parked MUSD onto this clone. Does not repay.
    function pullReserve(address park_, uint256 need) public returns (uint256 pulled) {
        if (need == 0) return 0;
        CoilPark box = CoilPark(park_);
        uint256 parked = box.assetsOf(address(this));
        if (parked == 0) return 0;
        pulled = parked < need ? parked : need;
        box.draw(pulled);
    }

    /// @notice After a full close, send any MUSD still parked for this clone to the owner.
    function returnReserve(CoilLegacy.Env memory e, address park_) public returns (uint256 amount) {
        CoilPark box = CoilPark(park_);
        amount = box.assetsOf(address(this));
        if (amount == 0) return 0;
        box.withdrawTo(e.owner, amount);
        emit ReserveReturned(e.owner, amount);
    }

    /// @dev True when selling `btcIn` for `musdOut` stays inside the oracle cap. No precompile calls.
    function oracleAllows(uint256 btcIn, uint256 musdOut, uint256 price, uint256 slippageBps) public pure returns (bool) {
        if (btcIn == 0 || musdOut == 0 || price == 0) return false;
        uint256 fairBtc = musdOut * WAD / price;
        if (fairBtc == 0) return false;
        return btcIn <= fairBtc * (BPS + slippageBps) / BPS;
    }

    /// @notice Owner unwind. Spends parked MUSD first.
    /// @dev A keeper cannot call this. When the oracle cap would reject the flash, the
    ///      owner still flashes if the BTC owed is strictly under the collateral. That
    ///      bound is the way out: the close pays the live pool price and cannot spend
    ///      more BTC than the trove holds. The Wave 1 router sale runs only when a flash
    ///      does not fit. Stacking both on the happy path would blow Mezo's 20-precompile cap,
    ///      and the BTC precompile allows only one Wave 1 sale per transaction.
    /// @return musdToFlash MUSD the caller must flash-borrow. Zero when this call finished the unwind.
    /// @return emitUnwind Caller should sweep and emit `Unwound`. False when `unwindSale` already did.
    function stageUnwind(
        CoilLegacy.Env memory e,
        address park_,
        address pool,
        address sizer_,
        uint256 fractionWad,
        uint256 price,
        uint256 rescueBps
    ) public returns (uint256 musdToFlash, bool emitUnwind) {
        uint256 debt = ITroveManager(e.troveManager).getTroveDebt(address(this));
        uint256 net = debt - GAS_COMPENSATION;
        bool full = fractionWad == WAD;
        uint256 toRepay = full ? net : net * fractionWad / WAD;
        if (!full && net - toRepay < IBorrowerOperations(e.borrowerOperations).minNetDebt()) revert MinDebt();

        uint256 have = IERC20(e.musd).balanceOf(address(this));
        if (have < toRepay) {
            pullReserve(park_, toRepay - have);
            have = IERC20(e.musd).balanceOf(address(this));
        }

        if (have >= toRepay) {
            if (full) {
                IBorrowerOperations(e.borrowerOperations).closeTrove();
                returnReserve(e, park_);
            } else {
                CoilLegacy.repayAmount(e, toRepay);
            }
            return (0, true);
        }

        if (_factoryPaused(e)) {
            if (full) {
                CoilLegacy.unwindAll(e, price, rescueBps);
                if (!_active(e)) returnReserve(e, park_);
                return (0, true);
            }
            CoilLegacy.unwindSale(e, fractionWad, price, toRepay, rescueBps);
            return (0, false);
        }

        // Partial repay: burn the parked MUSD before the flash, so `sweep` cannot return it unused.
        // A full close keeps it on the clone. `closeTrove` burns the balance together with the flash.
        if (!full && have > 0) {
            CoilLegacy.repayAmount(e, have);
            toRepay -= have;
            have = 0;
        }

        uint256 short = toRepay - have;
        (uint256 btcOwed, uint256 coll) = _quoteBtcIn(e, pool, sizer_, short);
        // Owner exit. The oracle cap is not applied. `btcOwed < coll` is the max BTC in.
        if (btcOwed != 0 && btcOwed < coll) return (short, true);

        if (full) {
            CoilLegacy.unwindAll(e, price, rescueBps);
            if (!_active(e)) {
                returnReserve(e, park_);
                return (0, true);
            }
            revert Slippage();
        }
        CoilLegacy.unwindSale(e, fractionWad, price, toRepay, rescueBps);
        return (0, false);
    }

    /// @notice `guard` / `deleverTo` sizing. Repays the reserve first.
    /// @dev If the BTC sale would fail the oracle cap, skip it and keep the reserve repayment.
    ///      `guard` already accepts any rise in the ratio. A sale that reverts would undo that repayment.
    /// @return musdToFlash MUSD the caller must flash-borrow. Zero when no BTC sale should run.
    function stageDelever(
        CoilLegacy.Env memory e,
        address park_,
        address pool,
        address sizer_,
        uint256 targetCR,
        uint256 price,
        uint256 rescueBps
    ) public returns (uint256 musdToFlash) {
        uint256 spent = CoilLegacy.applyReserve(e, park_, targetCR, price);
        if (!_active(e) || _cr(e, price) >= targetCR) return 0;
        if (_factoryPaused(e)) {
            if (spent != 0) {
                emit PartialRescue(spent, _cr(e, price));
                return 0;
            }
            CoilLegacy.deleverIter(e, targetCR, price, rescueBps);
            return 0;
        }

        (uint256 musdOut, uint256 btcOwed, uint256 coll) = _saleQuote(e, pool, sizer_, targetCR, price);
        if (musdOut == 0) {
            if (spent != 0) emit PartialRescue(spent, _cr(e, price));
            return 0;
        }
        if (btcOwed == 0 || btcOwed >= coll || !oracleAllows(btcOwed, musdOut, price, rescueBps)) {
            if (spent == 0) revert Slippage();
            emit PartialRescue(spent, _cr(e, price));
            return 0;
        }
        return musdOut;
    }

    function _saleQuote(CoilLegacy.Env memory e, address pool, address sizer_, uint256 targetCR, uint256 price)
        private
        view
        returns (uint256 musdOut, uint256 btcOwed, uint256 coll)
    {
        FlashSizer.Repay memory r;
        r.coll = ITroveManager(e.troveManager).getTroveColl(address(this));
        r.debt = ITroveManager(e.troveManager).getTroveDebt(address(this));
        r.room = CoilLegacy.maxRepay(e, r.debt);
        (r.reserveMusd, r.reserveBtc) = _poolReserves(pool, e.btc);
        r.fee = IPoolFactory(e.poolFactory).getFee(pool, IPool(pool).stable());
        r.targetCR = targetCR;
        r.price = price;
        r.gasComp = GAS_COMPENSATION;
        r.mcrBuffer = MCR + 0.01e18;
        coll = r.coll;
        musdOut = FlashSizer(sizer_).sizeRepay(r);
        if (musdOut == 0) return (0, 0, coll);
        btcOwed = FlashSizer(sizer_).amountIn(r.reserveBtc, r.reserveMusd, musdOut, r.fee);
    }

    function _quoteBtcIn(CoilLegacy.Env memory e, address pool, address sizer_, uint256 musdOut)
        private
        view
        returns (uint256 btcOwed, uint256 coll)
    {
        (uint256 poolMusd, uint256 poolBtc) = _poolReserves(pool, e.btc);
        uint256 fee = IPoolFactory(e.poolFactory).getFee(pool, IPool(pool).stable());
        btcOwed = FlashSizer(sizer_).amountIn(poolBtc, poolMusd, musdOut, fee);
        coll = ITroveManager(e.troveManager).getTroveColl(address(this));
    }

    function _factoryPaused(CoilLegacy.Env memory e) private view returns (bool) {
        (bool ok, bytes memory data) = e.poolFactory.staticcall(abi.encodeWithSignature("isPaused()"));
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (bool));
    }

    function _poolReserves(address pool, address btc) private view returns (uint256 poolMusd, uint256 poolBtc) {
        (uint256 r0, uint256 r1,) = IPool(pool).getReserves();
        if (IPool(pool).token0() == btc) return (r1, r0);
        return (r0, r1);
    }

    function _active(CoilLegacy.Env memory e) private view returns (bool) {
        return ITroveManager(e.troveManager).getTroveStatus(address(this)) == ITroveManager.Status.active;
    }

    function _cr(CoilLegacy.Env memory e, uint256 price) private view returns (uint256) {
        return ITroveManager(e.troveManager).getCurrentICR(address(this), price);
    }
}
