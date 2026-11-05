# Coil web

## Railway CI/CD

GitHub Actions checks contracts, keeper behavior, and the production web image
on pushes and pull requests. Railway's native GitHub integration deploys the
`web` service from `main` after those checks pass. Enable **Wait for CI** on the
Railway deployment trigger. There is no token-bearing deployment job in GitHub
Actions and no Railway secret or target variables to configure in GitHub.

First authorize Railway’s GitHub integration for `PrabalParihar/coil` using an
account with repository access. A source label alone does not create an
automatic deployment trigger. If Railway reports that no one in the project
has access, grant that repository access before enabling Wait for CI. Until
the trigger exists, use authenticated CLI uploads only after CI passes.

The release image builds the Next.js static export using Node 22 and
`npm ci --legacy-peer-deps`, then serves it with Nginx on Railway's `PORT`.
`/guard` and `/stats` resolve to their exported pages, static assets have long
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
| Wait for CI | Enabled (`checkSuites: true`) |
| Health check | `/`, timeout 120 seconds |

Keep build and start command overrides unset so the Dockerfile controls the
release. Do not add `railway.json` or `railway.toml`; the current Railway API
rejects that deprecated configuration format. The root, Dockerfile path, and
health check above are stored in the Railway service settings. These settings apply only to `web`; the `keeper` service and its
credentials are separate. A failed CI run must leave the previous successful
web deployment serving traffic.

A push to `main` is the automatic release trigger. A manual GitHub workflow run
reruns checks; it does not upload an app by itself. For a manual release or
rollback, use the Railway service's Deployments page after checking the desired
commit's CI results. Avoid introducing a second GitHub Actions deploy job or
another trigger for the same service.

Optional public build variables belong in the Railway service:
`NEXT_PUBLIC_COIL_FACTORY` and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. They are
compiled into the exported app, so changing them requires a new deployment.
The default factory remains the currently deployed testnet factory.

Verify the Railway deployment reaches `SUCCESS` for the intended commit, then
request `/`, `/guard`, and `/stats` on the public URL and check their Coil Labs
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

`npm run build` writes a static export to `out/`. The live demo at [coil.up.railway.app](https://coil.up.railway.app) serves that export. On Vercel, set the project root to `web`. The app defaults to the live Wave 2 factory `0x2218D33d2f9279A4266b49dB572F5b1343d09De5` (block 16407578). Set `NEXT_PUBLIC_COIL_FACTORY` in `.env.local` to use a different one. That factory has the reserve and the peg gate. Close fixes that spend the reserve and skip a failing BTC sale need a newer factory. `/stats` is the public count page. Mainnet numbers on the desk are read-only.
