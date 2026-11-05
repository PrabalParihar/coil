# Railway CI/CD Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan in the current isolated cloud checkout. Steps use checkbox syntax for tracking.

**Goal:** Validate every change in GitHub Actions and deploy the Coil web app to Railway after checks pass on `main`.

**Architecture:** Keep the existing contract checks, add keeper validation and a Docker build/runtime check for the static Next.js export, then use Railway’s native GitHub deployment trigger with Wait for CI enabled. Keep deployment authentication in the existing Railway integration; no GitHub deployment secret is required. Keep keeper transaction execution and contract deployment out of the web release.

**Tech Stack:** GitHub Actions, Foundry 1.8.5, Node 22, Docker, Nginx, Railway native GitHub integration.

**Spec:** User requests to deploy to Railway and set a CI/CD pipeline; existing static-export behavior in `web/next.config.ts` and deployment notes in `README.md`.

## Global Constraints

- Preserve application logic and dependency lockfiles.
- Use `npm ci --legacy-peer-deps` for the web lockfile and `npm ci` for the keeper.
- Automatically deploy pushes to `main` after all checks pass; manual workflow dispatch runs validation only. Pull requests must not deploy.
- Use Railway's `PORT` and serve `/`, `/guard`, `/stats`, static assets, and real 404 responses.
- Reuse the authenticated Railway/GitHub integration; do not add a Railway token to GitHub.

## Review Focus

- Static export cannot be served with `next start`: verify the actual container's routes.
- The trigger must target only the existing production web service, branch `main`, with `checkSuites: true`.
- Production releases must wait for all CI jobs and for the deployed service to become healthy.
- Npm's legacy peer resolution must remain frozen and leave lockfiles unchanged.
- The production Dockerfile must avoid unsupported BuildKit mounts on Railway; session-specific proxy trust must not enter production layers.

### Task 1: Web release image

**Files:** Create `web/Dockerfile`, `web/.dockerignore`, and `web/nginx.conf.template`; configure the Railway service health check directly. Remove the obsolete `web/railway.json` because the current API rejects legacy Config as Code.

- [ ] Build the static export in a Node 22 stage with frozen dependencies.
- [ ] Serve it with Nginx on Railway's port, including extensionless routes and 404s.
- [ ] Build and run the image locally; verify application pages and an unknown route.

### Task 2: Pipeline and operational instructions

**Files:** Modify `.github/workflows/ci.yml` and `web/README.md`; configure the existing Railway web service and its GitHub deployment trigger.

- [ ] Pin Foundry and add keeper and container checks.
- [ ] Connect Railway to `PrabalParihar/coil` on `main` with Wait for CI enabled, root `/web`, and the web Dockerfile, with no legacy config-file setting.
- [ ] Validate workflow syntax, all CI jobs, and the actual Railway trigger/settings readback.
- [ ] Document native CI-gated deployment, service root, deployment verification, and rollback.
- [ ] Publish the reviewed change to GitHub and verify the available CI results.
- [ ] Deploy and verify Railway once account authorization and the target service are available.
