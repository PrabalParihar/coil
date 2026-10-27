// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {CoilAccount} from "../src/CoilAccount.sol";
import {CoilFactory} from "../src/CoilFactory.sol";
import {CoilPark} from "../src/CoilPark.sol";
import {FlashSizer} from "../src/libraries/FlashMath.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed, IRouter, IERC20} from "../src/interfaces/Mezo.sol";

interface IPoolView {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint256, uint256, uint256);
    function stable() external view returns (bool);
}

/// @dev Stand-in for the Mezo BTC precompile. Anvil cannot execute 0x7b7c…0000,
///      so fork tests etch this code in its place and seed the pool's balance.
/// @dev 1:1 ERC-4626 stand-in. Proves the park can hold sMUSD shares and draw MUSD back.
contract MockSavings {
    IERC20 public immutable token;
    mapping(address => uint256) public sharesOf;

    constructor(address asset_) {
        token = IERC20(asset_);
    }

    function asset() external view returns (address) {
        return address(token);
    }

    function deposit(uint256 assets, address receiver) external returns (uint256) {
        require(token.transferFrom(msg.sender, address(this), assets), "deposit");
        sharesOf[receiver] += assets;
        return assets;
    }

    function withdraw(uint256 assets, address receiver, address owner_) external returns (uint256) {
        require(msg.sender == owner_, "owner");
        require(sharesOf[owner_] >= assets, "shares");
        sharesOf[owner_] -= assets;
        require(token.transfer(receiver, assets), "withdraw");
        return assets;
    }

    function convertToAssets(uint256 shares) external pure returns (uint256) {
        return shares;
    }

    function previewWithdraw(uint256 assets) external pure returns (uint256) {
        return assets;
    }
}

contract MockWbtc {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 wad) external {
        require(balanceOf[msg.sender] >= wad, "wbtc");
        balanceOf[msg.sender] -= wad;
        (bool ok,) = msg.sender.call{value: wad}("");
        require(ok, "wbtc send");
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        return _move(msg.sender, to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= amount, "allow");
            allowance[from][msg.sender] = allowed - amount;
        }
        return _move(from, to, amount);
    }

    function _move(address from, address to, uint256 amount) internal returns (bool) {
        require(balanceOf[from] >= amount, "bal");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    receive() external payable {}
}

