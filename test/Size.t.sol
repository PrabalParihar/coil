// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CoilAccount} from "../src/CoilAccount.sol";
import {CoilFactory} from "../src/CoilFactory.sol";
import {CoilLegacy} from "../src/libraries/CoilLegacy.sol";
import {CoilExit} from "../src/libraries/CoilExit.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";

/// @notice Mezo testnet enforces EIP-170 inside eth_estimateGas. `runtimeCode`
///         is unavailable here because these contracts store immutables, so this
///         deploys them on a fork and measures the code that would actually be
///         stored. `forge build --sizes` is the same gate in CI.
contract SizeTest is Test {
    uint256 internal constant EIP_170 = 24_576;

    function test_runtimeFitsEip170() public {
        vm.createSelectFork(vm.envOr("MEZO_TESTNET_RPC", string("https://rpc.test.mezo.org")));

        CoilAccount impl = new CoilAccount(
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
        CoilFactory factory = new CoilFactory(address(impl), address(this));
        address legacy = _linkedLib(address(impl), type(CoilLegacy).runtimeCode);
        address exitLib = _linkedLib(address(impl), type(CoilExit).runtimeCode);

        assertGt(address(impl).code.length, 0);
        assertGt(address(factory).code.length, 0);
        assertGt(address(impl.sizer()).code.length, 0);
        assertGt(address(impl.park()).code.length, 0);
        assertGt(legacy.code.length, 0);
        assertGt(exitLib.code.length, 0);

        assertLe(address(impl).code.length, EIP_170, "CoilAccount");
        assertLe(address(factory).code.length, EIP_170, "CoilFactory");
        assertLe(address(impl.sizer()).code.length, EIP_170, "FlashSizer");
        assertLe(address(impl.park()).code.length, EIP_170, "CoilPark");
        assertLe(legacy.code.length, EIP_170, "CoilLegacy");
        assertLe(exitLib.code.length, EIP_170, "CoilExit");
    }

    /// @dev Same recognition as script/Deploy.s.sol. The deployed library embeds its
    ///      own address, so it is not a byte-for-byte copy of the unlinked runtime.
    function _linkedLib(address impl, bytes memory expected) internal view returns (address lib) {
        bytes memory code = impl.code;
        uint256 len = code.length;
        for (uint256 i; i + 21 <= len; ++i) {
            if (uint8(code[i]) != 0x73) continue;
            address candidate;
            assembly {
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
            if (found != candidate && !_linkPlaceholder(expected, j)) return false;
            unchecked {
                j += 20;
            }
        }
        return true;
    }
}
