#!/usr/bin/env bash
# Verify Coil Labs contracts on the Mezo testnet Blockscout explorer.
# Usage:
#   IMPL=0x… FACTORY=0x… ./script/verify.sh
# Requires Foundry. No private key.
set -euo pipefail

: "${IMPL:?Set IMPL to the CoilAccount implementation address}"
: "${FACTORY:?Set FACTORY to the CoilFactory address}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VERIFIER_URL="${VERIFIER_URL:-https://api.explorer.test.mezo.org/api}"
CHAIN="${CHAIN:-31611}"

# Constructor arguments match script/Deploy.s.sol (Mezo testnet).
IMPL_ARGS="$(cast abi-encode \
  "constructor(address,address,address,address,address,address,address,address,address,address)" \
  0xCdF7028ceAB81fA0C6971208e83fa7872994beE5 \
  0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0 \
  0x722E4D24FD6Ff8b0AC679450F3D91294607268fA \
  0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6 \
  0x86bCF0841622a5dAC14A313a15f96A95421b9366 \
  0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503 \
  0x7b7C000000000000000000000000000000000000 \
  0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9 \
  0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A \
  0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9)"

OWNER="${OWNER:-}"
if [[ -z "$OWNER" ]]; then
  echo "Set OWNER to the factory owner address (the deployer)." >&2
  exit 1
fi

FACTORY_ARGS="$(cast abi-encode "constructor(address,address)" "$IMPL" "$OWNER")"

forge verify-contract "$IMPL" src/CoilAccount.sol:CoilAccount \
  --chain "$CHAIN" \
  --verifier blockscout \
  --verifier-url "$VERIFIER_URL" \
  --constructor-args "$IMPL_ARGS" \
  --watch

forge verify-contract "$FACTORY" src/CoilFactory.sol:CoilFactory \
  --chain "$CHAIN" \
  --verifier blockscout \
  --verifier-url "$VERIFIER_URL" \
  --constructor-args "$FACTORY_ARGS" \
  --watch

echo "Submitted. Explorer: https://explorer.test.mezo.org/address/$FACTORY"
