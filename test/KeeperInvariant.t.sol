// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CoilAccount} from "../src/CoilAccount.sol";
import {CoilFactory} from "../src/CoilFactory.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";
import {IPriceFeed, IERC20} from "../src/interfaces/Mezo.sol";

interface IPoolReserves {
    function getReserves() external view returns (uint256, uint256, uint256);
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

/// @dev Calls that are not the owner. A price drop is applied before the call so
///      the before/after collateral ratio uses the same oracle.
contract KeeperHandler is Test {
    CoilAccount public account;
    address public stranger;
    address public keeper;
    uint256 public spot;
    uint256 public fundedTips;
    uint256 public minCr;

    constructor(CoilAccount _account, address _stranger, address _keeper, uint256 _spot, uint256 _tips) {
        account = _account;
        stranger = _stranger;
        keeper = _keeper;
        spot = _spot;
        fundedTips = _tips;
        minCr = _account.position().cr;
    }

    function guard(uint256 seed) external {
        _maybeDrop(seed);
        address caller = _caller(seed);
        uint256 crBefore = _cr();
        vm.prank(caller);
        try account.guard() {} catch {}
        _after(caller, crBefore);
    }

    function delever(uint256 seed) external {
        _maybeDrop(seed);
        address caller = _caller(seed);
        uint256 target = 1.2e18 + (seed % 160) * 1e16;
        uint256 crBefore = _cr();
        vm.prank(caller);
        try account.deleverTo(target) {} catch {}
        try account.flashDeleverTo(target) {} catch {}
        _after(caller, crBefore);
    }

    function tryForbidden(uint256 seed) external {
        address caller = _caller(seed);
        uint256 crBefore = _cr();
        vm.prank(caller);
        if (seed % 5 == 0) {
            try account.unwind(1e18) {} catch {}
        } else if (seed % 5 == 1) {
            try account.flashUnwind(0.5e18) {} catch {}
        } else if (seed % 5 == 2) {
            try account.flashLoop(1.5e18, 50) {} catch {}
        } else if (seed % 5 == 3) {
            try account.sweep() {} catch {}
        } else {
            try account.withdrawTips(1) {} catch {}
        }
        _after(caller, crBefore);
    }

    function assertBooks() external view {
        assertEq(stranger.balance, 0);
        assertEq(keeper.balance, 0);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(stranger), 0);
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(keeper), 0);
        uint256 mezoLeft = IERC20(MezoAddresses.MEZO).balanceOf(address(account))
            + IERC20(MezoAddresses.MEZO).balanceOf(stranger) + IERC20(MezoAddresses.MEZO).balanceOf(keeper);
        assertEq(mezoLeft, fundedTips);
        if (account.position().active) assertGe(account.position().cr, minCr);
    }

    function _caller(uint256 seed) internal view returns (address) {
        return seed % 2 == 0 ? stranger : keeper;
    }

    function _after(address caller, uint256 crBefore) internal {
        if (account.position().active) {
            uint256 crNow = _cr();
            assertGe(crNow, crBefore);
        }
        assertEq(IERC20(MezoAddresses.TESTNET_MUSD).balanceOf(caller), 0);
        assertEq(caller.balance, 0);
    }

    function _maybeDrop(uint256 seed) internal {
        uint256 price = seed % 3 == 0 ? spot * 75 / 100 : spot;
        vm.mockCall(
            MezoAddresses.TESTNET_PRICE_FEED,
            abi.encodeWithSelector(IPriceFeed.fetchPrice.selector),
            abi.encode(price)
        );
        if (account.position().active) {
            uint256 crNow = account.position().cr;
            if (crNow < minCr) minCr = crNow;
        }
    }

    function _cr() internal view returns (uint256) {
        if (!account.position().active) return type(uint256).max;
        return account.position().cr;
    }
}

/// forge-config: default.invariant.runs = 6
/// forge-config: default.invariant.depth = 4
/// forge-config: default.invariant.fail_on_revert = true
contract KeeperInvariantTest is Test {
    KeeperHandler internal handler;

    function setUp() public {
        vm.createSelectFork(vm.envOr("MEZO_TESTNET_RPC", string("https://rpc.test.mezo.org")));
        (uint256 reserveMusd, uint256 reserveBtc,) = IPoolReserves(MezoAddresses.TESTNET_MUSD_BTC_POOL).getReserves();
        uint256 spot = reserveMusd * 1e18 / reserveBtc;
        vm.mockCall(
            MezoAddresses.TESTNET_PRICE_FEED, abi.encodeWithSelector(IPriceFeed.fetchPrice.selector), abi.encode(spot)
        );
        MockWbtc mirror = new MockWbtc();
        vm.etch(MezoAddresses.BTC, address(mirror).code);
        deal(MezoAddresses.BTC, MezoAddresses.TESTNET_MUSD_BTC_POOL, reserveBtc);
        vm.deal(MezoAddresses.BTC, 5_000 ether);
        MockWbtc mezo = new MockWbtc();
        vm.etch(MezoAddresses.MEZO, address(mezo).code);

        CoilAccount implementation = new CoilAccount(
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
        CoilFactory factory = new CoilFactory(address(implementation), address(this));
        address user = makeAddr("invariant-owner");
        vm.deal(user, 2 ether);
        vm.prank(user);
        factory.createAccount();
        CoilAccount account = CoilAccount(payable(factory.accountOf(user)));
        vm.prank(user);
        account.flashLoop{value: 0.2 ether}(1.7e18, 80);

        uint256 tips = 30e18;
        deal(MezoAddresses.MEZO, user, tips);
        vm.startPrank(user);
        IERC20(MezoAddresses.MEZO).approve(address(account), tips);
        account.fundTips(tips);
        account.setGuard(1.45e18, 2.1e18, 4, 5e18);
        vm.stopPrank();

        address stranger = makeAddr("invariant-stranger");
        address keeper = makeAddr("invariant-keeper");
        factory.setKeeper(keeper);

        handler = new KeeperHandler(account, stranger, keeper, spot, tips);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](3);
        selectors[0] = KeeperHandler.guard.selector;
        selectors[1] = KeeperHandler.delever.selector;
        selectors[2] = KeeperHandler.tryForbidden.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_keeperOnlyReducesRisk() public view {
        handler.assertBooks();
    }
}
