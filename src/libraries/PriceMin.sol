// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title PriceMin
/// @notice Oracle floors for swaps. `amountOutMin` is this value, never a pool quote.
/// @dev Matsnet `PriceFeed.fetchPrice()` is 18-decimal USD per 1 BTC
///      (`TARGET_DIGITS = 18` in musd `PriceFeed.sol`). Mezo BTC and MUSD are
///      18-decimal tokens, so the live pair does not rescale. The helpers still
///      take decimals so a 6 or 8 decimal token cannot silently reuse that formula.
///
///      A zero price reverts. This library does not read the feed and does not
///      catch errors. A stale feed reverts inside `fetchPrice` with
///      "PriceFeed: Oracle is stale." Callers must let that revert stand.
library PriceMin {
    uint256 internal constant BPS = 10_000;
    /// @notice Decimals on `fetchPrice()`. Not 8.
    uint8 internal constant PRICE_DECIMALS = 18;
    /// @notice Mezo BTC. The live swap path passes this.
    uint8 internal constant BTC_DECIMALS = 18;
    /// @notice Mezo MUSD. The live swap path passes this.
    uint8 internal constant MUSD_DECIMALS = 18;

    /// @notice Default bound for an open. 50 bps is 0.50% under the oracle.
    /// @dev The testnet MUSD/BTC pool fee is 4 bps, and the book holds well over
    ///      1,000 BTC, so half a percent covers the fee and a little lag.
    ///      A 100 bps default would give a sandwich more room. Rescue sales use
    ///      a separate owner-set bound (default 200 bps, hard cap 300) because
    ///      that pool has sat about 140 bps under the oracle.
    uint16 internal constant DEFAULT_SLIPPAGE_BPS = 50;

    error OraclePriceZero();
    error BadSlippage();
    error BadDecimals();

    /// @notice Minimum $1-stable out for selling `amountIn` of the priced asset.
    /// @dev 18-decimal BTC into 18-decimal MUSD:
    ///      `amountIn * price / 1e18 * (10_000 - slippageBps) / 10_000`.
    ///      `price` is 18-decimal USD per 1 whole asset.
    function stableOutMin(
        uint256 amountIn,
        uint8 assetDecimals,
        uint256 price,
        uint8 stableDecimals,
        uint256 slippageBps
    ) internal pure returns (uint256) {
        if (amountIn == 0) return 0;
        _check(price, slippageBps, assetDecimals, stableDecimals);
        uint256 num = amountIn * price * (BPS - slippageBps) * _pow10(stableDecimals);
        uint256 den = _pow10(assetDecimals) * _pow10(PRICE_DECIMALS) * BPS;
        return num / den;
    }

    /// @notice Minimum priced-asset out for spending a $1 stable.
    /// @dev 18-decimal MUSD into 18-decimal BTC:
    ///      `stableIn * 1e18 / price * (10_000 - slippageBps) / 10_000`.
    function tokenOutMin(
        uint256 stableIn,
        uint8 stableDecimals,
        uint256 price,
        uint8 assetDecimals,
        uint256 slippageBps
    ) internal pure returns (uint256) {
        if (stableIn == 0) return 0;
        _check(price, slippageBps, stableDecimals, assetDecimals);
        uint256 num = stableIn * _pow10(PRICE_DECIMALS) * _pow10(assetDecimals) * (BPS - slippageBps);
        uint256 den = price * _pow10(stableDecimals) * BPS;
        return num / den;
    }

    function _check(uint256 price, uint256 slippageBps, uint8 leftDecimals, uint8 rightDecimals) private pure {
        if (price == 0) revert OraclePriceZero();
        if (slippageBps >= BPS) revert BadSlippage();
        if (leftDecimals > 18 || rightDecimals > 18) revert BadDecimals();
    }

    function _pow10(uint8 decimals) private pure returns (uint256 scale) {
        scale = 1;
        for (uint8 i; i < decimals; ++i) {
            scale *= 10;
        }
    }
}
