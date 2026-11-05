# Coil keeper

Node 22 service. Run `npm ci`, `npm run typecheck`, and `npm run check`; start with
`npm start -- --watch`. Monitoring is the default. Add `--execute` or
`COIL_EXECUTE=true` only for an authorized funded keeper. The service only submits
`guard()` and `heartbeat()` transactions and simulates both before submission.

The canonical `../deployments/manifest.json` generates `src/deployment.generated.ts`.
Run the root deployment generator after changing the manifest; include the generated
copy in the keeper Docker build context. Build with `docker build keeper`.

Configuration:

| Variable | Meaning |
| --- | --- |
| `COIL_CHAIN_ID` | `31611` (default, matsnet) or `31612` (mainnet) |
| `COIL_RPC_URL` | Selected chain's HTTP RPC; defaults to manifest RPC. `MEZO_TESTNET_RPC` / `MEZO_MAINNET_RPC` are chain-specific fallbacks. |
| `COIL_FACTORY`, `COIL_FACTORY_DEPLOY_BLOCK` | Optional selection **pair**, nonzero address and positive decimal block. Active and retained manifest factories require their matching chain and creation block. |
| `COIL_EXPECTED_KEEPER` | Expected public signer; defaults to manifest keeper for that deployment. Mandatory for execution. Must match manifest and wallet; heartbeat additionally requires live factory `keeper()`. |
| `KEEPER_PRIVATE_KEY` | Execution key from service secrets. Never put it in build arguments, checked-in files, public status, or logs. |
| `COIL_MAINNET_ENABLED` | Mainnet execution additionally requires `true` and a ready active or retained mainnet manifest deployment. This is a release gate, not authorization to go live. |
| `KEEPER_WATCH` | `true` for continuous polling (Docker default). |
| `KEEPER_POLL_MS` | Poll interval, default `20000`, range 3000–300000 ms. |
| `PORT` | HTTP listen port on `0.0.0.0`; Railway assigned value, default `3000`. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Optional alerts and `/watch`, `/unwatch`, `/help` commands. No configured Telegram means no notification requests. |
| `WATCHES_PATH` | Optional watch file, default `/tmp/coil-watches.json`; mount a volume if watches must persist. Watched clones must belong to the selected factory. |

A keeper service covers **one chain/factory/deployment-block generation**. The generated
`DEPLOYMENTS` selects the active generation by default; `RETAINED_DEPLOYMENTS` records
older deployed generations. An explicit pair selecting a retained generation binds its
own expected signer, implementation, RPC, explorer and capabilities. It never inherits
those fields from a replacement active deployment. Incorrect known blocks, other-chain
pairs and a signer conflicting with the selected record fail configuration. Mainnet
execution still requires that selected record to be `ready` and the explicit enable flag;
retention alone cannot upgrade release readiness.

Retention preserves account identity; it does not make every old ABI compatible with the
current keeper adapter. Public getter checks confirm that the current adapter supports
the reserve generations `0xff3335…5BC8` and `0x2218…9De5` as well as the new policy build.
The earlier flash generation `0x6A38…31F7` lacks `park`, `pegGuardBps` and
`rescueSlippageBps`; Wave 1 `0xE29f…8a3e` also lacks `pool` and `tipMezo`. Do not deploy
this current binary to those older generations and claim execution coverage. Preserve
and pin a prior compatible container image digest/source revision together with its
factory/block, or validate a dedicated compatible adapter before changing that service.
Record its actual successful account reads, guard simulation/execution and generation-
specific health before claiming protection. No compatible prior image or active coverage
for those two historical generations is established by this change. Unsupported reads
in the current adapter degrade scanning; a retained catalog entry is not a health proof.

