# Roadmap — Pasta de Trabalho

Esta pasta contém o roadmap completo do `huu` e specs executáveis por feature.

## Como ler

- [`ROADMAP.md`](ROADMAP.md) — visão estratégica completa: DAG de dependências,
  princípios, não-objetivos, mapeamento Bernstein↔huu, cronograma.
- [`tasks/`](tasks/) — uma pasta por Tier; um markdown por feature. **Cada
  arquivo é auto-suficiente** — um agente lendo apenas aquele arquivo (sem
  acesso ao ROADMAP) consegue executar a task.

## Estrutura

```
roadmap/
├── ROADMAP.md                    # estratégia
├── README.md                      # este arquivo
└── tasks/
    ├── tier-0-foundation/         # 2 semanas, bloqueia Tier 1
    │   ├── F0.1-zod-schema.md
    │   ├── F0.2-price-catalog.md
    │   ├── F0.3-history-jsonl.md
    │   └── F0.4-event-bus.md
    ├── tier-1-sprint/             # 4 semanas, máximo ROI
    │   ├── F1-janitor.md
    │   ├── F2-dry-run.md
    │   ├── F3-mcp-server.md
    │   └── F4-hmac-audit.md
    ├── tier-2-professional/       # 3 meses
    │   ├── F5-skill-packs.md
    │   ├── F6-lite-history-advisor.md
    │   ├── F7-token-budget.md
    │   ├── F8-json-schema.md
    │   ├── F9-huu-pr.md
    │   ├── F11-from-ticket.md
    │   ├── F12-lifecycle-hooks.md
    │   ├── F13-web-dashboard.md
    │   ├── F14-prometheus-otel.md
    │   ├── F21-doctor.md
    │   ├── F22-init-wizard.md
    │   └── Fquick-draft.md
    └── tier-3-platform/           # 12 meses
        ├── F10-autofix.md
        ├── F16-acp-bridge.md
        ├── F19-chaos.md
        ├── F20-fingerprint.md
        ├── F23-cookbook.md
        ├── F25-sandbox-abstraction.md
        └── F26-record-replay.md
```

## Como cada task file está organizado

Cada `tasks/**/*.md` segue o template:

1. **Project paths** — caminhos absolutos de `huu` e `bernstein`.
2. **Context** — o que é a feature, por que importa.
3. **Current state in `huu`** — file:line refs do que já existe.
4. **Bernstein reference** — file:line refs no Bernstein para estudar.
5. **Dependencies (DAG)** — quais task IDs precisam estar mergeados antes.
6. **What to build** — arquivos novos a criar, arquivos existentes a editar.
7. **Code sketch** — TypeScript real (não pseudo-código) das APIs principais.
8. **Libraries** — npm packages a adicionar com versão sugerida.
9. **Tests** — onde colocar, framework (vitest), estratégia.
10. **Acceptance criteria** — checklist do que precisa ser verdade pra merge.
11. **Out of scope** — o que NÃO fazer nesta task.
12. **Estimated effort** — dias-dev.

## Como executar uma task

```bash
# 1. Confirmar dependências do DAG estão mergeadas (ler "Dependencies" no .md)
# 2. Criar branch limpo:
git checkout -b feat/F0.1-zod-schema
# 3. Abrir o markdown e seguir step-by-step.
# 4. Rodar testes locais:
npm run typecheck && npm test
# 5. Smoke se a task tocar Docker:
./scripts/smoke-image.sh && ./scripts/smoke-pipeline.sh
# 6. PR com título "feat(F0.1): zod schema as single source of truth"
```

## Workflow recomendado

1. **Tier 0 primeiro**, em qualquer ordem (são independentes entre si).
2. **Tier 1 sequencial** (F2 → F1 → F4 → F3): cada um vai pra `main` antes
   do próximo começar. Razão: F3 (MCP server) ganha tools incrementais
   conforme F2/F4 mergeiam.
3. **Tier 2 sob demanda** — não construir em antecipação. Cada task precisa
   de issue com ≥3 reactions de usuários distintos antes de start.
4. **Tier 3 idem**, com prioridade ainda mais alta na demanda real.

## Convenções dos task files

- **Code sketches são prescritivos**, não decorativos. Se o sketch usa
  `import { z } from 'zod'`, é porque essa é a escolha. Mudar requer
  justificativa em PR description.
- **Paths absolutos** evitam ambiguidade. `huu` está sempre em
  `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117` (este worktree)
  e Bernstein em `/home/ondokai/Projects/bernstein` (referência read-only).
- **Schema deltas** sempre em `huu-pipeline-v1` (versão atual). Quebras
  reais → migrator + `v2`, fora do escopo das tasks atuais.
- **Out of scope** é tão importante quanto "what to build" — protege
  contra scope creep.

## Quando atualizar este roadmap

- Task mergeada → marcar `✅ merged in vX.Y.Z` no topo do arquivo da task.
- Task descartada → mover para `tasks/_archived/` com motivo.
- Nova feature proposta → primeiro adicionar entry no [`ROADMAP.md`](ROADMAP.md),
  *depois* criar o task file aqui.

— *Última atualização: 2026-04-29*
