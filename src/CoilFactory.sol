// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {CoilAccount} from "./CoilAccount.sol";
import {Clones} from "./libraries/Clones.sol";

/// @notice Deploys one minimal proxy per user. The clone owns that user's MUSD trove.
contract CoilFactory {
    address public immutable implementation;
    address public owner;
    address public keeper;

    mapping(address => address) public accountOf;
    address[] public accounts;

    event AccountCreated(address indexed owner, address indexed account);
    event KeeperUpdated(address indexed keeper);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Heartbeat(address indexed keeper, uint256 timestamp);

    error Ownable();
    error AccountExists();
    error ZeroAddress();

    constructor(address _implementation, address _owner) {
        if (_implementation == address(0) || _owner == address(0)) revert ZeroAddress();
        implementation = _implementation;
        owner = _owner;
    }

    function createAccount() external returns (address account) {
        if (accountOf[msg.sender] != address(0)) revert AccountExists();
        account = Clones.clone(implementation);
        CoilAccount(payable(account)).initialize(msg.sender);
        accountOf[msg.sender] = account;
        accounts.push(account);
        emit AccountCreated(msg.sender, account);
    }

    function accountsLength() external view returns (uint256) {
        return accounts.length;
    }

    /// @notice Keeper pulse. The guard log reads the latest event as a heartbeat.
    function heartbeat() external {
        emit Heartbeat(msg.sender, block.timestamp);
    }

    function setKeeper(address _keeper) external {
        if (msg.sender != owner) revert Ownable();
        keeper = _keeper;
        emit KeeperUpdated(_keeper);
    }

    function transferOwnership(address next) external {
        if (msg.sender != owner) revert Ownable();
        if (next == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, next);
        owner = next;
    }
}
