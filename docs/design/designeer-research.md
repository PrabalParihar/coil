# Designeer research and MCP setup

Date: 2026-11-07 (Asia/Kolkata).

## Connection

The public Designeer Inspiration, Finds and Info pages were accessible. No official Designeer MCP endpoint or install instructions were found on those pages. The configured service is Microsoft's official `@playwright/mcp@0.0.84`, which browses Designeer; it is not represented as a Designeer API/server.

- Project config: `.codex/config.toml`, server `design_browser`.
- Launcher: `bash scripts/design-mcp.sh`.
- Tested the exact launcher with MCP stdio initialization and browser tool calls, including snapshots and screenshot capture on Designeer and Coil.
- The global Codex config is read-only in this environment. `codex mcp get` did not discover the project entry in this already-running CLI session. A trusted project/session reload may be needed to attach it as native tools. The server itself was exercised directly through an MCP client during this task.
- No API key is required for these public pages. Proxy routing is inherited from the environment; TLS checks remain enabled. The browser profile is isolated and page-registered WebMCP tools are disabled.
- The launcher prefers the installed Chromium/Chrome binary. Override it with `COIL_BROWSER_EXECUTABLE` if needed. If no local browser is available, install Chrome using the normal Playwright browser setup before starting it.
- No application package dependencies were changed.

## Sources actually inspected

- https://designeer.xyz/inspiration — galleries and editorial sources; spacing and hierarchy research.
- https://designeer.xyz/finds — independent visual work and microinteractions.
- https://designeer.xyz/finds/eliakuratli-2103604478796800245 — Elia, compact chart grouping and restrained labeling.
- https://designeer.xyz/finds/ayushsoni-io-2109992023390638527 — Ayush Soni, bold typographic framing and graphic rhythm.
- https://designeer.xyz/finds/david-visuals-2111096871506591835 — David, clear layered interaction hierarchy; use as inspiration, not a copied payment-card feature.
- https://coil.up.railway.app — current home and app desk, captured through MCP with reduced motion for stable reference images.
- https://github.com/microsoft/playwright-mcp — official setup/source documentation.

Some third-party gallery preview requests reported console/network warnings; these were not Coil application errors. The selected references and screenshots were accessible and inspected. No account sign-in, favourites, folder creation, submission or external messages were used.

## Redesign brief

Keep Coil's orange/dark identity, existing routes and wallet/contract semantics. Improve hierarchy, density, spacing, visual feedback and the deposit-to-review flow. Explore three 1440×1024 primary desktop screens before implementation; the selected direction will be adapted responsively. Generated numbers are illustrative and must never stand in for a live quote, keeper-health proof or funded release receipt. Preserve testnet/legacy labeling and opening/Recovery Mode/peg restrictions in the eventual implementation.

Exploration directions: an app-first two-column desk; a progressively guided input/review flow; a typographic layout with a compact exposure visualization. These are design candidates, not added product features or a selected build plan.

## Latest user correction

The initial three concepts were rejected as too text-heavy with excessive typography. The next pass uses one sans-serif family, 13–14px body/labels, a maximum 24px section heading, and numbers up to 32px. Remove marketing hero copy, long descriptions, redundant headings, decorative cards and repeated notices. Keep concise field labels, one action, essential risk/blocked-state context and expandable secondary details. Use fresh Designeer Minimal Gallery, Sombra and Interface references from the requested libraries; maintain the current orange/dark identity and financial semantics.

Latest displayed candidate set (the earlier text-heavy set is rejected):
- 1: Quiet Desk — `/workspace/generated_images/exec-a1efba60-0044-406e-b8f1-60b8a4a96fb2.png`.
- 2: Compact Bar — `/workspace/generated_images/exec-e872e00a-5a1e-4d56-9f1f-a2dfbfe9348d.png`.
- 3: Minimal Workbench — `/workspace/generated_images/exec-3e8793bf-44e5-45b8-abcb-4249c7a22201.png`.
Implementation has not started; the next choice must resolve against this latest displayed set. Mockup values remain illustrative and must be replaced by actual quote/state bindings.
