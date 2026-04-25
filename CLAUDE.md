# maco-backend

NestJS backend for the MacoSaaS Agent Orchestrator.

## Stack

- **Runtime**: Node.js / TypeScript
- **Framework**: NestJS (scaffolded in MACO-9)
- **Linting**: ESLint 8 + `@typescript-eslint` + `eslint-plugin-import`
- **Formatting**: Prettier 3
- **Pre-commit**: Husky 9 + lint-staged

## Layout

```
src/          # NestJS application source (scaffolded in MACO-9)
test/         # e2e tests
dist/         # compiled output (git-ignored)
```

## Commands

```bash
npm run lint          # report lint violations
npm run lint:fix      # auto-fix lint violations
npm run format        # reformat all source files
npm run format:check  # verify formatting without writing
```

## Conventions

- Single quotes, 2-space indent, 100-char line width (Prettier)
- `@typescript-eslint/no-explicit-any` → warn; `no-unused-vars` → error
- Import order enforced by `eslint-plugin-import` (builtin → external → internal)
- Editor settings defined in `.editorconfig` (works with Neovim via editorconfig plugin)

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
