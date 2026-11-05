# Coil web

## Railway CI/CD

GitHub Actions checks contracts, keeper behavior, and the production web image
on pushes and pull requests. Railway native GitHub deployment with **Wait for
CI** is the required target configuration. The latest authenticated inspection
still returned an empty `deploymentTriggers` list; a repository/branch source
label does not prove an automatic trigger exists. Do not describe native
auto-deploy or Wait for CI as enabled until a fresh API read confirms it.

First authorize Railway’s GitHub integration for `PrabalParihar/coil` using an
account with repository access. A source label alone does not create an
automatic deployment trigger. If Railway reports that no one in the project
has access, grant that repository access before enabling Wait for CI. Until
the trigger exists, use authenticated CLI uploads only after CI passes.

The release image builds the Next.js static export using Node 22 and
`npm ci --legacy-peer-deps`, then serves it with Nginx on Railway's `PORT`.
`/guard`, `/stats`, and `/keeper` resolve to their exported pages, static assets have long
cache lifetimes, and unknown routes return 404. `next start` is not used.

The existing production target is:

| Setting | Value |
| --- | --- |
| Project | `coil` (`095d6e00-938c-41cd-8941-27dee0996eaf`) |
| Environment | `production` (`3b985932-0f86-4281-acb9-fb7626e8be25`) |
| Service | `web` (`0d117789-e565-47dd-a021-7dc9705f1ce0`) |
| Public URL | `https://coil.up.railway.app` |
| GitHub source | `PrabalParihar/coil`, branch `main` |
| Root directory | `/web` |
| Railway config file | Unset; service settings supply root and health check |
| Dockerfile | `Dockerfile`, detected under the service root |
| Wait for CI | Required target; native deployment trigger currently unconfigured |
| Health check | `/`, timeout 120 seconds |

Keep build and start command overrides unset so the Dockerfile controls the
release. Do not add `railway.json` or `railway.toml`; the current Railway API
rejects that deprecated configuration format. The root, Dockerfile path, and
health check above are stored in the Railway service settings. These settings apply only to `web`; the `keeper` service and its
credentials are separate. A failed CI run must leave the previous successful
web deployment serving traffic.

After a supported native trigger is configured and verified, a push to `main`
can trigger deployment with Wait for CI. At the latest inspection that trigger
is absent. A manual GitHub workflow run reruns checks; it does not upload an app
by itself. For a manual release or
rollback, use the Railway service's Deployments page after checking the desired
commit's CI results. Avoid introducing a second GitHub Actions deploy job or
another trigger for the same service.

