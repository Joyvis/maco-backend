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
    cqrs/              # BaseCommand, BaseEvent, BaseCommandHandler, BaseEventHandler
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

## CQRS

`@nestjs/cqrs` is installed and `CqrsModule.forRoot()` is registered globally in `AppModule`.

- Base classes live in `src/shared/cqrs/` — import via `@shared/cqrs/base-command`, etc.
- Pattern: `Command → @CommandHandler → entity mutation → EventBus.publish(event) → @EventsHandler`
- Commands extend `BaseCommand` (requires `tenant_id` + `user_id`); events extend `BaseEvent` (requires `tenant_id`, `source_command`, `correlation_id`)
- `BaseEventHandler` wraps `process()` with 3-retry exponential backoff (100 → 200 → 400 ms); never re-throws
- Feature modules must import `CqrsModule` (not `forRoot`) and register handlers as providers — see `TenancyModule` for reference
- `ICommandHandler` is a conditional type in v11 — do **not** use `implements ICommandHandler<T>`; use `extends BaseCommandHandler<T>` instead
- E2E tests must call `await app.init()` after `compile()` so `onApplicationBootstrap` registers handlers

## Docker

Production image is defined in `Dockerfile` (multi-stage: `deps` → `build` → `prod-deps` → `runtime`). The runtime stage is `node:20-alpine`, runs as non-root user `app`, exposes port `3000`, and starts `node dist/main.js`.

```bash
docker build -t maco-backend .
docker run --rm -p 3000:3000 maco-backend
```

`.dockerignore` excludes `node_modules`, `dist`, `.git`, `.devcontainer`, and other host artifacts so the build context stays small. CI builds the image in the `docker` job (after `test` and `build`) using buildx with GitHub Actions layer cache.

## Dev container / Devpod

`.devcontainer/` follows the standard devcontainer spec, so it works with VS Code Dev Containers, GitHub Codespaces, and Devpod.

- `devcontainer.json` — `app` service, workspace at `/workspace`, runs `npm ci` post-create, forwards `3000` (NestJS) and `5432` (Postgres), preinstalls ESLint/Prettier/Jest/Docker VS Code extensions
- `docker-compose.yml` — two services:
  - `app` — `mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm`, `network_mode: service:postgres` (so Postgres is reachable at `localhost:5432`), `node_modules` lives in a named volume to avoid host I/O penalty
  - `postgres` — `postgres:16-alpine` with creds `maco/maco/maco` and a healthcheck
- `DATABASE_URL=postgresql://maco:maco@localhost:5432/maco` is injected into the app container

```bash
# Devpod
devpod up . --ide vscode      # or --ide none for terminal-only
devpod ssh maco-backend       # shell into the workspace
devpod stop maco-backend

# VS Code: "Dev Containers: Reopen in Container"
```

Inside the container, run the standard `npm run start:dev`, `npm test`, etc.
