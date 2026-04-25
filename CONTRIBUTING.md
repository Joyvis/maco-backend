# Contributing to maco-backend

## Local Development

### Prerequisites

- Node.js 20.x
- npm
- Docker (for local PostgreSQL or Docker builds)
- PostgreSQL 16 (optional — see Docker section)

### Setup

```bash
npm install
```

### Running Lint

```bash
# ESLint
npm run lint

# Prettier format check
npm run lint:check

# Auto-fix both
npm run lint:fix
```

### Running Tests

Tests require a running PostgreSQL instance. Start one via Docker:

```bash
docker run --rm -e POSTGRES_USER=maco_test -e POSTGRES_PASSWORD=maco_test \
  -e POSTGRES_DB=maco_test -p 5432:5432 postgres:16
```

Then run tests:

```bash
# Run tests
npm test

# Run tests with coverage report
npm run test:coverage
```

Coverage thresholds are enforced at 80% (branches, functions, lines, statements). The CI job fails if coverage drops below this.

### Building

```bash
npm run build
```

This compiles TypeScript to `dist/`. Verify the build succeeds before opening a PR.

### Docker Build

```bash
docker build .
```

The CI pipeline verifies the Docker image builds successfully on every PR.

---

## CI Pipeline

The GitHub Actions CI pipeline (`.github/workflows/ci.yml`) runs on every push to `main` and on pull requests targeting `main`.

### Jobs

| Job | Depends on | Description |
|-----|-----------|-------------|
| `lint` | — | Runs ESLint and Prettier check |
| `test` | `lint` | Runs Jest with coverage against a PostgreSQL 16 service container |
| `build` | `lint` | Compiles TypeScript via `npm run build` |
| `docker` | `test`, `build` | Builds the production Docker image |

If `lint` fails, all downstream jobs are skipped automatically via `needs` dependencies.

### Required GitHub Secrets

No secrets are required for the current CI pipeline. The test database runs as a GitHub Actions service container using hardcoded test credentials.

Future secrets to add when registry push is needed:

| Secret | Purpose |
|--------|---------|
| `DOCKER_REGISTRY_TOKEN` | Authenticate to container registry for image push |

---

## Branch Protection Rules (Recommended)

Configure the following rules on the `main` branch in **Settings → Branches**:

- **Require status checks to pass before merging** — select: `lint`, `test`, `build`, `docker`
- **Require branches to be up to date before merging**
- **Require pull request reviews before merging** — at least 1 approving review
- **Restrict who can push to matching branches** — disallow direct pushes to `main`

---

## Commit Convention

Use conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
