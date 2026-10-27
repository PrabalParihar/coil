// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {FlashSizer} from "../src/libraries/FlashMath.sol";

contract FlashMathTest is Test {
    FlashSizer internal sizer;

    function setUp() public {
        sizer = new FlashSizer();
    }

    /// forge-config: default.fuzz.runs = 128
    function testFuzz_amountInCoversConstantProduct(uint128 reserveIn, uint128 reserveOut, uint128 amountOut, uint16 fee)
        public
        view
    {
        // Mezo's MUSD/BTC book: tens of millions of MUSD against hundreds of BTC.
        // amountOut stays under 2% of the reserve so the +8 wei walk is enough.
        reserveIn = uint128(bound(reserveIn, 1e22, 1e26));
        reserveOut = uint128(bound(reserveOut, 100e18, 5_000e18));
        amountOut = uint128(bound(amountOut, 1e15, reserveOut / 50));
        fee = uint16(bound(fee, 1, 30));

        uint256 paid = sizer.amountIn(reserveIn, reserveOut, amountOut, fee);
        assertGt(paid, 0);
        uint256 kept = paid - paid * fee / 10_000;
        uint256 outLeft = uint256(reserveOut) - amountOut;
        assertGe((uint256(reserveIn) + kept) * outLeft, uint256(reserveIn) * reserveOut);
    }

    function test_zeroOutReturnsZero() public view {
        assertEq(sizer.amountIn(1e24, 1e21, 0, 4), 0);
    }
}
