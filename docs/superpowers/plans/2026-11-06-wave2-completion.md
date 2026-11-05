# Wave 2 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement and merge the approved Wave 2 engineering, operational, and submission requirements with honest release/evidence gates.

**Architecture:** Extend the current clone/factory and linked-library design. Financial changes form one coherent tested subsystem; independent web, keeper, and materials work follows fixed interfaces. A canonical public deployment manifest generates copies inside each Docker build context. Integrate and review the complete branch before merging.

**Tech Stack:** Solidity 0.8.24, Foundry, Node 22, TypeScript, viem, Next.js static export, Docker/Nginx, Railway, Python/reportlab/pptx, ffmpeg.

**Spec:** `docs/superpowers/specs/2026-11-06-wave2-completion-design.md` (approved in chat).

## Global Constraints

- Fee default 25 bps, owner-set 1–50 inclusive; zero Coil fee on guard/rescue/repay/exit/claim. Factory owner controls policy.
- All pool fills obey one PriceMin oracle bound before flash and in callbacks. No second slippage widening. Empty-reserve unsafe guard returns false without tip.
- RM allows safe owner MUSD repayment; full close only when Mezo permits it. No automatic queued close.
- New factory opens initially paused; explicit nonzero finite limits required to unpause. Guardian can pause, only owner unpauses. Risk-reducing actions remain available.
- Every runtime below 24,576 bytes and changed execution paths within 20 Mezo precompile calls. Existing clones are not upgraded.
- No fabricated user/deployment/verification proofs, no secret values in artifacts, no unapproved mainnet go-live. Preserve the cloud environment publication.
- TDD for behavior changes; keep meaningful existing tests. Centralize Git staging/commits in the controller because independent workstreams share this worktree.

## Review Focus

- Fee policy changes after quote: transaction-enforced accepted fee ceiling, exact gross-up and CR/debt accounting.
- Cap/pause changes on existing positions: safe exits/repay/guard/top-up continue; risk-increasing calls revert atomically.
- Adversarial pool movement or no-op guard: callback-bound fills and actual tip/balance/debt effects, not just named reverts.
- Missing/invalid deployment metadata or stale RPC: no mismatched chain writes or false online status; address/block overrides validated together.
- Missing real-user/signing/external data: release verifier must fail honestly, and demo/materials must label local/fork footage.

---

### Task 1: Financial contracts and acceptance tests

**Files:** `src/CoilFactory.sol`, `src/ICoilFactory.sol`, `src/CoilAccount.sol`, `src/interfaces/Mezo.sol`, `src/libraries/{PriceMin,FlashMath,CoilLegacy,CoilExit}.sol`, optional new `CoilOwner.sol`/fee helper, `test/*.sol`. Exclusive owner: contract workstream.

**Interfaces:**
- Factory `policy() external view returns (Policy memory)` with tuple fields `uint16 feeBps,address feeRecipient,bool opensPaused,uint256 maxCollateral,uint256 maxDebt`; public getters `coilFeeBps`, `feeRecipient`, `opensPaused`, `maxCollateral`, `maxDebt`, `guardian`.
- Factory setters `setCoilFee(uint16)`, `setFeeRecipient(address)`, `setPositionLimits(uint256,uint256)`, `setGuardian(address)`, `pauseOpens()`, `unpauseOpens()`. Existing constructor `(address implementation,address owner)` and account/keeper functions retained.
- Account `claimCollateral() returns(uint256)`, `repayWithMUSD(uint256 amount) returns(uint256)`, `closeWithMUSD(uint256 maxOwnerMUSD)`, `addCollateral()` payable, owner-only and nonreentrant.
- Keep `loop(uint256,uint256)`/`flashLoop(uint256,uint256)`; add overloads `(uint256,uint256,uint16 maxCoilFeeBps)`.
- Keep old quote ABI; add `quoteLoopWithFee(uint256,uint256,uint256) returns(LoopQuote,uint256 coilFeeMusd)` and `quoteFlashLoopWithFee(uint256,uint256,uint256) returns(LoopQuote,uint256 flashBtc,uint256 poolFeeMusd,uint256 coilFeeMusd)`. `LoopQuote` keeps its six existing fields; minted amount is gross and fees are explicit.
- Heartbeat on new factory checks configured keeper; `guard()` remains permissionless. Coordinate any interface change with the controller before changing names.

