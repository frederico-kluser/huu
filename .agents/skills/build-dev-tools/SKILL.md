---
name: build-dev-tools
description: >-
  Define build, dev, test, and CLI commands for the huu project.
  Use when running the project, debugging builds, or adding new npm scripts.
  Do not use for runtime logic or UI component development.
---
# Build & Dev Tools

## Goal

Documents the build, development, and test commands and tools of the
huu project.

## Boundaries

**Do:**
- Use `npm run dev` for development with hot-reload (tsx --watch)
- Use `npm start` to run without compiling
- Use `npm run build` to compile TypeScript → `dist/` and make `dist/cli.js` executable
- Use `npm test` to run the full Vitest suite (12 test files covering lib, git/branch-namer, and orchestrator/pipeline-integration paths)
- Use `npm run typecheck` for fast validation without emitting files
- Use `npm run release-notes` to print commits since the current `package.json` version (helps draft `CHANGELOG.md` entries — see release procedure in `AGENTS.md`)
- Set `HUU_NO_DOCKER=1` while developing huu itself — without it, the global `huu` binary auto-execs into the published Docker image and ignores your local source

**Do not:**
- Forget `HUU_NO_DOCKER=1` when iterating on the wrapper itself — without it, `huu --stub` re-execs into the container and your local edits silently don't run
- Add linters/formatters without discussing with the team (none are configured)
- Use `tsc` directly without `--noEmit` or the appropriate script
- Modify `tsconfig.json` without validating impact on `vitest` and `tsx`
- Forget to rebuild (`npm run build`) before testing the dist binary — the auto-Docker re-exec gate lives in `dist/cli.js` after compile

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
npm run build:link    # build + npm link (exposes global binary `huu`)
```

### Tests
```bash
npm test              # vitest run (once) — full suite
npm run test:watch    # vitest (watch mode)
```

### Smoke Tests
```bash
tsx scripts/smoke-dashboard.tsx    # visually tests the RunDashboard
tsx scripts/smoke-conflict.tsx     # tests conflict resolution
```

### Release (manual — sem CI)
```bash
# 1. Bump package.json version + atualizar CHANGELOG.md (Keep a Changelog 1.1.0)
npm run release-notes              # commits desde v$(version) — drafta a entry
# 2. Validar local
npm run typecheck && npm test
docker build -t huu:local . && ./scripts/smoke-image.sh && ./scripts/smoke-pipeline.sh
# 3. Tag + push
git tag vX.Y.Z && git push origin main vX.Y.Z
# 4. (Opcional) publicar imagem no GHCR — ver "Release procedure" em AGENTS.md
```

### Docker dev
```bash
DOCKER_BUILDKIT=1 docker build -t huu:dev .
DOCKER_BUILDKIT=1 docker build --build-arg INCLUDE_SSH=false -t huu:slim .
HUU_IMAGE=huu:dev huu run example.pipeline.json   # use local image
```
See the `docker-runtime` skill for Dockerfile, signal lifecycle, and HEALTHCHECK semantics.

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
- `scripts/` é onde moram os smokes (`smoke-image.sh`, `smoke-pipeline.sh`) e o wrapper `huu-docker` (bash, pra quem não quer Node).
- **Não há CI automatizada.** Convenção: rodar `npm run typecheck && npm test` antes de cada commit; smokes (`./scripts/smoke-*.sh`) antes de cada release ou PR não-trivial. Pre-push hook opcional em `.githooks/pre-push` (ativar via `git config core.hooksPath .githooks`).
- The compiled `dist/cli.js` uses **top-level await** to gate the docker re-exec. Node 20+ ESM supports it; do not try to compile to CommonJS.
