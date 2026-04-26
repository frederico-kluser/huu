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

## Agent Skills

Detailed domain-specific guidance lives in `.agents/skills/`:

| Skill | Domain |
|---|---|
| `architecture-conventions` | Layered architecture, naming, imports, dependency rules |
| `git-workflow-orchestration` | Worktree lifecycle, branch naming, merge, conflict resolution |
| `pipeline-agents` | Pipeline creation, task decomposition, AgentFactory usage |
| `ui-tui-ink` | Ink (React for terminals) component patterns, screen routing |
| `build-dev-tools` | Build, dev, test commands and tooling config |
| `llm-integration` | OpenRouter model selection, Pi SDK, thinking detection |

Consult the relevant skill before starting any task.

## Arquitetura (Resumo)

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

Dependencies flow **downward only** — lower layers never import upper layers.
See `architecture-conventions` skill for full conventions and rules.

## Commit Rules

- No CI/CD configured — commits are manual
- Prefer Conventional Commits
- Never force-push to main
