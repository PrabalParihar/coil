// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CoilAccount} from "../src/CoilAccount.sol";
import {CoilFactory} from "../src/CoilFactory.sol";
import {CoilLegacy} from "../src/libraries/CoilLegacy.sol";
import {CoilExit} from "../src/libraries/CoilExit.sol";
import {CoilOwner} from "../src/libraries/CoilOwner.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";

/// @notice Deploy the explicitly selected Mezo market, always with opens paused.
///         Set COIL_CHAIN_ID=31611|31612 to match the RPC chain before running.
///         Mainnet additionally requires COIL_MAINNET_APPROVED=true, explicit finite
///         COIL_MAX_COLLATERAL / COIL_MAX_DEBT (wei), COIL_KEEPER and COIL_GUARDIAN.
///         Mainnet approval is a runtime gate, not a grant of go-live authorization.
///         Testnet defaults below are finite fixture settings, not mainnet recommendations.
///         Never use the public Anvil test key on a live network. This script does not unpause.
contract Deploy is Script {
    struct Config {
        uint256 chainId;
        address keeper;
        address guardian;
        uint256 maxCollateral;
        uint256 maxDebt;
        address[10] market;
    }

    /// @notice Public, key-free preflight; validation precedes broadcast and key parsing.
    function configuration(address deployer) public view returns (Config memory c) {
        string memory selected = vm.envOr("COIL_CHAIN_ID", string(""));
        require(bytes(selected).length > 0, "select COIL_CHAIN_ID explicitly");
        c.chainId = vm.parseUint(selected);
        require(c.chainId == 31611 || c.chainId == 31612, "unsupported chain");
        require(block.chainid == c.chainId, "selected chain differs from RPC chain");
        bool mainnet = c.chainId == 31612;
        if (mainnet) require(vm.envOr("COIL_MAINNET_APPROVED", false), "mainnet approval required");
        c.maxCollateral = _limit("COIL_MAX_COLLATERAL", mainnet, 1 ether);
        c.maxDebt = _limit("COIL_MAX_DEBT", mainnet, 100000 ether);
        c.keeper = _role("COIL_KEEPER", mainnet, deployer);
        c.guardian = _role("COIL_GUARDIAN", mainnet, deployer);
        if (mainnet) {
            c.market = [
                MezoAddresses.MAINNET_BORROWER_OPERATIONS, MezoAddresses.MAINNET_TROVE_MANAGER,
                MezoAddresses.MAINNET_SORTED_TROVES, MezoAddresses.MAINNET_HINT_HELPERS,
                MezoAddresses.MAINNET_PRICE_FEED, MezoAddresses.MAINNET_MUSD, MezoAddresses.BTC,
                MezoAddresses.MAINNET_ROUTER, MezoAddresses.MAINNET_POOL_FACTORY, MezoAddresses.MAINNET_MUSD_BTC_POOL
            ];
        } else {
            c.market = [
                MezoAddresses.TESTNET_BORROWER_OPERATIONS, MezoAddresses.TESTNET_TROVE_MANAGER,
                MezoAddresses.TESTNET_SORTED_TROVES, MezoAddresses.TESTNET_HINT_HELPERS,
                MezoAddresses.TESTNET_PRICE_FEED, MezoAddresses.TESTNET_MUSD, MezoAddresses.BTC,
                MezoAddresses.TESTNET_ROUTER, MezoAddresses.TESTNET_POOL_FACTORY, MezoAddresses.TESTNET_MUSD_BTC_POOL
            ];
        }
    }

    function _limit(string memory name, bool mainnet, uint256 testDefault) private view returns (uint256 limit) {
        string memory value = vm.envOr(name, string(""));
        require(!mainnet || bytes(value).length > 0, "explicit mainnet limits required");
        limit = bytes(value).length == 0 ? testDefault : vm.parseUint(value);
        require(limit > 0 && limit < type(uint256).max, "finite nonzero limits required");
    }

    function _role(string memory name, bool mainnet, address testDefault) private view returns (address role) {
        string memory value = vm.envOr(name, string(""));
        require(!mainnet || bytes(value).length > 0, "explicit mainnet roles required");
        role = bytes(value).length == 0 ? testDefault : vm.parseAddress(value);
        require(role != address(0), "nonzero keeper/guardian required");
    }

    function run() external returns (CoilAccount implementation, CoilFactory factory) {
        // Public preflight uses an inert nonzero fallback; actual testnet identities
        // are resolved against the deployer below. No key is read on a failed chain gate.
        configuration(address(1));
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);
        Config memory c = configuration(deployer);
        vm.startBroadcast(key);
        implementation = new CoilAccount(
            c.market[0], c.market[1], c.market[2], c.market[3], c.market[4],
            c.market[5], c.market[6], c.market[7], c.market[8], c.market[9]
        );
        factory = new CoilFactory(address(implementation), deployer);
        factory.setPositionLimits(c.maxCollateral, c.maxDebt);
        factory.setKeeper(c.keeper);
        factory.setGuardian(c.guardian);
        // Opening remains paused. A separate owner action after release review activates it.
        vm.stopBroadcast();
        require(factory.opensPaused(), "deployment must remain paused");

        // FlashSizer and CoilPark are implementation constructor CREATEs, nonces 1/2.
        address sizer = vm.computeCreateAddress(address(implementation), 1);
        address park = vm.computeCreateAddress(address(implementation), 2);
        address legacy = _linkedLib(address(implementation), type(CoilLegacy).runtimeCode);
        address exitLib = _linkedLib(address(implementation), type(CoilExit).runtimeCode);
        address ownerLib = _linkedLib(address(implementation), type(CoilOwner).runtimeCode);
        console2.log("chainId", c.chainId);
        console2.log("deployer", deployer);
        console2.log("keeper", c.keeper);
        console2.log("guardian", c.guardian);
        console2.log("maxCollateral", c.maxCollateral);
        console2.log("maxDebt", c.maxDebt);
        console2.log("opensPaused", factory.opensPaused());
        console2.log("legacy", legacy);
        console2.log("exit", exitLib);
        console2.log("ownerLibrary", ownerLib);
        console2.log("sizer", sizer);
        console2.log("park", park);
        console2.log("implementation", address(implementation));
        console2.log("factory", address(factory));
    }

    /// @dev Libraries are linked into CoilAccount as PUSH20 <address> DELEGATECALL.
    ///      A library's own bytecode also embeds that address, so the deployed code
    ///      differs from `type(Lib).runtimeCode` only there.
    ///      The logged address is what verify.sh passes to --libraries.
    function _linkedLib(address impl, bytes memory expected) internal view returns (address lib) {
        bytes memory code = impl.code;
        uint256 len = code.length;
        for (uint256 i; i + 21 <= len; ++i) {
            if (uint8(code[i]) != 0x73) continue;
            address candidate;
            assembly ("memory-safe") {
                candidate := shr(96, mload(add(code, add(i, 33))))
            }
            if (_isLinkedLegacy(candidate, expected)) return candidate;
        }
        revert("library was not linked");
    }

    /// @dev Foundry's unlinked placeholder is 20 bytes and starts with `__$`.
    function _linkPlaceholder(bytes memory code, uint256 j) internal pure returns (bool) {
        return j + 2 < code.length && code[j] == 0x5f && code[j + 1] == 0x5f && code[j + 2] == 0x24;
    }

    function _isLinkedLegacy(address candidate, bytes memory expected) internal view returns (bool) {
        bytes memory deployed = candidate.code;
        if (deployed.length == 0 || deployed.length != expected.length) return false;
        for (uint256 j; j < deployed.length;) {
            // viaIR can encode the library self-address guard as ADDRESS PUSH32 EQ.
            // Normalize the entire zero-placeholder word before bytewise comparison
            // skips its leading zeros. Other zero constants must still match exactly.
            if (j > 0 && j + 33 < deployed.length && expected[j - 1] == 0x30
                && deployed[j] == 0x7f && expected[j] == 0x7f && expected[j + 33] == 0x14) {
                bytes32 actualWord;
                bytes32 expectedWord;
                assembly ("memory-safe") {
                    actualWord := mload(add(deployed, add(j, 33)))
                    expectedWord := mload(add(expected, add(j, 33)))
                }
                if (expectedWord == bytes32(0) && uint256(actualWord) == uint256(uint160(candidate))) {
                    j += 33;
                    continue;
                }
            }
            if (deployed[j] == expected[j]) {
                unchecked {
                    ++j;
                }
                continue;
            }
            if (j + 20 > deployed.length) return false;
            address found;
            assembly ("memory-safe") {
                found := shr(96, mload(add(deployed, add(j, 32))))
            }
            if (found != candidate && !_linkPlaceholder(expected, j)) return false;
            unchecked {
                j += 20;
            }
        }
        return true;
    }
}
