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

### Atalhos

**No editor de pipeline:**
- `a` adicionar etapa, `d` remover, `J/K` reordenar, `e`/`Enter` editar
- `n` renomear pipeline · `i` importar JSON · `x` exportar JSON
- `r` executar (quando todas as etapas estão válidas) · `Esc` voltar

**No editor de etapa:**
- `Tab`/`Shift+Tab` entre campos · `Enter` no campo arquivos abre o seletor

**No seletor de arquivos:**
- `↑↓`/`jk` navega · `Space` toggle · `a` toggle-all · `/` filtro · `Enter` confirma

**No dashboard:**
- `+`/`-` aumentar/diminuir concorrência (afeta o pool em tempo real)
- `↑↓←→` navega cards · `Enter` abre modal de detalhes
- `q` aborta run

## Como funciona

1. **Preflight** — verifica que estamos num git repo, branch resolvido, sem conflitos.
2. **Worktree central** — cria `.programatic-agent-worktrees/<runId>/integration` na branch `programatic-agent/<runId>/integration` (a partir do HEAD atual). O diretório é auto-anexado ao `.gitignore` na primeira run.
3. **Para cada etapa da pipeline:**
   - Decompõe em tasks (1 por arquivo, ou 1 task whole-project se `files: []`).
   - Spawna agents respeitando a concorrência atual. Cada agent vive em `.programatic-agent-worktrees/<runId>/agent-N/` e branch a partir do HEAD da integração mais recente.
   - Quando o agent termina: validate → stage → commit (`--no-verify`) → remove worktree.
   - Quando todos terminam: `git merge --no-ff` cada branch na worktree central, em ordem de `agentId`.
   - Se houver conflitos: um **integration agent LLM** (mesmo modelo da run) é spawnado na worktree central, recebe o sistema prompt com permissão para rodar git, e tem como missão resolver os conflitos. Se ele falhar, a run é abortada com as branches preservadas para resolução manual. Com `--stub`, o resolver é desligado (stubs não resolvem conflitos), e qualquer conflito aborta direto.
4. **Stage N+1** branca a partir do HEAD da integração atualizado.
5. **Cleanup** — worktree central removida ao fim. As branches ficam preservadas como artefatos.

## Esquema da pipeline (JSON)

```json
{
  "_format": "programatic-agent-pipeline-v1",
  "pipeline": {
    "name": "minha-pipeline",
    "steps": [
      {
        "name": "Etapa 1",
        "prompt": "Refatore $file usando padrao X",
        "files": ["src/foo.ts", "src/bar.ts"]
      },
      {
        "name": "Etapa 2 (rodada livre)",
        "prompt": "Atualize o README com base nas mudancas anteriores",
        "files": []
      }
    ]
  }
}
```

- `prompt` aceita `$file` quando `files` não está vazio (substituído pelo arquivo da task).
- `files: []` faz a etapa rodar uma única vez sem restrição de arquivo.

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
