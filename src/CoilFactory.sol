// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ICoilFactory} from "./ICoilFactory.sol";
import {CoilAccount} from "./CoilAccount.sol";
import {Clones} from "./libraries/Clones.sol";

/// @notice Deploys one minimal proxy per user. The clone owns that user's MUSD trove.
contract CoilFactory {
    address public immutable implementation;
    address public owner;
    address public keeper;
    uint16 public coilFeeBps = 25;
    address public feeRecipient;
    bool public opensPaused = true;
    uint256 public maxCollateral;
    uint256 public maxDebt;
    address public guardian;

    event PolicyUpdated(uint16 feeBps, address recipient, bool paused, uint256 collateralLimit, uint256 debtLimit);
    event GuardianUpdated(address indexed guardian);
    error BadPolicy();

    modifier onlyOwner() { if (msg.sender != owner) revert Ownable(); _; }

    function policy() external view returns (ICoilFactory.Policy memory) {
        return ICoilFactory.Policy(coilFeeBps, feeRecipient, opensPaused, maxCollateral, maxDebt);
    }
    function setCoilFee(uint16 bps) external onlyOwner {
        if (bps == 0 || bps > 50) revert BadPolicy();
        coilFeeBps = bps; _emitPolicy();
    }
    function setFeeRecipient(address recipient) external onlyOwner {
        if (recipient == address(0)) revert ZeroAddress();
        feeRecipient = recipient; _emitPolicy();
    }
    function setPositionLimits(uint256 collateral, uint256 debt) external onlyOwner {
        if (collateral == 0 || debt == 0 || collateral == type(uint256).max || debt == type(uint256).max) revert BadPolicy();
        maxCollateral = collateral; maxDebt = debt; _emitPolicy();
    }
    function setGuardian(address next) external onlyOwner { guardian = next; emit GuardianUpdated(next); }
    function pauseOpens() external {
        if (msg.sender != owner && msg.sender != guardian) revert Ownable();
        opensPaused = true; _emitPolicy();
    }
    function unpauseOpens() external onlyOwner {
        if (maxCollateral == 0 || maxDebt == 0) revert BadPolicy();
        opensPaused = false; _emitPolicy();
    }
    function _emitPolicy() private {
        emit PolicyUpdated(coilFeeBps, feeRecipient, opensPaused, maxCollateral, maxDebt);
    }

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
        feeRecipient = _owner;
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
        if (msg.sender != keeper || keeper == address(0)) revert Ownable();
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
