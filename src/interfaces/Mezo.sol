// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev Subset of mezo-org/musd BorrowerOperations used by Coil.
///      openTrove takes the MUSD the borrower receives. The protocol adds the
///      borrowing fee and the 200 MUSD gas compensation on top.
interface IBorrowerOperations {
    function openTrove(uint256 _debtAmount, address _upperHint, address _lowerHint) external payable;

    function addColl(address _upperHint, address _lowerHint) external payable;

    function withdrawColl(uint256 _amount, address _upperHint, address _lowerHint) external;

    function withdrawMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;

    function repayMUSD(uint256 _amount, address _upperHint, address _lowerHint) external;

    function closeTrove() external;

    /// @notice Trove owner surplus claim on musd BorrowerOperations.
    ///         Selector `0x6f0b0c1c`. Coil does not call this yet.
    function claimCollateral() external;

    function refinance(address _upperHint, address _lowerHint) external;

    function minNetDebt() external view returns (uint256);

    function borrowingRate() external view returns (uint256);

    function refinancingFeePercentage() external view returns (uint8);

    function getBorrowingFee(uint256 _debt) external view returns (uint256);
}

interface ITroveManager {
    enum Status {
        nonExistent,
        active,
        closedByOwner,
        closedByLiquidation,
        closedByRedemption
    }

    function getTroveStatus(address _borrower) external view returns (Status);

    function getTroveDebt(address _borrower) external view returns (uint256);

    function getTroveColl(address _borrower) external view returns (uint256);

    function getTrovePrincipal(address _borrower) external view returns (uint256);

    function getCurrentICR(address _borrower, uint256 _price) external view returns (uint256);

    function getTroveMaxBorrowingCapacity(address _borrower) external view returns (uint256);

    function getNominalICR(address _borrower) external view returns (uint256);

    function checkRecoveryMode(uint256 _price) external view returns (bool);
}

interface ISortedTroves {
    function getLast() external view returns (address);

    function getPrev(address _id) external view returns (address);

    function findInsertPosition(uint256 _NICR, address _prevId, address _nextId)
        external
        view
        returns (address, address);
}

interface IHintHelpers {
    function getApproxHint(uint256 _CR, uint256 _numTrials, uint256 _inputRandomSeed)
        external
        view
        returns (address hintAddress, uint256 diff, uint256 latestRandomSeed);
}

/// @dev musd PriceFeed. `fetchPrice` is `view` and returns 18-decimal USD per 1 BTC.
///      A price older than 60 seconds reverts "PriceFeed: Oracle is stale."
///      There is no last-good price. A zero answer is not rejected here.
interface IPriceFeed {
    function fetchPrice() external view returns (uint256);
}

/// @dev Mezo Pools router (mezo-org/tigris). There is no native-BTC swap entrypoint.
interface IRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    function getAmountsOut(uint256 amountIn, Route[] calldata routes) external view returns (uint256[] memory amounts);

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function defaultFactory() external view returns (address);
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev Mezo Pools volatile pair. `swap` with nonempty `data` calls `IPoolCallee.hook`
///      on `to` before checking the constant product. Testnet MUSD/BTC is token0/token1.
interface IPool {
    function token0() external view returns (address);

    function token1() external view returns (address);

    function stable() external view returns (bool);

    function getReserves() external view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast);

    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256);

    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @dev Callback name on mezo-org/tigris Pool. `sender` is the address that called `swap`.
interface IPoolCallee {
    function hook(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}

interface IPoolFactory {
    function getFee(address pool, bool stable) external view returns (uint256);

    function isPaused() external view returns (bool);
}