- [ ] Write failing fee/policy/claim/RM and strict-bound/no-op tests, including all four named PRD A9 cases, fee drift/rounding, lowering limits on existing positions, and simulated adverse callback behavior.
- [ ] Run focused tests and capture RED reason before changing production code. Prefer low-level interface calls for absent APIs so missing functionality is an assertion failure rather than a typo.
- [ ] Implement coherent fee-aware solver/router/callback policy and owner actions, preserving direct MUSD exit and old ABI compatibility. Extend test fixture bootstrap to explicitly configure/unpause the new factory.
- [ ] Run `forge test` and `forge build --sizes`; expected all tests pass, all runtimes below 24,576, no skipped failures. Include the exact new tests and RED→GREEN evidence in the report.
- [ ] Return scoped diff and report; controller commits after review/integration.

### Task 2: Canonical deployments, scripts, and release evidence tooling

**Files:** create `deployments/manifest.json`, `scripts/deployments.cjs`, `scripts/deployments.test.cjs`, `scripts/release-evidence.cjs` and tests; generate `web/src/lib/deployment.generated.ts`, `keeper/src/deployment.generated.ts`; modify `script/Deploy.s.sol`, `script/verify.sh`, `.github/workflows/ci.yml`, `web/Dockerfile`, `.env.example`. Exclusive owner: controller.

**Interfaces:**
- Canonical JSON `{schemaVersion:1,deployments:{"31611":Deployment,"31612":Deployment}}`. Deployment fields: `chainId,name,rpcUrl,explorerUrl,status,factory,deploymentBlock,implementation,keeper,contracts,capabilities`. Status `legacy|ready|pending`; pending factory/block may be null. Addresses are nonzero valid addresses when present; block is a decimal string. `capabilities` contains `policy,coilFee,ownerActions` booleans.
- Generated TS modules export identical `DEPLOYMENTS` and `Deployment` type. Current testnet pair `0xff3335576f998EE872596d4EB7ABECb71a0D5BC8` / `"16408315"` is explicitly legacy; mainnet is pending, never a made-up address.
- `scripts/deployments.cjs` exports validation/generation helpers; CLI `node scripts/deployments.cjs --check` verifies committed copies, no network.
- `NEXT_PUBLIC_COIL_FACTORY` override requires `NEXT_PUBLIC_COIL_FACTORY_DEPLOY_BLOCK`. Mainnet requires a real manifest entry plus explicit write enablement. Keeper gets a matching chain/factory/block selection.

- [ ] Write Node tests that reject partial pairs, invalid chain/address/block, false ready status, mismatched receipts and insufficient tester proofs; observe RED.
- [ ] Implement manifest/generator and offline evidence validation. Root script uses Node built-ins; live verification may use configured cast/Railway SDK without extracting credentials.
- [ ] Configure deployment script for explicit selected chain, finite limits, guardian/keeper/public configuration, default paused policy and operator-controlled activation. Include new linked libraries in verification. Update only safe testnet/local CI defaults, not mainnet auto-unpause.
- [ ] Run `node --test scripts/*.test.cjs`, generation check, Foundry script compile/local-fork dry-run after Task 1, and workflow validation. Expected valid artifacts pass and absent/forged release evidence fails clearly.
- [ ] Commit scoped changes after combined validation.

### Task 3: Keeper backoff, chain selection, and health

**Files:** `keeper/src/**` except generated deployment module; `keeper/package.json`, `keeper/Dockerfile`, keeper README/configuration. Exclusive owner: keeper workstream.

**Interfaces:** consume generated `DEPLOYMENTS`/`Deployment`. Parse configured chain/factory/block consistently; do not import app-only code. HTTP GET `/health` and `/status` on assigned `PORT` expose only public operational fields: `chainId,factory,keeper,mode,lastScanAt,lastHeartbeatAt,status,counters`.

- [ ] Write failing checks for unchanged-failure backoff, reset on newly actionable risk/reserve/settings, deduplicated alerts, stalled scans, read-only vs execute status, heartbeat receipt failure, and wrong chain/factory pairs.
- [ ] Run checks to observe RED; refactor reusable engine/status helpers out of executable entry point.
- [ ] Implement bounded per-account backoff, successful confirmation tracking, chain-aware ABI/client setup, configured expected heartbeat signer, health/status server and safe errors. Preserve simulation-before-send and no secrets in status.
- [ ] Run `npm run typecheck && npm run check`; expected all existing and new checks pass, including real HTTP behavior with ephemeral local ports when permitted.
- [ ] Return report and scoped diff; do not stage/commit or mutate contract/web/root files.

