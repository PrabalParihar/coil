// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IBorrowerOperations, ITroveManager, ISortedTroves, IHintHelpers, IPriceFeed, IRouter, IERC20, IPool, IPoolCallee, IPoolFactory} from "./interfaces/Mezo.sol";
import {ICoilFactory} from "./ICoilFactory.sol";
import {MezoAddresses} from "./MezoAddresses.sol";
import {FlashSizer} from "./libraries/FlashMath.sol";
import {CoilLegacy} from "./libraries/CoilLegacy.sol";
import {CoilPark} from "./CoilPark.sol";

/// @title CoilAccount
/// @notice One clone per user. The clone is the MUSD trove owner.
/// @dev `flashLoop`, `flashUnwind`, and `flashDeleverTo` borrow from the MUSD/BTC
///      pool inside `hook` and repay before the swap returns, so leverage, unwind,
///      and de-lever each fit in one transaction.
///
///      Precompile budget (limit 20). Counts are from Pool.swap in mezo-org/tigris
///      plus the live measurement that `fetchPrice` is 2 calls and a MUSD→BTC swap
///      is 3 BTC calls (transfer, balanceOf, balanceOf after the fee is skimmed).
///      EXTCODEHASH does not count. A storage flag stands in for transient storage:
///      this chain is compiled for Shanghai, which has no TSTORE.
///
///      flashLoop (new trove): fetchPrice 2 + openTrove fetchPrice 2 + BTC-out swap 3 = 7.
///      flashUnwind / close: fetchPrice 2 + closeTrove fetchPrice 2 + BTC repayment
///      (transfer in, balanceOf, fee transfer, balanceOf) 4 = 8.
///      flashDelever: fetchPrice 2 + repay 2 + withdraw 2 + BTC repayment 4 = 10.
///      guard() adds a MEZO balanceOf and transfer, both precompiles, = 12.
///      A reserve repay adds one `repayMUSD` (2) before any flash. Reserve plus
///      flash plus the tip is 14. A second reserve top-up in the same call is 16.
///      All of those sit under 20. The iterative `loop` is unchanged and still
///      stops after two swaps.
///
///      Router fallback (`loop`, sale unwind, quotes, hints, sweep) lives in
///      CoilLegacy and is reached with DELEGATECALL. That call is not a
///      precompile, and `address(this)` stays this clone. The counts above
///      do not change. `precompileBudget()` stays on this contract.
///
///      On Mezo, BTC at 0x7b7c…0000 reports the native balance. Fork tests etch a
///      WETH-style token at that address; wrap and unwrap exist for that case.
contract CoilAccount is IPoolCallee {
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
    IPool public immutable pool;
    /// @dev Separate contract so quote views can staticcall the solver. A public
    ///      library would delegatecall, which a staticcall is not allowed to do.
    FlashSizer public immutable sizer;
    /// @notice Shared MUSD reserve. Clones read this immutable from the implementation.
    CoilPark public immutable park;
    /// @dev Testnet MUSD/BTC has MUSD as token0. Read once so flash swaps do not assume it.
    bool public immutable btcIsToken0;
    IERC20 public immutable mezo;

    address public owner;
    address public factory;
    address public keeper;
    /// @notice Slippage for `loop` / `flashLoop`. The owner sets it on each open.
    uint16 public slippageBps;
    /// @notice Slippage for `guard`, `flashUnwind`, and `flashDeleverTo`.
    ///         Owner-set, default 2% (200 bps), hard cap 3% (300 bps). A keeper
    ///         cannot change it. The oracle check still bounds BTC sold to
    ///         `fair * (1 + rescueSlippageBps)`, so a caller cannot push a
    ///         rescue through a worse pool than that cap.
    uint16 public rescueSlippageBps;
    /// @notice Max pool-vs-oracle gap, in bps, that `flashLoop` will still open through.
    uint16 public maxPegDeviationBps;
    /// @notice When non-zero, `guard` also acts if MUSD is at least this many bps under $1
    ///         and the trove sits in the redemption zone (or the bottom 8, if no zone is set).
    uint16 public pegGuardBps;
    uint256 public floorCR;
    uint256 public guardTargetCR;
    uint32 public redemptionZone;
    /// @dev MEZO paid to a caller of `guard` when that call raises the collateral ratio.
    uint256 public tipMezo;
    /// @dev One MEZO tip per clone per block. A second `guard` in the same block can still
    ///      rescue, but it does not pay again.
    uint256 public lastTipBlock;

    bool private initialized;
    uint256 private locked;

    enum FlashKind {
        None,
        Loop,
        Close,
        Repay
    }

    FlashKind private flashKind;
    uint256 private flashMaxIn;

    /// @notice Documented precompile-call upper bounds. See the contract natspec.
    uint256 public constant FLASH_LOOP_PRECOMPILES = 7;
    uint256 public constant FLASH_UNWIND_PRECOMPILES = 8;
    uint256 public constant FLASH_DELEVER_PRECOMPILES = 10;
    uint256 public constant GUARD_TIP_PRECOMPILES = 12;
    /// @dev guard() that repays from the reserve twice and then flashes BTC. Still under 20.
    uint256 internal constant RESERVE_GUARD_PRECOMPILES = 16;
    /// @dev 2%. Covers the ~1.4% pool-below-oracle gap seen on testnet, plus the pool fee.
    uint16 public constant RESCUE_SLIPPAGE_DEFAULT = 200;
    /// @dev Same ceiling as open slippage. Past this, `setRescueSlippage` reverts.
    uint16 public constant RESCUE_SLIPPAGE_CAP = 300;
    /// @dev flashLoop reverts when the pool and the oracle differ by more than this, unless the owner raises it.
    uint16 internal constant PEG_DEVIATION_DEFAULT = 200;
    uint16 internal constant PEG_DEVIATION_CAP = 500;

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
    event GuardSet(uint256 floorCR, uint256 guardTargetCR, uint32 redemptionZone, uint256 tipMezo);
    event GuardTriggered(address indexed caller, uint256 crBefore, uint256 crAfter);
    event ReserveDeposited(address indexed owner, uint256 amount);
    event ReserveWithdrawn(address indexed owner, uint256 amount);
    event ReserveSpent(uint256 amount);
    event Guarded(address indexed caller, uint256 crBefore, uint256 crAfter, uint256 tip);
    event KeeperSet(address indexed keeper);
    event Swept(address indexed to, uint256 btcAmount, uint256 musdAmount);
    event TipsFunded(address indexed from, uint256 amount);
    event TipsWithdrawn(address indexed to, uint256 amount);

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
    error NotPool();
    error BadFlash();
    error PoolPaused();
    error PegOff();

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
        address _poolFactory,
        address _pool
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
        pool = IPool(_pool);
        btcIsToken0 = IPool(_pool).token0() == _btc;
        sizer = new FlashSizer();
        park = new CoilPark(address(musd), msg.sender);
        mezo = IERC20(MezoAddresses.MEZO);
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
        rescueSlippageBps = RESCUE_SLIPPAGE_DEFAULT;
        maxPegDeviationBps = PEG_DEVIATION_DEFAULT;
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
        // Router loop lives in CoilLegacy so this clone stays under EIP-170.
        // DELEGATECALL keeps address(this) as the clone. No extra precompile calls.
        CoilLegacy.runLoop(_env(), targetCR, maxSlippageBps);
    }

    /// @param fractionWad Share of net debt to repay, 1e18 = close the trove and return BTC.
    ///         One Mezo Pools flash swap covers the whole repayment.
    function unwind(uint256 fractionWad) external onlyOwner nonReentrant {
        _unwind(fractionWad);
    }

    /// @notice Same path as `unwind`. Named for callers that want the flash entrypoint explicit.
    function flashUnwind(uint256 fractionWad) external onlyOwner nonReentrant {
        _unwind(fractionWad);
    }

    /// @notice Raise the collateral ratio to `targetCR` by flash-repaying debt with BTC collateral.
    ///         The owner can aim anywhere above the current ratio. A keeper can only aim up to the
    ///         guard target the owner configured, and cannot pull funds to itself.
    ///         One flash swap does the whole raise. If the 1,800 MUSD floor stops the ratio short
    ///         of `targetCR`, the call still succeeds when the ratio rose.
    function deleverTo(uint256 targetCR) external nonReentrant {
        _delever(targetCR);
    }

    /// @notice Same path as `deleverTo`.
    function flashDeleverTo(uint256 targetCR) external nonReentrant {
        _delever(targetCR);
    }

    /// @notice Anyone may call this. It de-levers to the guard target when the ratio is under
    ///         the floor, or when this trove sits within `redemptionZone` of the lowest-CR end
    ///         of SortedTroves. The caller is paid `tipMezo` in MEZO, capped by this clone's
    ///         MEZO balance, and only when the collateral ratio actually rose.
    ///         This cannot loop, unwind, withdraw, or send BTC or MUSD to the caller.
    function guard() external nonReentrant returns (bool acted) {
        if (guardTargetCR == 0 || !_active()) return false;

        uint256 price = priceFeed.fetchPrice();
        uint256 cr = _cr(price);
        bool crRisk = floorCR != 0 && cr < floorCR;
        uint256 rank = redemptionRank();
        bool redemptionRisk = redemptionZone != 0 && rank != 0 && rank <= redemptionZone;
        (uint256 poolMusd, uint256 poolBtc) = _reserves();
        uint256 belowPeg = CoilLegacy.musdBelowPegBps(poolMusd, poolBtc, price);
        uint256 zone = redemptionZone == 0 ? 8 : redemptionZone;
        bool pegRisk = pegGuardBps != 0 && belowPeg >= pegGuardBps && rank != 0 && rank <= zone;
        if (!crRisk && !redemptionRisk && !pegRisk) return false;
        if (cr >= guardTargetCR) return false;

        _deleverFlash(guardTargetCR, price);
        uint256 afterCr = _cr(price);
        if (afterCr < cr) revert NotSafer();
        if (afterCr == cr) return false;
        _sweep();
        uint256 tip = _payTip(msg.sender);
        emit Guarded(msg.sender, cr, afterCr, tip);
        emit GuardTriggered(msg.sender, cr, afterCr);
        emit Delevered(owner, guardTargetCR, afterCr, _active() ? troveManager.getTroveDebt(address(this)) : 0);
        return true;
    }

    function setGuard(uint256 floor, uint256 target, uint32 zone) external onlyOwner {
        _setGuard(floor, target, zone, tipMezo);
    }

    function setGuard(uint256 floor, uint256 target, uint32 zone, uint256 tip) external onlyOwner {
        _setGuard(floor, target, zone, tip);
    }

    /// @notice Pull MEZO from the owner into this clone. The owner must approve first.
    function fundTips(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        _transferFrom(address(mezo), msg.sender, address(this), amount);
        emit TipsFunded(msg.sender, amount);
    }

    /// @notice Owner reclaim of unused MEZO. A keeper cannot call this.
    function withdrawTips(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        _transferToken(address(mezo), owner, amount);
        emit TipsWithdrawn(owner, amount);
    }

    /// @notice Lever with one pool flash swap. `targetCR` of 1.5e18 is 3×. 1.333e18 is about 4×.
    ///         The 115% floor still applies. `loop` remains the two-swap fallback.
    function flashLoop(uint256 targetCR, uint256 maxSlippageBps) external payable onlyOwner nonReentrant {
        if (maxSlippageBps == 0 || maxSlippageBps > 300) revert BadSlippage();
        if (targetCR < MIN_TARGET_CR || targetCR > 10e18) revert BadCR();
        slippageBps = uint16(maxSlippageBps);
        _flashLoop(targetCR, maxSlippageBps);
    }

    function setKeeper(address next) external onlyOwner {
        keeper = next;
        emit KeeperSet(next);
    }

    function setSlippage(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > 300) revert BadSlippage();
        slippageBps = bps;
    }

    /// @notice Bound for rescues and closes. Does not change the open slippage.
    ///         Only the owner can set it, and only up to `RESCUE_SLIPPAGE_CAP`.
    function setRescueSlippage(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > RESCUE_SLIPPAGE_CAP) revert BadSlippage();
        rescueSlippageBps = bps;
    }

    /// @notice Park MUSD (`withdraw` false) or send it back to the owner. Approve this clone before a deposit.
    function moveReserve(uint256 amount, bool withdraw) external onlyOwner nonReentrant {
        CoilLegacy.moveReserve(_env(), address(park), amount, withdraw);
    }

    /// @notice `maxOpenBps` is the pool-vs-oracle gap `flashLoop` accepts. `guardBps` of 0 turns the peg trigger off.
    function setPegBounds(uint16 maxOpenBps, uint16 guardBps) external onlyOwner {
        if (maxOpenBps == 0 || maxOpenBps > PEG_DEVIATION_CAP || guardBps > PEG_DEVIATION_CAP) revert BadSlippage();
        maxPegDeviationBps = maxOpenBps;
        pegGuardBps = guardBps;
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
        CoilLegacy.Quote memory got = CoilLegacy.quoteLoop(_env(), collateralIn, targetCR, slippageBps_);
        q.collateral = got.collateral;
        q.debt = got.debt;
        q.cr = got.cr;
        q.liquidationPrice = got.liquidationPrice;
        q.musdMinted = got.musdMinted;
        q.iterations = got.iterations;
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

    /// @notice Rank a prospective trove would have. 1 is redeemed first.
    ///         Walks at most 32 troves from the low-NICR end. A return of 33 means
    ///         the trove sits outside that window.
    function previewRedemptionRank(uint256 collateral, uint256 debt) external view returns (uint256) {
        if (collateral == 0 || debt == 0) return type(uint256).max;
        uint256 nicr = collateral * NICR_PRECISION / debt;
        address cur = sortedTroves.getLast();
        uint256 ahead;
        for (uint256 i; i < MAX_RANK_WALK && cur != address(0); ++i) {
            uint256 n = troveManager.getNominalICR(cur);
            if (n >= nicr) break;
            unchecked {
                ++ahead;
            }
            cur = sortedTroves.getPrev(cur);
        }
        return ahead + 1;
    }

    /// @notice Nominal ICR of the trove `zone` places from the low end.
    ///         A new trove needs a higher NICR to sit outside that zone.
    ///         Returns 0 when the list is shorter than `zone`.
    function redemptionEdge(uint32 zone) external view returns (uint256 nicr) {
        if (zone == 0) return 0;
        address cur = sortedTroves.getLast();
        for (uint256 rank = 1; rank <= MAX_RANK_WALK && cur != address(0); ++rank) {
            if (rank == zone) return troveManager.getNominalICR(cur);
            cur = sortedTroves.getPrev(cur);
        }
        return 0;
    }

    /// @notice Dry-run of `flashLoop` for a fresh trove.
    function quoteFlashLoop(uint256 collateralIn, uint256 targetCR, uint256 slippageBps_)
        external
        view
        returns (LoopQuote memory q, uint256 flashBtc, uint256 poolFeeMusd)
    {
        if (collateralIn == 0) revert ZeroAmount();
        if (targetCR < MIN_TARGET_CR || targetCR > 10e18) revert BadCR();
        if (slippageBps_ == 0 || slippageBps_ > 300) revert BadSlippage();
        uint256 price = priceFeed.fetchPrice();
        (uint256 flash, uint256 owed, uint256 minted, bool fits) =
            _solveFlash(collateralIn, 0, 0, false, targetCR, price);
        if (!fits || minted == 0) revert CannotOpen();
        if (flash > 0) {
            uint256 fair = flash * price / WAD;
            if (fair == 0 || owed > fair * (BPS + slippageBps_) / BPS) revert Slippage();
        }
        uint256 rate = borrowerOperations.borrowingRate();
        uint256 coll = collateralIn + flash;
        uint256 debt = _projectedDebt(0, minted, rate, false, 0);
        q.collateral = coll;
        q.debt = debt;
        q.cr = coll * price / debt;
        q.liquidationPrice = MCR * debt / coll;
        q.musdMinted = minted;
        q.iterations = flash == 0 ? 0 : 1;
        flashBtc = flash;
        uint256 feeBps = _poolFeeBps();
        poolFeeMusd = owed * feeBps / BPS;
    }

    function precompileBudget() external pure returns (uint256 loopCalls, uint256 unwindCalls, uint256 deleverCalls, uint256 guardCalls) {
        return (FLASH_LOOP_PRECOMPILES, FLASH_UNWIND_PRECOMPILES, FLASH_DELEVER_PRECOMPILES, GUARD_TIP_PRECOMPILES);
    }

    function tipBalance() external view returns (uint256) {
        return mezo.balanceOf(address(this));
    }

    // ---------------------------------------------------------------------
    // Flash swap
    // ---------------------------------------------------------------------

    /// @inheritdoc IPoolCallee
    function hook(address sender, uint256 amount0, uint256 amount1, bytes calldata) external {
        if (msg.sender != address(pool)) revert NotPool();
        if (sender != address(this) || flashKind == FlashKind.None) revert BadFlash();
        FlashKind kind = flashKind;
        uint256 maxIn = flashMaxIn;
        flashKind = FlashKind.None;
        flashMaxIn = 0;

        uint256 musdGot = btcIsToken0 ? amount1 : amount0;
        uint256 btcGot = btcIsToken0 ? amount0 : amount1;
        if (kind == FlashKind.Loop) _hookLoop(btcGot, maxIn);
        else if (kind == FlashKind.Close) _hookClose(musdGot);
        else if (kind == FlashKind.Repay) _hookRepay(musdGot);
        else revert BadFlash();
    }

    function _unwind(uint256 fractionWad) internal {
        if (fractionWad == 0 || fractionWad > WAD) revert BadFraction();
        if (!_active()) revert NoTrove();
        uint256 price = priceFeed.fetchPrice();
        if (fractionWad == WAD) {
            _flashClose(price);
            _sweep();
            emit Unwound(owner, fractionWad, _active() ? _cr(price) : type(uint256).max);
            return;
        }

        uint256 debt = troveManager.getTroveDebt(address(this));
        uint256 net = debt - GAS_COMPENSATION;
        uint256 toRepay = net * fractionWad / WAD;
        if (net - toRepay < borrowerOperations.minNetDebt()) revert MinDebt();
        uint256 have = musd.balanceOf(address(this));
        if (have >= toRepay) {
            _repay(toRepay);
        } else if (!_paused()) {
            uint256 short = toRepay - have;
            _beginRepay(short, price);
        } else {
            _unwindSale(fractionWad, price, toRepay);
            return;
        }
        _sweep();
        emit Unwound(owner, fractionWad, _active() ? _cr(price) : type(uint256).max);
    }

    function _delever(uint256 targetCR) internal {
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
        _deleverFlash(targetCR, price);
        uint256 afterCr = _cr(price);
        if (afterCr < beforeCr) revert NotSafer();
        if (afterCr == beforeCr) return;
        _sweep();
        emit Delevered(owner, targetCR, afterCr, troveManager.getTroveDebt(address(this)));
    }

    function _deleverFlash(uint256 targetCR, uint256 price) internal {
        CoilLegacy.applyReserve(_env(), address(park), targetCR, price);
        if (_active() && _cr(price) >= targetCR) return;
        if (_paused()) {
            _deleverTo(targetCR, price);
            return;
        }
        uint256 musdOut = _sizeDelever(targetCR, price);
        if (musdOut == 0) return;
        _beginRepay(musdOut, price);
    }

    function _flashClose(uint256 price) internal {
        uint256 debt = troveManager.getTroveDebt(address(this));
        uint256 need = debt - GAS_COMPENSATION;
        uint256 have = musd.balanceOf(address(this));
        if (have >= need) {
            borrowerOperations.closeTrove();
            return;
        }
        if (_paused()) {
            _unwindAll(price);
            return;
        }
        uint256 short = need - have;
        (uint256 reserveMusd, uint256 reserveBtc) = _reserves();
        uint256 btcOwed = sizer.amountIn(reserveBtc, reserveMusd, short, _poolFeeBps());
        uint256 coll = troveManager.getTroveColl(address(this));
        if (btcOwed == 0 || btcOwed >= coll) revert Slippage();
        _checkOracleSlip(btcOwed, short, price);
        flashKind = FlashKind.Close;
        _swapMusdOut(short);
    }

    function _beginRepay(uint256 musdOut, uint256 price) internal {
        (uint256 reserveMusd, uint256 reserveBtc) = _reserves();
        uint256 btcOwed = sizer.amountIn(reserveBtc, reserveMusd, musdOut, _poolFeeBps());
        uint256 coll = troveManager.getTroveColl(address(this));
        if (btcOwed == 0 || btcOwed >= coll) revert Slippage();
        _checkOracleSlip(btcOwed, musdOut, price);
        flashKind = FlashKind.Repay;
        _swapMusdOut(musdOut);
    }

    function _flashLoop(uint256 targetCR, uint256 slip) internal {
        uint256 price = priceFeed.fetchPrice();
        if (troveManager.checkRecoveryMode(price)) revert RecoveryMode();
        (uint256 poolMusd, uint256 poolBtc) = _reserves();
        if (CoilLegacy.deviationBps(poolMusd, poolBtc, price) > maxPegDeviationBps) revert PegOff();
        bool exists = _active();
        if (!exists && msg.value == 0) revert ZeroAmount();
        if (exists && msg.value == 0 && _cr(price) <= targetCR) revert AlreadyAtTarget();

        uint256 collNow = exists ? troveManager.getTroveColl(address(this)) : 0;
        uint256 debtNow = exists ? troveManager.getTroveDebt(address(this)) : 0;
        (uint256 flashBtc, uint256 owed, uint256 minted, bool fits) =
            _solveFlash(msg.value, collNow, debtNow, exists, targetCR, price);
        if (!fits) revert CannotOpen();
        if (flashBtc > 0) {
            uint256 fair = flashBtc * price / WAD;
            if (fair == 0 || owed > fair * (BPS + slip) / BPS) revert Slippage();
        }

        if (flashBtc == 0) {
            _loopWithoutFlash(msg.value, minted, exists);
        } else {
            if (_paused()) revert PoolPaused();
            flashKind = FlashKind.Loop;
            flashMaxIn = owed + (owed * slip / BPS) + 8;
            _swapBtcOut(flashBtc);
        }

        if (!_active()) revert CannotOpen();
        uint256 endCr = _cr(price);
        if (endCr < targetCR) revert BelowTarget();
        _sweep();
        emit Looped(
            owner, targetCR, troveManager.getTroveColl(address(this)), troveManager.getTroveDebt(address(this)), endCr
        );
    }

    function _loopWithoutFlash(uint256 deposit, uint256 minted, bool exists) internal {
        uint256 rate = borrowerOperations.borrowingRate();
        if (!exists) {
            (address upper, address lower) = _hintPair(deposit, minted + minted * rate / WAD + GAS_COMPENSATION);
            borrowerOperations.openTrove{value: deposit}(minted, upper, lower);
            return;
        }
        if (deposit > 0) _addColl(deposit);
        if (minted > 0) {
            uint256 principal = troveManager.getTrovePrincipal(address(this)) + minted + minted * rate / WAD;
            (address upper, address lower) = _hintPair(troveManager.getTroveColl(address(this)), principal);
            borrowerOperations.withdrawMUSD(minted, upper, lower);
        }
    }

    function _hookLoop(uint256 btcGot, uint256 maxMusd) internal {
        uint256 owed = btcGot == 0 ? 0 : _musdInForBtcOut(btcGot);
        if (owed > maxMusd) revert Slippage();
        uint256 nativeIn = _pullBtcToNative();
        bool exists = _active();
        uint256 rate = borrowerOperations.borrowingRate();
        uint256 minted = owed;
        if (!exists) {
            uint256 minAmt = _minOpenAmount(rate);
            if (minted < minAmt) minted = minAmt;
            (address upper, address lower) = _hintPair(nativeIn, minted + minted * rate / WAD + GAS_COMPENSATION);
            borrowerOperations.openTrove{value: nativeIn}(minted, upper, lower);
        } else {
            if (nativeIn > 0) {
                (address upper, address lower) = _hintPair(
                    troveManager.getTroveColl(address(this)) + nativeIn, troveManager.getTrovePrincipal(address(this))
                );
                borrowerOperations.addColl{value: nativeIn}(upper, lower);
                (upper, lower) = _hintPair(
                    troveManager.getTroveColl(address(this)), troveManager.getTrovePrincipal(address(this))
                );
                borrowerOperations.refinance(upper, lower);
            }
            if (minted > 0) {
                uint256 principal = troveManager.getTrovePrincipal(address(this)) + minted + minted * rate / WAD;
                (address upper, address lower) =
                    _hintPair(troveManager.getTroveColl(address(this)), principal);
                borrowerOperations.withdrawMUSD(minted, upper, lower);
            }
        }
        if (owed > 0) _transferToken(address(musd), address(pool), owed);
    }

    function _hookClose(uint256 musdGot) internal {
        borrowerOperations.closeTrove();
        uint256 owed = _btcInForMusdOut(musdGot);
        _sendBtc(address(pool), owed);
    }

    function _hookRepay(uint256 musdGot) internal {
        _repay(musdGot);
        uint256 owed = _btcInForMusdOut(musdGot);
        uint256 coll = troveManager.getTroveColl(address(this));
        (address upper, address lower) =
            _hintPair(coll - owed, troveManager.getTrovePrincipal(address(this)));
        borrowerOperations.withdrawColl(owed, upper, lower);
        _sendBtc(address(pool), owed);
    }

    function _repay(uint256 amount) internal {
        uint256 principal = troveManager.getTrovePrincipal(address(this));
        uint256 hinted = principal > amount ? principal - amount : principal;
        (address upper, address lower) = _hintPair(troveManager.getTroveColl(address(this)), hinted);
        borrowerOperations.repayMUSD(amount, upper, lower);
    }

    function _solveFlash(
        uint256 deposit,
        uint256 collNow,
        uint256 debtNow,
        bool exists,
        uint256 targetCR,
        uint256 price
    ) internal view returns (uint256 flashBtc, uint256 owed, uint256 minted, bool fits) {
        FlashSizer.Ctx memory c;
        c.deposit = deposit;
        c.collNow = collNow;
        c.debtNow = debtNow;
        c.exists = exists;
        c.targetCR = targetCR;
        c.price = price;
        c.fee = _poolFeeBps();
        (c.reserveMusd, c.reserveBtc) = _reserves();
        c.rate = borrowerOperations.borrowingRate();
        c.minAmt = exists ? 0 : _minOpenAmount(c.rate);
        c.gasComp = GAS_COMPENSATION;
        c.mcr = MCR;
        c.openHeadroom = OPEN_HEADROOM;
        return sizer.solve(c);
    }

    function _sizeDelever(uint256 targetCR, uint256 price) internal view returns (uint256) {
        uint256 coll = troveManager.getTroveColl(address(this));
        uint256 debt = troveManager.getTroveDebt(address(this));
        uint256 room = _maxRepay(debt);
        (uint256 reserveMusd, uint256 reserveBtc) = _reserves();
        return sizer.sizeRepay(
            coll, debt, room, targetCR, price, reserveMusd, reserveBtc, _poolFeeBps(), GAS_COMPENSATION, MCR + 0.01e18
        );
    }

    function _swapBtcOut(uint256 btcOut) internal {
        if (btcIsToken0) pool.swap(btcOut, 0, address(this), hex"01");
        else pool.swap(0, btcOut, address(this), hex"01");
    }

    function _swapMusdOut(uint256 musdOut) internal {
        if (btcIsToken0) pool.swap(0, musdOut, address(this), hex"01");
        else pool.swap(musdOut, 0, address(this), hex"01");
    }

    function _musdInForBtcOut(uint256 btcOut) internal view returns (uint256) {
        (uint256 reserveMusd, uint256 reserveBtc) = _reserves();
        return sizer.amountIn(reserveMusd, reserveBtc, btcOut, _poolFeeBps());
    }

    function _btcInForMusdOut(uint256 musdOut) internal view returns (uint256) {
        (uint256 reserveMusd, uint256 reserveBtc) = _reserves();
        return sizer.amountIn(reserveBtc, reserveMusd, musdOut, _poolFeeBps());
    }

    function _reserves() internal view returns (uint256 reserveMusd, uint256 reserveBtc) {
        (uint256 r0, uint256 r1,) = pool.getReserves();
        if (btcIsToken0) return (r1, r0);
        return (r0, r1);
    }

    function _poolFeeBps() internal view returns (uint256) {
        return IPoolFactory(poolFactory).getFee(address(pool), pool.stable());
    }

    function _paused() internal view returns (bool) {
        (bool ok, bytes memory data) = poolFactory.staticcall(abi.encodeWithSignature("isPaused()"));
        if (!ok || data.length < 32) return false;
        return abi.decode(data, (bool));
    }

    /// @dev Oracle bound for a BTC-in / MUSD-out flash. Uses `rescueSlippageBps`,
    ///      not the open slippage. No precompile calls.
    function _checkOracleSlip(uint256 btcIn, uint256 musdOut, uint256 price) internal view {
        if (btcIn == 0 || price == 0) revert Slippage();
        uint256 fairBtc = musdOut * WAD / price;
        uint256 cap = fairBtc * (BPS + rescueSlippageBps) / BPS;
        if (btcIn > cap) revert Slippage();
    }

    function _pullBtcToNative() internal returns (uint256) {
        if (!_btcMirror()) {
            uint256 erc = IERC20(btc).balanceOf(address(this));
            if (erc > 0) {
                (bool ok,) = btc.call(abi.encodeWithSignature("withdraw(uint256)", erc));
                if (!ok) revert Slippage();
            }
        }
        return address(this).balance;
    }

    function _sendBtc(address to, uint256 amount) internal {
        if (amount == 0) revert Slippage();
        if (_btcMirror()) {
            _transferToken(btc, to, amount);
            return;
        }
        (bool ok,) = btc.call{value: amount}(abi.encodeWithSignature("deposit()"));
        if (!ok) revert Slippage();
        _transferToken(btc, to, amount);
    }

    function _setGuard(uint256 floor, uint256 target, uint32 zone, uint256 tip) internal {
        if (floor == 0 && target == 0 && zone == 0) {
            floorCR = 0;
            guardTargetCR = 0;
            redemptionZone = 0;
            tipMezo = tip;
            emit GuardSet(0, 0, 0, tip);
            return;
        }
        if (floor < MIN_TARGET_CR || target < floor || zone > MAX_RANK_WALK) revert BadCR();
        floorCR = floor;
        guardTargetCR = target;
        redemptionZone = zone;
        tipMezo = tip;
        emit GuardSet(floor, target, zone, tip);
    }

    function _payTip(address to) internal returns (uint256 paid) {
        if (to == address(0) || tipMezo == 0 || block.number == lastTipBlock) return 0;
        uint256 bal = mezo.balanceOf(address(this));
        paid = bal < tipMezo ? bal : tipMezo;
        if (paid == 0) return 0;
        _transferToken(address(mezo), to, paid);
        lastTipBlock = block.number;
    }


    function _unwindSale(uint256 fractionWad, uint256 price, uint256 toRepay) internal {
        CoilLegacy.unwindSale(_env(), fractionWad, price, toRepay, rescueSlippageBps);
    }

    function _addColl(uint256 amount) internal {
        CoilLegacy.addColl(_env(), amount);
    }

    function _deleverTo(uint256 targetCR, uint256 price) internal {
        CoilLegacy.deleverIter(_env(), targetCR, price, rescueSlippageBps);
    }

    function _unwindAll(uint256 price) internal {
        CoilLegacy.unwindAll(_env(), price, rescueSlippageBps);
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


    function _minOpenAmount(uint256 rate) internal view returns (uint256) {
        return CoilLegacy.minOpenAmount(_env(), rate);
    }

    function _maxRepay(uint256 debt) internal view returns (uint256) {
        return CoilLegacy.maxRepay(_env(), debt);
    }

    /// @dev Codehash of the live BTC precompile bytecode. EXTCODEHASH does not
    ///      spend a precompile call. The fork test etches a different mock at
    ///      the same address, so this distinguishes them.
    bytes32 internal constant BTC_MIRROR_CODEHASH =
        0x646ced85f3dad5f3a9fa7a920d158620ac616278d1b32b45867d486b40bdd5ef;

    function _btcMirror() internal view returns (bool) {
        return btc.codehash == BTC_MIRROR_CODEHASH;
    }

    function _transferToken(address token, address to, uint256 amount) internal {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _transferFrom(address token, address from, address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }


    function _hintPair(uint256 coll, uint256 debtForNicr) internal view returns (address upper, address lower) {
        return CoilLegacy.hintPair(_env(), coll, debtForNicr);
    }

    function _sweep() internal {
        CoilLegacy.sweep(_env());
    }

    function _env() internal view returns (CoilLegacy.Env memory e) {
        e.borrowerOperations = address(borrowerOperations);
        e.troveManager = address(troveManager);
        e.sortedTroves = address(sortedTroves);
        e.hintHelpers = address(hintHelpers);
        e.priceFeed = address(priceFeed);
        e.musd = address(musd);
        e.btc = btc;
        e.router = address(router);
        e.poolFactory = poolFactory;
        e.owner = owner;
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
