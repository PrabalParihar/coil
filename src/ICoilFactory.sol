// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface ICoilFactory {
    function keeper() external view returns (address);

    function accountOf(address owner) external view returns (address);
}
