# Operator handoff

## Repository

Create the public GitHub repository `vibenet-adapter-codex`, then attach this local repository as its origin. Repository creation, visibility, branch protection, merge, and release are Operator-owned actions.

## Local state

- Branch: `codex/adapter-core-p0`
- Scope: deterministic replay and authorized stdin normalization only
- No production infrastructure or credentials are required

## Before opening the PR

```bash
npm ci
npm run verify:schemas
npm run typecheck
npm test
npm run build
git diff --check
```

Confirm the public repository description is exactly:

> An independent VIBEnet adapter for the public Codex app-server.

The first PR should remain draft until the lifecycle profile PR is green. Any public proof must use deterministic adapter receipts and the label `documented replay`.
