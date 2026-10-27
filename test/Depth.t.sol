// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FlashSizer} from "../src/libraries/FlashMath.sol";
import {CoilLegacy} from "../src/libraries/CoilLegacy.sol";

/// @notice Pool-depth math with mainnet-sized reserves. No fork and no deploy.
contract DepthTest is Test {
    FlashSizer internal sizer;

    function setUp() public {
        sizer = new FlashSizer();
    }

    function test_impactGrowsWhenThePoolIsThin() public {
        uint256 deep = sizer.impactBps(100_000_000e18, 1_300e18, 2_000e18, 4);
        uint256 thin = sizer.impactBps(59_603e18, 0.738e18, 2_000e18, 30);
        assertLt(deep, 20);
        assertGt(thin, 100);
        assertGt(thin, deep);
    }

    function test_sensibleTargetRefusesFourTimesOnMainnetDepth() public {
        FlashSizer.Ctx memory c = _ctx(0.05 ether, 59_603e18, 0.738 ether, 30);
        c.targetCR = uint256(4e18) / 3;
        (, uint256 owed4,, bool fits4) = sizer.solve(c);
        assertTrue(fits4);
        uint256 impact4 = sizer.impactBps(c.reserveMusd, c.reserveBtc, owed4, c.fee);
        assertGt(impact4, 100);
        (uint256 target, uint256 impact, uint256 leverage, bool capped) = sizer.sensibleTarget(c, 100);
        // Published mainnet depth: no rung stays under 1% impact.
        assertFalse(capped);
        assertGt(impact, 100);
        assertLe(impact, impact4);
        assertGt(leverage, 0);

        // Deeper book: 4× is still too thick, a lower rung is not.
        c = _ctx(0.05 ether, 600_000e18, 7.5 ether, 30);
        c.targetCR = uint256(4e18) / 3;
        (, owed4,, fits4) = sizer.solve(c);
        assertTrue(fits4);
        assertGt(sizer.impactBps(c.reserveMusd, c.reserveBtc, owed4, c.fee), 100);
        (target, impact, leverage, capped) = sizer.sensibleTarget(c, 100);
        assertTrue(capped);
        assertLe(impact, 100);
        assertGt(target, uint256(4e18) / 3);
        assertLt(leverage, 4e18);
    }

    function _ctx(uint256 deposit, uint256 musd, uint256 btc, uint256 fee) internal pure returns (FlashSizer.Ctx memory c) {
        c.deposit = deposit;
        c.price = 80_125.75e18;
        c.fee = fee;
        c.reserveMusd = musd;
        c.reserveBtc = btc;
        c.rate = 0.001e18;
        c.minAmt = 1_800e18;
        c.gasComp = 200e18;
        c.mcr = 1.1e18;
        c.openHeadroom = 0.005e18;
    }

    function test_deviationAndPegDirections() public pure {
        uint256 oracle = 80_125e18;
        uint256 btc = 0.738 ether;
        uint256 richMusd = 80_745e18 * 738 / 1000;
        uint256 below = CoilLegacy.musdBelowPegBps(richMusd, btc, oracle);
        uint256 gap = CoilLegacy.deviationBps(richMusd, btc, oracle);
        assertGt(below, 50);
        assertLt(below, 150);
        assertGt(gap, 50);
        uint256 cheapPool = oracle * btc / 1e18;
        assertEq(CoilLegacy.musdBelowPegBps(cheapPool, btc, oracle), 0);
    }
}
