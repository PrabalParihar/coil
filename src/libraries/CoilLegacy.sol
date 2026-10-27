// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBorrowerOperations, ITroveManager, ISortedTroves, IHintHelpers, IPriceFeed, IRouter, IERC20} from "../interfaces/Mezo.sol";

/// @notice Router-based loop, sale unwind, and quotes. Deployed on its own and
///         linked into CoilAccount with DELEGATECALL, so `address(this)` stays the
///         clone and the precompile calls inside a transaction are unchanged.
/// @dev Public functions live in this bytecode. Internal helpers are not copied
///      back into CoilAccount. Do not call this contract directly: Solidity
///      libraries only run through the account's delegatecall.
library CoilLegacy {
    uint256 internal constant WAD = 1e18;
    uint256 internal constant MCR = 1.1e18;
    uint256 internal constant MIN_TARGET_CR = 1.15e18;
    uint256 internal constant GAS_COMPENSATION = 200e18;
    uint256 internal constant NICR_PRECISION = 1e20;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_ITERS = 6;
    uint256 internal constant MAX_SWAPS_PER_TX = 2;
    uint256 internal constant CR_BUFFER = 0.003e18;
    uint256 internal constant OPEN_HEADROOM = 0.005e18;
    bytes32 internal constant BTC_MIRROR_CODEHASH =
        0x646ced85f3dad5f3a9fa7a920d158620ac616278d1b32b45867d486b40bdd5ef;

    struct Env {
        address borrowerOperations;
        address troveManager;
        address sortedTroves;
        address hintHelpers;
        address priceFeed;
        address musd;
        address btc;
        address router;
        address poolFactory;
        address owner;
    }

    struct Quote {
        uint256 collateral;
        uint256 debt;
        uint256 cr;
        uint256 liquidationPrice;
        uint256 musdMinted;
        uint256 iterations;
    }

    event Looped(address indexed owner, uint256 targetCR, uint256 collateral, uint256 debt, uint256 cr);
    event Unwound(address indexed owner, uint256 fractionWad, uint256 cr);
    event Swept(address indexed to, uint256 btcAmount, uint256 musdAmount);

    error AlreadyAtTarget();
    error BelowTarget();
    error CannotOpen();
    error Iterations();
    error MinDebt();
    error NotSafer();
    error RecoveryMode();
    error ShortRepay();
    error Slippage();
    error TransferFailed();
    error ZeroAmount();

    function runLoop(Env memory e, uint256 targetCR, uint256 maxSlippageBps) public {
        uint256 price = IPriceFeed(e.priceFeed).fetchPrice();
        if (ITroveManager(e.troveManager).checkRecoveryMode(price)) revert RecoveryMode();

        bool exists = _active(e);
        if (!exists && msg.value == 0) revert ZeroAmount();
        if (exists && msg.value == 0 && _cr(e, price) <= targetCR) revert AlreadyAtTarget();
        if (exists && msg.value > 0) addColl(e, msg.value);

        uint256 pending = exists ? 0 : msg.value;
        uint256 swaps;
        for (uint256 i; i < MAX_ITERS && swaps < MAX_SWAPS_PER_TX; ++i) {
            bool stop;
            (pending, stop) = _leverStep(e, targetCR, maxSlippageBps, pending, price, swaps);
            if (stop) break;
            unchecked {
                ++swaps;
            }
        }
        if (pending != 0) revert CannotOpen();
        if (!_active(e)) revert CannotOpen();

        uint256 endCr = _cr(e, price);
        if (endCr < targetCR) revert BelowTarget();
        emit Looped(
            e.owner,
            targetCR,
            ITroveManager(e.troveManager).getTroveColl(address(this)),
            ITroveManager(e.troveManager).getTroveDebt(address(this)),
            endCr
        );
    }

    function quoteLoop(Env memory e, uint256 collateralIn, uint256 targetCR, uint256 slippageBps_)
        public
        view
        returns (Quote memory q)
    {
        if (collateralIn == 0) revert ZeroAmount();
        uint256 price = IPriceFeed(e.priceFeed).fetchPrice();
        uint256 rate = IBorrowerOperations(e.borrowerOperations).borrowingRate();
        uint8 refiPct = IBorrowerOperations(e.borrowerOperations).refinancingFeePercentage();
        uint256 coll = collateralIn;
        uint256 debt;

        for (uint256 i; i < MAX_SWAPS_PER_TX; ++i) {
            if (debt != 0 && coll * price / debt <= targetCR) break;
            bool last = i + 1 == MAX_SWAPS_PER_TX;
            uint8 feePct = last ? 0 : refiPct;
            uint256 cap = debt == 0 ? coll * price / (MCR + OPEN_HEADROOM) : coll * price / MCR;
            uint256 maxAmt = _amountFromCap(debt, cap, rate);
            uint256 amount = _borrowAmount(e, coll, debt, price, targetCR, maxAmt, slippageBps_, rate, feePct);
            if (amount == 0) break;
            uint256 btcOut = _btcMinOut(e, amount, slippageBps_);
            debt = _projectedDebt(debt, amount, rate, !last, feePct);
            coll += btcOut;
            q.musdMinted += amount;
            q.iterations = i + 1;
            if (last || coll * price / debt <= targetCR + CR_BUFFER) break;
        }

        q.collateral = coll;
        q.debt = debt;
        q.cr = debt == 0 ? 0 : coll * price / debt;
        q.liquidationPrice = coll == 0 ? 0 : MCR * debt / coll;
    }

    function unwindSale(Env memory e, uint256 fractionWad, uint256 price, uint256 toRepay, uint256 slippageBps) public {
        uint256 repaid;
        uint256 saleCap = _saleCap(e);
        for (uint256 i; i < saleCap && repaid < toRepay; ++i) {
            uint256 short = toRepay - repaid;
            uint256 coll = ITroveManager(e.troveManager).getTroveColl(address(this));
            uint256 debt = ITroveManager(e.troveManager).getTroveDebt(address(this));
            uint256 maxW = _maxWithdraw(coll, debt, price);
            if (maxW == 0) break;
            uint256 sell = _btcInForMusd(e, short, slippageBps);
            if (sell == 0 || sell > maxW) sell = maxW;
            uint256 got = _sellAndRepay(e, sell, short, slippageBps);
            if (got == 0) break;
            repaid += got;
        }
        if (repaid < toRepay && (toRepay - repaid) * 100 > toRepay && !(_btcMirror(e) && repaid > 0)) {
            revert ShortRepay();
        }
        sweep(e);
        emit Unwound(e.owner, fractionWad, _active(e) ? _cr(e, price) : type(uint256).max);
    }

    function deleverIter(Env memory e, uint256 targetCR, uint256 price, uint256 slippageBps) public {
        uint256 sales = _saleCap(e);
        for (uint256 i; i < sales; ++i) {
            uint256 coll = ITroveManager(e.troveManager).getTroveColl(address(this));
            uint256 debt = ITroveManager(e.troveManager).getTroveDebt(address(this));
            if (debt <= GAS_COMPENSATION) return;
            uint256 crNow = coll * price / debt;
            if (crNow >= targetCR) return;

            uint256 maxW = _maxWithdraw(coll, debt, price);
            uint256 room = maxRepay(e, debt);
            if (maxW == 0 || room == 0) {
                if (_btcMirror(e)) return;
                revert MinDebt();
            }
            uint256 sell = _btcToReach(e, coll, debt, price, targetCR, maxW, slippageBps);
            uint256 forRoom = _btcInForMusd(e, room, slippageBps);
            if (forRoom != 0 && (sell == 0 || forRoom < sell)) sell = forRoom;
            if (sell == 0 || sell > maxW) {
                if (_btcMirror(e)) return;
                revert MinDebt();
            }
            if (_crAfterCappedRepay(e, coll, debt, sell, price, slippageBps, room) <= crNow) {
                if (_btcMirror(e)) return;
                revert NotSafer();
            }
            _sellAndRepay(e, sell, room, slippageBps);
        }
        if (!_btcMirror(e) && _cr(e, price) < targetCR) revert Iterations();
    }

    function unwindAll(Env memory e, uint256 price, uint256 slippageBps) public {
        uint256 sales;
        uint256 saleCap = _btcMirror(e) ? 1 : MAX_ITERS + 2;
        for (uint256 i; i < MAX_ITERS + 2; ++i) {
            uint256 debt = ITroveManager(e.troveManager).getTroveDebt(address(this));
            uint256 need = debt - GAS_COMPENSATION;
            uint256 have = IERC20(e.musd).balanceOf(address(this));
            if (have >= need) {
                IBorrowerOperations(e.borrowerOperations).closeTrove();
                sweep(e);
                return;
            }
            if (sales >= saleCap) return;

            uint256 coll = ITroveManager(e.troveManager).getTroveColl(address(this));
            uint256 maxW = _maxWithdraw(coll, debt, price);
            if (maxW == 0) revert MinDebt();

            uint256 short = need - have;
            uint256 btcForShort = _btcInForMusd(e, short, slippageBps);
            if (btcForShort != 0 && btcForShort <= maxW) {
                _withdrawAndSwap(e, btcForShort, slippageBps);
                sales++;
                continue;
            }

            uint256 room = maxRepay(e, debt);
            if (room == 0) revert MinDebt();
            uint256 btcForRepay = _btcInForMusd(e, room, slippageBps);
            if (btcForRepay == 0 || btcForRepay > maxW) btcForRepay = maxW;
            _sellAndRepay(e, btcForRepay, room, slippageBps);
            sales++;
        }
        if (!_btcMirror(e)) revert Iterations();
    }

    function addColl(Env memory e, uint256 amount) public {
        (address upper, address lower) = hintPair(
            e, ITroveManager(e.troveManager).getTroveColl(address(this)) + amount, ITroveManager(e.troveManager).getTrovePrincipal(address(this))
        );
        IBorrowerOperations(e.borrowerOperations).addColl{value: amount}(upper, lower);
        (upper, lower) = hintPair(
            e, ITroveManager(e.troveManager).getTroveColl(address(this)), ITroveManager(e.troveManager).getTrovePrincipal(address(this))
        );
        IBorrowerOperations(e.borrowerOperations).refinance(upper, lower);
    }

    function hintPair(Env memory e, uint256 coll, uint256 debtForNicr) public view returns (address upper, address lower) {
        if (coll == 0 || debtForNicr == 0) return (address(0), address(0));
        uint256 nicr = coll * NICR_PRECISION / debtForNicr;
        address approx = address(0);
        try IHintHelpers(e.hintHelpers).getApproxHint(nicr, 12, uint256(uint160(address(this)))) returns (
            address hint, uint256, uint256
        ) {
            approx = hint;
        } catch {}
        (upper, lower) = ISortedTroves(e.sortedTroves).findInsertPosition(nicr, approx, approx);
    }

    function sweep(Env memory e) public {
        uint256 btcBeforeSend = address(this).balance;
        uint256 musdBefore = IERC20(e.musd).balanceOf(address(this));
        if (btcBeforeSend > 0) {
            (bool ok,) = e.owner.call{value: btcBeforeSend}("");
            if (!ok) revert TransferFailed();
        }
        if (_btcMirror(e)) {
            if (btcBeforeSend > 0 || musdBefore > 0) {
                uint256 mirroredMusd = IERC20(e.musd).balanceOf(address(this));
                if (mirroredMusd > 0 && !IERC20(e.musd).transfer(e.owner, mirroredMusd)) revert TransferFailed();
                emit Swept(e.owner, btcBeforeSend, musdBefore);
            }
            return;
        }
        uint256 erc = IERC20(e.btc).balanceOf(address(this));
        if (erc > 0 && address(this).balance == 0) {
            (bool ok,) = e.btc.call(abi.encodeWithSignature("withdraw(uint256)", erc));
            if (ok && address(this).balance > 0) {
                (bool ok2,) = e.owner.call{value: address(this).balance}("");
                if (!ok2) revert TransferFailed();
            } else {
                (bool ok3, bytes memory data) =
                    e.btc.call(abi.encodeWithSelector(IERC20.transfer.selector, e.owner, erc));
                if (!ok3 || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
            }
        }
        uint256 musdLeft = IERC20(e.musd).balanceOf(address(this));
        if (musdLeft > 0) {
            if (!IERC20(e.musd).transfer(e.owner, musdLeft)) revert TransferFailed();
        }
        if (btcBeforeSend > 0 || musdBefore > 0) emit Swept(e.owner, btcBeforeSend, musdBefore);
    }

    function minOpenAmount(Env memory e, uint256 rate) public view returns (uint256) {
        uint256 minNet = IBorrowerOperations(e.borrowerOperations).minNetDebt();
        return (minNet * WAD + (WAD + rate) - 1) / (WAD + rate);
    }

    function maxRepay(Env memory e, uint256 debt) public view returns (uint256) {
        if (debt <= GAS_COMPENSATION) return 0;
        uint256 net = debt - GAS_COMPENSATION;
        uint256 minNet = IBorrowerOperations(e.borrowerOperations).minNetDebt();
        if (net <= minNet) return 0;
        return net - minNet;
    }

    function _leverStep(Env memory e, uint256 targetCR, uint256 slip, uint256 pending, uint256 price, uint256 completedSwaps)
        private
        returns (uint256, bool)
    {
        uint256 coll = pending > 0 ? pending : ITroveManager(e.troveManager).getTroveColl(address(this));
        uint256 debt = pending > 0 ? 0 : ITroveManager(e.troveManager).getTroveDebt(address(this));
        if (debt != 0 && coll * price / debt <= targetCR) return (0, true);

        bool last = completedSwaps + 1 >= MAX_SWAPS_PER_TX;
        uint256 rate = IBorrowerOperations(e.borrowerOperations).borrowingRate();
        uint8 refiPct = IBorrowerOperations(e.borrowerOperations).refinancingFeePercentage();
        uint8 feePct = last ? 0 : refiPct;
        uint256 cap = debt == 0
            ? coll * price / (MCR + OPEN_HEADROOM)
            : ITroveManager(e.troveManager).getTroveMaxBorrowingCapacity(address(this));
        uint256 maxAmt = _amountFromCap(debt, cap, rate);
        uint256 amount = _borrowAmount(e, coll, debt, price, targetCR, maxAmt, slip, rate, feePct);
        if (amount == 0) {
            if (pending > 0) revert CannotOpen();
            return (0, true);
        }

        uint256 minBtc = _btcMinOut(e, amount, slip);
        if (minBtc == 0) revert Slippage();
        uint256 fee = amount * rate / WAD;

        if (debt == 0) {
            (address upper, address lower) = hintPair(e, pending, amount + fee + GAS_COMPENSATION);
            IBorrowerOperations(e.borrowerOperations).openTrove{value: pending}(amount, upper, lower);
            pending = 0;
        } else {
            uint256 newPrincipal = ITroveManager(e.troveManager).getTrovePrincipal(address(this)) + amount + fee;
            (address upper, address lower) = hintPair(e, coll, newPrincipal);
            IBorrowerOperations(e.borrowerOperations).withdrawMUSD(amount, upper, lower);
        }

        uint256 btcGot = _swapMusdToBtc(e, amount, minBtc);
        uint256 principal = ITroveManager(e.troveManager).getTrovePrincipal(address(this));
        (address upperAdd, address lowerAdd) =
            hintPair(e, ITroveManager(e.troveManager).getTroveColl(address(this)) + btcGot, principal);
        IBorrowerOperations(e.borrowerOperations).addColl{value: btcGot}(upperAdd, lowerAdd);

        uint256 crNow = ITroveManager(e.troveManager).getTroveColl(address(this)) * price
            / ITroveManager(e.troveManager).getTroveDebt(address(this));
        if (last || crNow <= targetCR + CR_BUFFER) return (0, true);

        (address upperRefi, address lowerRefi) = hintPair(
            e, ITroveManager(e.troveManager).getTroveColl(address(this)), ITroveManager(e.troveManager).getTrovePrincipal(address(this))
        );
        IBorrowerOperations(e.borrowerOperations).refinance(upperRefi, lowerRefi);
        return (0, false);
    }

    function _borrowAmount(
        Env memory e,
        uint256 coll,
        uint256 debt,
        uint256 price,
        uint256 targetCR,
        uint256 maxAmount,
        uint256 slip,
        uint256 rate,
        uint8 refiPct
    ) private view returns (uint256) {
        if (maxAmount == 0) return 0;
        uint256 minAmount = debt == 0 ? minOpenAmount(e, rate) : 1e16;
        if (minAmount > maxAmount) return 0;
        if (_projectedCR(e, coll, debt, minAmount, price, slip, rate, refiPct) < targetCR) return 0;
        if (_projectedCR(e, coll, debt, maxAmount, price, slip, rate, refiPct) >= targetCR) return maxAmount;

        uint256 lo = minAmount;
        uint256 hi = maxAmount;
        for (uint256 i; i < 18; ++i) {
            uint256 mid = (lo + hi + 1) / 2;
            if (_projectedCR(e, coll, debt, mid, price, slip, rate, refiPct) >= targetCR) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    function _projectedCR(
        Env memory e,
        uint256 coll,
        uint256 debt,
        uint256 amount,
        uint256 price,
        uint256 slip,
        uint256 rate,
        uint8 refiPct
    ) private view returns (uint256) {
        uint256 btcOut = _btcMinOut(e, amount, slip);
        uint256 newDebt = _projectedDebt(debt, amount, rate, true, refiPct);
        if (newDebt == 0) return type(uint256).max;
        return (coll + btcOut) * price / newDebt;
    }

    function _projectedDebt(uint256 debt, uint256 amount, uint256 rate, bool includeRefi, uint8 refiPct)
        private
        pure
        returns (uint256 newDebt)
    {
        uint256 fee = amount * rate / WAD;
        newDebt = (debt == 0 ? GAS_COMPENSATION : debt) + amount + fee;
        if (includeRefi && refiPct != 0 && newDebt > GAS_COMPENSATION) {
            uint256 refiBase = (newDebt - GAS_COMPENSATION) * refiPct / 100;
            newDebt += refiBase * rate / WAD;
        }
    }

    function _amountFromCap(uint256 debt, uint256 cap, uint256 rate) private pure returns (uint256) {
        uint256 base = debt == 0 ? GAS_COMPENSATION : debt;
        if (cap <= base) return 0;
        uint256 room = cap - base;
        if (debt != 0) room = room * 995 / 1000;
        return room * WAD / (WAD + rate);
    }

    function _maxWithdraw(uint256 coll, uint256 debt, uint256 price) private pure returns (uint256) {
        if (price == 0 || debt == 0) return 0;
        uint256 floor = MCR + 0.01e18;
        uint256 minColl = (debt * floor + price - 1) / price;
        if (coll <= minColl) return 0;
        return coll - minColl;
    }

    function _btcToReach(
        Env memory e,
        uint256 coll,
        uint256 debt,
        uint256 price,
        uint256 targetCR,
        uint256 maxBtc,
        uint256 slip
    ) private view returns (uint256) {
        uint256 musdAtMax = _musdMinOut(e, maxBtc, slip);
        uint256 cap = maxRepay(e, debt);
        if (cap != 0 && musdAtMax > cap) {
            uint256 shrunk = _btcInForMusd(e, cap, slip);
            if (shrunk != 0 && shrunk < maxBtc) maxBtc = shrunk;
        }
        if (maxBtc == 0) return 0;
        if (_crAfterSell(e, coll, debt, maxBtc, price, slip) < targetCR) return maxBtc;

        uint256 lo;
        uint256 hi = maxBtc;
        for (uint256 i; i < 18; ++i) {
            uint256 mid = (lo + hi) / 2;
            if (mid == 0 || _crAfterSell(e, coll, debt, mid, price, slip) < targetCR) lo = mid + 1;
            else hi = mid;
        }
        return hi;
    }

    function _crAfterSell(Env memory e, uint256 coll, uint256 debt, uint256 btcAmt, uint256 price, uint256 slip)
        private
        view
        returns (uint256)
    {
        if (btcAmt >= coll) return 0;
        uint256 musdOut = _musdMinOut(e, btcAmt, slip);
        if (musdOut >= debt) return type(uint256).max;
        return (coll - btcAmt) * price / (debt - musdOut);
    }

    function _crAfterCappedRepay(
        Env memory e,
        uint256 coll,
        uint256 debt,
        uint256 btcAmt,
        uint256 price,
        uint256 slip,
        uint256 room
    ) private view returns (uint256) {
        if (btcAmt == 0 || btcAmt >= coll || room == 0) return 0;
        uint256 musdOut = _musdMinOut(e, btcAmt, slip);
        uint256 repaid = musdOut > room ? room : musdOut;
        if (repaid == 0) return 0;
        if (repaid >= debt) return type(uint256).max;
        return (coll - btcAmt) * price / (debt - repaid);
    }

    function _btcInForMusd(Env memory e, uint256 musdOut, uint256 slip) private view returns (uint256) {
        if (musdOut == 0) return 0;
        uint256 lo;
        uint256 hi = 1e16;
        for (uint256 i; i < 12; ++i) {
            if (_musdMinOut(e, hi, slip) >= musdOut) break;
            hi *= 2;
        }
        if (_musdMinOut(e, hi, slip) < musdOut) return 0;
        for (uint256 i; i < 22; ++i) {
            uint256 mid = (lo + hi) / 2;
            if (_musdMinOut(e, mid, slip) >= musdOut) hi = mid;
            else lo = mid + 1;
        }
        return hi;
    }

    function _withdrawAndSwap(Env memory e, uint256 btcAmount, uint256 slippageBps) private returns (uint256 musdGot) {
        uint256 minMusd = _musdMinOut(e, btcAmount, slippageBps);
        if (minMusd == 0) revert Slippage();
        (address upper, address lower) = hintPair(
            e,
            ITroveManager(e.troveManager).getTroveColl(address(this)) - btcAmount,
            ITroveManager(e.troveManager).getTrovePrincipal(address(this))
        );
        IBorrowerOperations(e.borrowerOperations).withdrawColl(btcAmount, upper, lower);
        musdGot = _swapBtcToMusd(e, btcAmount, minMusd);
    }

    function _sellAndRepay(Env memory e, uint256 btcAmount, uint256 repayCap, uint256 slippageBps)
        private
        returns (uint256 repaid)
    {
        uint256 got = _withdrawAndSwap(e, btcAmount, slippageBps);
        uint256 debt = ITroveManager(e.troveManager).getTroveDebt(address(this));
        uint256 cap = maxRepay(e, debt);
        if (repayCap < cap) cap = repayCap;
        repaid = got > cap ? cap : got;
        if (repaid == 0) return 0;
        uint256 principal = ITroveManager(e.troveManager).getTrovePrincipal(address(this));
        uint256 hinted = principal > repaid ? principal - repaid : principal;
        (address upper, address lower) = hintPair(e, ITroveManager(e.troveManager).getTroveColl(address(this)), hinted);
        IBorrowerOperations(e.borrowerOperations).repayMUSD(repaid, upper, lower);
    }

    function _swapMusdToBtc(Env memory e, uint256 amount, uint256 minOut) private returns (uint256 got) {
        uint256 nativeBefore = address(this).balance;
        _approve(e.musd, e.router, amount);
        IRouter.Route[] memory routes = _route(e, e.musd, e.btc);
        bytes memory payload = abi.encodeCall(
            IRouter.swapExactTokensForTokens, (amount, minOut, routes, address(this), block.timestamp)
        );
        (bool swapOk, bytes memory swapData) = e.router.call(payload);
        if (!swapOk) {
            assembly {
                revert(add(swapData, 32), mload(swapData))
            }
        }

        uint256 nativeGain = address(this).balance - nativeBefore;
        if (nativeGain >= minOut) return nativeGain;

        uint256 ercGain = IERC20(e.btc).balanceOf(address(this));
        if (ercGain < minOut) revert Slippage();
        (bool ok,) = e.btc.call(abi.encodeWithSignature("withdraw(uint256)", ercGain));
        if (!ok) revert Slippage();
        got = address(this).balance - nativeBefore;
        if (got < minOut) revert Slippage();
    }

    function _swapBtcToMusd(Env memory e, uint256 amount, uint256 minOut) private returns (uint256 got) {
        if (_btcMirror(e)) {
            if (address(this).balance < amount) revert Slippage();
        } else {
            uint256 native = address(this).balance;
            if (native < amount) {
                uint256 erc = IERC20(e.btc).balanceOf(address(this));
                if (erc < amount) {
                    uint256 short = amount - erc;
                    if (native < short) revert Slippage();
                    (bool ok,) = e.btc.call{value: short}(abi.encodeWithSignature("deposit()"));
                    if (!ok) revert Slippage();
                }
            } else {
                uint256 erc = IERC20(e.btc).balanceOf(address(this));
                if (erc < amount) {
                    (bool ok,) = e.btc.call{value: amount}(abi.encodeWithSignature("deposit()"));
                    if (!ok) revert Slippage();
                }
            }
        }
        _approve(e.btc, e.router, amount);
        uint256 beforeBal = IERC20(e.musd).balanceOf(address(this));
        IRouter(e.router).swapExactTokensForTokens(amount, minOut, _route(e, e.btc, e.musd), address(this), block.timestamp);
        got = IERC20(e.musd).balanceOf(address(this)) - beforeBal;
        if (got < minOut) revert Slippage();
    }

    function _btcMinOut(Env memory e, uint256 musdAmount, uint256 slip) private view returns (uint256) {
        if (musdAmount == 0) return 0;
        uint256 quoted = _quotedOut(e, musdAmount, e.musd, e.btc);
        return quoted * (BPS - slip) / BPS;
    }

    function _musdMinOut(Env memory e, uint256 btcAmount, uint256 slip) private view returns (uint256) {
        if (btcAmount == 0) return 0;
        uint256 quoted = _quotedOut(e, btcAmount, e.btc, e.musd);
        return quoted * (BPS - slip) / BPS;
    }

    function _quotedOut(Env memory e, uint256 amountIn, address from, address to) private view returns (uint256) {
        uint256[] memory amounts = IRouter(e.router).getAmountsOut(amountIn, _route(e, from, to));
        return amounts[amounts.length - 1];
    }

    function _route(Env memory e, address from, address to) private pure returns (IRouter.Route[] memory routes) {
        routes = new IRouter.Route[](1);
        routes[0] = IRouter.Route({from: from, to: to, stable: false, factory: e.poolFactory});
    }

    function _approve(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _btcMirror(Env memory e) private view returns (bool) {
        return e.btc.codehash == BTC_MIRROR_CODEHASH;
    }

    function _active(Env memory e) private view returns (bool) {
        return ITroveManager(e.troveManager).getTroveStatus(address(this)) == ITroveManager.Status.active;
    }

    function _cr(Env memory e, uint256 price) private view returns (uint256) {
        return ITroveManager(e.troveManager).getCurrentICR(address(this), price);
    }

    function _saleCap(Env memory e) private view returns (uint256) {
        return _btcMirror(e) ? 1 : MAX_ITERS;
    }
}
