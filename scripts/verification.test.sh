#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
fixture_bin="$(mktemp -d)"
trap 'rm -rf "$fixture_bin"' EXIT
printf '#!/bin/sh\nexit 97\n' > "$fixture_bin/forge"
chmod +x "$fixture_bin/forge"
export PATH="$fixture_bin:$PATH"
script="$repo/script/verify.sh"
export LEGACY=0x0000000000000000000000000000000000000011
export EXIT=0x0000000000000000000000000000000000000012
export OWNER_LIB=0x0000000000000000000000000000000000000013
export SIZER=0x0000000000000000000000000000000000000014
export PARK=0x0000000000000000000000000000000000000015
export IMPL=0x0000000000000000000000000000000000000016
export FACTORY=0x0000000000000000000000000000000000000017
export OWNER=0x0000000000000000000000000000000000000018
export COIL_CHAIN_ID=31611
unset CHAIN || true
output="$(bash "$script" --dry-run)"
[[ "$output" == *'src/libraries/CoilOwner.sol:CoilOwner'* ]] || { echo 'FAIL: missing CoilOwner verification'; exit 1; }
[[ "$output" == *'api.explorer.test.mezo.org'* ]] || { echo 'FAIL: wrong testnet verification explorer'; exit 1; }
[[ "$output" == *'118917a40faf1cd7a13db0ef56c86de7973ac503'* ]] || { echo 'FAIL: testnet constructor market missing'; exit 1; }
[[ "$output" != *'fully verified'* ]] || { echo 'FAIL: dry-run fabricated verification'; exit 1; }
export COIL_CHAIN_ID=31612
output="$(bash "$script" --dry-run)"
[[ "$output" == *'api.explorer.mezo.org'* ]] || { echo 'FAIL: wrong mainnet verifier'; exit 1; }
[[ "$output" == *'dd468a1ddc392dcdbef6db6e34e89aa338f9f186'* ]] || { echo 'FAIL: mainnet constructor market missing'; exit 1; }
[[ "$output" != *'118917a40faf1cd7a13db0ef56c86de7973ac503'* ]] || { echo 'FAIL: testnet constructor market mixed into mainnet'; exit 1; }
[[ "$output" != *'api.explorer.test.mezo.org'* ]] || { echo 'FAIL: matsnet verifier mixed into mainnet'; exit 1; }
export COIL_CHAIN_ID=1
if bash "$script" --dry-run >/dev/null 2>&1; then echo 'FAIL: unsupported chain accepted'; exit 1; fi
export COIL_CHAIN_ID=31611 CHAIN=31612
if bash "$script" --dry-run >/dev/null 2>&1; then echo 'FAIL: conflicting chain env accepted'; exit 1; fi
unset CHAIN
export OWNER_LIB=0x0000000000000000000000000000000000000000
if bash "$script" --dry-run >/dev/null 2>&1; then echo 'FAIL: zero owner library accepted'; exit 1; fi
echo 'offline verification chain/link/address behavior checks passed'
