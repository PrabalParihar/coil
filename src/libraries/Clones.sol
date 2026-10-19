// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev EIP-1167 minimal proxy. Immutables live in the implementation bytecode and are
///      shared by every clone; per-user state lives in the clone's own storage.
library Clones {
    function clone(address implementation) internal returns (address instance) {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x3d602d80600a3d3981f3363d3d373d3d3d363d73000000000000000000000000)
            mstore(add(ptr, 0x14), shl(0x60, implementation))
            mstore(add(ptr, 0x28), 0x5af43d82803e903d91602b57fd5bf30000000000000000000000000000000000)
            instance := create(0, ptr, 0x37)
        }
        require(instance != address(0), "clone failed");
    }
}
