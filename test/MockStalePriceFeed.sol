// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Test double for musd `PriceFeed.fetchPrice` staleness.
/// @dev `MAX_PRICE_DELAY` is 60 seconds. The check matches the upstream require:
///      a price older than 60 seconds reverts "PriceFeed: Oracle is stale."
///      There is no last-good price. Storage is `price` at slot 0 and
///      `updatedAt` at slot 1 so fork tests can etch this code onto the feed.
contract MockStalePriceFeed {
    uint256 public constant MAX_PRICE_DELAY = 60;
    uint256 public price;
    uint256 public updatedAt;

    function set(uint256 price_, uint256 updatedAt_) external {
        price = price_;
        updatedAt = updatedAt_;
    }

    function fetchPrice() external view returns (uint256) {
        require(block.timestamp - updatedAt <= MAX_PRICE_DELAY, "PriceFeed: Oracle is stale.");
        return price;
    }
}
