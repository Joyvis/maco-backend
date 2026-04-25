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
