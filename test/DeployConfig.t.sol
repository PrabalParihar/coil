// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {CoilFactory} from "../src/CoilFactory.sol";
import {MezoAddresses} from "../src/MezoAddresses.sol";

contract DeployConfigTest is Test {
    // Public Anvil fixture only. Never use this key for a live network.
    uint256 private constant ANVIL_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    Deploy private script;
    address private deployer;
    struct Config {
        uint256 chainId;
        address keeper;
        address guardian;
        uint256 maxCollateral;
        uint256 maxDebt;
        address[10] market;
    }
    function setUp() public {
        script = new Deploy();
        deployer = vm.addr(ANVIL_KEY);
        _reset();
    }
    function _reset() private {
        vm.chainId(31611);
        vm.setEnv("COIL_CHAIN_ID", "31611");
        vm.setEnv("COIL_MAX_COLLATERAL", "");
        vm.setEnv("COIL_MAX_DEBT", "");
        vm.setEnv("COIL_KEEPER", "");
        vm.setEnv("COIL_GUARDIAN", "");
        vm.setEnv("COIL_MAINNET_APPROVED", "false");
    }
    // vm.setEnv changes process-global state, so exercise these scenarios in one
    // sequential test rather than racing separate cases on Foundry worker threads.
    function test_configurationGuardsAndPausedDeployment() public {
        _reset(); this._test_testnetConfigHasFiniteLabelledDefaultsAndSelectedMarket();
        _reset(); this._test_configRejectsMissingUnsupportedOrMismatchedChain();
        _reset(); this._test_configRejectsZeroAndUnlimitedLimits();
        _reset(); this._test_mainnetRequiresApprovalBothNumericLimitsAndPublicRoles();
        _reset(); this._test_approvedMainnetConfigSelectsOnlyMainnetMarketAndExplicitCaps();
        _reset(); this._test_testnetRunConfiguresRolesAndLimitsButNeverUnpauses();
    }
    function _read() private returns (Config memory) {
        (bool ok, bytes memory data) = address(script).call(abi.encodeWithSignature("configuration(address)", deployer));
        assertTrue(ok, "deployment configuration must validate selected network and return public settings");
        return abi.decode(data, (Config));
    }
    function _rejected() private {
        (bool ok,) = address(script).call(abi.encodeWithSignature("configuration(address)", deployer));
        assertFalse(ok, "unsafe deployment configuration accepted");
    }
    function _mainnet() private {
        vm.chainId(31612);
        vm.setEnv("COIL_CHAIN_ID", "31612");
        vm.setEnv("COIL_MAINNET_APPROVED", "true");
        vm.setEnv("COIL_MAX_COLLATERAL", "100000000000000000");
        vm.setEnv("COIL_MAX_DEBT", "5000000000000000000000");
        vm.setEnv("COIL_KEEPER", "0x0000000000000000000000000000000000000011");
        vm.setEnv("COIL_GUARDIAN", "0x0000000000000000000000000000000000000012");
    }
    function _test_testnetConfigHasFiniteLabelledDefaultsAndSelectedMarket() external {
        Config memory c = _read();
        assertEq(c.chainId, 31611);
        assertEq(c.maxCollateral, 1 ether);
        assertEq(c.maxDebt, 100000 ether);
        assertEq(c.keeper, deployer);
        assertEq(c.guardian, deployer);
        assertEq(c.market[5], MezoAddresses.TESTNET_MUSD);
        assertEq(c.market[9], MezoAddresses.TESTNET_MUSD_BTC_POOL);
    }
    function _test_configRejectsMissingUnsupportedOrMismatchedChain() external {
        vm.setEnv("COIL_CHAIN_ID", ""); _rejected();
        vm.setEnv("COIL_CHAIN_ID", "1"); _rejected();
        vm.setEnv("COIL_CHAIN_ID", "31612"); _rejected();
    }
    function _test_configRejectsZeroAndUnlimitedLimits() external {
        vm.setEnv("COIL_MAX_COLLATERAL", "0"); _rejected();
        vm.setEnv("COIL_MAX_COLLATERAL", "100");
        vm.setEnv("COIL_MAX_DEBT", "0"); _rejected();
        vm.setEnv("COIL_MAX_DEBT", vm.toString(type(uint256).max)); _rejected();
        vm.setEnv("COIL_MAX_DEBT", "100");
        vm.setEnv("COIL_MAX_COLLATERAL", vm.toString(type(uint256).max)); _rejected();
    }
    function _test_mainnetRequiresApprovalBothNumericLimitsAndPublicRoles() external {
        _mainnet(); vm.setEnv("COIL_MAINNET_APPROVED", "false"); _rejected();
        _mainnet(); vm.setEnv("COIL_MAX_COLLATERAL", ""); _rejected();
        _mainnet(); vm.setEnv("COIL_MAX_DEBT", ""); _rejected();
        _mainnet(); vm.setEnv("COIL_KEEPER", ""); _rejected();
        _mainnet(); vm.setEnv("COIL_GUARDIAN", ""); _rejected();
        _mainnet(); vm.setEnv("COIL_KEEPER", "0x0000000000000000000000000000000000000000"); _rejected();
    }
    function _test_approvedMainnetConfigSelectsOnlyMainnetMarketAndExplicitCaps() external {
        _mainnet();
        Config memory c = _read();
        assertEq(c.maxCollateral, 0.1 ether);
        assertEq(c.maxDebt, 5000 ether);
        assertEq(c.keeper, address(0x11));
        assertEq(c.guardian, address(0x12));
        assertEq(c.market[5], MezoAddresses.MAINNET_MUSD);
        assertEq(c.market[9], MezoAddresses.MAINNET_MUSD_BTC_POOL);
    }
    function _test_testnetRunConfiguresRolesAndLimitsButNeverUnpauses() external {
        vm.setEnv("PRIVATE_KEY", vm.toString(ANVIL_KEY));
        vm.setEnv("COIL_KEEPER", "0x0000000000000000000000000000000000000011");
        vm.setEnv("COIL_GUARDIAN", "0x0000000000000000000000000000000000000012");
        vm.mockCall(MezoAddresses.TESTNET_MUSD_BTC_POOL, abi.encodeWithSignature("token0()"), abi.encode(MezoAddresses.TESTNET_MUSD));
        (bool ok, bytes memory data) = address(script).call(abi.encodeWithSignature("run()"));
        assertTrue(ok, "local-only mocked deployment should succeed");
        assertEq(data.length, 64, "deployment returns public implementation/factory addresses");
        (address implementation, address factoryAddress) = abi.decode(data, (address,address));
        CoilFactory factory = CoilFactory(factoryAddress);
        assertEq(factory.implementation(), implementation);
        assertEq(factory.owner(), deployer);
        assertEq(factory.coilFeeBps(), 25);
        assertTrue(factory.opensPaused(), "deployment cannot silently activate opening");
        assertEq(factory.maxCollateral(), 1 ether);
        assertEq(factory.maxDebt(), 100000 ether);
        assertEq(factory.keeper(), address(0x11));
        assertEq(factory.guardian(), address(0x12));
    }
}