contract CoilForkTest is Test {
    uint256 internal spot;
    uint256 internal reserveMusd;
    uint256 internal reserveBtc;

    CoilAccount internal implementation;
    CoilFactory internal factory;
    uint256 internal userNonce;

    function setUp() public {
        vm.createSelectFork(vm.envOr("MEZO_TESTNET_RPC", string("https://rpc.test.mezo.org")));
        IPoolView pool = IPoolView(MezoAddresses.TESTNET_MUSD_BTC_POOL);
        require(pool.token0() == MezoAddresses.TESTNET_MUSD, "token0");
        require(pool.token1() == MezoAddresses.BTC, "token1");
        (reserveMusd, reserveBtc,) = pool.getReserves();
        spot = reserveMusd * 1e18 / reserveBtc;

        _mockPrice(spot);
        _installBtcMirror();
        _installMezo();

        implementation = new CoilAccount(
            MezoAddresses.TESTNET_BORROWER_OPERATIONS,
            MezoAddresses.TESTNET_TROVE_MANAGER,
            MezoAddresses.TESTNET_SORTED_TROVES,
            MezoAddresses.TESTNET_HINT_HELPERS,
            MezoAddresses.TESTNET_PRICE_FEED,
            MezoAddresses.TESTNET_MUSD,
            MezoAddresses.BTC,
            MezoAddresses.TESTNET_ROUTER,
            MezoAddresses.TESTNET_POOL_FACTORY,
            MezoAddresses.TESTNET_MUSD_BTC_POOL
        );
        factory = new CoilFactory(address(implementation), address(this));
    }

    function test_forkReadsLiveProtocol() public {
        assertEq(block.chainid, 31611);
        IBorrowerOperations bo = IBorrowerOperations(MezoAddresses.TESTNET_BORROWER_OPERATIONS);
        assertEq(bo.minNetDebt(), 1800e18);
        assertEq(bo.borrowingRate(), 1e15);
        assertEq(bo.refinancingFeePercentage(), 20);
        assertEq(_mcr(MezoAddresses.TESTNET_BORROWER_OPERATIONS), 1.1e18);
        assertEq(_gasComp(MezoAddresses.TESTNET_TROVE_MANAGER), 200e18);
        assertGt(reserveBtc, 1000e18);
        assertGt(reserveMusd, 50_000_000e18);
        assertFalse(IPoolView(MezoAddresses.TESTNET_MUSD_BTC_POOL).stable());
        assertEq(IRouter(MezoAddresses.TESTNET_ROUTER).defaultFactory(), MezoAddresses.TESTNET_POOL_FACTORY);

        // The oracle precompile is not executable on Anvil. Coil fork tests substitute the price.
        (bool ok,) = address(0x7b7c000000000000000000000000000000000015).staticcall(
            abi.encodeWithSignature("latestRoundData()")
        );
        assertFalse(ok);
    }

    function test_directOpenTrove() public {
        address user = makeAddr("direct");
        vm.deal(user, 1 ether);
        vm.prank(user);
        IBorrowerOperations(MezoAddresses.TESTNET_BORROWER_OPERATIONS).openTrove{value: 0.1 ether}(
            2_000e18, address(0), address(0)
        );
        uint256 debt = ITroveManager(MezoAddresses.TESTNET_TROVE_MANAGER).getTroveDebt(user);
        uint256 coll = ITroveManager(MezoAddresses.TESTNET_TROVE_MANAGER).getTroveColl(user);
        assertEq(coll, 0.1 ether);
        assertGt(debt, 2_200e18);
        assertLt(debt, 2_300e18);
    }

    function test_loopHitsTarget() public {
        (address user, CoilAccount account) = _open(0.2 ether, 2e18, 50);
        CoilAccount.Position memory p = account.position();
        assertTrue(p.active);
        assertGt(p.collateral, 0.2 ether);
        assertGe(p.cr, 2e18);
        assertLt(p.cr, 2.15e18);
        assertGt(p.debt, 1800e18);
        assertEq(p.owner, user);
        assertGt(p.liquidationPrice, 0);
        assertLt(p.liquidationPrice, spot);
        assertEq(address(account).balance, 0);
    }

    function test_quoteAgreesWithExecution() public {
        CoilAccount.LoopQuote memory q = implementation.quoteLoop(0.2 ether, 2e18, 50);
        assertGe(q.cr, 2e18);
        assertGt(q.musdMinted, 1800e18);
        assertGt(q.iterations, 0);

        (, CoilAccount account) = _open(0.2 ether, 2e18, 50);
        CoilAccount.Position memory p = account.position();
        assertGe(p.cr, q.cr);
        assertApproxEqRel(p.collateral, q.collateral, 0.02e18);
        assertApproxEqRel(p.debt, q.debt, 0.02e18);
    }

    function test_highTargetWithSmallCollReverts() public {
        address user = makeAddr("small");
        vm.deal(user, 1 ether);
        vm.prank(user);
        factory.createAccount();
        CoilAccount account = CoilAccount(payable(factory.accountOf(user)));
        vm.prank(user);
        vm.expectRevert(CoilAccount.CannotOpen.selector);
        account.loop{value: 0.05 ether}(5e18, 50);
    }

    function test_unwindFullClosesAndReturnsBtc() public {
        (address user, CoilAccount account) = _open(0.2 ether, 2e18, 50);
        uint256 before = user.balance;
        vm.prank(user);
        account.unwind(1e18);
        CoilAccount.Position memory p = account.position();
        assertFalse(p.active);
        assertGt(user.balance, before);
        // Fees and swap costs are real, but the user gets most of the BTC back.
        assertGt(user.balance - before, 0.15 ether);
        assertEq(ITroveManager(MezoAddresses.TESTNET_TROVE_MANAGER).getTroveColl(address(account)), 0);
    }

    function test_unwindPartialRaisesCR() public {
        (address user, CoilAccount account) = _open(0.2 ether, 1.7e18, 50);
        uint256 crBefore = account.position().cr;
        uint256 debtBefore = account.position().debt;
        vm.prank(user);
        account.unwind(0.25e18);
        CoilAccount.Position memory p = account.position();
        assertTrue(p.active);
        assertGt(p.cr, crBefore);
        assertLt(p.debt, debtBefore);
        assertGe(p.debt, 2000e18);
    }

    function test_deleverAndKeeperBounds() public {
        (address user, CoilAccount account) = _open(0.2 ether, 1.6e18, 50);
        address keeper = makeAddr("keeper");
        factory.setKeeper(keeper);

        vm.prank(user);
        account.setGuard(1.5e18, 2.2e18, 8);

        vm.prank(keeper);
        vm.expectRevert(CoilAccount.NotOwner.selector);
        account.unwind(1e18);

        vm.prank(keeper);
        vm.expectRevert(CoilAccount.KeeperLimited.selector);
        account.deleverTo(3e18);

        uint256 crBefore = account.position().cr;
        vm.prank(keeper);
        account.deleverTo(2e18);
        uint256 crAfter = account.position().cr;
        assertGt(crAfter, crBefore);
        assertGe(crAfter, 2e18);

        // Keeper cannot push past the guard target the owner set.
        vm.prank(keeper);
        vm.expectRevert(CoilAccount.KeeperLimited.selector);
        account.deleverTo(2.5e18);

        // Owner can still leave entirely.
        vm.prank(user);
        account.unwind(1e18);
        assertFalse(account.position().active);
        assertGt(user.balance, 0.15 ether);
    }

    function test_guardDeleversWhenOracleDrops() public {
        (address user, CoilAccount account) = _open(0.25 ether, 2e18, 50);
        address keeper = makeAddr("keeper");
        vm.prank(user);
        account.setKeeper(keeper);
        vm.prank(user);
        account.setGuard(1.8e18, 2.3e18, 4);

        uint256 dropped = spot * 85 / 100;
        _mockPrice(dropped);
        uint256 cr = account.position().cr;
        assertLt(cr, 1.8e18);

        vm.prank(keeper);
        bool acted = account.guard();
        assertTrue(acted);
        assertGe(account.position().cr, 2.3e18);

        vm.prank(keeper);
        acted = account.guard();
        assertFalse(acted);
    }

    /// @dev The testnet pool can sit ~1.4% under the oracle. Rescue and close
    ///      use rescueSlippageBps (default 200, cap 300), not the 50 bps open default.
    function test_guardSucceedsWhenPoolIsBelowOracle() public {
        uint256 rich = spot * 10_000 / 9_860;
        _mockPrice(rich);

        uint256 target = uint256(4e18) / 3;
        (address user, CoilAccount account) = _flashOpen(0.02 ether, target, 50);
        assertEq(account.rescueSlippageBps(), 200);
        assertEq(account.slippageBps(), 50);
        assertLt(account.position().cr, 1.4e18);

        vm.prank(user);
        account.setGuard(1.4e18, 1.5e18, 0);
        address stranger = makeAddr("rescue-stranger");
        vm.prank(stranger);
        vm.expectRevert(CoilAccount.NotOwner.selector);
        account.setRescueSlippage(200);

        vm.prank(user);
        vm.expectRevert(CoilAccount.BadSlippage.selector);
        account.setRescueSlippage(301);

        vm.prank(user);
        account.setRescueSlippage(50);
        vm.prank(stranger);
        vm.expectRevert(CoilAccount.Slippage.selector);
        account.guard();
        vm.prank(user);
        vm.expectRevert(CoilAccount.Slippage.selector);
        account.flashUnwind(1e18);

        vm.prank(user);
        account.setRescueSlippage(200);
        uint256 crBefore = account.position().cr;
        vm.prank(stranger);
        bool acted = account.guard();
        assertTrue(acted);
        assertGt(account.position().cr, crBefore);
        assertGe(account.position().cr, 1.5e18);
    }

    function test_topUpExistingTrove() public {
        (address user, CoilAccount account) = _open(0.15 ether, 2.2e18, 50);
        uint256 collBefore = account.position().collateral;
        vm.deal(user, user.balance + 0.1 ether);
        vm.prank(user);
        account.loop{value: 0.1 ether}(2e18, 50);
        CoilAccount.Position memory p = account.position();
        assertGt(p.collateral, collBefore);
        assertGe(p.cr, 2e18);
        assertLt(p.cr, 2.15e18);
    }

    function test_precompileBudgetFits() public view {
        (uint256 loopCalls, uint256 unwindCalls, uint256 deleverCalls, uint256 guardCalls) =
            implementation.precompileBudget();
        assertEq(loopCalls, 7);
        assertEq(unwindCalls, 8);
        assertEq(deleverCalls, 10);
        assertEq(guardCalls, 12);
        assertLe(guardCalls, 16);
        // A reserve repay adds one price fetch (+2). A second top-up adds another. 12 + 4 = 16, under 20.
        assertLe(guardCalls + 4, 20);
    }

    function test_flashLoopReachesThreeTimes() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.5e18, 50);
        CoilAccount.Position memory p = account.position();
        assertTrue(p.active);
        assertGe(p.cr, 1.5e18);
        assertLt(p.cr, 1.6e18);
        assertGt(p.collateral, 0.35 ether);
        assertEq(p.owner, user);
        assertEq(address(account).balance, 0);
    }

    function test_flashLoopReachesAboutFourTimes() public {
        // 4× leverage is a collateral ratio of 4/3 ≈ 133.33%.
        uint256 target = uint256(4e18) / 3;
        (, CoilAccount account) = _flashOpen(0.25 ether, target, 100);
        CoilAccount.Position memory p = account.position();
        assertTrue(p.active);
        assertGe(p.cr, target);
        assertLt(p.cr, target + 0.05e18);
        // Leverage is CR / (CR − 1), scaled by 10_000 so 4.00× is 40_000.
        uint256 leverageBps = p.cr * 10_000 / (p.cr - 1e18);
        console2.log("four-x collateral ratio", p.cr);
        console2.log("four-x leverage bps", leverageBps);
        assertGe(leverageBps, 38_000);
        assertLt(leverageBps, 41_000);
    }

    function test_flashQuoteAgrees() public {
        (CoilAccount.LoopQuote memory q, uint256 flashBtc, uint256 poolFee) =
            implementation.quoteFlashLoop(0.2 ether, 1.5e18, 50);
        assertGt(flashBtc, 0);
        assertGt(poolFee, 0);
        assertGe(q.cr, 1.5e18);
        (, CoilAccount account) = _flashOpen(0.2 ether, 1.5e18, 50);
        CoilAccount.Position memory p = account.position();
        assertApproxEqRel(p.collateral, q.collateral, 0.02e18);
        assertApproxEqRel(p.debt, q.debt, 0.02e18);
    }

    function test_flashUnwindAndDeleverAreOneCall() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.5e18, 50);
        uint256 opened = account.position().cr;
        vm.prank(user);
        account.flashDeleverTo(2e18);
        assertGe(account.position().cr, 2e18);
        assertGt(account.position().cr, opened);

        uint256 before = user.balance;
        vm.prank(user);
        account.flashUnwind(1e18);
        assertFalse(account.position().active);
        assertGt(user.balance - before, 0.15 ether);
    }

    function test_tightSlippageReverts() public {
        address user = makeAddr("tight");
        vm.deal(user, 1 ether);
        vm.prank(user);
        factory.createAccount();
        CoilAccount account = CoilAccount(payable(factory.accountOf(user)));
        vm.prank(user);
        vm.expectRevert(CoilAccount.Slippage.selector);
        account.flashLoop{value: 0.2 ether}(1.5e18, 1);
    }

    function test_hookRejectsSpoof() public {
        (, CoilAccount account) = _flashOpen(0.12 ether, 2e18, 50);
        vm.expectRevert(CoilAccount.NotPool.selector);
        account.hook(address(this), 0, 1, hex"01");

        vm.prank(address(account.pool()));
        vm.expectRevert(CoilAccount.BadFlash.selector);
        account.hook(address(this), 0, 1, hex"01");
    }

    function test_strangerGuardPaysMezoOnlyWhenSafer() public {
        (address user, CoilAccount account) = _flashOpen(0.22 ether, 1.7e18, 50);
        address stranger = makeAddr("stranger");
        uint256 tip = 25e18;
        _mintMezo(user, 100e18);
        vm.startPrank(user);
        IERC20(MezoAddresses.MEZO).approve(address(account), tip);
        account.fundTips(tip);
        account.setGuard(1.5e18, 2.2e18, 4, tip);
        vm.stopPrank();

        uint256 strangerBefore = IERC20(MezoAddresses.MEZO).balanceOf(stranger);
        vm.prank(stranger);
        bool acted = account.guard();
        assertFalse(acted);
        assertEq(IERC20(MezoAddresses.MEZO).balanceOf(stranger), strangerBefore);

        uint256 dropped = spot * 80 / 100;
        _mockPrice(dropped);
        assertLt(account.position().cr, 1.5e18);
        uint256 crBefore = account.position().cr;
        uint256 btcBefore = stranger.balance;
        uint256 musdBefore = IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(stranger);

        vm.prank(stranger);
        acted = account.guard();
        assertTrue(acted);
        assertGt(account.position().cr, crBefore);
        assertEq(IERC20(MezoAddresses.MEZO).balanceOf(stranger), strangerBefore + tip);
        assertEq(stranger.balance, btcBefore);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(stranger), musdBefore);

        vm.prank(stranger);
        acted = account.guard();
        assertFalse(acted);
        assertEq(IERC20(MezoAddresses.MEZO).balanceOf(stranger), strangerBefore + tip);
    }

    function test_underfundedTipPaysBalance() public {
        (address user, CoilAccount account) = _flashOpen(0.22 ether, 1.8e18, 50);
        address stranger = makeAddr("partial-tip");
        _mintMezo(user, 4e18);
        vm.startPrank(user);
        IERC20(MezoAddresses.MEZO).approve(address(account), 4e18);
        account.fundTips(4e18);
        account.setGuard(1.6e18, 2.4e18, 0, 20e18);
        vm.stopPrank();
        _mockPrice(spot * 80 / 100);
        vm.prank(stranger);
        assertTrue(account.guard());
        assertEq(IERC20(MezoAddresses.MEZO).balanceOf(stranger), 4e18);
        assertEq(IERC20(MezoAddresses.MEZO).balanceOf(address(account)), 0);
    }

    function test_keeperCannotLoopUnwindOrTakeTips() public {
        (address user, CoilAccount account) = _flashOpen(0.16 ether, 1.8e18, 50);
        address keeper = makeAddr("keeper-bounds");
        _mintMezo(user, 10e18);
        vm.startPrank(user);
        IERC20(MezoAddresses.MEZO).approve(address(account), 10e18);
        account.fundTips(10e18);
        account.setKeeper(keeper);
        account.setGuard(1.5e18, 2e18, 0, 10e18);
        vm.stopPrank();

        vm.startPrank(keeper);
        vm.expectRevert(CoilAccount.NotOwner.selector);
        account.flashLoop{value: 0}(1.5e18, 50);
        vm.expectRevert(CoilAccount.NotOwner.selector);
        account.unwind(1e18);
        vm.expectRevert(CoilAccount.NotOwner.selector);
        account.flashUnwind(0.5e18);
        vm.expectRevert(CoilAccount.NotOwner.selector);
        account.withdrawTips(1e18);
        vm.expectRevert(CoilAccount.NotOwner.selector);
        account.sweep();
        vm.expectRevert(CoilAccount.KeeperLimited.selector);
        account.flashDeleverTo(3e18);
        vm.stopPrank();

        vm.prank(user);
        account.unwind(1e18);
        assertFalse(account.position().active);
        assertEq(IERC20(MezoAddresses.MEZO).balanceOf(address(account)), 10e18);
    }

    /// forge-config: default.fuzz.runs = 8
    function testFuzz_flashLoopStaysAboveTarget(uint96 depositRaw, uint16 targetPct) public {
        uint256 deposit = bound(uint256(depositRaw), 0.1 ether, 0.35 ether);
        uint256 pct = bound(uint256(targetPct), 140, 220);
        uint256 target = pct * 1e16;
        (, CoilAccount account) = _flashOpen(deposit, target, 100);
        CoilAccount.Position memory p = account.position();
        assertTrue(p.active);
        assertGe(p.cr, target);
        assertGt(p.collateral, deposit);
    }

    function test_guardRepaysReserveBeforeSellingBtc() public {
        (address user, CoilAccount account) = _flashOpen(0.02 ether, uint256(4e18) / 3, 50);
        CoilAccount.Position memory before = account.position();
        assertLt(before.cr, 1.4e18);
        uint256 musdNeed = _debtGap(account, 1.5e18) + 2e18;
        assertGt(musdNeed, 0);
        deal(MezoAddresses.TESTNET_MUSD, user, musdNeed);
        vm.startPrank(user);
        IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), musdNeed);
        account.moveReserve(musdNeed, false);
        account.setRescueSlippage(1);
        account.setGuard(1.4e18, 1.5e18, 0);
        vm.stopPrank();
        assertEq(account.park().assetsOf(address(account)), musdNeed);
        uint256 coll = before.collateral;
        vm.prank(makeAddr("reserve-keeper"));
        assertTrue(account.guard());
        CoilAccount.Position memory afterP = account.position();
        assertGe(afterP.cr, 1.5e18);
        assertEq(afterP.collateral, coll);
        assertLt(account.park().assetsOf(address(account)), musdNeed);
        assertLt(afterP.debt, before.debt);
    }

    function test_guardSellsOnlyTheReserveRemainder() public {
        (address user, CoilAccount account) = _flashOpen(0.02 ether, uint256(4e18) / 3, 50);
        uint256 musdNeed = _debtGap(account, 1.5e18) + 2e18;
        uint256 half = musdNeed / 2;
        assertGt(half, 0);
        deal(MezoAddresses.TESTNET_MUSD, user, half);
        vm.startPrank(user);
        IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), half);
        account.moveReserve(half, false);
        account.setGuard(1.4e18, 1.5e18, 0);
        vm.stopPrank();
        uint256 coll = account.position().collateral;
        vm.prank(makeAddr("partial-reserve"));
        assertTrue(account.guard());
        CoilAccount.Position memory afterP = account.position();
        assertGe(afterP.cr, 1.5e18);
        assertLt(afterP.collateral, coll);
        assertEq(account.park().assetsOf(address(account)), 0);
    }

    function test_sweepLeavesTheReserve() public {
        (address user, CoilAccount account) = _flashOpen(0.02 ether, uint256(4e18) / 3, 50);
        deal(MezoAddresses.TESTNET_MUSD, user, 100e18);
        vm.startPrank(user);
        IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), 100e18);
        account.moveReserve(100e18, false);
        account.sweep();
        vm.stopPrank();
        assertEq(account.park().assetsOf(address(account)), 100e18);
        vm.prank(makeAddr("thief"));
        vm.expectRevert(CoilAccount.NotOwner.selector);
        account.moveReserve(1e18, true);
        vm.prank(user);
        account.moveReserve(40e18, true);
        assertEq(account.park().assetsOf(address(account)), 60e18);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(user), 40e18);
    }

    function test_flashLoopRevertsWhenPoolIsOffTheOracle() public {
        (address user, CoilAccount account) = _openAccount();
        _mockPrice(spot * 10_300 / 10_000);
        vm.prank(user);
        vm.expectRevert(CoilAccount.PegOff.selector);
        account.flashLoop{value: 0.2 ether}(1.5e18, 200);
        vm.prank(user);
        account.setPegBounds(400, 0);
        vm.prank(user);
        account.flashLoop{value: 0.2 ether}(1.5e18, 200);
        assertTrue(account.position().active);
        _mockPrice(spot);
    }

    function test_flashLoopRevertsInRecoveryMode() public {
        (address user, CoilAccount account) = _openAccount();
        vm.mockCall(
            MezoAddresses.TESTNET_TROVE_MANAGER,
            abi.encodeWithSignature("checkRecoveryMode(uint256)"),
            abi.encode(true)
        );
        vm.prank(user);
        vm.expectRevert(CoilAccount.RecoveryMode.selector);
        account.flashLoop{value: 0.2 ether}(1.5e18, 200);
        vm.clearMockedCalls();
        _mockPrice(spot);
    }

    function test_pegGuardActsWhenMusdIsUnderOneDollar() public {
        (address user, CoilAccount account) = _flashOpen(0.02 ether, uint256(4e18) / 3, 50);
        vm.mockCall(
            address(account.sortedTroves()),
            abi.encodeWithSignature("getLast()"),
            abi.encode(address(account))
        );
        assertEq(account.redemptionRank(), 1);
        vm.prank(user);
        account.setPegBounds(200, 50);
        vm.prank(user);
        account.setGuard(1.15e18, 1.5e18, 0);
        _mockPrice(spot * 9_700 / 10_000);
        uint256 beforeCr = account.position().cr;
        vm.prank(makeAddr("peg-keeper"));
        bool acted = account.guard();
        assertTrue(acted);
        assertGt(account.position().cr, beforeCr);
        _mockPrice(spot);
    }

    function test_savingsVaultAdapterRepaysFromShares() public {
        (address user, CoilAccount account) = _flashOpen(0.02 ether, uint256(4e18) / 3, 50);
        MockSavings vault = new MockSavings(MezoAddresses.TESTNET_MUSD);
        vm.prank(address(this));
        account.park().setVault(address(vault));
        uint256 musdNeed = _debtGap(account, 1.5e18) + 2e18;
        deal(MezoAddresses.TESTNET_MUSD, user, musdNeed);
        vm.startPrank(user);
        IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), musdNeed);
        account.moveReserve(musdNeed, false);
        account.setRescueSlippage(1);
        account.setGuard(1.4e18, 1.5e18, 0);
        vm.stopPrank();
        assertGt(vault.sharesOf(address(account.park())), 0);
        uint256 coll = account.position().collateral;
        vm.prank(makeAddr("vault-keeper"));
        assertTrue(account.guard());
        assertGe(account.position().cr, 1.5e18);
        assertEq(account.position().collateral, coll);
        CoilPark park = account.park();
        vm.expectRevert(CoilPark.NotGovernor.selector);
        vm.prank(makeAddr("not-governor"));
        park.setVault(address(0));
    }

    function test_quoteDepthReportsSensibleLeverage() public {
        FlashSizer sizer = FlashSizer(address(implementation.sizer()));
        FlashSizer.Ctx memory c;
        c.deposit = 0.05 ether;
        c.price = spot;
        c.fee = 4;
        c.reserveMusd = reserveMusd;
        c.reserveBtc = reserveBtc;
        c.rate = 0.001e18;
        c.minAmt = 1_800e18;
        c.gasComp = 200e18;
        c.mcr = 1.1e18;
        c.openHeadroom = 0.005e18;
        c.targetCR = uint256(4e18) / 3;
        (, uint256 owed,, bool fits) = sizer.solve(c);
        uint256 impact = fits ? sizer.impactBps(reserveMusd, reserveBtc, owed, 4) : 10_000;
        (uint256 sensibleCR, uint256 sensibleImpact,, bool withinCap) = sizer.sensibleTarget(c, 100);
        assertLt(impact, 10_000);
        assertGt(sensibleCR, 1e18);
        if (withinCap) assertLe(sensibleImpact, 100);
    }

    function test_twoUsersGetDistinctClones() public {
        (, CoilAccount a) = _open(0.12 ether, 2.5e18, 50);
        (, CoilAccount b) = _open(0.12 ether, 2.5e18, 50);
        assertTrue(address(a) != address(b));
        assertEq(factory.accountsLength(), 2);
    }

    function _mcr(address protocol) internal view returns (uint256 value) {
        (bool ok, bytes memory data) = protocol.staticcall(abi.encodeWithSignature("MCR()"));
        require(ok, "mcr");
        value = abi.decode(data, (uint256));
    }

    function _gasComp(address protocol) internal view returns (uint256 value) {
        (bool ok, bytes memory data) = protocol.staticcall(abi.encodeWithSignature("MUSD_GAS_COMPENSATION()"));
        require(ok, "gas");
        value = abi.decode(data, (uint256));
    }

    function _debtGap(CoilAccount account, uint256 target) internal view returns (uint256) {
        CoilAccount.Position memory p = account.position();
        if (p.collateral == 0 || p.debt == 0) return 0;
        uint256 targetDebt = p.collateral * spot / target;
        if (targetDebt >= p.debt) return 0;
        return p.debt - targetDebt;
    }

    function _openAccount() internal returns (address user, CoilAccount account) {
        userNonce++;
        user = makeAddr(string(abi.encodePacked("acct-", vm.toString(userNonce))));
        vm.deal(user, 1 ether);
        vm.prank(user);
        factory.createAccount();
        account = CoilAccount(payable(factory.accountOf(user)));
    }

    function _open(uint256 collateral, uint256 targetCR, uint256 slip)
        internal
        returns (address user, CoilAccount account)
    {
        userNonce++;
        user = makeAddr(string(abi.encodePacked("coil-user-", vm.toString(userNonce))));
        vm.deal(user, collateral + 1 ether);
        vm.prank(user);
        factory.createAccount();
        account = CoilAccount(payable(factory.accountOf(user)));
        vm.prank(user);
        account.loop{value: collateral}(targetCR, slip);
    }

    function _flashOpen(uint256 collateral, uint256 targetCR, uint256 slip)
        internal
        returns (address user, CoilAccount account)
    {
        userNonce++;
        user = makeAddr(string(abi.encodePacked("flash-user-", vm.toString(userNonce))));
        vm.deal(user, collateral + 1 ether);
        vm.prank(user);
        factory.createAccount();
        account = CoilAccount(payable(factory.accountOf(user)));
        vm.prank(user);
        account.flashLoop{value: collateral}(targetCR, slip);
    }

    function _mintMezo(address to, uint256 amount) internal {
        deal(MezoAddresses.MEZO, to, amount);
    }

    function _mockPrice(uint256 price) internal {
        vm.mockCall(
            MezoAddresses.TESTNET_PRICE_FEED,
            abi.encodeWithSelector(IPriceFeed.fetchPrice.selector),
            abi.encode(price)
        );
    }

    function _installBtcMirror() internal {
        MockWbtc mirror = new MockWbtc();
        vm.etch(MezoAddresses.BTC, address(mirror).code);
        deal(MezoAddresses.BTC, MezoAddresses.TESTNET_MUSD_BTC_POOL, reserveBtc);
        vm.deal(MezoAddresses.BTC, 5_000 ether);
    }

    function _installMezo() internal {
        MockWbtc token = new MockWbtc();
        vm.etch(MezoAddresses.MEZO, address(token).code);
    }
}
