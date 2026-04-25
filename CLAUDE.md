## Stack

- **Runtime**: Node.js >= 20 LTS (see `.nvmrc`)
- **Framework**: NestJS v11 with `@nestjs/platform-express`
- **Language**: TypeScript 5 (strict mode)
- **Package manager**: npm

## Layout

```
src/
  app.module.ts          # Root module — imports all 11 feature modules
  shared/                # Global SharedModule (guards, decorators, filters, interceptors)
  tenancy/               # Auth, Users, Roles, Tenants
  catalog/               # Services, Products, Staff Qualifications
  commerce/              # Sale Orders, Payments, Checkout
  scheduling/            # Appointments, Staff Schedules
  finance/               # Financial Accounts, Transactions, Cash Register
  inventory/             # Stock, Purchase Orders
  pricing/               # Price Rules
  subscription/          # Plans, Subscriptions
  support/               # Tickets
  notification/          # Email, SMS, Push
test/                    # E2E tests
```

## Commands

```bash
npm run start:dev   # Start dev server with watch mode
npm run build       # Compile to dist/
npm run lint        # ESLint (auto-fix)
npm run test        # Jest unit tests
npm run test:e2e    # Jest E2E tests
npm run test:cov    # Coverage report
```

## Conventions

- Each bounded context module lives in `src/<context>/` and exports `<Context>Module`
- Each module file set: `<context>.module.ts`, `<context>.controller.ts`, `<context>.service.ts`, `<context>.controller.spec.ts`
- Path aliases (`@tenancy/*`, `@catalog/*`, …, `@shared/*`) are configured in `tsconfig.json` and `jest.moduleNameMapper` — use them for cross-context imports
- `SharedModule` is `@Global()` — do not re-import it in bounded context modules
- TypeScript strict mode is on — all `noImplicitAny`, `strictNullChecks`, etc. are enforced

## Docker

Production image is defined in `Dockerfile` (multi-stage: `deps` → `build` → `prod-deps` → `runtime`). The runtime stage is `node:20-alpine`, runs as non-root user `app`, exposes port `3000`, and starts `node dist/main.js`.

```bash
docker build -t maco-backend .
docker run --rm -p 3000:3000 maco-backend
```

`.dockerignore` excludes `node_modules`, `dist`, `.git`, `.devcontainer`, and other host artifacts so the build context stays small. CI builds the image in the `docker` job (after `test` and `build`) using buildx with GitHub Actions layer cache.

## Dev container / Devpod

`.devcontainer/` follows the standard devcontainer spec, so it works with VS Code Dev Containers, GitHub Codespaces, and Devpod.

- `devcontainer.json` — `app` service, workspace at `/workspace`, runs `npm install` post-create, forwards `3000` (NestJS) and `5432` (Postgres), preinstalls ESLint/Prettier/Jest/Docker VS Code extensions
- `docker-compose.yml` — two services on a shared `dev` bridge network:
  - `app` — `mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm`, loads `.env` if present, `node_modules` lives in a named volume to avoid host I/O penalty
  - `db` — `postgres:16-alpine` with creds from env vars (default `maco/maco/maco`) and a healthcheck
- `DATABASE_URL=postgresql://maco:maco@db:5432/maco` — Postgres is reachable at hostname `db` inside the container network
- Copy `.env.example` → `.env` and customise before first `devpod up`

```bash
# Devpod
devpod up . --ide vscode      # or --ide none for terminal-only
devpod ssh maco-backend       # shell into the workspace
devpod stop maco-backend

# VS Code: "Dev Containers: Reopen in Container"
```

Inside the container, run the standard `npm run start:dev`, `npm test`, etc.
