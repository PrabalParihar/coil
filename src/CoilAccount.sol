// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBorrowerOperations, ITroveManager, ISortedTroves, IHintHelpers, IPriceFeed, IRouter, IERC20} from "./interfaces/Mezo.sol";
import {ICoilFactory} from "./ICoilFactory.sol";

/// @title CoilAccount
/// @notice One clone per user. The clone is the MUSD trove owner, so a single
///         transaction can borrow, swap MUSD to BTC on Mezo Pools, and add that
///         BTC back as collateral until a target collateral ratio.
/// @dev On Mezo, BTC at 0x7b7c…0000 reports the native balance. The router only
///      moves that ERC-20, and BorrowerOperations only accepts msg.value, so
///      those are the same coins. Fork tests replace the precompile with a
///      WETH-style token; the wrap/unwrap branch below exists for that case.
///      A Mezo transaction may call native precompiles at most 20 times.
///      PriceFeed.fetchPrice is two of those calls, and each MUSD to BTC swap
///      is three more (the pool transfers BTC, then reads its balance twice).
///      Two borrow-and-swap rounds, with the oracle read once here and again
///      inside each BorrowerOperations call, fill that budget. A third swap
///      reverts inside the pool. Loop therefore stops after two rounds.
///      Landing above the target is the intended result.
contract CoilAccount {
    uint256 public constant WAD = 1e18;
    uint256 public constant MCR = 1.1e18;
    uint256 public constant MIN_TARGET_CR = 1.15e18;
    uint256 public constant GAS_COMPENSATION = 200e18;
    uint256 public constant NICR_PRECISION = 1e20;
    uint256 public constant BPS = 10_000;
    uint256 public constant MAX_ITERS = 6;
    /// @dev Borrow-and-swap rounds that fit in one Mezo transaction. See the contract natspec.
    uint256 internal constant MAX_SWAPS_PER_TX = 2;
    /// @dev Extra CR we try to keep so the refinance fee cannot cross under the target.
    uint256 public constant CR_BUFFER = 0.003e18;
    /// @dev Open the first trove slightly above the 110% line. Capacity is based on
    ///      the collateral present at openTrove, before the swapped BTC is added.
    uint256 internal constant OPEN_HEADROOM = 0.005e18;
    uint32 public constant MAX_RANK_WALK = 32;

    IBorrowerOperations public immutable borrowerOperations;
    ITroveManager public immutable troveManager;
    ISortedTroves public immutable sortedTroves;
    IHintHelpers public immutable hintHelpers;
    IPriceFeed public immutable priceFeed;
    IERC20 public immutable musd;
    address public immutable btc;
    IRouter public immutable router;
    address public immutable poolFactory;

    address public owner;
    address public factory;
    address public keeper;
    uint16 public slippageBps;
    uint256 public floorCR;
    uint256 public guardTargetCR;
    uint32 public redemptionZone;

    bool private initialized;
    uint256 private locked;

    struct LoopQuote {
        uint256 collateral;
        uint256 debt;
        uint256 cr;
        uint256 liquidationPrice;
        uint256 musdMinted;
        uint256 iterations;
    }

    struct Position {
        bool active;
        uint256 collateral;
        uint256 debt;
        uint256 cr;
        uint256 liquidationPrice;
        uint256 redemptionRank;
        uint256 floorCR;
        uint256 guardTargetCR;
        uint32 redemptionZone;
        uint16 slippageBps;
        address owner;
    }

    event Looped(address indexed owner, uint256 targetCR, uint256 collateral, uint256 debt, uint256 cr);
    event Unwound(address indexed owner, uint256 fractionWad, uint256 cr);
    event Delevered(address indexed owner, uint256 targetCR, uint256 cr, uint256 debt);
    event GuardSet(uint256 floorCR, uint256 guardTargetCR, uint32 redemptionZone);
    event GuardTriggered(address indexed caller, uint256 crBefore, uint256 crAfter);
    event KeeperSet(address indexed keeper);
    event Swept(address indexed to, uint256 btcAmount, uint256 musdAmount);

    error NotOwner();
    error NotKeeper();
    error AlreadyInitialized();
    error BadCR();
    error BadSlippage();
    error BadFraction();
    error ZeroAmount();
    error NoTrove();
    error AlreadyAtTarget();
    error CannotOpen();
    error BelowTarget();
    error RecoveryMode();
    error Slippage();
    error Iterations();
    error MinDebt();
    error ShortRepay();
    error KeeperLimited();
    error NoGuard();
    error NotSafer();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (locked != 0) revert TransferFailed();
        locked = 1;
        _;
        locked = 0;
    }

    constructor(
        address _borrowerOperations,
        address _troveManager,
        address _sortedTroves,
        address _hintHelpers,
        address _priceFeed,
        address _musd,
        address _btc,
        address _router,
        address _poolFactory
    ) {
        borrowerOperations = IBorrowerOperations(_borrowerOperations);
        troveManager = ITroveManager(_troveManager);
        sortedTroves = ISortedTroves(_sortedTroves);
        hintHelpers = IHintHelpers(_hintHelpers);
        priceFeed = IPriceFeed(_priceFeed);
        musd = IERC20(_musd);
        btc = _btc;
        router = IRouter(_router);
        poolFactory = _poolFactory;
        initialized = true;
        owner = address(1);
    }

    function initialize(address _owner) external {
        if (initialized) revert AlreadyInitialized();
        if (_owner == address(0)) revert ZeroAmount();
        initialized = true;
        owner = _owner;
        factory = msg.sender;
        slippageBps = 50;
    }

    receive() external payable {}

    // ---------------------------------------------------------------------
    // Owner actions
    // ---------------------------------------------------------------------

    /// @notice Lever BTC up to `targetCR` (1e18 = 100%). Sends `msg.value` in as collateral.
    ///         A fresh trove is opened on this clone. An existing trove is topped up, then
    ///         borrowed against until the ratio would cross under the target.
    function loop(uint256 targetCR, uint256 maxSlippageBps) external payable onlyOwner nonReentrant {
        if (maxSlippageBps == 0 || maxSlippageBps > 300) revert BadSlippage();
        if (targetCR < MIN_TARGET_CR || targetCR > 10e18) revert BadCR();
        slippageBps = uint16(maxSlippageBps);

        uint256 price = priceFeed.fetchPrice();
        if (troveManager.checkRecoveryMode(price)) revert RecoveryMode();

        bool exists = _active();
        if (!exists && msg.value == 0) revert ZeroAmount();
        if (exists && msg.value == 0 && _cr(price) <= targetCR) revert AlreadyAtTarget();
        if (exists && msg.value > 0) _addColl(msg.value);

        uint256 pending = exists ? 0 : msg.value;
        uint256 swaps;
        for (uint256 i; i < MAX_ITERS && swaps < MAX_SWAPS_PER_TX; ++i) {
            bool stop;
            (pending, stop) = _leverStep(targetCR, maxSlippageBps, pending, price, swaps);
            if (stop) break;
            unchecked {
                ++swaps;
            }
        }
        if (pending != 0) revert CannotOpen();
        if (!_active()) revert CannotOpen();

        uint256 endCr = _cr(price);
        if (endCr < targetCR) revert BelowTarget();
        emit Looped(
            owner, targetCR, troveManager.getTroveColl(address(this)), troveManager.getTroveDebt(address(this)), endCr
        );
    }

    /// @param fractionWad Share of net debt to repay, 1e18 = close the trove and return BTC.
    function unwind(uint256 fractionWad) external onlyOwner nonReentrant {
        if (fractionWad == 0 || fractionWad > WAD) revert BadFraction();
        if (!_active()) revert NoTrove();
        if (fractionWad == WAD) {
            _unwindAll(priceFeed.fetchPrice());
            emit Unwound(owner, fractionWad, type(uint256).max);
            return;
        }

        uint256 debt = troveManager.getTroveDebt(address(this));
        uint256 net = debt - GAS_COMPENSATION;
        uint256 toRepay = net * fractionWad / WAD;
        if (net - toRepay < borrowerOperations.minNetDebt()) revert MinDebt();

        uint256 price = priceFeed.fetchPrice();
        uint256 repaid;
        for (uint256 i; i < MAX_ITERS && repaid < toRepay; ++i) {
            uint256 short = toRepay - repaid;
            uint256 coll = troveManager.getTroveColl(address(this));
            debt = troveManager.getTroveDebt(address(this));
            uint256 maxW = _maxWithdraw(coll, debt, price);
            if (maxW == 0) break;
            uint256 sell = _btcInForMusd(short, slippageBps);
            if (sell == 0 || sell > maxW) sell = maxW;
            uint256 got = _sellAndRepay(sell, short);
            if (got == 0) break;
            repaid += got;
        }
        if (repaid < toRepay && (toRepay - repaid) * 100 > toRepay) revert ShortRepay();
        _sweep();
        emit Unwound(owner, fractionWad, _active() ? _cr(price) : type(uint256).max);
    }

    /// @notice Raise the collateral ratio to `targetCR` by selling collateral for MUSD and repaying.
    ///         The owner can aim anywhere above the current ratio. A keeper can only aim up to the
    ///         guard target the owner configured, and cannot pull funds to itself.
    function deleverTo(uint256 targetCR) external nonReentrant {
        if (!_active()) revert NoTrove();
        if (targetCR < MIN_TARGET_CR || targetCR > 50e18) revert BadCR();
        if (msg.sender != owner) {
            if (!_isKeeper(msg.sender)) revert NotKeeper();
            if (guardTargetCR == 0) revert NoGuard();
            if (targetCR > guardTargetCR) revert KeeperLimited();
        }

        uint256 price = priceFeed.fetchPrice();
        uint256 beforeCr = _cr(price);
        if (beforeCr >= targetCR) revert AlreadyAtTarget();
        _deleverTo(targetCR, price);
        uint256 afterCr = _cr(price);
        if (afterCr <= beforeCr) revert NotSafer();
        _sweep();
        emit Delevered(owner, targetCR, afterCr, troveManager.getTroveDebt(address(this)));
    }

    /// @notice Keeper or owner entrypoint. De-levers to the guard target when the ratio is under
    ///         the floor, or when this trove sits within `redemptionZone` of the lowest-CR end
    ///         of SortedTroves (the first troves redemption hits).
    function guard() external nonReentrant returns (bool acted) {
        if (msg.sender != owner && !_isKeeper(msg.sender)) revert NotKeeper();
        if (guardTargetCR == 0 || !_active()) return false;

        uint256 price = priceFeed.fetchPrice();
        uint256 cr = _cr(price);
        bool crRisk = floorCR != 0 && cr < floorCR;
        uint256 rank = redemptionRank();
        bool redemptionRisk = redemptionZone != 0 && rank <= redemptionZone;
        if (!crRisk && !redemptionRisk) return false;
        if (cr >= guardTargetCR) return false;

        _deleverTo(guardTargetCR, price);
        uint256 afterCr = _cr(price);
        if (afterCr <= cr) revert NotSafer();
        _sweep();
        emit GuardTriggered(msg.sender, cr, afterCr);
        emit Delevered(owner, guardTargetCR, afterCr, _active() ? troveManager.getTroveDebt(address(this)) : 0);
        return true;
    }

    function setGuard(uint256 floor, uint256 target, uint32 zone) external onlyOwner {
        if (floor == 0 && target == 0 && zone == 0) {
            floorCR = 0;
            guardTargetCR = 0;
            redemptionZone = 0;
            emit GuardSet(0, 0, 0);
            return;
        }
        if (floor < MIN_TARGET_CR || target < floor || zone > MAX_RANK_WALK) revert BadCR();
        floorCR = floor;
        guardTargetCR = target;
        redemptionZone = zone;
        emit GuardSet(floor, target, zone);
    }

    function setKeeper(address next) external onlyOwner {
        keeper = next;
        emit KeeperSet(next);
    }

    function setSlippage(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > 300) revert BadSlippage();
        slippageBps = bps;
    }

    function sweep() external onlyOwner nonReentrant {
        _sweep();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function position() external view returns (Position memory p) {
        p.owner = owner;
        p.floorCR = floorCR;
        p.guardTargetCR = guardTargetCR;
        p.redemptionZone = redemptionZone;
        p.slippageBps = slippageBps;
        p.active = _active();
        if (!p.active) return p;
        uint256 price = priceFeed.fetchPrice();
        p.collateral = troveManager.getTroveColl(address(this));
        p.debt = troveManager.getTroveDebt(address(this));
        p.cr = p.debt == 0 ? 0 : troveManager.getCurrentICR(address(this), price);
        p.liquidationPrice = p.collateral == 0 ? 0 : MCR * p.debt / p.collateral;
        p.redemptionRank = redemptionRank();
    }

    /// @notice Dry-run of `loop` for `collateralIn` of BTC and no existing trove.
    ///         Uses router quotes at `slippageBps` worse than the current pool, so the
    ///         executed ratio should land at or above `quote.cr`.
    function quoteLoop(uint256 collateralIn, uint256 targetCR, uint256 slippageBps_)
        external
        view
        returns (LoopQuote memory q)
    {
        if (collateralIn == 0) revert ZeroAmount();
        if (targetCR < MIN_TARGET_CR || targetCR > 10e18) revert BadCR();
        if (slippageBps_ == 0 || slippageBps_ > 300) revert BadSlippage();

        uint256 price = priceFeed.fetchPrice();
        uint256 rate = borrowerOperations.borrowingRate();
        uint8 refiPct = borrowerOperations.refinancingFeePercentage();
        uint256 coll = collateralIn;
        uint256 debt;

        for (uint256 i; i < MAX_SWAPS_PER_TX; ++i) {
            if (debt != 0 && coll * price / debt <= targetCR) break;
            bool last = i + 1 == MAX_SWAPS_PER_TX;
            uint8 feePct = last ? 0 : refiPct;
            uint256 cap = debt == 0 ? coll * price / (MCR + OPEN_HEADROOM) : coll * price / MCR;
            uint256 maxAmt = _amountFromCap(debt, cap, rate);
            uint256 amount = _borrowAmount(coll, debt, price, targetCR, maxAmt, slippageBps_, rate, feePct);
            if (amount == 0) break;
            uint256 btcOut = _btcMinOut(amount, slippageBps_);
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

    /// @notice 1 = lowest collateral ratio, the first trove a redemption walks.
    ///         Returns type(uint256).max when the trove is outside the walked window.
    function redemptionRank() public view returns (uint256) {
        if (!_active()) return 0;
        address cur = sortedTroves.getLast();
        for (uint256 rank = 1; rank <= MAX_RANK_WALK; ++rank) {
            if (cur == address(this)) return rank;
            cur = sortedTroves.getPrev(cur);
            if (cur == address(0)) return type(uint256).max;
        }
        return type(uint256).max;
    }

    // ---------------------------------------------------------------------
    // Leverage step
    // ---------------------------------------------------------------------

    function _leverStep(uint256 targetCR, uint256 slip, uint256 pending, uint256 price, uint256 completedSwaps)
        internal
        returns (uint256, bool)
    {
        uint256 coll = pending > 0 ? pending : troveManager.getTroveColl(address(this));
        uint256 debt = pending > 0 ? 0 : troveManager.getTroveDebt(address(this));
        if (debt != 0 && coll * price / debt <= targetCR) return (0, true);

        // The last round in this transaction is not refinanced, so the sizing
        // must not reserve a refinance fee it will never pay.
        bool last = completedSwaps + 1 >= MAX_SWAPS_PER_TX;
        uint256 rate = borrowerOperations.borrowingRate();
        uint8 refiPct = borrowerOperations.refinancingFeePercentage();
        uint8 feePct = last ? 0 : refiPct;
        uint256 cap = debt == 0 ? coll * price / (MCR + OPEN_HEADROOM) : troveManager.getTroveMaxBorrowingCapacity(address(this));
        uint256 maxAmt = _amountFromCap(debt, cap, rate);
        uint256 amount = _borrowAmount(coll, debt, price, targetCR, maxAmt, slip, rate, feePct);
        if (amount == 0) {
            if (pending > 0) revert CannotOpen();
            return (0, true);
        }

        uint256 minBtc = _btcMinOut(amount, slip);
        if (minBtc == 0) revert Slippage();
        uint256 fee = amount * rate / WAD;

        if (debt == 0) {
            (address upper, address lower) = _hintPair(pending, amount + fee + GAS_COMPENSATION);
            borrowerOperations.openTrove{value: pending}(amount, upper, lower);
            pending = 0;
        } else {
            uint256 newPrincipal = troveManager.getTrovePrincipal(address(this)) + amount + fee;
            (address upper, address lower) = _hintPair(coll, newPrincipal);
            borrowerOperations.withdrawMUSD(amount, upper, lower);
        }

        uint256 btcGot = _swapMusdToBtc(amount, minBtc);
        uint256 principal = troveManager.getTrovePrincipal(address(this));
        (address upperAdd, address lowerAdd) = _hintPair(troveManager.getTroveColl(address(this)) + btcGot, principal);
        borrowerOperations.addColl{value: btcGot}(upperAdd, lowerAdd);

        uint256 crNow = troveManager.getTroveColl(address(this)) * price / troveManager.getTroveDebt(address(this));
        // Stop while the ratio is still above the target. Another swap would be
        // the third BTC transfer in this transaction, which Mezo rejects.
        if (last || crNow <= targetCR + CR_BUFFER) return (0, true);

        (address upperRefi, address lowerRefi) = _hintPair(
            troveManager.getTroveColl(address(this)), troveManager.getTrovePrincipal(address(this))
        );
        borrowerOperations.refinance(upperRefi, lowerRefi);
        return (0, false);
    }

    function _addColl(uint256 amount) internal {
        (address upper, address lower) = _hintPair(troveManager.getTroveColl(address(this)) + amount, troveManager.getTrovePrincipal(address(this)));
        borrowerOperations.addColl{value: amount}(upper, lower);
        (upper, lower) = _hintPair(troveManager.getTroveColl(address(this)), troveManager.getTrovePrincipal(address(this)));
        borrowerOperations.refinance(upper, lower);
    }

    function _deleverTo(uint256 targetCR, uint256 price) internal {
        for (uint256 i; i < MAX_ITERS; ++i) {
            uint256 coll = troveManager.getTroveColl(address(this));
            uint256 debt = troveManager.getTroveDebt(address(this));
            if (debt <= GAS_COMPENSATION) return;
            if (coll * price / debt >= targetCR) return;

            uint256 maxW = _maxWithdraw(coll, debt, price);
            if (maxW == 0) revert MinDebt();
            uint256 sell = _btcToReach(coll, debt, price, targetCR, maxW, slippageBps);
            if (sell == 0) revert MinDebt();
            // Repay the whole swap. Capping at the constant-collateral gap would
            // sell BTC and leave the MUSD unspent, which drops the ratio.
            _sellAndRepay(sell, type(uint256).max);
        }
        if (_cr(price) < targetCR) revert Iterations();
    }

    function _unwindAll(uint256 price) internal {
        for (uint256 i; i < MAX_ITERS + 2; ++i) {
            uint256 debt = troveManager.getTroveDebt(address(this));
            uint256 need = debt - GAS_COMPENSATION;
            uint256 have = musd.balanceOf(address(this));
            if (have >= need) {
                borrowerOperations.closeTrove();
                _sweep();
                return;
            }

            uint256 coll = troveManager.getTroveColl(address(this));
            uint256 maxW = _maxWithdraw(coll, debt, price);
            if (maxW == 0) revert MinDebt();

            uint256 short = need - have;
            uint256 btcForShort = _btcInForMusd(short, slippageBps);
            if (btcForShort != 0 && btcForShort <= maxW) {
                _withdrawAndSwap(btcForShort);
                continue;
            }

            uint256 maxRepay = _maxRepay(debt);
            if (maxRepay == 0) revert MinDebt();
            uint256 btcForRepay = _btcInForMusd(maxRepay, slippageBps);
            if (btcForRepay == 0 || btcForRepay > maxW) btcForRepay = maxW;
            _sellAndRepay(btcForRepay, maxRepay);
        }
        revert Iterations();
    }

    function _withdrawAndSwap(uint256 btcAmount) internal returns (uint256 musdGot) {
        uint256 minMusd = _musdMinOut(btcAmount, slippageBps);
        if (minMusd == 0) revert Slippage();
        (address upper, address lower) = _hintPair(
            troveManager.getTroveColl(address(this)) - btcAmount, troveManager.getTrovePrincipal(address(this))
        );
        borrowerOperations.withdrawColl(btcAmount, upper, lower);
        musdGot = _swapBtcToMusd(btcAmount, minMusd);
    }

    function _sellAndRepay(uint256 btcAmount, uint256 repayCap) internal returns (uint256 repaid) {
        uint256 got = _withdrawAndSwap(btcAmount);
        uint256 debt = troveManager.getTroveDebt(address(this));
        uint256 cap = _maxRepay(debt);
        if (repayCap < cap) cap = repayCap;
        repaid = got > cap ? cap : got;
        if (repaid == 0) return 0;
        uint256 principal = troveManager.getTrovePrincipal(address(this));
        uint256 hinted = principal > repaid ? principal - repaid : principal;
        (address upper, address lower) = _hintPair(troveManager.getTroveColl(address(this)), hinted);
        borrowerOperations.repayMUSD(repaid, upper, lower);
    }

    // ---------------------------------------------------------------------
    // Sizing
    // ---------------------------------------------------------------------

    function _borrowAmount(
        uint256 coll,
        uint256 debt,
        uint256 price,
        uint256 targetCR,
        uint256 maxAmount,
        uint256 slip,
        uint256 rate,
        uint8 refiPct
    ) internal view returns (uint256) {
        if (maxAmount == 0) return 0;
        uint256 minAmount = debt == 0 ? _minOpenAmount(rate) : 1e16;
        if (minAmount > maxAmount) return 0;
        if (_projectedCR(coll, debt, minAmount, price, slip, rate, refiPct) < targetCR) return 0;
        if (_projectedCR(coll, debt, maxAmount, price, slip, rate, refiPct) >= targetCR) return maxAmount;

        uint256 lo = minAmount;
        uint256 hi = maxAmount;
        for (uint256 i; i < 18; ++i) {
            uint256 mid = (lo + hi + 1) / 2;
            if (_projectedCR(coll, debt, mid, price, slip, rate, refiPct) >= targetCR) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    function _projectedCR(
        uint256 coll,
        uint256 debt,
        uint256 amount,
        uint256 price,
        uint256 slip,
        uint256 rate,
        uint8 refiPct
    ) internal view returns (uint256) {
        uint256 btcOut = _btcMinOut(amount, slip);
        uint256 newDebt = _projectedDebt(debt, amount, rate, true, refiPct);
        if (newDebt == 0) return type(uint256).max;
        return (coll + btcOut) * price / newDebt;
    }

    function _projectedDebt(uint256 debt, uint256 amount, uint256 rate, bool includeRefi, uint8 refiPct)
        internal
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

    function _amountFromCap(uint256 debt, uint256 cap, uint256 rate) internal pure returns (uint256) {
        uint256 base = debt == 0 ? GAS_COMPENSATION : debt;
        if (cap <= base) return 0;
        uint256 room = cap - base;
        if (debt != 0) room = room * 995 / 1000;
        return room * WAD / (WAD + rate);
    }

    function _minOpenAmount(uint256 rate) internal view returns (uint256) {
        uint256 minNet = borrowerOperations.minNetDebt();
        return (minNet * WAD + (WAD + rate) - 1) / (WAD + rate);
    }

    function _maxWithdraw(uint256 coll, uint256 debt, uint256 price) internal pure returns (uint256) {
        if (price == 0 || debt == 0) return 0;
        uint256 floor = MCR + 0.01e18;
        uint256 minColl = (debt * floor + price - 1) / price;
        if (coll <= minColl) return 0;
        return coll - minColl;
    }

    function _maxRepay(uint256 debt) internal view returns (uint256) {
        if (debt <= GAS_COMPENSATION) return 0;
        uint256 net = debt - GAS_COMPENSATION;
        uint256 minNet = borrowerOperations.minNetDebt();
        if (net <= minNet) return 0;
        return net - minNet;
    }

    function _btcToReach(uint256 coll, uint256 debt, uint256 price, uint256 targetCR, uint256 maxBtc, uint256 slip)
        internal
        view
        returns (uint256)
    {
        uint256 musdAtMax = _musdMinOut(maxBtc, slip);
        uint256 cap = _maxRepay(debt);
        if (cap != 0 && musdAtMax > cap) {
            uint256 shrunk = _btcInForMusd(cap, slip);
            if (shrunk != 0 && shrunk < maxBtc) maxBtc = shrunk;
        }
        if (maxBtc == 0) return 0;
        if (_crAfterSell(coll, debt, maxBtc, price, slip) < targetCR) return maxBtc;

        uint256 lo;
        uint256 hi = maxBtc;
        for (uint256 i; i < 18; ++i) {
            uint256 mid = (lo + hi) / 2;
            if (mid == 0 || _crAfterSell(coll, debt, mid, price, slip) < targetCR) lo = mid + 1;
            else hi = mid;
        }
        return hi;
    }

    function _crAfterSell(uint256 coll, uint256 debt, uint256 btcAmt, uint256 price, uint256 slip)
        internal
        view
        returns (uint256)
    {
        if (btcAmt >= coll) return 0;
        uint256 musdOut = _musdMinOut(btcAmt, slip);
        if (musdOut >= debt) return type(uint256).max;
        return (coll - btcAmt) * price / (debt - musdOut);
    }

    function _btcInForMusd(uint256 musdOut, uint256 slip) internal view returns (uint256) {
        if (musdOut == 0) return 0;
        uint256 lo;
        uint256 hi = 1e16;
        for (uint256 i; i < 12; ++i) {
            if (_musdMinOut(hi, slip) >= musdOut) break;
            hi *= 2;
        }
        if (_musdMinOut(hi, slip) < musdOut) return 0;
        for (uint256 i; i < 22; ++i) {
            uint256 mid = (lo + hi) / 2;
            if (_musdMinOut(mid, slip) >= musdOut) hi = mid;
            else lo = mid + 1;
        }
        return hi;
    }

    // ---------------------------------------------------------------------
    // Swaps
    // ---------------------------------------------------------------------

    function _swapMusdToBtc(uint256 amount, uint256 minOut) internal returns (uint256 got) {
        uint256 nativeBefore = address(this).balance;
        _approve(address(musd), address(router), amount);
        IRouter.Route[] memory routes = _route(address(musd), btc);
        bytes memory payload = abi.encodeCall(
            IRouter.swapExactTokensForTokens, (amount, minOut, routes, address(this), block.timestamp)
        );
        (bool swapOk, bytes memory swapData) = address(router).call(payload);
        if (!swapOk) {
            assembly {
                revert(add(swapData, 32), mload(swapData))
            }
        }

        uint256 nativeGain = address(this).balance - nativeBefore;
        // Live Mezo credits native BTC, so this returns before any balanceOf.
        // The fork mock only credits its ERC-20; unwrap that below.
        if (nativeGain >= minOut) return nativeGain;

        uint256 ercGain = IERC20(btc).balanceOf(address(this));
        if (ercGain < minOut) revert Slippage();
        (bool ok,) = btc.call(abi.encodeWithSignature("withdraw(uint256)", ercGain));
        if (!ok) revert Slippage();
        got = address(this).balance - nativeBefore;
        if (got < minOut) revert Slippage();
    }

    function _swapBtcToMusd(uint256 amount, uint256 minOut) internal returns (uint256 got) {
        // On the live mirror, native balance and balanceOf are the same number,
        // and balanceOf spends one of the 20 precompile calls. Skip it.
        if (_btcMirror()) {
            if (address(this).balance < amount) revert Slippage();
        } else {
            uint256 native = address(this).balance;
            if (native < amount) {
                uint256 erc = IERC20(btc).balanceOf(address(this));
                if (erc < amount) {
                    uint256 short = amount - erc;
                    if (native < short) revert Slippage();
                    (bool ok,) = btc.call{value: short}(abi.encodeWithSignature("deposit()"));
                    if (!ok) revert Slippage();
                }
            } else {
                uint256 erc = IERC20(btc).balanceOf(address(this));
                if (erc < amount) {
                    (bool ok,) = btc.call{value: amount}(abi.encodeWithSignature("deposit()"));
                    if (!ok) revert Slippage();
                }
            }
        }
        _approve(btc, address(router), amount);
        uint256 beforeBal = musd.balanceOf(address(this));
        router.swapExactTokensForTokens(amount, minOut, _route(btc, address(musd)), address(this), block.timestamp);
        got = musd.balanceOf(address(this)) - beforeBal;
        if (got < minOut) revert Slippage();
    }

    function _btcMinOut(uint256 musdAmount, uint256 slip) internal view returns (uint256) {
        if (musdAmount == 0) return 0;
        uint256 quoted = _quotedOut(musdAmount, address(musd), btc);
        return quoted * (BPS - slip) / BPS;
    }

    function _musdMinOut(uint256 btcAmount, uint256 slip) internal view returns (uint256) {
        if (btcAmount == 0) return 0;
        uint256 quoted = _quotedOut(btcAmount, btc, address(musd));
        return quoted * (BPS - slip) / BPS;
    }

    function _quotedOut(uint256 amountIn, address from, address to) internal view returns (uint256) {
        uint256[] memory amounts = router.getAmountsOut(amountIn, _route(from, to));
        return amounts[amounts.length - 1];
    }

    function _route(address from, address to) internal view returns (IRouter.Route[] memory routes) {
        routes = new IRouter.Route[](1);
        routes[0] = IRouter.Route({from: from, to: to, stable: false, factory: poolFactory});
    }

    /// @dev Codehash of the live BTC precompile bytecode. EXTCODEHASH does not
    ///      spend a precompile call. The fork test etches a different mock at
    ///      the same address, so this distinguishes them.
    bytes32 internal constant BTC_MIRROR_CODEHASH =
        0x646ced85f3dad5f3a9fa7a920d158620ac616278d1b32b45867d486b40bdd5ef;

    function _btcMirror() internal view returns (bool) {
        return btc.codehash == BTC_MIRROR_CODEHASH;
    }

    function _hintPair(uint256 coll, uint256 debtForNicr) internal view returns (address upper, address lower) {
        if (coll == 0 || debtForNicr == 0) return (address(0), address(0));
        // Hints are ordinary contract calls, not precompile calls. An empty hint
        // makes SortedTroves walk the list and can blow the 10M block gas limit.
        uint256 nicr = coll * NICR_PRECISION / debtForNicr;
        address approx = address(0);
        try hintHelpers.getApproxHint(nicr, 12, uint256(uint160(address(this)))) returns (
            address hint, uint256, uint256
        ) {
            approx = hint;
        } catch {}
        (upper, lower) = sortedTroves.findInsertPosition(nicr, approx, approx);
    }

    function _approve(address token, address spender, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.approve.selector, spender, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _sweep() internal {
        uint256 btcBeforeSend = address(this).balance;
        uint256 musdBefore = musd.balanceOf(address(this));
        if (btcBeforeSend > 0) {
            (bool ok,) = owner.call{value: btcBeforeSend}("");
            if (!ok) revert TransferFailed();
        }
        uint256 erc = IERC20(btc).balanceOf(address(this));
        // Mezo's mirror moves with the native send above, so `erc` is then zero.
        // A distinct wrapper (fork tests) can still hold a balance; unwrap or forward it.
        if (erc > 0 && address(this).balance == 0) {
            (bool ok,) = btc.call(abi.encodeWithSignature("withdraw(uint256)", erc));
            if (ok && address(this).balance > 0) {
                (bool ok2,) = owner.call{value: address(this).balance}("");
                if (!ok2) revert TransferFailed();
            } else {
                (bool ok3, bytes memory data) =
                    btc.call(abi.encodeWithSelector(IERC20.transfer.selector, owner, erc));
                if (!ok3 || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
            }
        }
        uint256 m = musd.balanceOf(address(this));
        if (m > 0) {
            if (!musd.transfer(owner, m)) revert TransferFailed();
        }
        if (btcBeforeSend > 0 || musdBefore > 0) emit Swept(owner, btcBeforeSend, musdBefore);
    }

    function _active() internal view returns (bool) {
        return troveManager.getTroveStatus(address(this)) == ITroveManager.Status.active;
    }

    function _cr(uint256 price) internal view returns (uint256) {
        return troveManager.getCurrentICR(address(this), price);
    }

    function _isKeeper(address who) internal view returns (bool) {
        if (who == address(0)) return false;
        if (keeper != address(0) && who == keeper) return true;
        return factory != address(0) && who == ICoilFactory(factory).keeper();
    }
}
