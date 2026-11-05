// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBorrowerOperations, ITroveManager, IERC20, IPriceFeed, IPool, IPoolFactory} from "../interfaces/Mezo.sol";
import {ICoilFactory} from "../ICoilFactory.sol";
import {FlashSizer} from "./FlashMath.sol";
import {PriceMin} from "./PriceMin.sol";
import {CoilLegacy} from "./CoilLegacy.sol";
import {CoilExit} from "./CoilExit.sol";

/// @notice Linked owner actions. The account enforces ownership and its shared reentrancy lock.
library CoilOwner {
    event CollateralClaimed(address indexed owner, uint256 amount);
    event MUSDRepaid(address indexed owner, uint256 amount);
    event ClosedWithMUSD(address indexed owner, uint256 ownerMUSD);
    error TransferFailed();
    error ZeroAmount();
    error NoTrove();
    error RecoveryMode();
    error OraclePriceZero();
    error ShortRepay();
    error BadCR();
    error BadSlippage();
    error CannotOpen();
    error Slippage();
    error OpensPaused();
    error PositionLimit();
    error AlreadyAtTarget();

    function checkLimits(address manager, address factory, ICoilFactory.Policy memory starting) public view {
        uint256 collateral = ITroveManager(manager).getTroveColl(address(this));
        uint256 debt = ITroveManager(manager).getTroveDebt(address(this));
        if (collateral > starting.maxCollateral || debt > starting.maxDebt) revert PositionLimit();
        ICoilFactory.Policy memory current = ICoilFactory(factory).policy();
        if (current.opensPaused) revert OpensPaused();
        if (collateral > current.maxCollateral || debt > current.maxDebt) revert PositionLimit();
    }

    function loopWithoutFlash(CoilLegacy.Env memory e, uint256 deposit, uint256 minted, bool exists) public {
        uint256 rate = IBorrowerOperations(e.borrowerOperations).borrowingRate();
        if (!exists) {
            (address upper, address lower) = CoilLegacy.hintPair(e, deposit, minted + minted * rate / 1e18 + 200e18);
            IBorrowerOperations(e.borrowerOperations).openTrove{value: deposit}(minted, upper, lower);
            return;
        }
        if (deposit > 0) CoilLegacy.addColl(e, deposit);
        if (minted > 0) {
            uint256 principal =
                ITroveManager(e.troveManager).getTrovePrincipal(address(this)) + minted + minted * rate / 1e18;
            (address upper, address lower) =
                CoilLegacy.hintPair(e, ITroveManager(e.troveManager).getTroveColl(address(this)), principal);
            IBorrowerOperations(e.borrowerOperations).withdrawMUSD(minted, upper, lower);
        }
    }

    function quoteLoop(CoilLegacy.Env memory e, uint256 collateral, uint256 target, uint256 slip)
        public
        view
        returns (CoilLegacy.Quote memory)
    {
        _checkQuote(collateral, target, slip);
        return CoilLegacy.quoteLoop(e, collateral, target, slip);
    }

    function quoteLoopPosition(CoilLegacy.Env memory e, uint256 collateral, uint256 target, uint256 slip)
        public
        view
        returns (CoilLegacy.Quote memory)
    {
        bool exists = ITroveManager(e.troveManager).getTroveStatus(address(this)) == ITroveManager.Status.active;
        _checkQuote(collateral + (exists ? ITroveManager(e.troveManager).getTroveColl(address(this)) : 0), target, slip);
        return CoilLegacy.quoteLoopPosition(e, collateral, target, slip);
    }

    function quoteFlash(
        CoilLegacy.Env memory e,
        address sizer,
        address pool,
        uint256 collateral,
        uint256 target,
        uint256 slip
    ) public view returns (CoilLegacy.Quote memory q, uint256 flash, uint256 poolFee) {
        return _quoteFlash(e, sizer, pool, collateral, target, slip, false);
    }

    function quoteFlashPosition(
        CoilLegacy.Env memory e,
        address sizer,
        address pool,
        uint256 collateral,
        uint256 target,
        uint256 slip
    ) public view returns (CoilLegacy.Quote memory q, uint256 flash, uint256 poolFee) {
        return _quoteFlash(e, sizer, pool, collateral, target, slip, true);
    }

    function _quoteFlash(
        CoilLegacy.Env memory e,
        address sizer,
        address pool,
        uint256 collateral,
        uint256 target,
        uint256 slip,
        bool includePosition
    ) private view returns (CoilLegacy.Quote memory q, uint256 flash, uint256 poolFee) {
        uint256 price = IPriceFeed(e.priceFeed).fetchPrice();
        if (price == 0) revert OraclePriceZero();
        FlashSizer.Ctx memory c = _context(e, pool, price);
        c.deposit = collateral;
        c.targetCR = target;
        if (includePosition) c = _position(e, c);
        _checkQuote(collateral + c.collNow, target, slip);
        if (c.exists && collateral == 0 && c.collNow * price / c.debtNow <= target) revert AlreadyAtTarget();
        (uint256 got, uint256 owed, uint256 minted, bool fits) = FlashSizer(sizer).solve(c);
        if (!fits || (!c.exists && minted == 0)) revert CannotOpen();
        if (got != 0) {
            uint256 floor = PriceMin.tokenOutMin(owed, 18, price, 18, slip);
            if (floor == 0 || got < floor) revert Slippage();
        }
        q.collateral = c.collNow + collateral + got;
        uint256 startingDebt = c.exists ? c.debtNow : 200e18;
        if (c.exists && (collateral > 0 || got > 0)) {
            startingDebt += ((startingDebt - 200e18) * c.refiPct / 100) * c.rate / 1e18;
        }
        q.debt = startingDebt + minted + minted * c.rate / 1e18;
        q.cr = q.collateral * price / q.debt;
        q.liquidationPrice = 1.1e18 * q.debt / q.collateral;
        q.musdMinted = minted;
        q.iterations = got == 0 ? 0 : 1;
        q.coilFeeMusd = minted * e.coilFeeBps / 10000;
        return (q, got, owed * c.fee / 10000);
    }

    function solveFlash(
        CoilLegacy.Env memory e,
        address sizer,
        address pool,
        uint256 deposit,
        uint256 target,
        uint256 price
    ) public view returns (uint256 flash, uint256 owed, uint256 minted, bool fits) {
        FlashSizer.Ctx memory c = _context(e, pool, price);
        c.deposit = deposit;
        c.targetCR = target;
        c = _position(e, c);
        return FlashSizer(sizer).solve(c);
    }

    function _position(CoilLegacy.Env memory e, FlashSizer.Ctx memory c) private view returns (FlashSizer.Ctx memory) {
        c.exists = ITroveManager(e.troveManager).getTroveStatus(address(this)) == ITroveManager.Status.active;
        if (c.exists) {
            c.collNow = ITroveManager(e.troveManager).getTroveColl(address(this));
            c.debtNow = ITroveManager(e.troveManager).getTroveDebt(address(this));
            c.minAmt = 0;
        }
        return c;
    }

    function _context(CoilLegacy.Env memory e, address pool, uint256 price)
        private
        view
        returns (FlashSizer.Ctx memory c)
    {
        c.price = price;
        c.fee = IPoolFactory(e.poolFactory).getFee(pool, IPool(pool).stable());
        (uint256 r0, uint256 r1,) = IPool(pool).getReserves();
        (c.reserveMusd, c.reserveBtc) = IPool(pool).token0() == e.btc ? (r1, r0) : (r0, r1);
        c.rate = IBorrowerOperations(e.borrowerOperations).borrowingRate();
        c.refiPct = IBorrowerOperations(e.borrowerOperations).refinancingFeePercentage();
        c.minAmt = CoilLegacy.minOpenAmount(e, c.rate);
        c.gasComp = 200e18;
        c.mcr = 1.1e18;
        c.openHeadroom = 0.005e18;
        c.coilFeeBps = e.coilFeeBps;
    }

    function _checkQuote(uint256 collateral, uint256 target, uint256 slip) private pure {
        if (collateral == 0) revert ZeroAmount();
        if (target < 1.15e18 || target > 10e18) revert BadCR();
        if (slip == 0 || slip > 300) revert BadSlippage();
    }

    function claim(CoilLegacy.Env memory e) public returns (uint256 amount) {
        uint256 beforeBalance = address(this).balance;
        IBorrowerOperations(e.borrowerOperations).claimCollateral();
        amount = address(this).balance - beforeBalance;
        if (amount != 0) {
            (bool ok,) = e.owner.call{value: amount}("");
            if (!ok) revert TransferFailed();
        }
        emit CollateralClaimed(e.owner, amount);
    }

    function repay(CoilLegacy.Env memory e, uint256 requested) public returns (uint256 amount) {
        if (requested == 0) revert ZeroAmount();
        _requireActive(e);
        uint256 room = CoilLegacy.maxRepay(e, ITroveManager(e.troveManager).getTroveDebt(address(this)));
        amount = requested < room ? requested : room;
        // Pull only what can be used; unused owner funds never leave the wallet.
        if (amount != 0) {
            _pull(e, amount);
            CoilLegacy.repayAmount(e, amount);
        }
        emit MUSDRepaid(e.owner, amount);
    }

    function close(CoilLegacy.Env memory e, address park, uint256 maxOwnerMUSD) public {
        _requireActive(e);
        uint256 price = IPriceFeed(e.priceFeed).fetchPrice();
        if (price == 0) revert OraclePriceZero();
        if (ITroveManager(e.troveManager).checkRecoveryMode(price)) revert RecoveryMode();
        uint256 need = ITroveManager(e.troveManager).getTroveDebt(address(this)) - 200e18;
        uint256 have = IERC20(e.musd).balanceOf(address(this));
        if (have < need) have += CoilExit.pullReserve(park, need - have);
        uint256 fromOwner = have < need ? need - have : 0;
        if (fromOwner > maxOwnerMUSD) revert ShortRepay();
        if (fromOwner != 0) _pull(e, fromOwner);
        IBorrowerOperations(e.borrowerOperations).closeTrove();
        CoilExit.returnReserve(e, park);
        CoilLegacy.sweep(e);
        emit ClosedWithMUSD(e.owner, fromOwner);
    }

    function addCollateral(CoilLegacy.Env memory e) public {
        if (msg.value == 0) revert ZeroAmount();
        _requireActive(e);
        (address upper, address lower) = CoilLegacy.hintPair(
            e,
            ITroveManager(e.troveManager).getTroveColl(address(this)) + msg.value,
            ITroveManager(e.troveManager).getTrovePrincipal(address(this))
        );
        // No refinance or collateral withdrawal: protocol-safe in Recovery Mode.
        IBorrowerOperations(e.borrowerOperations).addColl{value: msg.value}(upper, lower);
    }

    function _requireActive(CoilLegacy.Env memory e) private view {
        if (ITroveManager(e.troveManager).getTroveStatus(address(this)) != ITroveManager.Status.active) {
            revert NoTrove();
        }
    }

    function _pull(CoilLegacy.Env memory e, uint256 amount) private {
        if (!IERC20(e.musd).transferFrom(e.owner, address(this), amount)) revert TransferFailed();
    }
}
