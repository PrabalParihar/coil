// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ICoilFactory {
    struct Policy {
        uint16 feeBps;
        address feeRecipient;
        bool opensPaused;
        uint256 maxCollateral;
        uint256 maxDebt;
    }
    function policy() external view returns (Policy memory);

    function keeper() external view returns (address);

    function accountOf(address owner) external view returns (address);
}
