# Coil web

## Railway CI/CD

GitHub Actions checks contracts, keeper behavior, and the production web image
on pushes and pull requests. A successful push to `main` (or a manual run on
`main`) deploys the web service to Railway after all three jobs pass. Pull
requests never run the production deployment job.

The release image builds the Next.js static export using Node 22 and
`npm ci --legacy-peer-deps`, then serves it with Nginx on Railway's `PORT`.
`/guard` and `/stats` resolve to their exported pages, static assets have long
cache lifetimes, and unknown routes return 404. `next start` is not used.

Configure these in the repository's GitHub **production** environment before
enabling deployment:

| Setting | Kind | Value |
| --- | --- | --- |
| `RAILWAY_TOKEN` | Secret | Railway project token scoped to the intended production environment |
| `RAILWAY_PROJECT_ID` | Variable | Target Railway project ID |
| `RAILWAY_ENVIRONMENT_ID` | Variable | Target Railway environment ID |
| `RAILWAY_SERVICE_ID` | Variable | Web service ID; do not use the keeper service |
| `RAILWAY_PUBLIC_URL` | Variable | Public HTTPS base URL of that service |

Use GitHub Settings → Environments → production for these values. Never commit
the token or paste it into an issue or pull request. Missing settings fail the
deployment job before an upload. Environment reviewers can be configured there
if releases need approval.

The workflow uploads `web/` as the deployment archive root. Set the Railway
service's root directory to `/`, remove old build/start command overrides, and
let `railway.json` select the Dockerfile and health check. Disable a separate
Railway GitHub auto-deploy trigger for this service so it cannot release before
the workflow's CI gate. The workflow is the release trigger.

Optional public build variables belong in the Railway service:
`NEXT_PUBLIC_COIL_FACTORY` and `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`. They are
compiled into the exported app, so changing them requires a new deployment.
The default factory remains the currently deployed testnet factory.

The pinned Railway CLI waits for the deployment status, with `/` as the Railway
health check. The workflow also requires its explicit terminal JSON success
event, so an interrupted status stream cannot pass on exit code alone.
The workflow then requests `/`, `/guard`, and `/stats` on the
public URL and checks their Coil Labs HTML. A build finishing alone does not
count as a verified release.

For a local production-image check:

```bash
docker build -t coil-web:local web
docker run --rm -e PORT=3000 -p 3000:3000 coil-web:local
```

From a trusted proxy environment, an optional BuildKit `proxy_ca` secret can
supply the CA bundle during build; it is never copied into the image. Railway
and ordinary GitHub runners do not need that local build secret.

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
