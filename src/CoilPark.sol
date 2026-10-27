// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "./interfaces/Mezo.sol";

/// @dev ERC-4626 slice. Used when a MUSD savings vault (sMUSD) is configured.
///      Assets in, shares out. `withdraw` sends assets to `receiver`.
interface ISavingsVault {
    function asset() external view returns (address);

    function deposit(uint256 assets, address receiver) external returns (uint256 shares);

    function withdraw(uint256 assets, address receiver, address owner) external returns (uint256 shares);

    function convertToAssets(uint256 shares) external view returns (uint256 assets);

    function previewWithdraw(uint256 assets) external view returns (uint256 shares);
}

/// @notice MUSD set aside for one Coil implementation's clones.
///         Plain MUSD until `setVault` points at a savings vault. `guard` draws
///         this before any BTC is sold, so a rescue does not depend on pool slippage.
/// @dev One park per implementation, created in the CoilAccount constructor.
///      Balances are keyed by the clone (`msg.sender` on delegatecall).
contract CoilPark {
    IERC20 public immutable asset;
    /// @notice Deployer of the implementation. May point `vault` at sMUSD later.
    address public immutable governor;

    /// @dev Plain-MUSD balances. Unused while `vault` is set.
    mapping(address => uint256) public parked;
    /// @dev Savings-vault shares, keyed by clone.
    mapping(address => uint256) public sharesOf;

    address public vault;

    event VaultSet(address indexed vault);
    event Parked(address indexed account, address indexed payer, uint256 assets);
    event Drawn(address indexed account, address indexed to, uint256 assets);

    error NotGovernor();
    error BadAmount();
    error BadVault();

    constructor(address asset_, address governor_) {
        if (asset_ == address(0) || governor_ == address(0)) revert BadVault();
        asset = IERC20(asset_);
        governor = governor_;
    }

    /// @notice Optional sMUSD (or any ERC-4626 whose asset is MUSD). Zero clears it.
    function setVault(address next) external {
        if (msg.sender != governor) revert NotGovernor();
        if (next != address(0) && ISavingsVault(next).asset() != address(asset)) revert BadVault();
        vault = next;
        emit VaultSet(next);
    }

    function assetsOf(address account) external view returns (uint256) {
        if (vault == address(0)) return parked[account];
        return ISavingsVault(vault).convertToAssets(sharesOf[account]);
    }

    /// @notice Pull MUSD from `payer` into the park for `msg.sender` (the clone).
    function depositFor(address payer, uint256 assets) external {
        if (assets == 0 || payer == address(0)) revert BadAmount();
        if (!asset.transferFrom(payer, address(this), assets)) revert BadAmount();
        if (vault == address(0)) {
            parked[msg.sender] += assets;
        } else {
            if (!asset.approve(vault, assets)) revert BadAmount();
            uint256 shares = ISavingsVault(vault).deposit(assets, address(this));
            sharesOf[msg.sender] += shares;
        }
        emit Parked(msg.sender, payer, assets);
    }

    /// @notice Send `assets` of MUSD to `to`. Only the clone that owns the balance.
    function withdrawTo(address to, uint256 assets) external {
        _draw(to, assets);
    }

    /// @notice Send `assets` of MUSD to the clone, ready for `repayMUSD`.
    function draw(uint256 assets) external {
        _draw(msg.sender, assets);
    }

    function _draw(address to, uint256 assets) internal {
        if (assets == 0 || to == address(0)) revert BadAmount();
        if (vault == address(0)) {
            uint256 bal = parked[msg.sender];
            if (bal < assets) revert BadAmount();
            parked[msg.sender] = bal - assets;
            if (!asset.transfer(to, assets)) revert BadAmount();
        } else {
            uint256 shares = ISavingsVault(vault).previewWithdraw(assets);
            uint256 held = sharesOf[msg.sender];
            if (held < shares) revert BadAmount();
            sharesOf[msg.sender] = held - shares;
            ISavingsVault(vault).withdraw(assets, to, address(this));
        }
        emit Drawn(msg.sender, to, assets);
    }
}