### Task 4: Web fee/owner actions, chain readiness, and public status

**Files:** `web/src/**` except generated deployment module; web tests/scripts and `web/package.json`, `web/README.md`. Exclusive owner: web workstream.

**Interfaces:** consume Task 1 ABI exactly and Task 2 generated deployments. `Market.coilFeeBps?:bigint` defaults to zero for legacy previews; `LoopPreview` exposes Coil fee separately. Probe new factory `policy()` to distinguish capabilities for custom/local deployments. Owner transactions on new contracts use accepted-fee overloads.

- [ ] Add failing tests for fee-aware preview/gross-up, legacy behavior, accepted-fee call selection, partial override rejection, unsupported mainnet writes, RM actions and health freshness; observe RED.
- [ ] Implement exact ABI/quote changes, owner claim and MUSD approve/repay/close controls, clear RM and pause/cap states, chain-specific clients/links and <=2x mainnet default. Mainnet writes stay disabled without real configuration/enablement.
- [ ] Add `/keeper`; make `/guard` load recent history first with errors/retry/pagination and trusted-heartbeat freshness. Keep `/stats` honest and update factory/block provenance.
- [ ] Remove fabricated WalletConnect project ID; keep usable injected/Bitcoin connectors and clear optional connection availability. Preserve conditional Passport fallback.
- [ ] Run web checks, TypeScript and production build; expected /, /guard, /stats, /keeper render, unknown route remains 404. Return report/scoped diff; controller performs final browser/container integration.

### Task 5: Submission assets, documentation, and proof ledger

**Files:** `docs/SUBMISSION.md`, `docs/VIDEO_SCRIPT.md`, new deck source/PDF/PPTX and <=120-second video/storyboard assets under `docs/`, `docs/evidence/**`, `CHANGELOG.md`, `SECURITY.md`, `THREAT_MODEL.md`, `DEPLOYMENTS.md`, `README.md`. Exclusive owner: materials workstream; avoid spec/plan edits.

**Interfaces:** describe approved behavior and actual evidence only. Current source/live versions differ; new contract addresses and real-user claims remain pending until verified. Team is Prabal Pratap Singh, Nikhil Verma, Neha Singh.

- [ ] Create/update materials using actual existing footage labelled with its chain/version, or clearly labelled local/fork demonstration; never invent pending fee/claim/RM transactions.
- [ ] Produce reviewable deck source plus PDF/PPTX and a <=120-second video/script; use available ffmpeg/reportlab/pptx. Update fee model, team, mainnet gate and clear matsnet/mainnet labels. Draft Updates, do not post externally.
- [ ] Add structured empty proof ledger/schema that release tooling can validate; explain real tester recruitment and funded receipts as required external inputs.
- [ ] Update security/deployment docs against actual Task 1 behavior after interface/code changes settle; do not claim an audit or live deployment merely because code exists.
- [ ] Verify video duration with ffprobe, render/sample deck pages, check links/team/chain/fee claims and return artifact/report paths. No new behavioral tests for editorial-only copy.

### Task 6: Integration, fresh review, and authorized merge

**Files:** cross-subsystem fixes, CI and integration/browser fixtures as required. Owner: controller.

- [ ] Verify every workstream report, interface and spec coverage; require all meaningful new behavior to have RED→GREEN evidence. Run full Foundry, sizes, keeper checks, manifest/release tests, web production build and HTTP/container checks.
- [ ] Exercise local-fork browser flows for account creation, fee-bearing loop, owner-funded repay/close and capability/health/error states. Keep local transactions labelled; collect actual funded-chain proof only through an authorized configured identity.
- [ ] Generate a full immutable diff review package from main base to completed branch and dispatch a fresh broad reviewer. Fix important findings with reproducing tests and rerun affected/full suites; record decisions and external blockers.
- [ ] Recheck remote main, resolve any changes, push branch and merge using authorized GitHub/Git SDK. Use PR/CI gating where available; do not bypass branch protection or extract authentication tokens. If API auth remains unavailable, complete local reviewed work and attempt the configured authorized Git transport before requesting account repair.
- [ ] Verify resulting remote main SHA and available CI results; update completion matrix distinguishing implemented, tested, deployed, verified and externally pending. Mainnet go-live remains separately gated by the approved design.
