---
name: build-dev-tools
description: >-
  Define build, dev, test, and CLI commands for the programatic-agent project.
  Use when running the project, debugging builds, or adding new npm scripts.
  Do not use for runtime logic or UI component development.
paths: "package.json, tsconfig.json, scripts/*"
---
# Build & Dev Tools

## Goal

Documents the build, development, and test commands and tools of the
programatic-agent project.

## Boundaries

**Do:**
- Use `npm run dev` for development with hot-reload (tsx --watch)
- Use `npm start` to run without compiling
- Use `npm run build` to compile TypeScript → `dist/` and make `dist/cli.js` executable
- Use `npm test` to run Vitest (single test file: `lib/pipeline-io.test.ts`)
- Use `npm run typecheck` for fast validation without emitting files
- Use `tsx scripts/smoke-*.tsx` for manual smoke tests

**Do not:**
- Expect `npm test` to cover the orchestrator or git — there's only 1 test file
- Add linters/formatters without discussing with the team (none are configured)
- Use `tsc` directly without `--noEmit` or the appropriate script
- Modify `tsconfig.json` without validating impact on `vitest` and `tsx`

## Workflow

### Development
```bash
npm install
npm run dev           # hot reload
# ou
npm start             # run once
```

### Build and Distribution
```bash
npm run build         # tsc + chmod +x dist/cli.js
npm run build:link    # build + npm link (exposes global binary `programatic-agent`)
```

### Tests
```bash
npm test              # vitest run (once)
npm run test:watch    # vitest (watch mode)
```

### Smoke Tests
```bash
tsx scripts/smoke-dashboard.tsx    # visually tests the RunDashboard
tsx scripts/smoke-conflict.tsx     # tests conflict resolution
```

## Configurations

### TypeScript (`tsconfig.json`)
- Target: ES2022, Module: ESNext, ModuleResolution: Bundler
- JSX: react-jsx, Strict: true
- OutDir: `dist/`, RootDir: `src/`
- Declarations + sourcemaps enabled
- Excludes: `node_modules`, `dist`, `scripts`

### Vitest
- No configuration file — uses defaults
- Auto-discovers path aliases via `tsconfig.json`

### npm (`package.json`)
- `"type": "module"` — ESM-only
- `.npmrc`: `legacy-peer-deps=true`

## Gotchas

- No ESLint, Prettier, Husky, lint-staged, commitlint, or `.editorconfig`.
- `@mariozechner/pi-ai` and `@mariozechner/pi-coding-agent` use `latest` (not semver).
- The build produces `dist/cli.js` with a shebang — `chmod +x` is part of the build script.
- `scripts/` are manual smoke tests, not part of the build or test suite.
- No CI/CD (GitHub Actions, Docker, etc.).