Before replacing an active factory, pin the existing keeper service to its exact public
`COIL_CHAIN_ID`, `COIL_FACTORY`, and `COIL_FACTORY_DEPLOY_BLOCK`. Preserve its compatible container image digest/source revision, signer,
funding, environment, watch volume, and public status URL. Keep that service running for
as long as accounts on that generation retain state requiring monitoring or rescue.
Updating the active manifest must not redirect that pinned service. Create a separate
service for the replacement factory, configure its own selected pair and expected signer,
and verify its own account enumeration, fresh successful scans, confirmed expected-keeper
heartbeats, and rescue behavior before claiming execution coverage. Each generation has
its own health URL; a healthy new service says nothing about an older factory's accounts.
Retire an old service only after the accounts no longer need it or an explicitly validated
replacement service covers that exact generation. No deployment or coverage proof is
created by this configuration support alone.

Do not add clones from an older factory to the new service's `/watch` list as a rollout
shortcut. Watched clones must report the selected factory; foreign clones fail snapshot
validation and degrade scanning instead of being silently counted as protected. With a
retained manifest keeper of null, the service has no authenticated expected signer by
default and monitoring must be described as monitoring. Execution requires an authorized
configured signer; heartbeat health additionally requires matching live factory registration.

Use separate service environments and funded identities for matsnet and mainnet.
Protocol addresses are read from the selected clone, never reused from matsnet.
Every scan checks the RPC chain and latest block freshness; factory code must exist
at the configured deployment block and a known implementation must match the manifest.
Writes recheck chain freshness; heartbeat also checks the live expected keeper. Permissionless guard remains available if only the heartbeat registration differs. Failed simulations
never submit a transaction. Only successful receipts increment confirmation counters.
A failed, reverted, or unconfirmed heartbeat never advances heartbeat freshness.

Per-account no-op/failure retries begin at twice the polling interval and increase
exponentially, capped at five minutes. Every poll still refreshes the account's
position, oracle, pool liquidity, funded reserve, guard settings, Recovery Mode, and pool pause/fee policy.
All collateral, rank, owner/settings, oracle, pool and reserve changes reset the delay
immediately. Accrued debt and derived CR/liquidation-price dust do not restart it:
CR movement of at least one relative basis point (0.01%), debt growth of at least
one relative basis point, or any observed debt reduction since the previous successful
poll resets immediately, including after an accrued-interest poll skipped simulation. Compare with
the original retry anchor, so small changes accumulate rather than disappearing
behind a moving baseline. The separate last-observed debt updates on every successful
snapshot and never moves those cumulative-risk anchors. Crossing the guard floor, target, or Mezo's 110% liquidation
and 150% critical-ratio boundaries remains exact even for a one-wei CR change,
regardless of mode. Smaller same-regime drift can
wait for the existing bounded retry, at most five minutes; a tiny debt increase
cannot be distinguished from interest accrual without another changed input.
Unchanged failure alerts remain deduplicated across these retries and changed market
inputs within one risk episode. A changed failure code, newly actionable simulation,
or confirmed guard still alerts; resolved risk or successful rescue clears the episode.
State is in memory and restarts clear backoff. Telegram/provider errors are reported
using fixed safe messages; response bodies, RPC URLs, keys, and tokens are omitted.

`GET /status` returns only `chainId`, `factory`, public `keeper` (or null), `mode`,
`lastScanAt`, `lastHeartbeatAt`, `status`, and numeric `counters`. Timestamps are
Unix epoch milliseconds, null before success. No environment or raw errors appear.
`GET /health` has the same JSON and returns HTTP 200 for fresh `monitoring` or
`healthy` operation; `starting`, `degraded`, and `stale` return HTTP 503. `/status`
remains HTTP 200 so clients can inspect unhealthy state. A read-only service is
`monitoring`, never active transaction protection. Set Railway's health path to
`/health` using service settings and the service root to `keeper`.

A completed scan ages out after the greater of 60 seconds or three polling intervals.
RPC/position read failures cannot refresh its success timestamp. Execute health also
requires a recent confirmed heartbeat from the configured wallet. Legacy factories
have permissionless heartbeat events: this service's confirmed transactions are
operational observations, not evidence that arbitrary historical events came from
the expected keeper. Consumers must check sender identity for on-chain history.

`npm run check` includes a real ephemeral localhost HTTP server. Restricted sandboxes
may require the test command to run with localhost listen permission. No checks send
external notifications or chain transactions; RPC behavior uses an in-process boundary
fixture and the HTTP check calls only localhost.
