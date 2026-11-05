#!/usr/bin/env bash
# Verify a previously deployed Coil release on the explicitly selected chain.
# COIL_CHAIN_ID=31611|31612 LEGACY=0x... EXIT=0x... OWNER_LIB=0x... SIZER=0x...
# PARK=0x... IMPL=0x... FACTORY=0x... OWNER=0x... ./script/verify.sh [--dry-run]
# OWNER is factory owner / implementation deployer; OWNER_LIB is CoilOwner.
# --dry-run encodes public constructor arguments and prints commands without submitting.
# No private key is needed. Explorer verification does not establish release readiness.
set -euo pipefail

VERIFY_DRY_RUN=false
case "${1:-}" in
  "") ;;
  --dry-run) VERIFY_DRY_RUN=true ;;
  *) echo "Usage: script/verify.sh [--dry-run]" >&2; exit 1 ;;
esac
[[ $# -le 1 ]] || { echo "Usage: script/verify.sh [--dry-run]" >&2; exit 1; }

SELECTED_CHAIN="${COIL_CHAIN_ID:-${CHAIN:-}}"
if [[ -n "${COIL_CHAIN_ID:-}" && -n "${CHAIN:-}" && "$COIL_CHAIN_ID" != "$CHAIN" ]]; then
  echo "COIL_CHAIN_ID and CHAIN disagree." >&2; exit 1
fi
case "$SELECTED_CHAIN" in
  31611)
    DEFAULT_VERIFIER=https://api.explorer.test.mezo.org/api
    EXPLORER=https://explorer.test.mezo.org
    MARKET=(
      0xCdF7028ceAB81fA0C6971208e83fa7872994beE5
      0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0
      0x722E4D24FD6Ff8b0AC679450F3D91294607268fA
      0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6
      0x86bCF0841622a5dAC14A313a15f96A95421b9366
      0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
      0x7b7C000000000000000000000000000000000000
      0x9a1ff7FE3a0F69959A3fBa1F1e5ee18e1A9CD7E9
      0x4947243CC818b627A5D06d14C4eCe7398A23Ce1A
      0xd16A5Df82120ED8D626a1a15232bFcE2366d6AA9
    ) ;;
  31612)
    DEFAULT_VERIFIER=https://api.explorer.mezo.org/api
    EXPLORER=https://explorer.mezo.org
    MARKET=(
      0x44b1bac67dDA612a41a58AAf779143B181dEe031
      0x94AfB503dBca74aC3E4929BACEeDfCe19B93c193
      0x8C5DB4C62BF29c1C4564390d10c20a47E0b2749f
      0xD267b3bE2514375A075fd03C3D9CBa6b95317DC3
      0xc5aC5A8892230E0A3e1c473881A2de7353fFcA88
      0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186
      0x7b7C000000000000000000000000000000000000
      0x16A76d3cd3C1e3CE843C6680d6B37E9116b5C706
      0x83FE469C636C4081b87bA5b3Ae9991c6Ed104248
      0x52e604c44417233b6CcEDDDc0d640A405Caacefb
    ) ;;
  *) echo "Set COIL_CHAIN_ID to 31611 or 31612; no network is selected implicitly." >&2; exit 1 ;;
esac

for NAME in LEGACY EXIT OWNER_LIB SIZER PARK IMPL FACTORY OWNER; do
  VALUE="${!NAME:-}"
  if [[ ! "$VALUE" =~ ^0x[[:xdigit:]]{40}$ || "$VALUE" == 0x0000000000000000000000000000000000000000 ]]; then
    echo "Set $NAME to the nonzero public address printed by the deployment script." >&2; exit 1
  fi
done
VERIFIER_URL="${VERIFIER_URL:-$DEFAULT_VERIFIER}"
[[ "$VERIFIER_URL" == https://* || "$VERIFIER_URL" == http://127.0.0.1:* ]] || { echo "Invalid public verifier URL." >&2; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
IMPL_ARGS="$(cast abi-encode 'constructor(address,address,address,address,address,address,address,address,address,address)' "${MARKET[@]}")"
FACTORY_ARGS="$(cast abi-encode 'constructor(address,address)' "$IMPL" "$OWNER")"
PARK_ARGS="$(cast abi-encode 'constructor(address,address)' "${MARKET[5]}" "$OWNER")"

verify() {
  if [[ "$VERIFY_DRY_RUN" == true ]]; then
    printf 'forge verify-contract '
    printf '%q ' "$@" --chain "$SELECTED_CHAIN" --verifier blockscout --verifier-url "$VERIFIER_URL" --watch
    printf '\n'
  else
    forge verify-contract "$@" --chain "$SELECTED_CHAIN" --verifier blockscout --verifier-url "$VERIFIER_URL" --watch
  fi
}

# Dependency order matches the linked runtime: Exit->Legacy, Owner->Legacy+Exit,
# implementation->Legacy+Exit+Owner. FlashSizer and CoilPark are constructor CREATEs.
verify "$LEGACY" src/libraries/CoilLegacy.sol:CoilLegacy
verify "$EXIT" src/libraries/CoilExit.sol:CoilExit \
  --libraries "src/libraries/CoilLegacy.sol:CoilLegacy:$LEGACY"
verify "$OWNER_LIB" src/libraries/CoilOwner.sol:CoilOwner \
  --libraries "src/libraries/CoilLegacy.sol:CoilLegacy:$LEGACY" \
  --libraries "src/libraries/CoilExit.sol:CoilExit:$EXIT"
verify "$SIZER" src/libraries/FlashMath.sol:FlashSizer
verify "$PARK" src/CoilPark.sol:CoilPark --constructor-args "$PARK_ARGS"
verify "$IMPL" src/CoilAccount.sol:CoilAccount --constructor-args "$IMPL_ARGS" \
  --libraries "src/libraries/CoilLegacy.sol:CoilLegacy:$LEGACY" \
  --libraries "src/libraries/CoilExit.sol:CoilExit:$EXIT" \
  --libraries "src/libraries/CoilOwner.sol:CoilOwner:$OWNER_LIB"
verify "$FACTORY" src/CoilFactory.sol:CoilFactory --constructor-args "$FACTORY_ARGS"

if [[ "$VERIFY_DRY_RUN" == true ]]; then
  echo "Dry-run only: no explorer submissions or verification claims. Selected chain $SELECTED_CHAIN."
else
  echo "Verification commands completed; confirm each explorer result and release evidence separately."
fi
echo "Explorer: $EXPLORER/address/$FACTORY"
