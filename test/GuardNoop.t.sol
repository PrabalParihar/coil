// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {CoilExit} from "../src/libraries/CoilExit.sol";
import {CoilLegacy} from "../src/libraries/CoilLegacy.sol";
import {FlashSizer} from "../src/libraries/FlashMath.sol";
import {ITroveManager} from "../src/interfaces/Mezo.sol";

contract GuardNoopTest is Test {
    function test_unsafeEmptyReserveDoesNotEmitPartialRescue() public {
        CoilLegacy.Env memory e;
        e.troveManager = address(100);
        e.borrowerOperations = address(101);
        e.poolFactory = address(102);
        e.btc = address(103);
        address pool = address(104);
        address park = address(105);
        FlashSizer sizer = new FlashSizer();
        vm.mockCall(
            e.troveManager,
            abi.encodeWithSignature("getTroveStatus(address)", address(this)),
            abi.encode(ITroveManager.Status.active)
        );
        vm.mockCall(
            e.troveManager, abi.encodeWithSignature("getTroveColl(address)", address(this)), abi.encode(0.04 ether)
        );
        vm.mockCall(
            e.troveManager, abi.encodeWithSignature("getTroveDebt(address)", address(this)), abi.encode(3000e18)
        );
        vm.mockCall(
            e.troveManager,
            abi.encodeWithSignature("getCurrentICR(address,uint256)", address(this), 110_000e18),
            abi.encode(uint256(1.466e18))
        );
        vm.mockCall(
            e.troveManager, abi.encodeWithSignature("checkRecoveryMode(uint256)", 110_000e18), abi.encode(false)
        );
        vm.mockCall(e.borrowerOperations, abi.encodeWithSignature("minNetDebt()"), abi.encode(1800e18));
        vm.mockCall(park, abi.encodeWithSignature("assetsOf(address)", address(this)), abi.encode(0));
        vm.mockCall(e.poolFactory, abi.encodeWithSignature("isPaused()"), abi.encode(false));
        vm.mockCall(e.poolFactory, abi.encodeWithSignature("getFee(address,bool)", pool, false), abi.encode(4));
        vm.mockCall(pool, abi.encodeWithSignature("stable()"), abi.encode(false));
        vm.mockCall(pool, abi.encodeWithSignature("token0()"), abi.encode(address(106)));
        vm.mockCall(pool, abi.encodeWithSignature("getReserves()"), abi.encode(100_000_000e18, 1000e18, 0));
        vm.recordLogs();
        assertEq(CoilExit.stageDelever(e, park, pool, address(sizer), 2e18, 110_000e18, 200, true), 0);
        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(entries.length, 0, "no improvement must not emit PartialRescue");
    }
}
