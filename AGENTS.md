# programatic-agent

CLI TUI em TypeScript/React (Ink) que executa pipelines de agentes LLM em git worktrees isolados. Cada etapa decompõe em tasks paralelas, mergeadas deterministicamente em worktree central ao fim de cada estágio.

## Build & Run

```bash
# Instalar dependências
npm install

# Rodar em dev (hot reload)
npm run dev

# Rodar direto (sem build)
npm start

# Compilar para produção
npm run build

# Rodar testes
npm test

# Type-check apenas
npm run typecheck
```

## Convenções

- **ESM only**: `"type": "module"` — todos os imports usam extensão `.js` explícita
- **Naming**: `kebab-case.ts` para arquivos, `PascalCase` para classes e componentes React, `camelCase` para funções e variáveis
- **Imports**: externos primeiro, depois internos (por profundidade), depois `node:` built-ins
- **Exports**: nomeados apenas — nunca usar `export default`
- **Types**: discriminated unions com `kind` ou `type` como discriminante
- **Error handling**: best-effort catch + ignore para operações transientes; `err instanceof Error ? err.message : String(err)` para mensagens seguras
- **Git**: operações síncronas via `execSync`; retry com backoff exponencial para push

## Arquitetura

```
cli.tsx / app.tsx (entry + screen router)
    ↓
ui/components/ (Ink React views)
    ↓
orchestrator/ (worker pool, stage lifecycle, merge)
    ↓
git/ (worktree manager, branch ops, preflight, merge)
    ↓
lib/ (types, pipeline-io, file-scanner, openrouter, run-id)
```

Dependências fluem **sempre para baixo** — camadas inferiores nunca importam camadas superiores.

## Regras Invioláveis

- Nunca usar `export default`
- Sempre usar `.js` em imports locais (mesmo para arquivos `.ts`/`.tsx`)
- Nunca importar `ui/` ou `orchestrator/` a partir de `git/` ou `lib/`
- `AgentFactory` é a única porta de saída para LLM — orchestrator não conhece SDK
- Todos os tipos compartilhados vivem em `lib/types.ts`
- Commits de agentes usam `--no-verify` (preflight já validou)
- Worktrees temporárias vivem em `.programatic-agent-worktrees/<runId>/` (auto-gitignored)

## Regras de Commit

- Não há CI/CD configurado — commits são manuais
- O projeto atualmente não usa Conventional Commits de forma estrita, mas prefira-o
- Nunca force-push na branch principal
