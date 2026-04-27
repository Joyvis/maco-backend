# maco-backend

NestJS backend for the MacoSaaS Agent Orchestrator.

## Stack

- **Runtime**: Node.js >= 20 LTS (see `.nvmrc`)
- **Framework**: NestJS v11 with `@nestjs/platform-express`
- **Language**: TypeScript 5 (strict mode)
- **Package manager**: pnpm (switched from npm in MACO-81)
- **Linting**: ESLint 9 (flat config) + `typescript-eslint` + `eslint-plugin-import` + `eslint-plugin-prettier`
- **Formatting**: Prettier 3 (config in `.prettierrc`)
- **Pre-commit**: Husky 9 + lint-staged

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
npm run start:dev       # Start dev server with watch mode
npm run build           # Compile to dist/
npm run lint            # ESLint (report violations, fail on warnings)
npm run lint:fix        # ESLint --fix
npm run format          # Prettier --write
npm run format:check    # Prettier --check
npm run test            # Jest unit tests
npm run test:e2e        # Jest E2E tests
npm run test:cov        # Coverage report
npm run migration:create  # Generate a migration from entity diff
npm run migration:up      # Apply pending migrations
npm run migration:down    # Revert last migration
npm run migration:fresh   # Drop + re-apply all migrations
```

## MikroORM

- **Version**: MikroORM v6 (CommonJS; v7 is ESM-only and incompatible with this project's tsconfig)
- **Config**: `mikro-orm.config.ts` (root) — consumed by both the NestJS module and the CLI
- **Entities**: glob `src/**/*.entity.ts`; discovered automatically — no manual registration needed
- **Base entities**: `src/shared/entities/base.entity.ts` (id/created_at/updated_at) and `tenant-scoped.entity.ts` (+tenant_id + global `tenant` filter)
- **Migrations**: live in `src/migrations/`; generated via `npm run migration:create`
- **Tenant filter**: enabled by default on all `TenantScopedEntity` subclasses. Set params: `em.setFilterParams('tenant', { tenantId })`. Disable per-query: `em.find(Entity, {}, { filters: { tenant: false } })`
- **RequestContext**: `MikroOrmMiddleware` is applied globally in `AppModule` — Identity Map is scoped per HTTP request
- **SQLite in tests**: use `@mikro-orm/sqlite` in-memory for integration tests; avoid `defaultRaw: 'now()'` in schema creation because SQLite uses `CURRENT_TIMESTAMP` instead

## Conventions

- Each bounded context module lives in `src/<context>/` and exports `<Context>Module`
- Each module file set: `<context>.module.ts`, `<context>.controller.ts`, `<context>.service.ts`, `<context>.controller.spec.ts`
- Path aliases (`@tenancy/*`, `@catalog/*`, …, `@shared/*`) are configured in `tsconfig.json` and `jest.moduleNameMapper` — use them for cross-context imports
- `SharedModule` is `@Global()` — do not re-import it in bounded context modules
- TypeScript strict mode is on — all `noImplicitAny`, `strictNullChecks`, etc. are enforced
- Single quotes, 2-space indent, 100-char line width (Prettier)
- `@typescript-eslint/no-explicit-any` → error; `no-unused-vars` → error
- Import order enforced by `eslint-plugin-import` (builtin → external → internal)
- Editor settings defined in `.editorconfig`

## Setup after clone

```bash
npm install        # installs deps and runs `husky` via prepare script
```

The `prepare` script runs `husky` automatically on `npm install`, which wires up the
pre-commit hook. The `.husky/pre-commit` file must exist (committed to the repo) for
the hook to run. To initialize it for the first time:

```bash
npx husky init
# then overwrite .husky/pre-commit with:
echo "npx lint-staged" > .husky/pre-commit
```

The pre-commit hook runs `eslint --fix` + `prettier --write` on staged `.ts` files
via lint-staged (configured in `package.json`).

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

Multi-stage `Dockerfile` with four named stages: `base` → `development` → `build` → `prod-deps` → `production`. The `production` stage is `node:20-alpine`, runs as non-root user `app`, exposes port `3000`, and starts `node dist/main.js`.

```bash
# Development image (hot-reload via nest start --watch)
docker build --target development -t maco-dev .
docker run --rm -p 3000:3000 maco-dev

# Production image
docker build --target production -t maco-prod .
docker run --rm -p 3000:3000 maco-prod
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

## JWT Authentication

`@nestjs/jwt`, `@nestjs/passport`, `passport-jwt`, and `bcrypt` are installed.

- Auth module lives in `src/tenancy/auth/` — imported by `TenancyModule`
- **Global guard**: `JwtAuthGuard` is registered via `APP_GUARD` in `AuthModule` — all routes are protected by default
- **@Public()**: decorator in `src/tenancy/auth/public.decorator.ts` — skip auth for a handler or controller
- **@CurrentUser()**: param decorator in `src/tenancy/auth/current-user.decorator.ts` — injects `{ id, tenantId, roles }`
- **TenantGuard**: use `@UseGuards(TenantGuard)` on routes with a `:tenantId` path param to enforce cross-tenant isolation
- Entities: `User` and `UserRole` live in `src/tenancy/entities/` — the `users` and `user_roles` tables are created here
- Refresh tokens: stored hashed (bcrypt) in `refresh_tokens` table; token rotation is enforced; replay detection revokes all user tokens
- Env vars required: `JWT_SECRET`, `JWT_REFRESH_SECRET` — TTLs default to 900s / 604800s (see `.env.example`)
- JWT `roles` field contains role **names** (strings from `roles.name` column), not enum literals

## Tenant Self-Service Onboarding

- `POST /sign-up` — public endpoint; creates a tenant with `trial` status (free_trial) or returns a Stripe checkout URL (paid)
- `POST /tenancy/create` — protected endpoint (requires JWT); PA admin creates tenant with active status, bypasses payment
- `POST /webhooks/stripe` — public webhook; creates tenant with active status after Stripe payment confirmation

New entities in `src/tenancy/entities/`:
- `Tenant` — root tenant record (extends `BaseEntity`, not `TenantScopedEntity`)
- `Role` — per-tenant role definitions with `is_system` flag (extends `TenantScopedEntity`)
- `TenantConfig` — per-tenant key-value config (extends `TenantScopedEntity`)

`UserRole.role` is now a FK to `roles` table (was an enum). `AuthService` populates `roles.role` and uses `ur.role.name` in JWT.

`BaseCommandHandler<T, R>` now accepts an optional return type generic `R` (default `void`) so handlers can return values.

On registration, `TenantOnboardingHandler` seeds 3 default `TenantConfig` rows (locale, timezone, max_users).

Env var: `STRIPE_WEBHOOK_SECRET` — required for Stripe webhook signature verification.
