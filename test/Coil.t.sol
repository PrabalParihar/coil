// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CoilAccount} from "../src/CoilAccount.sol";
import {CoilFactory} from "../src/CoilFactory.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";
import {IBorrowerOperations, ITroveManager, IPriceFeed, IRouter} from "../src/interfaces/Mezo.sol";

interface IPoolView {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint256, uint256, uint256);
    function stable() external view returns (bool);
}

/// @dev Stand-in for the Mezo BTC precompile. Anvil cannot execute 0x7b7c…0000,
///      so fork tests etch this code in its place and seed the pool's balance.
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

        implementation = new CoilAccount(
            MezoAddresses.TESTNET_BORROWER_OPERATIONS,
            MezoAddresses.TESTNET_TROVE_MANAGER,
            MezoAddresses.TESTNET_SORTED_TROVES,
            MezoAddresses.TESTNET_HINT_HELPERS,
            MezoAddresses.TESTNET_PRICE_FEED,
            MezoAddresses.TESTNET_MUSD,
            MezoAddresses.BTC,
            MezoAddresses.TESTNET_ROUTER,
            MezoAddresses.TESTNET_POOL_FACTORY
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
}
