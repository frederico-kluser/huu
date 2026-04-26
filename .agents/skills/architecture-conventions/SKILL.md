---
name: architecture-conventions
description: >-
  Define layered architecture boundaries, naming conventions, import rules, and
  dependency direction for the programatic-agent codebase. Use when creating new
  modules, refactoring imports, or reviewing code structure. Do not use for
  runtime debugging or UI styling decisions.
paths: "src/**/*.ts, src/**/*.tsx"
---
# Architecture & Conventions

## Goal

Estabelece as regras arquiteturais e convenções de código do projeto
programatic-agent, garantindo que novos módulos sigam a mesma estrutura
layered e os mesmos padrões de naming/import.

## Boundaries

**Fazer:**
- Seguir o fluxo de dependências: `ui/` → `orchestrator/` → `git/` → `lib/`
- Usar discriminated unions (`kind` / `type`) para estados e eventos
- Colocar todos os tipos compartilhados em `lib/types.ts`
- Usar `.js` explícita em imports locais (ESM requirement)
- Usar `export default`? **NUNCA.** Somente named exports.

**Nao fazer:**
- Importar `ui/` ou `orchestrator/` a partir de `git/` ou `lib/`
- Criar tipos dispersos em múltiplos arquivos
- Usar `export default` em qualquer arquivo
- Importar camadas superiores a partir de camadas inferiores

## Workflow

1. **Novo módulo** — decida a camada (`ui/`, `orchestrator/`, `git/`, `lib/`)
2. **Naming** — `kebab-case.ts` (ou `.tsx` se JSX), `PascalCase` classes/componentes, `camelCase` funções
3. **Tipos** — se for compartilhado, vá para `lib/types.ts`; se for local, defina no próprio arquivo
4. **Imports** — ordem: externos → internos (por profundidade) → `node:` built-ins
5. **Exports** — sempre nomeados

## Gotchas

- O projeto é ESM-only (`"type": "module"`). TypeScript com `moduleResolution: Bundler` requer `.js` nos imports mesmo para `.ts`/`.tsx`.
- `lib/types.ts` é a fonte única de verdade (~25 interfaces). Não duplique tipos.
- A arquitetura foi derivada de `pi-orq` mas foi reduzida a pipeline linear apenas (sem DAG/parallel).
- O `Orchestrator` é uma classe mutável por design (mantém estado de pool, subscribers, lifecycle).
- Não há framework de injeção de dependências — factories são passadas como parâmetros (`AgentFactory`).
```
