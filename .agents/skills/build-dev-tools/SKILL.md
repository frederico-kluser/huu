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

Documenta os comandos e ferramentas de build, desenvolvimento e teste do
projeto programatic-agent.

## Boundaries

**Fazer:**
- Usar `npm run dev` para desenvolvimento com hot-reload (tsx --watch)
- Usar `npm start` para rodar sem compilar
- Usar `npm run build` para compilar TypeScript → `dist/` e tornar `dist/cli.js` executável
- Usar `npm test` para rodar Vitest (único arquivo de teste: `lib/pipeline-io.test.ts`)
- Usar `npm run typecheck` para validação rápida sem emitir arquivos
- Usar `tsx scripts/smoke-*.tsx` para smoke tests manuais

**Nao fazer:**
- Esperar que `npm test` cubra o orchestrator ou git — só existe 1 test file
- Adicionar linters/formatters sem discutir com o time (nenhum está configurado)
- Usar `tsc` diretamente sem `--noEmit` ou sem o script apropriado
- Modificar `tsconfig.json` sem validar impacto em `vitest` e `tsx`

## Workflow

### Desenvolvimento
```bash
npm install
npm run dev           # hot reload
# ou
npm start             # run once
```

### Build e Distribuição
```bash
npm run build         # tsc + chmod +x dist/cli.js
npm run build:link    # build + npm link (expõe binário global `programatic-agent`)
```

### Testes
```bash
npm test              # vitest run (uma vez)
npm run test:watch    # vitest (watch mode)
```

### Smoke Tests
```bash
tsx scripts/smoke-dashboard.tsx    # testa visualmente o RunDashboard
tsx scripts/smoke-conflict.tsx     # testa resolução de conflitos
```

## Configurações

### TypeScript (`tsconfig.json`)
- Target: ES2022, Module: ESNext, ModuleResolution: Bundler
- JSX: react-jsx, Strict: true
- OutDir: `dist/`, RootDir: `src/`
- Declarations + sourcemaps habilitados
- Exclui: `node_modules`, `dist`, `scripts`

### Vitest
- Sem arquivo de configuração — usa defaults
- Auto-descobre path aliases via `tsconfig.json`

### npm (`package.json`)
- `"type": "module"` — ESM-only
- `.npmrc`: `legacy-peer-deps=true`

## Gotchas

- Não há ESLint, Prettier, Husky, lint-staged, commitlint, nem `.editorconfig`.
- `@mariozechner/pi-ai` e `@mariozechner/pi-coding-agent` usam `latest` (não semver).
- O build produz `dist/cli.js` com shebang — `chmod +x` é parte do build script.
- `scripts/` são smoke tests manuais, não parte do build ou test suite.
- Não há CI/CD (GitHub Actions, Docker, etc.).