Optional public build variables belong in the Railway service:
`NEXT_PUBLIC_COIL_FACTORY` with `NEXT_PUBLIC_COIL_FACTORY_DEPLOY_BLOCK`,
`NEXT_PUBLIC_COIL_CHAIN_ID` (31611 or 31612), and optional
`NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. They are
compiled into the exported app, so changing them requires a new deployment.
The default factory remains the currently deployed testnet factory.

Verify the Railway deployment reaches `SUCCESS` for the intended commit, then
request `/`, `/guard`, `/stats`, and `/keeper` on the public URL and check their Coil Labs
HTML. Railway's health check must pass before a rollout succeeds. A build
finishing or a CLI exiting alone does not count as a verified release.

For a local production-image check from the repository root:

```bash
docker build -t coil-web:local web
docker run --rm -e PORT=3000 -p 3000:3000 coil-web:local
```

The production Dockerfile uses ordinary Docker build steps because Railway
does not support BuildKit secret mounts. GitHub CI builds and tests this exact
Dockerfile. Preserve TLS verification when using any local proxy; do not add
session certificates to the production image.

For rollback, redeploy the previous successful deployment from the Railway
service's Deployments page. This pipeline deploys only the web app; it does not
deploy contracts or enable keeper signing.

## Development

Next.js app for Coil. Connect a wallet on Mezo testnet, preview a loop from the live oracle and the MUSD/BTC pool, then create an account, loop, de-lever, unwind, and set the guard.

Setup, contract addresses, and risks are in the repository README.

```bash
npm install
npm run dev
```

The dev server listens on [http://127.0.0.1:43123](http://127.0.0.1:43123).

`npm run build` writes a static export to `out/`. The live demo at
[coil.up.railway.app](https://coil.up.railway.app) serves that export.
The public source of truth is `deployments/manifest.json`, copied by the root
`node scripts/deployments.cjs --generate` command into the web build context.
Do not edit `src/lib/deployment.generated.ts` manually. The current production
pair is `0xff3335576f998EE872596d4EB7ABECb71a0D5BC8`, block `16408315`,
explicitly labelled legacy. Existing clones retain their deployed capabilities.

Set `NEXT_PUBLIC_COIL_CHAIN_ID=31612` for mainnet market reads and matching
wallet/RPC/explorer selection. Mainnet transactions require a real `ready`
manifest entry and `NEXT_PUBLIC_COIL_ENABLE_MAINNET_WRITES=true`; a public
factory override cannot turn a pending mainnet release into a ready one.
The opening target defaults to 200% CR (about 2×). Contracts are unaudited and
pool depth and explicit position limits need review before release.

A custom/local factory override must include both `NEXT_PUBLIC_COIL_FACTORY`
and `NEXT_PUBLIC_COIL_FACTORY_DEPLOY_BLOCK`. Invalid or partial pairs fail
build/start configuration. A known factory must match its selected-chain
manifest block; a factory belonging only to another chain is rejected. Matching
canonical pairs retain their provenance, including when the same address exists
on both chains. A different override clears unrelated keeper/implementation
provenance, then the UI probes `policy()` for new implementation capabilities.
The accepted fee ceiling is included in new loop selectors. Coil fees apply to
gross minted MUSD; protocol and pool fees are separate. Before account creation the browser estimates a fresh position. New-policy
accounts use state-aware `quoteFlashLoopWithFee` / `quoteLoopWithFee` views for
existing collateral, total debt (including refinancing), gross mint and Coil
fee. Input/account/chain/policy changes invalidate the old quote immediately;
refresh/error states disable loop consent until a matching quote succeeds.
Legacy-account increases retain a labelled fresh-position estimate. Contracts
enforce actual resulting limits. Paused openings do not disable safe owner actions.

New accounts expose surplus claim, MUSD repayment, MUSD close and direct BTC
top-up. MUSD approvals target the account. Repayment respects minimum debt and
returns unused owner funds. Mezo blocks full close during Recovery Mode; the
owner may repay safely and submit a close later when permitted. No automatic
close is queued. Closing with an owner maximum of zero can use sufficient
account/reserve funds without an allowance.

WalletConnect is shown only with a valid configured 32-hex project ID. Without
one, injected and OrangeKit Bitcoin connectors remain available. Passport
remains conditional because its pinned package does not compile; OrangeKit
continues as the explicit fallback.

Optional `NEXT_PUBLIC_KEEPER_STATUS_URL` must be a public HTTPS endpoint without
credentials, query/fragment parameters, local/private hostnames, IP literals or
custom ports. The UI fetches GET only with omitted credentials, no redirects,
no-store caching and an 8-second timeout. It validates the exact public schema,
selected chain/factory, expected execution keeper, epoch-ms timestamps, modes,
status consistency and finite nonnegative counters before displaying it.
Read-only services may report `keeper: null`; execution requires the expected
nonzero keeper. Service scans expire after 60 seconds in the UI, independently
of the service's reported status. Missing URL explicitly shows chain evidence
only / unavailable service mode; invalid or unavailable configured URLs show a
service error alongside separately labelled chain evidence. Monitoring never
claims transaction protection. Superseded requests abort and cannot publish
stale identity results.

`/keeper` shows authenticated expected-keeper heartbeat freshness (180 seconds)
and rejects stale RPC evidence. Legacy permissionless heartbeats are history,
not proof of keeper health. Monitoring mode is not transaction protection.
Owner discovery checks the current plus retained same-chain catalog, including
all documented legacy generations. It deduplicates the same factory/block pair,
defaults to an older funded position ahead of a new empty clone, and keeps
unreadable older accounts visible. The selector binds each clone's factory,
block, capability probes and transaction calls; old clones are not upgraded.
Changing account/factory invalidates fee quote consent. Explicit generation
selection remains available so current-factory onboarding does not hide funded
legacy positions or their existing owner exit controls.

`/guard` loads the latest 9,999-block window and paginates older windows, with
retry/error states and a visible first-40-account scanning limit. `/stats` publishes factory counts before slow history, reads only a recent
9,999-block window initially, and offers explicit older pages ending before the
previous earliest block. Event identities are deduplicated across refreshes. It
shows public chain observations and incomplete counts honestly; it does not
assert real-user recruitment or release verification.

Run offline web checks after dependencies are installed:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

The Node test runner transpiles TypeScript through the existing compiler;
no additional test dependency is required. Container/browser verification of
`/`, `/guard`, `/stats`, `/keeper`, static assets and unknown-route 404s is a
separate integration check. A successful build is not deployment evidence.
