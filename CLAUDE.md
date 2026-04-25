## Stack

- Runtime: Node.js 20.x, TypeScript 5.x
- Framework: Express 4.x
- Database: PostgreSQL 16 (via `pg`)
- Test: Jest + ts-jest, coverage threshold 80%
- Lint: ESLint + `@typescript-eslint`, Prettier

## Layout

```
src/          TypeScript source
dist/         Compiled output (git-ignored)
coverage/     Jest coverage report (git-ignored)
.github/workflows/ci.yml  GitHub Actions CI
```

## Commands

```bash
npm run build        # tsc → dist/
npm run lint         # ESLint src/**/*.ts
npm run lint:check   # Prettier check
npm test             # Jest
npm run test:coverage  # Jest --coverage
docker build .       # Build production image
```

## Conventions

- Test files: `*.spec.ts` inside `src/`
- Jest rootDir is `src/`, so imports in tests are relative to `src/`
- CI jobs order: lint → (test, build in parallel) → docker
- Test DB: `postgresql://maco_test:maco_test@localhost:5432/maco_test` (matches CI service container)
