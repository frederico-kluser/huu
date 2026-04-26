# programatic-agent

TUI de execução guiada com kanban. Define uma pipeline de etapas (nome + prompt + arquivos opcionais), seleciona um modelo via OpenRouter, e roda os agents em paralelo, cada um na sua própria git worktree, mergeando na worktree central ao fim de cada etapa. A próxima etapa só começa depois que todos os itens da etapa anterior tiverem sido mergeados.

## Instalação

```bash
npm install
npm run build
npm link        # opcional, expõe o binário `programatic-agent`
```

## Uso

```bash
# TUI completa
programatic-agent

# Carrega uma pipeline e vai direto pro seletor de modelo
programatic-agent run example.pipeline.json

# Força agent stub (sem LLM real, útil pra validar o flow visualmente)
programatic-agent --stub
programatic-agent run example.pipeline.json --stub
```

### Variáveis de ambiente

- `OPENROUTER_API_KEY` — sua chave OpenRouter. Sem isso, a TUI pede ao iniciar a run.

### Atalhos (toda a UI é em inglês)

**Welcome:** `[N]` new pipeline · `[I]` import JSON · `[Q]` quit

**Pipeline editor:**
- `↑↓` navigate steps · `ENTER`/`E` edit step · `N` new step · `D` delete step
- `SHIFT+↑↓` reorder · `R` rename pipeline · `I` import · `S` save (export)
- `G` go (run pipeline) when all steps are valid · `ESC` back

**Step editor:**
- `TAB`/`SHIFT+TAB` cycle fields (Name → Prompt → Files)
- `ENTER` inside a text field moves to the next
- On the Files row: `F`/`ENTER` open picker · `W` use whole project · `S` save step
- `CTRL+S` save step · `ESC` cancel and discard

**File picker:**
- `↑↓` navigate · `SPACE` toggle · `A` select all · `C` clear all
- `/` filter · `ENTER` confirm (empty selection = whole project) · `ESC` cancel

**Run dashboard:**
- `+`/`-` adjust concurrency (live)
- `↑↓←→` navigate cards · `ENTER` open card details · `Q` abort run

**Summary:** `ENTER` back to editor · `Q` quit

## Como funciona

> Veja `.agents/skills/git-workflow-orchestration/SKILL.md` para o ciclo de vida completo de worktrees, branches, merge e resolução de conflitos.

Em resumo:
1. **Preflight** — valida o estado do repo git.
2. **Worktree central** — cria integration worktree na branch `programatic-agent/<runId>/integration`.
3. **Por estágio** — decompõe em tasks, spawna agents em worktrees isoladas, mergea na central.
4. **Próximo estágio** brancha a partir do HEAD da integration atualizada.
5. **Cleanup** — worktree central removida; branches preservadas como artefatos.

## Esquema da pipeline (JSON)

> Veja `.agents/skills/pipeline-agents/SKILL.md` para detalhes completos de criação de pipelines, decomposição de tasks e uso do `AgentFactory`.

```json
{
  "_format": "programatic-agent-pipeline-v1",
  "pipeline": {
    "name": "my-pipeline",
    "steps": [
      {
        "name": "Step 1",
        "prompt": "Refactor $file using pattern X",
        "files": ["src/foo.ts", "src/bar.ts"]
      },
      {
        "name": "Step 2 (free run)",
        "prompt": "Update README based on changes above",
        "files": []
      }
    ]
  }
}
```

- `prompt` accepts `$file` when `files` is non-empty.
- `files: []` runs a single whole-project task.

## Decisões arquiteturais

| Decisão | Escolha |
|---|---|
| LLM SDK | `@mariozechner/pi-coding-agent` via OpenRouter |
| Conflitos no merge | LLM auto-resolve via integration agent (com chave real) |
| Worktrees | Dentro do repo: `<repo>/.programatic-agent-worktrees/<runId>/` |
| Recents do seletor | Global em `~/.programatic-agent/recents.json` |
| Modelo | Único por run (sem override por etapa) |
| Editor de pipeline | TUI completo in-app + import/export |

## Estrutura

```
src/
├── cli.tsx                    # entry CLI
├── app.tsx                    # screen router
├── lib/                       # types, pipeline-io, file-scanner, run-id, openrouter
├── git/                       # git-client, worktree-manager, branch-namer, integration-merge, preflight
├── orchestrator/              # index (Orchestrator class), task-decomposer, stub-agent, real-agent, types
├── models/                    # catalog, recents (global)
├── contracts/                 # zod schemas
└── ui/
    ├── components/            # PipelineEditor, StepEditor, FileMultiSelect, ModelSelectorOverlay,
    │                          # PipelineIOScreen, RunDashboard, AgentDetailModal, ApiKeyPrompt
    ├── hooks/useTerminalClear.ts
    └── adapters/agent-card-adapter.ts
```

## Licença

MIT
