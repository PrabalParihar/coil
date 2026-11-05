// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {VmSafe} from "forge-std/Vm.sol";
import {Test, console2, Vm} from "forge-std/Test.sol";
import {CoilAccount} from "../src/CoilAccount.sol";
import {CoilFactory} from "../src/CoilFactory.sol";
import {CoilPark} from "../src/CoilPark.sol";
import {FlashSizer} from "../src/libraries/FlashMath.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed, IRouter, IERC20} from "../src/interfaces/Mezo.sol";
import {PriceMin} from "../src/libraries/PriceMin.sol";
import {MockStalePriceFeed} from "./MockStalePriceFeed.sol";

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
        factory.setPositionLimits(100 ether, 10_000_000e18);
        factory.unpauseOpens();
    }

    function test_wave2_policyStartsPausedAndRejectsInvalidAuthority() public {
        CoilFactory fresh = new CoilFactory(address(implementation), address(this));
        (bool ok, bytes memory data) = address(fresh).staticcall(abi.encodeWithSignature("coilFeeBps()"));
        assertTrue(ok, "fee getter absent");
        assertEq(abi.decode(data, (uint16)), 25);
        (ok, data) = address(fresh).staticcall(abi.encodeWithSignature("opensPaused()"));
        assertTrue(ok); assertTrue(abi.decode(data, (bool)));
        (ok,) = address(fresh).call(abi.encodeWithSignature("unpauseOpens()")); assertFalse(ok);
        (ok,) = address(fresh).call(abi.encodeWithSignature("setCoilFee(uint16)", uint16(0))); assertFalse(ok);
        (ok,) = address(fresh).call(abi.encodeWithSignature("setCoilFee(uint16)", uint16(51))); assertFalse(ok);
        vm.prank(makeAddr("stranger"));
        (ok,) = address(fresh).call(abi.encodeWithSignature("setCoilFee(uint16)", uint16(50))); assertFalse(ok);
        (ok,) = address(fresh).call(abi.encodeWithSignature("setCoilFee(uint16)", uint16(50))); assertTrue(ok);
    }

    function test_wave2_feeDriftAndExactFlashFee() public {
        (address user, CoilAccount account) = _openAccount();
        (bool ok,) = address(factory).call(abi.encodeWithSignature("setCoilFee(uint16)", uint16(50)));
        assertTrue(ok, "fee setter absent");
        vm.prank(user);
        (ok,) = address(account).call{value: 0.2 ether}(abi.encodeWithSignature("flashLoop(uint256,uint256,uint16)", 1.5e18, 50, uint16(25)));
        assertFalse(ok, "stale fee acceptance");
        uint256 before = IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(address(this));
        vm.prank(user);
        (ok,) = address(account).call{value: 0.2 ether}(abi.encodeWithSignature("flashLoop(uint256,uint256,uint16)", 1.5e18, 50, uint16(50)));
        assertTrue(ok, "fee accepted open");
        uint256 gross = ITroveManager(MezoAddresses.TESTNET_TROVE_MANAGER).getTrovePrincipal(address(account)) - 200e18;
        // Principal includes the 0.1% protocol borrowing fee. Recover received notional to one wei.
        gross = (gross * 1000 + 1000) / 1001;
        assertApproxEqAbs(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(address(this)) - before, gross * 50 / 10000, 1);
        assertGe(account.position().cr, 1.5e18);
    }

    function test_wave2_realRecoveryRepayAndLaterDirectClose() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.5e18, 50);
        uint256 debt = account.position().debt;
        uint256 coll = account.position().collateral;
        deal(MezoAddresses.TESTNET_MUSD, user, debt);
        vm.prank(user); IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), debt);
        _mockPrice(spot / 1000);
        assertTrue(ITroveManager(MezoAddresses.TESTNET_TROVE_MANAGER).checkRecoveryMode(spot / 1000), "real system RM");
        vm.prank(address(account));
        vm.expectRevert(bytes("BorrowerOps: Operation not permitted during Recovery Mode"));
        IBorrowerOperations(MezoAddresses.TESTNET_BORROWER_OPERATIONS).closeTrove();
        vm.prank(user);
        (bool ok, bytes memory data) = address(account).call(abi.encodeWithSignature("repayWithMUSD(uint256)", 100e18));
        assertTrue(ok, "RM repayment missing"); assertEq(abi.decode(data, (uint256)), 100e18);
        assertEq(account.position().collateral, coll); assertEq(account.position().debt, debt - 100e18);
        vm.startPrank(user);
        account.moveReserve(50e18, false);
        account.setGuard(1.5e18, 2e18, 0);
        vm.stopPrank();
        assertTrue(account.guard(), "real RM guard must use pure reserve repayment");
        assertEq(account.position().collateral, coll, "RM rescue cannot withdraw collateral");
        assertEq(account.position().debt, debt - 150e18);
        assertEq(account.park().assetsOf(address(account)), 0);
        assertFalse(account.guard(), "empty reserve RM guard must be quiet");
        vm.prank(user);
        (ok,) = address(account).call(abi.encodeWithSignature("closeWithMUSD(uint256)", debt)); assertFalse(ok, "RM close forbidden");
        _mockPrice(_oracleAbovePool(400));
        vm.prank(user);
        (ok,) = address(account).call(abi.encodeWithSignature("closeWithMUSD(uint256)", debt)); assertTrue(ok, "direct exit missing");
        assertFalse(account.position().active);
    }

    function test_wave2_A9_guardUnsafeEmptyReserveNoTip() public {
        (address user, CoilAccount account) = _flashOpen(0.02 ether, uint256(4e18)/3, 50);
        vm.prank(user); account.setGuard(1.5e18, 2.2e18, 0, 5e18);
        _mintMezo(address(account), 10e18);
        uint256 coll = account.position().collateral; uint256 debt = account.position().debt;
        _mockPrice(_oracleAbovePool(400));
        address caller = makeAddr("sandwicher");
        vm.prank(caller); assertFalse(account.guard());
        assertEq(account.position().collateral, coll); assertEq(account.position().debt, debt);
        assertEq(IERC20(MezoAddresses.MEZO).balanceOf(caller), 0);
    }

    function test_wave2_A9_ownerFlashCloseOutsideBound() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.5e18, 50);
        _mockPrice(_oracleAbovePool(400));
        vm.prank(user); vm.expectRevert(CoilAccount.Slippage.selector); account.flashUnwind(1e18);
    }

    function test_wave2_loweredCapsPauseStillAllowOwnerRiskReduction() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.5e18, 50);
        (bool ok,) = address(factory).call(abi.encodeWithSignature("setPositionLimits(uint256,uint256)", 1, 1));
        assertTrue(ok, "caps absent");
        vm.prank(user); (ok,) = address(account).call{value: 0.01 ether}(abi.encodeWithSignature("flashLoop(uint256,uint256)", 1.5e18, 50)); assertFalse(ok);
        (ok,) = address(factory).call(abi.encodeWithSignature("pauseOpens()")); assertTrue(ok);
        uint256 coll = account.position().collateral;
        vm.prank(user); (ok,) = address(account).call{value: 0.01 ether}(abi.encodeWithSignature("addCollateral()")); assertTrue(ok, "safe topup absent");
        assertEq(account.position().collateral, coll + 0.01 ether);
        deal(MezoAddresses.TESTNET_MUSD, user, 100e18);
        vm.prank(user); IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), 100e18);
        vm.prank(user); (ok,) = address(account).call(abi.encodeWithSignature("repayWithMUSD(uint256)", 100e18)); assertTrue(ok);
    }

    function test_wave2_claimOnlyRecoveredNativeAndRejectRepeated() public {
        (address user, CoilAccount account) = _openAccount();
        ClaimFixture fixture = new ClaimFixture();
        vm.etch(MezoAddresses.TESTNET_BORROWER_OPERATIONS, address(fixture).code);
        vm.deal(MezoAddresses.TESTNET_BORROWER_OPERATIONS, 0.1 ether);
        vm.deal(address(account), 0.02 ether);
        uint256 before = user.balance;
        vm.prank(user); (bool ok, bytes memory data) = address(account).call(abi.encodeWithSignature("claimCollateral()"));
        assertTrue(ok, "claim missing"); assertEq(abi.decode(data, (uint256)), 0.1 ether);
        assertEq(user.balance - before, 0.1 ether); assertEq(address(account).balance, 0.02 ether);
        vm.prank(user); (ok,) = address(account).call(abi.encodeWithSignature("claimCollateral()")); assertFalse(ok);
        vm.prank(makeAddr("thief")); (ok,) = address(account).call(abi.encodeWithSignature("claimCollateral()")); assertFalse(ok);
    }

    function test_wave2_A9_flashSizerDeleverOutsideBound() public {
        (address user, CoilAccount account) = _flashOpen(0.02 ether, uint256(4e18)/3, 50);
        _mockPrice(_oracleAbovePool(400));
        vm.prank(user); vm.expectRevert(CoilAccount.Slippage.selector); account.flashDeleverTo(2.2e18);
    }

    function test_wave2_A9_flashLoopCallbackCannotWidenOracleBound() public {
        (address user, CoilAccount account) = _openAccount();
        AdversePool fixture = new AdversePool(reserveMusd, reserveBtc);
        vm.etch(MezoAddresses.TESTNET_MUSD_BTC_POOL, address(fixture).code);
        _mockPrice(spot * 996 / 1000);
        // Extra owner collateral makes a CR-only check insufficient to detect the bad fill.
        vm.deal(address(account), 0.1 ether);
        vm.prank(user); vm.expectRevert(CoilAccount.Slippage.selector);
        account.flashLoop{value: 0.2 ether}(1.5e18, 50);
        assertFalse(account.position().active);
        assertEq(address(account).balance, 0.1 ether);
    }

    function test_wave2_flashIncreaseAccountsForFeeAndRefinance() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.7e18, 50);
        uint256 debt = account.position().debt;
        vm.prank(user); account.flashLoop{value: 0.1 ether}(1.5e18, 50);
        assertGt(account.position().debt, debt);
        assertGe(account.position().cr, 1.5e18);
    }

    function test_wave2_guardianCanPauseOnlyAndHeartbeatAuthenticates() public {
        address guardian = makeAddr("guardian");
        factory.setGuardian(guardian);
        vm.prank(guardian); factory.pauseOpens();
        vm.prank(guardian); vm.expectRevert(CoilFactory.Ownable.selector); factory.unpauseOpens();
        vm.prank(guardian); vm.expectRevert(CoilFactory.Ownable.selector); factory.setCoilFee(50);
        vm.prank(guardian); vm.expectRevert(CoilFactory.Ownable.selector); factory.setFeeRecipient(guardian);
        vm.prank(guardian); vm.expectRevert(CoilFactory.Ownable.selector); factory.setPositionLimits(1, 1);
        vm.prank(guardian); vm.expectRevert(CoilFactory.Ownable.selector); factory.heartbeat();
        factory.setKeeper(guardian);
        vm.prank(guardian); factory.heartbeat();
        factory.unpauseOpens(); assertFalse(factory.opensPaused());
    }

    function test_wave2_quoteFeesMatchGrossAndRecipientOnBothOpenPaths() public {
        address recipient = makeAddr("fees"); factory.setFeeRecipient(recipient);
        (address user, CoilAccount account) = _openAccount();
        (CoilAccount.LoopQuote memory q,,, uint256 quotedFee) = account.quoteFlashLoopWithFee(0.2 ether, 1.5e18, 50);
        assertEq(quotedFee, q.musdMinted * 25 / 10000);
        vm.prank(user); account.flashLoop{value: 0.2 ether}(1.5e18, 50, 25);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(recipient), quotedFee);
        assertEq(account.position().debt, q.debt);
        (user, account) = _openAccount();
        vm.recordLogs();
        vm.prank(user); account.loop{value: 0.2 ether}(2e18, 50, 25);
        Vm.Log[] memory entries = vm.getRecordedLogs();
        uint256 paid;
        for (uint256 i; i < entries.length; ++i) {
            if (entries[i].emitter != address(account) || entries[i].topics[0] != keccak256("CoilFeePaid(address,uint256,uint256)")) continue;
            (uint256 gross, uint256 fee) = abi.decode(entries[i].data, (uint256,uint256));
            assertEq(fee, gross * 25 / 10000); paid += fee;
        }
        assertGt(paid, 0);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(recipient), quotedFee + paid);
        (q, quotedFee) = account.quoteLoopWithFee(0.2 ether, 2e18, 50);
        // Two borrowing rounds each round down independently.
        assertLe(quotedFee, q.musdMinted * 25 / 10000);
        assertApproxEqAbs(quotedFee, q.musdMinted * 25 / 10000, 1);
    }

    function test_wave2_ownerRepayCapsAtMinimumAndPreservesBalances() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.5e18, 50);
        uint256 debt = account.position().debt;
        deal(MezoAddresses.TESTNET_MUSD, user, debt);
        deal(MezoAddresses.TESTNET_MUSD, address(account), 17e18);
        uint256 feesBefore = IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient());
        vm.prank(user); IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), debt);
        vm.prank(user); uint256 paid = account.repayWithMUSD(debt);
        assertEq(account.position().debt, 2000e18);
        assertEq(paid, debt - 2000e18);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(user), 2000e18);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(address(account)), 17e18);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient()), feesBefore);
        vm.prank(user); assertEq(account.repayWithMUSD(1e18), 0);
        vm.prank(makeAddr("thief")); vm.expectRevert(CoilAccount.NotOwner.selector); account.repayWithMUSD(1e18);
        vm.prank(makeAddr("thief")); vm.expectRevert(CoilAccount.NotOwner.selector); account.closeWithMUSD(1e18);
        vm.prank(makeAddr("thief")); vm.expectRevert(CoilAccount.NotOwner.selector); account.addCollateral();
    }

    function test_wave2_claimReentrancyBlocked() public {
        ReenteringOwner receiver = new ReenteringOwner();
        vm.prank(address(receiver));
        CoilAccount account = CoilAccount(payable(factory.createAccount()));
        receiver.setAccount(account);
        ClaimFixture fixture = new ClaimFixture();
        vm.etch(MezoAddresses.TESTNET_BORROWER_OPERATIONS, address(fixture).code);
        vm.deal(MezoAddresses.TESTNET_BORROWER_OPERATIONS, 0.1 ether);
        vm.prank(address(receiver)); account.claimCollateral();
        assertTrue(receiver.attempted()); assertFalse(receiver.reentered());
        assertEq(address(receiver).balance, 0.1 ether);
    }

    function test_wave2_changedPathPrecompileBudgetMeasured() public {
        _etchFeed(spot, block.timestamp);
        (address user, CoilAccount account) = _openAccount();
        vm.startStateDiffRecording(); vm.prank(user); account.flashLoop{value: 0.2 ether}(1.5e18, 50, 25);
        _assertPrecompileTrace("flash open");
        vm.startStateDiffRecording(); vm.prank(user); account.flashLoop{value: 0.1 ether}(1.4e18, 50, 25);
        _assertPrecompileTrace("flash increase");
        vm.startStateDiffRecording(); vm.prank(user); account.addCollateral{value: 0.01 ether}();
        _assertPrecompileTrace("topup");
        deal(MezoAddresses.TESTNET_MUSD, user, account.position().debt);
        vm.prank(user); IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), type(uint256).max);
        vm.startStateDiffRecording(); vm.prank(user); account.repayWithMUSD(100e18);
        _assertPrecompileTrace("owner repay");
        vm.startStateDiffRecording(); vm.prank(user); account.closeWithMUSD(type(uint256).max);
        _assertPrecompileTrace("owner close");
        (user, account) = _openAccount();
        vm.startStateDiffRecording(); vm.prank(user); account.loop{value: 0.2 ether}(2e18, 50, 25);
        _assertPrecompileTrace("router open");
        deal(MezoAddresses.TESTNET_MUSD, user, 20e18);
        vm.startPrank(user);
        IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), 20e18);
        account.moveReserve(20e18, false);
        account.setGuard(2.2e18, 2.5e18, 0, 1e18);
        vm.stopPrank();
        _mintMezo(address(account), 2e18);
        uint256 fees = IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient());
        vm.startStateDiffRecording(); assertTrue(account.guard());
        _assertPrecompileTrace("reserve plus flash guard and tip");
        vm.startStateDiffRecording(); vm.prank(user); account.flashUnwind(1e18);
        _assertPrecompileTrace("flash close");
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient()), fees);
    }

    function _assertPrecompileTrace(string memory path) internal {
        Vm.AccountAccess[] memory calls = vm.stopAndReturnStateDiff();
        uint256 count; uint256 feeds;
        for (uint256 i; i < calls.length; ++i) {
            if (calls[i].kind != VmSafe.AccountAccessKind.Call && calls[i].kind != VmSafe.AccountAccessKind.StaticCall) continue;
            if (calls[i].account == MezoAddresses.TESTNET_PRICE_FEED) { count += 2; feeds++; }
            if (calls[i].account == MezoAddresses.BTC || calls[i].account == MezoAddresses.MEZO) {
                bytes4 sel = bytes4(calls[i].data);
                // deposit/withdraw only exist on the fork WBTC substitute, never on the native precompile.
                if (sel != bytes4(keccak256("deposit()")) && sel != bytes4(keccak256("withdraw(uint256)"))) count++;
            }
        }
        emit log_named_uint(path, count);
        if (keccak256(bytes(path)) != keccak256("surplus claim")) assertGt(feeds, 0, "trace must observe feed calls");
        assertLe(count, 20, path);
    }

    function test_wave2_callbackRejectsMissingActualBTC() public {
        (address user, CoilAccount account) = _openAccount();
        NoDeliveryPool fixture = new NoDeliveryPool(reserveMusd, reserveBtc);
        vm.etch(MezoAddresses.TESTNET_MUSD_BTC_POOL, address(fixture).code);
        vm.deal(address(account), 0.6 ether);
        uint256 fees = IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient());
        vm.prank(user); vm.expectRevert(CoilAccount.Slippage.selector);
        account.flashLoop{value: 0.2 ether}(1.5e18, 50);
        assertFalse(account.position().active);
        assertEq(address(account).balance, 0.6 ether);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient()), fees);
    }

    function test_wave2_callbackRejectsMissingActualMUSD() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.5e18, 50);
        vm.prank(user); account.setGuard(1.8e18, 2.2e18, 0, 5e18);
        deal(MezoAddresses.TESTNET_MUSD, address(account), 100_000e18);
        (uint256 rm, uint256 rb,) = IPoolView(MezoAddresses.TESTNET_MUSD_BTC_POOL).getReserves();
        NoDeliveryPool fixture = new NoDeliveryPool(rm, rb);
        vm.etch(MezoAddresses.TESTNET_MUSD_BTC_POOL, address(fixture).code);
        uint256 coll = account.position().collateral;
        vm.expectRevert(CoilAccount.Slippage.selector); account.guard();
        assertEq(account.position().collateral, coll);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(address(account)), 100_000e18);
    }

    function test_wave2_guardCallbackSandwichRollsBackReserveAndTip() public {
        (address user, CoilAccount account) = _flashOpen(0.02 ether, uint256(4e18)/3, 50);
        vm.prank(user); account.setGuard(1.5e18, 2.2e18, 0, 5e18);
        deal(MezoAddresses.TESTNET_MUSD, user, 10e18);
        vm.startPrank(user);
        IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), 10e18);
        account.moveReserve(10e18, false);
        vm.stopPrank();
        _mintMezo(address(account), 5e18);
        uint256 coll = account.position().collateral;
        uint256 debt = account.position().debt;
        (uint256 rm, uint256 rb,) = IPoolView(MezoAddresses.TESTNET_MUSD_BTC_POOL).getReserves();
        SaleAdversePool fixture = new SaleAdversePool(rm, rb);
        vm.etch(MezoAddresses.TESTNET_MUSD_BTC_POOL, address(fixture).code);
        _mockPrice(_oracleAbovePool(180));
        address caller = makeAddr("callback-sandwicher");
        vm.prank(caller); vm.expectRevert(CoilAccount.Slippage.selector); account.guard();
        assertEq(account.position().collateral, coll); assertEq(account.position().debt, debt);
        assertEq(account.park().assetsOf(address(account)), 10e18);
        assertEq(IERC20(MezoAddresses.MEZO).balanceOf(caller), 0);
        assertEq(IERC20(MezoAddresses.MEZO).balanceOf(address(account)), 5e18);
    }

    function test_wave2_realSurplusPoolClaimAndBudget() public {
        (address user, CoilAccount account) = _openAccount();
        (bool ok, bytes memory data) = MezoAddresses.TESTNET_BORROWER_OPERATIONS.staticcall(abi.encodeWithSignature("collSurplusPool()"));
        assertTrue(ok);
        address surplus = abi.decode(data, (address));
        // Protocol-equivalent post-redemption surplus bookkeeping on the fork.
        vm.prank(MezoAddresses.TESTNET_TROVE_MANAGER);
        (ok,) = surplus.call(abi.encodeWithSignature("accountSurplus(address,uint256)", address(account), 0.1 ether));
        assertTrue(ok);
        (ok, data) = MezoAddresses.TESTNET_BORROWER_OPERATIONS.staticcall(abi.encodeWithSignature("activePool()"));
        assertTrue(ok);
        address activePool = abi.decode(data, (address));
        vm.deal(activePool, activePool.balance + 0.1 ether);
        vm.prank(activePool); (ok,) = surplus.call{value: 0.1 ether}("");
        assertTrue(ok, "fund tracked surplus through ActivePool receive path");
        vm.deal(address(account), 0.02 ether);
        uint256 before = user.balance;
        vm.startStateDiffRecording(); vm.prank(user); assertEq(account.claimCollateral(), 0.1 ether);
        _assertPrecompileTrace("surplus claim");
        assertEq(user.balance - before, 0.1 ether);
        assertEq(address(account).balance, 0.02 ether);
        vm.prank(user); vm.expectRevert(); account.claimCollateral();
    }

    function test_wave2_activeFlashQuoteMatchesIncreaseIncludingRefinance() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.7e18, 50);
        CoilAccount.Position memory before = account.position();
        uint256 fees = IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient());
        (CoilAccount.LoopQuote memory q,,, uint256 quotedFee) = account.quoteFlashLoopWithFee(0.1 ether, 1.5e18, 50);
        assertGt(q.collateral, before.collateral + 0.1 ether, "quote must include existing collateral");
        assertGt(q.debt, before.debt, "quote must include existing debt");
        vm.prank(user); account.flashLoop{value: 0.1 ether}(1.5e18, 50, 25);
        assertEq(account.position().collateral, q.collateral);
        assertEq(account.position().debt, q.debt);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient()) - fees, quotedFee);
        assertEq(quotedFee, q.musdMinted * 25 / 10000);
        // Active-position zero-deposit leverage is also a supported quote.
        (q,,, quotedFee) = account.quoteFlashLoopWithFee(0, 1.4e18, 50);
        fees = IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient());
        vm.prank(user); account.flashLoop(1.4e18, 50, 25);
        assertEq(account.position().debt, q.debt);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient()) - fees, quotedFee);
        // Legacy quote keeps its documented fresh-position semantics.
        (CoilAccount.LoopQuote memory old,,) = account.quoteFlashLoop(0.1 ether, 1.5e18, 50);
        (CoilAccount.LoopQuote memory fresh,,) = implementation.quoteFlashLoop(0.1 ether, 1.5e18, 50);
        assertEq(old.debt, fresh.debt);
    }

    function test_wave2_activeRouterQuoteIncludesStartingPosition() public {
        (address user, CoilAccount account) = _open(0.15 ether, 2.2e18, 50);
        CoilAccount.Position memory before = account.position();
        (CoilAccount.LoopQuote memory q, uint256 quotedFee) = account.quoteLoopWithFee(0.1 ether, 2e18, 50);
        assertGt(q.collateral, before.collateral + 0.1 ether);
        assertGt(q.debt, before.debt);
        uint256 fees = IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient());
        vm.prank(user); account.loop{value: 0.1 ether}(2e18, 50, 25);
        // Router previews retain the conservative oracle-floor fill convention.
        assertGe(account.position().cr, q.cr);
        assertApproxEqRel(account.position().collateral, q.collateral, 0.02e18);
        assertApproxEqRel(account.position().debt, q.debt, 0.02e18);
        assertApproxEqRel(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient()) - fees, quotedFee, 0.03e18);
    }

    function test_wave2_actualCapsIncludeGasAndProtocolDebtAndRollbackFees() public {
        (address user, CoilAccount account) = _openAccount();
        (CoilAccount.LoopQuote memory q,,,) = account.quoteFlashLoopWithFee(0.2 ether, 1.5e18, 50);
        uint256 fees = IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient());
        factory.setPositionLimits(q.collateral, q.debt - 1);
        vm.prank(user); vm.expectRevert(CoilAccount.PositionLimit.selector); account.flashLoop{value: 0.2 ether}(1.5e18, 50, 25);
        factory.setPositionLimits(q.collateral - 1, q.debt);
        vm.prank(user); vm.expectRevert(CoilAccount.PositionLimit.selector); account.flashLoop{value: 0.2 ether}(1.5e18, 50, 25);
        factory.setPositionLimits(100 ether, 1);
        vm.prank(user); vm.expectRevert(CoilAccount.PositionLimit.selector); account.loop{value: 0.2 ether}(2e18, 50, 25);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(factory.feeRecipient()), fees);
        assertFalse(account.position().active);
        factory.setPositionLimits(q.collateral, q.debt);
        vm.prank(user); account.flashLoop{value: 0.2 ether}(1.5e18, 50, 25);
        assertEq(account.position().debt, q.debt);
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

    /// @dev The testnet pool can sit ~1.4% under the oracle. A keeper rescue
    ///      uses rescueSlippageBps (default 200, cap 300). Owner close does not
    ///      get stuck on that cap; see the close tests below.
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
        uint256 unchangedDebt = account.position().debt;
        vm.prank(stranger);
        assertFalse(account.guard());
        assertEq(account.position().debt, unchangedDebt);

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

    /// @dev 230 bps is inside the 300 bps rescue cap and outside the 200 bps default.
    ///      400 bps is past the cap, so `setRescueSlippage` cannot open a flash close.
    function test_closeWhenPoolIs230And400BpsOffOracle() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.5e18, 50);
        assertEq(account.rescueSlippageBps(), 200);
        _mockPrice(_oracleAbovePool(230));
        vm.prank(user);
        vm.expectRevert(CoilAccount.Slippage.selector);
        account.flashUnwind(1e18);
        vm.prank(user); account.setRescueSlippage(300);
        uint256 before = user.balance;
        vm.prank(user); account.flashUnwind(1e18);
        assertFalse(account.position().active);
        assertGt(user.balance, before);

        _mockPrice(spot);
        (address user2, CoilAccount second) = _flashOpen(0.2 ether, 1.5e18, 50);
        _mockPrice(_oracleAbovePool(400));
        vm.prank(user2);
        vm.expectRevert(CoilAccount.BadSlippage.selector);
        second.setRescueSlippage(400);
        vm.prank(user2);
        vm.expectRevert(CoilAccount.Slippage.selector);
        second.unwind(1e18);
        assertTrue(second.position().active);
        _mockPrice(spot);
    }

    function test_fullCloseSpendsReserveAndReturnsTheLeftover() public {
        (address user, CoilAccount account) = _flashOpen(0.2 ether, 1.5e18, 50);
        uint256 net = account.position().debt - 200e18;
        uint256 extra = 50.24e18;
        uint256 parkAmt = net + extra;
        deal(MezoAddresses.TESTNET_MUSD, user, parkAmt);
        vm.startPrank(user);
        IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), parkAmt);
        account.moveReserve(parkAmt, false);
        vm.stopPrank();
        assertEq(account.park().assetsOf(address(account)), parkAmt);

        uint256 coll = account.position().collateral;
        uint256 btcBefore = user.balance;
        _mockPrice(_oracleAbovePool(400));
        vm.prank(user);
        account.flashUnwind(1e18);
        assertFalse(account.position().active);
        assertEq(account.park().assetsOf(address(account)), 0);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(user), extra);
        assertEq(user.balance - btcBefore, coll);

        _mockPrice(spot);
        (address user2, CoilAccount small) = _flashOpen(0.2 ether, 1.5e18, 50);
        uint256 dust = 50.24e18;
        deal(MezoAddresses.TESTNET_MUSD, user2, dust);
        vm.startPrank(user2);
        IERC20(MezoAddresses.TESTNET_MUSD).approve(address(small), dust);
        small.moveReserve(dust, false);
        vm.stopPrank();
        _mockPrice(_oracleAbovePool(230));
        vm.prank(user2); small.setRescueSlippage(300);
        vm.prank(user2);
        small.unwind(1e18);
        assertFalse(small.position().active);
        assertEq(small.park().assetsOf(address(small)), 0);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(user2), 0);
        _mockPrice(spot);
    }

    function test_partialReserveGuardSkipsTheBtcSale() public {
        (address user, CoilAccount account) = _flashOpen(0.02 ether, uint256(4e18) / 3, 50);
        (address bareUser, CoilAccount bare) = _flashOpen(0.02 ether, uint256(4e18) / 3, 50);
        vm.prank(user);
        account.setGuard(1.5e18, 2.2e18, 0);
        vm.prank(bareUser);
        bare.setGuard(1.5e18, 2.2e18, 0);

        uint256 price = _oracleAbovePool(400);
        _mockPrice(price);
        uint256 coll = account.position().collateral;
        uint256 debt = account.position().debt;
        uint256 targetDebt = coll * price / 2.2e18;
        assertLt(targetDebt, debt);
        uint256 need = debt - targetDebt;
        uint256 net = debt - 200e18;
        uint256 room = net > 1800e18 ? net - 1800e18 : 0;
        if (need > room) need = room;
        uint256 half = need / 2;
        assertGt(half, 1e18);
        uint256 crBefore = account.position().cr;
        assertLt(crBefore, 1.5e18);

        deal(MezoAddresses.TESTNET_MUSD, user, half);
        vm.startPrank(user);
        IERC20(MezoAddresses.TESTNET_MUSD).approve(address(account), half);
        account.moveReserve(half, false);
        vm.stopPrank();

        vm.recordLogs();
        vm.prank(makeAddr("partial-only"));
        assertTrue(account.guard());
        CoilAccount.Position memory afterP = account.position();
        assertEq(afterP.collateral, coll);
        assertGt(afterP.cr, crBefore);
        assertLt(afterP.cr, 2.2e18);
        assertEq(account.park().assetsOf(address(account)), 0);
        assertLt(afterP.debt, debt);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 topic = keccak256("PartialRescue(uint256,uint256)");
        bool found;
        for (uint256 i; i < entries.length; ++i) {
            if (entries[i].emitter != address(account) || entries[i].topics[0] != topic) continue;
            (uint256 spent, uint256 crAfter) = abi.decode(entries[i].data, (uint256, uint256));
            assertEq(spent, half);
            assertEq(crAfter, afterP.cr);
            found = true;
        }
        assertTrue(found, "partial rescue");

        vm.prank(makeAddr("no-reserve"));
        assertFalse(bare.guard());
        _mockPrice(spot);
    }

    function test_pegOffBlocksOpenUntilTheOwnerRaisesTheCap() public {
        (address user, CoilAccount account) = _openAccount();
        _mockPrice(_oracleAbovePool(236));
        assertEq(account.maxPegDeviationBps(), 200);
        vm.prank(user);
        vm.expectRevert(CoilAccount.PegOff.selector);
        account.flashLoop{value: 0.2 ether}(1.5e18, 200);
        vm.prank(user);
        vm.expectRevert(CoilAccount.BadSlippage.selector);
        account.setPegBounds(501, 0);
        vm.prank(user);
        account.setPegBounds(500, 0);
        vm.prank(user);
        account.flashLoop{value: 0.2 ether}(1.5e18, 200);
        assertTrue(account.position().active);
        _mockPrice(spot);
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

    /// @notice One sandwich check. A pool moved outside the oracle bound reverts.
    ///         The same open against the unmoved pool passes. The attacker sells
    ///         with no floor. Coil does not.
    function test_sandwichOutsideOracleBoundReverts() public {
        (, CoilAccount opened) = _open(0.12 ether, 2e18, PriceMin.DEFAULT_SLIPPAGE_BPS);
        CoilAccount.Position memory within = opened.position();
        assertTrue(within.active);
        assertGe(within.cr, 2e18);
        assertEq(opened.slippageBps(), 50);

        uint256 snap = vm.snapshotState();

        address attacker = makeAddr("sandwicher");
        uint256 musdIn = reserveMusd / 20;
        assertGt(musdIn, 1_000e18);
        deal(MezoAddresses.TESTNET_MUSD, attacker, musdIn);
        IRouter.Route[] memory routes = new IRouter.Route[](1);
        routes[0] = IRouter.Route({
            from: MezoAddresses.TESTNET_MUSD,
            to: MezoAddresses.BTC,
            stable: false,
            factory: MezoAddresses.TESTNET_POOL_FACTORY
        });
        vm.startPrank(attacker);
        IERC20(MezoAddresses.TESTNET_MUSD).approve(MezoAddresses.TESTNET_ROUTER, musdIn);
        IRouter(MezoAddresses.TESTNET_ROUTER).swapExactTokensForTokens(musdIn, 0, routes, attacker, block.timestamp);
        vm.stopPrank();

        (uint256 musdNow, uint256 btcNow,) = IPoolView(MezoAddresses.TESTNET_MUSD_BTC_POOL).getReserves();
        uint256 moved = musdNow * 1e18 / btcNow;
        assertGt(moved, spot);
        uint256 gapBps = (moved - spot) * 10_000 / spot;
        assertGt(gapBps, 300, "pool was not pushed outside the cap");

        address victim = makeAddr("sandwich-victim");
        vm.deal(victim, 1 ether);
        vm.prank(victim);
        factory.createAccount();
        CoilAccount victimAcct = CoilAccount(payable(factory.accountOf(victim)));
        vm.prank(victim);
        vm.expectRevert();
        victimAcct.loop{value: 0.12 ether}(2e18, 300);
        assertFalse(victimAcct.position().active);
        assertEq(victim.balance, 1 ether);

        assertTrue(vm.revertToState(snap));
        (, CoilAccount again) = _open(0.12 ether, 2e18, PriceMin.DEFAULT_SLIPPAGE_BPS);
        assertTrue(again.position().active);
        assertGe(again.position().cr, 2e18);
    }

    /// @dev 60 seconds is still fresh (`<= MAX_PRICE_DELAY`). 61 seconds reverts
    ///      with the feed's own string. Coil does not catch it or keep a last price.
    function test_staleOracleRevertsOnLoop() public {
        (address user, CoilAccount account) = _openAccount();
        vm.deal(user, 1 ether);

        _etchFeed(spot, block.timestamp - 60);
        assertEq(IPriceFeed(MezoAddresses.TESTNET_PRICE_FEED).fetchPrice(), spot);

        _etchFeed(spot, block.timestamp - 61);
        vm.prank(user);
        vm.expectRevert(bytes("PriceFeed: Oracle is stale."));
        account.quoteLoop(0.2 ether, 2e18, 50);

        vm.prank(user);
        vm.expectRevert(bytes("PriceFeed: Oracle is stale."));
        account.loop{value: 0.2 ether}(2e18, 50);
        assertEq(user.balance, 1 ether);
        assertEq(
            uint256(ITroveManager(MezoAddresses.TESTNET_TROVE_MANAGER).getTroveStatus(address(account))),
            uint256(ITroveManager.Status.nonExistent)
        );

        vm.prank(user);
        vm.expectRevert(bytes("PriceFeed: Oracle is stale."));
        account.loop{value: 0.2 ether}(2e18, 50);
    }

    function test_zeroOracleDoesNotOpen() public {
        (address user, CoilAccount account) = _openAccount();
        vm.deal(user, 1 ether);
        _etchFeed(0, block.timestamp);
        vm.prank(user);
        vm.expectRevert(CoilAccount.OraclePriceZero.selector);
        account.loop{value: 0.2 ether}(2e18, 50);
        assertEq(user.balance, 1 ether);
        assertEq(
            uint256(ITroveManager(MezoAddresses.TESTNET_TROVE_MANAGER).getTroveStatus(address(account))),
            uint256(ITroveManager.Status.nonExistent)
        );
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

    /// @dev Oracle above the pool price by `bps`. Deviation is `bps` of the oracle.
    function _oracleAbovePool(uint256 bps) internal view returns (uint256) {
        return spot * 10_000 / (10_000 - bps);
    }

    /// @dev Replaces the feed code. Slot 0 is the price, slot 1 is `updatedAt`.
    ///      Clears the setUp mock so the etched `fetchPrice` actually runs.
    function _etchFeed(uint256 price, uint256 updatedAt) internal {
        vm.clearMockedCalls();
        MockStalePriceFeed logic = new MockStalePriceFeed();
        vm.etch(MezoAddresses.TESTNET_PRICE_FEED, address(logic).code);
        vm.store(MezoAddresses.TESTNET_PRICE_FEED, bytes32(uint256(0)), bytes32(price));
        vm.store(MezoAddresses.TESTNET_PRICE_FEED, bytes32(uint256(1)), bytes32(updatedAt));
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

contract ClaimFixture {
    function claimCollateral() external {
        uint256 amount = address(this).balance;
        require(amount > 0, "no surplus");
        (bool ok,) = msg.sender.call{value: amount}(""); require(ok);
    }
}

contract AdversePool {
    uint256 immutable rm;
    uint256 immutable rb;
    // Use a separate slot from the deployed pool's existing storage.
    constructor(uint256 m, uint256 b) { rm = m; rb = b; }
    function token0() external pure returns(address) { return MezoAddresses.TESTNET_MUSD; }
    function stable() external pure returns(bool) { return false; }
    function getReserves() external view returns(uint256, uint256, uint256) {
        uint256 moved; assembly { moved := sload(10000) }
        return (moved == 0 ? rm : rm * 1003 / 1000, rb, 0);
    }
    function swap(uint256 a0, uint256 a1, address to, bytes calldata data) external {
        IERC20(MezoAddresses.BTC).transfer(to, a1);
        assembly { sstore(10000, 1) }
        CoilAccount(payable(to)).hook(msg.sender, a0, a1, data);
    }
}

contract ReenteringOwner {
    CoilAccount account;
    bool public attempted;
    bool public reentered;
    function setAccount(CoilAccount next) external { account = next; }
    receive() external payable {
        attempted = true;
        (reentered,) = address(account).call(abi.encodeWithSignature("claimCollateral()"));
    }
}

contract NoDeliveryPool {
    uint256 immutable rm;
    uint256 immutable rb;
    constructor(uint256 m, uint256 b) { rm = m; rb = b; }
    function token0() external pure returns(address) { return MezoAddresses.TESTNET_MUSD; }
    function stable() external pure returns(bool) { return false; }
    function getReserves() external view returns(uint256, uint256, uint256) { return (rm, rb, 0); }
    function swap(uint256 a0, uint256 a1, address to, bytes calldata data) external {
        CoilAccount(payable(to)).hook(msg.sender, a0, a1, data);
    }
}

contract SaleAdversePool {
    uint256 immutable rm;
    uint256 immutable rb;
    constructor(uint256 m, uint256 b) { rm = m; rb = b; }
    function token0() external pure returns(address) { return MezoAddresses.TESTNET_MUSD; }
    function stable() external pure returns(bool) { return false; }
    function getReserves() external view returns(uint256, uint256, uint256) {
        uint256 moved; assembly { moved := sload(10000) }
        return (rm, moved == 0 ? rb : rb * 1003 / 1000, 0);
    }
    function swap(uint256 a0, uint256 a1, address to, bytes calldata data) external {
        IERC20(MezoAddresses.TESTNET_MUSD).transfer(to, a0);
        assembly { sstore(10000, 1) }
        CoilAccount(payable(to)).hook(msg.sender, a0, a1, data);
    }
}
