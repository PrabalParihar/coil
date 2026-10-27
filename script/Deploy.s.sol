// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CoilAccount} from "../src/CoilAccount.sol";
import {CoilFactory} from "../src/CoilFactory.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";

/// @notice Deploy Coil to Mezo testnet. The key stays in PRIVATE_KEY and is never committed.
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

        console2.log("deployer", deployer);
        console2.log("implementation", address(implementation));
        console2.log("factory", address(factory));
    }
}
