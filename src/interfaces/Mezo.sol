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
}
