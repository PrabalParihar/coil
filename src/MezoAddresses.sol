// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Addresses checked against mezo-org/musd deployments and mezo-org/tigris
///         on 19 Oct 2026. BTC is the ERC-20 mirror of native gas at the precompile
///         address; its balanceOf matches address.balance on testnet.
library MezoAddresses {
    address internal constant BTC = 0x7b7C000000000000000000000000000000000000;

    // --- matsnet / Mezo testnet (chain 31611) ---
    address internal constant TESTNET_MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;
    address internal constant TESTNET_BORROWER_OPERATIONS = 0xCdF7028ceAB81fA0C6971208e83fa7872994beE5;
    address internal constant TESTNET_TROVE_MANAGER = 0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0;
    address internal constant TESTNET_SORTED_TROVES = 0x722E4D24FD6Ff8b0AC679450F3D91294607268fA;
    address internal constant TESTNET_HINT_HELPERS = 0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6;
    address internal constant TESTNET_PRICE_FEED = 0x86bCF0841622a5dAC14A313a15f96A95421b9366;
    address internal constant TESTNET_ROUTER = 0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9;
    address internal constant TESTNET_POOL_FACTORY = 0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A;
    address internal constant TESTNET_MUSD_BTC_POOL = 0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9;

    // --- Mezo mainnet (chain 31612). Not used by the testnet deploy. ---
    address internal constant MAINNET_MUSD = 0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186;
    address internal constant MAINNET_BORROWER_OPERATIONS = 0x44b1bac67dDA612a41a58AAf779143B181dEe031;
    address internal constant MAINNET_TROVE_MANAGER = 0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193;
    address internal constant MAINNET_SORTED_TROVES = 0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f;
    address internal constant MAINNET_HINT_HELPERS = 0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3;
    address internal constant MAINNET_PRICE_FEED = 0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88;
    address internal constant MAINNET_ROUTER = 0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706;
    address internal constant MAINNET_POOL_FACTORY = 0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248;
    address internal constant MAINNET_MUSD_BTC_POOL = 0x52e604c44417233b6CcEDDDc0d640A405Caacefb;
}
