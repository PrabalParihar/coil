# Railway CI/CD Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan in the current isolated cloud checkout. Steps use checkbox syntax for tracking.

**Goal:** Validate every change in GitHub Actions and deploy the Coil web app to Railway after checks pass on `main`.

**Architecture:** Keep the existing contract checks, add keeper validation and a Docker build/runtime check for the static Next.js export, then gate the Railway deployment job on all three. Use a project-scoped Railway token and explicit project, environment, and service IDs. Keep keeper transaction execution and contract deployment out of the web release.

**Tech Stack:** GitHub Actions, Foundry 1.8.5, Node 22, Docker, Nginx, Railway CLI 5.71.0.

**Spec:** User requests to deploy to Railway and set a CI/CD pipeline; existing static-export behavior in `web/next.config.ts` and deployment notes in `README.md`.

## Global Constraints

- Preserve application logic and dependency lockfiles.
- Use `npm ci --legacy-peer-deps` for the web lockfile and `npm ci` for the keeper.
- Deploy on pushes to `main` or manual dispatch, after all checks pass; never deploy pull-request code with production secrets.
- Use Railway's `PORT` and serve `/`, `/guard`, `/stats`, static assets, and real 404 responses.
- Credentials belong in secure Railway/GitHub settings, never in committed files.

## Review Focus

- Static export cannot be served with `next start`: verify the actual container's routes.
- Missing target IDs or token must fail with clear errors before uploading.
- Production releases must wait for all CI jobs and for the deployed service to become healthy.
- Npm's legacy peer resolution must remain frozen and leave lockfiles unchanged.
- Proxy trust used for local verification must remain optional and absent from image layers.

### Task 1: Web release image

**Files:** Create `web/Dockerfile`, `web/.dockerignore`, `web/nginx.conf.template`, and `web/railway.json`.

- [ ] Build the static export in a Node 22 stage with frozen dependencies.
- [ ] Serve it with Nginx on Railway's port, including extensionless routes and 404s.
- [ ] Build and run the image locally; verify application pages and an unknown route.

### Task 2: Pipeline and operational instructions

**Files:** Modify `.github/workflows/ci.yml` and `web/README.md`; create a small deployment status check only if needed by Railway CLI's build-only wait behavior.

- [ ] Pin Foundry and add keeper and container checks.
- [ ] Add a production deployment job gated by all checks and explicit secure settings.
- [ ] Validate workflow syntax and target/settings failure behavior.
- [ ] Document required settings, service root, deployment verification, and rollback.
- [ ] Publish the reviewed change to GitHub and verify the available CI results.
- [ ] Deploy and verify Railway once account authorization and the target service are available.
