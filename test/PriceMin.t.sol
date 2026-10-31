// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {PriceMin} from "../src/libraries/PriceMin.sol";
import {IBorrowerOperations} from "../src/interfaces/Mezo.sol";
import {MockStalePriceFeed} from "./MockStalePriceFeed.sol";

/// @notice Decimal math, the 60 second stale boundary, and the claim selector.
///         No fork. The live pair is 18-decimal BTC and 18-decimal MUSD.
///         The 6 and 8 decimal cases lock the scaler. Coil does not swap those tokens.
contract PriceMinTest is Test {
    /// @dev Preflight sample from matsnet block 16482230. 18-decimal USD per 1 BTC.
    uint256 internal constant SAMPLE = 77_311.89259e18;

    function test_btc18ToMusd18UsesEighteenDecimalPrice() public pure {
        assertEq(PriceMin.PRICE_DECIMALS, 18);
        assertEq(PriceMin.BTC_DECIMALS, 18);
        assertEq(PriceMin.MUSD_DECIMALS, 18);
        assertEq(PriceMin.DEFAULT_SLIPPAGE_BPS, 50);

        // Whole dollars are raw / 1e18. Dividing by 1e8 is the 8-decimal misread.
        assertEq(SAMPLE, 77311892590000000000000);
        assertEq(SAMPLE / 1e18, 77_311);
        assertEq(SAMPLE % 1e18, 0.89259e18);
        assertTrue(SAMPLE / 1e8 != 77_311);

        uint256 oneBtc = 1e18;
        uint256 fair = PriceMin.stableOutMin(oneBtc, 18, SAMPLE, 18, 0);
        assertEq(fair, SAMPLE);

        uint256 minOut = PriceMin.stableOutMin(oneBtc, 18, SAMPLE, 18, 50);
        assertEq(minOut, SAMPLE * 9_950 / 10_000);
        assertGt(minOut, 0);

        uint256 back = PriceMin.tokenOutMin(SAMPLE, 18, SAMPLE, 18, 50);
        assertEq(back, oneBtc * 9_950 / 10_000);
    }

    function test_eightDecimalAssetScalesIntoEighteenDecimalMusd() public pure {
        uint256 one = 1e8;
        assertEq(PriceMin.stableOutMin(one, 8, SAMPLE, 18, 0), SAMPLE);
        assertEq(PriceMin.stableOutMin(one, 8, SAMPLE, 18, 50), SAMPLE * 9_950 / 10_000);
        // Spending the 18-decimal USD notional buys 1.00000000 of an 8-decimal asset.
        assertEq(PriceMin.tokenOutMin(SAMPLE, 18, SAMPLE, 8, 0), one);
    }

    function test_sixDecimalStableScalesBothWays() public pure {
        uint256 price = 50_000e18;
        // 1 whole BTC (18) into a 6-decimal stable, no slippage.
        assertEq(PriceMin.stableOutMin(1e18, 18, price, 6, 0), 50_000e6);
        // 1,000.000000 of a 6-decimal $1 token buys 0.02 BTC at $50,000.
        assertEq(PriceMin.tokenOutMin(1_000e6, 6, price, 18, 0), 0.02e18);
        assertEq(PriceMin.tokenOutMin(1_000e6, 6, price, 18, 50), 0.02e18 * 9_950 / 10_000);
    }

    function test_zeroPriceReverts() public {
        vm.expectRevert(PriceMin.OraclePriceZero.selector);
        this.stableFloor(1e18, 0, 50);
        vm.expectRevert(PriceMin.OraclePriceZero.selector);
        this.tokenFloor(1e18, 0, 50);
    }

    function stableFloor(uint256 amount, uint256 price, uint256 slip) external pure returns (uint256) {
        return PriceMin.stableOutMin(amount, 18, price, 18, slip);
    }

    function tokenFloor(uint256 amount, uint256 price, uint256 slip) external pure returns (uint256) {
        return PriceMin.tokenOutMin(amount, 18, price, 18, slip);
    }

    /// @dev A 1-wei sale at a 1-wei price rounds to a zero floor. Callers must revert,
    ///      not pass that zero to the router.
    function test_roundedZeroIsNotAUsableFloor() public pure {
        assertEq(PriceMin.stableOutMin(1, 18, 1, 18, 9_999), 0);
        assertEq(PriceMin.stableOutMin(0, 18, SAMPLE, 18, 50), 0);
    }

    function test_sixtySecondsIsFreshAndSixtyOneReverts() public {
        MockStalePriceFeed feed = new MockStalePriceFeed();
        assertEq(feed.MAX_PRICE_DELAY(), 60);
        feed.set(SAMPLE, block.timestamp);

        vm.warp(block.timestamp + 60);
        assertEq(feed.fetchPrice(), SAMPLE);
        uint256 minOut = this.readMin(feed, 1e18, 50);
        assertEq(minOut, SAMPLE * 9_950 / 10_000);

        vm.warp(block.timestamp + 1);
        vm.expectRevert(bytes("PriceFeed: Oracle is stale."));
        feed.fetchPrice();

        // The reader does not catch the revert and does not return a zero minimum.
        vm.expectRevert(bytes("PriceFeed: Oracle is stale."));
        this.readMin(feed, 1e18, 50);
    }

    function test_claimCollateralSelector() public pure {
        assertEq(IBorrowerOperations.claimCollateral.selector, bytes4(hex"6f0b0c1c"));
    }

    /// @dev Same shape as Coil: read the feed, then scale. No try/catch.
    function readMin(MockStalePriceFeed feed, uint256 btcIn, uint256 slip) external view returns (uint256 minOut) {
        uint256 price = feed.fetchPrice();
        minOut = PriceMin.stableOutMin(btcIn, 18, price, 18, slip);
        require(minOut != 0, "zero min");
    }
}
