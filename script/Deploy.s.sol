// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CoilAccount} from "../src/CoilAccount.sol";
import {CoilFactory} from "../src/CoilFactory.sol";
import {CoilLegacy} from "../src/libraries/CoilLegacy.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";

/// @notice Deploy Coil to Mezo testnet. The key stays in PRIVATE_KEY and is never committed.
///         Foundry deploys and links CoilLegacy in this same broadcast.
///         Broadcast only against a fork or a key you control:
///         PRIVATE_KEY=0x… forge script script/Deploy.s.sol --rpc-url <rpc> --broadcast
contract Deploy is Script {
    function run() external {
        uint256 key = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(key);

        vm.startBroadcast(key);
        CoilAccount implementation = new CoilAccount(
            MezoAddresses.TESTNET_BORROWER_OPERATIONS,
            MezoAddresses.TESTNET_TROVE_MANAGER,
            MezoAddresses.TESTNET_SORTED_TROVES,
            MezoAddresses.TESTNET_HINT_HELPERS,
            MezoAddresses.TESTNET_PRICE_FEED,
            MezoAddresses.TESTNET_MUSD,
            MezoAddresses.BTC,
            MezoAddresses.TESTNET_ROUTER,
            MezoAddresses.TESTNET_POOL_FACTORY,
            MezoAddresses.TESTNET_MUSD_BTC_POOL
        );
        CoilFactory factory = new CoilFactory(address(implementation), deployer);
        vm.stopBroadcast();

        // FlashSizer is the implementation constructor's first CREATE (nonce 1).
        // CoilPark is the second (nonce 2).
        address sizer = vm.computeCreateAddress(address(implementation), 1);
        address park = vm.computeCreateAddress(address(implementation), 2);
        address legacy = _linkedLegacy(address(implementation));

        console2.log("deployer", deployer);
        console2.log("legacy", legacy);
        console2.log("sizer", sizer);
        console2.log("park", park);
        console2.log("implementation", address(implementation));
        console2.log("factory", address(factory));
    }

    /// @dev CoilLegacy is linked into CoilAccount as PUSH20 <address> DELEGATECALL.
    ///      Its own bytecode also embeds that address (calls to its public functions),
    ///      so the deployed code differs from `type(CoilLegacy).runtimeCode` only there.
    ///      The logged address is what verify.sh passes to --libraries.
    function _linkedLegacy(address impl) internal view returns (address lib) {
        bytes memory code = impl.code;
        bytes memory expected = type(CoilLegacy).runtimeCode;
        uint256 len = code.length;
        for (uint256 i; i + 21 <= len; ++i) {
            if (uint8(code[i]) != 0x73) continue;
            address candidate;
            assembly {
                candidate := shr(96, mload(add(code, add(i, 33))))
            }
            if (_isLinkedLegacy(candidate, expected)) return candidate;
        }
        revert("CoilLegacy was not linked");
    }

    function _isLinkedLegacy(address candidate, bytes memory expected) internal view returns (bool) {
        bytes memory deployed = candidate.code;
        if (deployed.length == 0 || deployed.length != expected.length) return false;
        for (uint256 j; j < deployed.length;) {
            if (deployed[j] == expected[j]) {
                unchecked {
                    ++j;
                }
                continue;
            }
            if (j + 20 > deployed.length) return false;
            address found;
            assembly {
                found := shr(96, mload(add(deployed, add(j, 32))))
            }
            if (found != candidate) return false;
            unchecked {
                j += 20;
            }
        }
        return true;
    }
}
