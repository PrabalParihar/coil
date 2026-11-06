#!/usr/bin/env bash
# Public design research through the official Microsoft Playwright MCP server.
set -euo pipefail

# Use the cloud environment's installed Node toolchain when it is available.
if [[ -f /workspace/.coil-tools/activate.sh ]]; then
  source /workspace/.coil-tools/activate.sh
fi

# Preserve the environment's network route without putting proxy values in config.
if [[ -n "${HTTPS_PROXY:-}" ]]; then
  export PLAYWRIGHT_MCP_PROXY_SERVER="$HTTPS_PROXY"
  export PLAYWRIGHT_MCP_PROXY_BYPASS="127.0.0.1,localhost"
fi

coil_browser_path="${COIL_BROWSER_EXECUTABLE:-}"
if [[ -z "$coil_browser_path" ]]; then
  coil_browser_path="$(command -v chromium || command -v google-chrome || true)"
fi
coil_mcp_args=(--headless --browser chrome --isolated --no-webmcp)
if [[ -n "$coil_browser_path" ]]; then
  coil_mcp_args+=(--executable-path "$coil_browser_path")
fi
# The root-owned cloud container requires Chromium's container launch mode.
if [[ "$(id -u)" == 0 ]]; then
  coil_mcp_args+=(--no-sandbox)
fi

exec npx --yes @playwright/mcp@0.0.84 "${coil_mcp_args[@]}"
