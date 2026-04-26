---
name: git-workflow-orchestration
description: >-
  Define git worktree lifecycle, branch naming, merge strategies, and conflict
  resolution for agent runs. Use when modifying git operations, debugging merge
  failures, or adding new preflight checks. Do not use for general git usage
  outside the agent context.
paths: "src/git/**/*.ts"
disable-model-invocation: true
---
# Git Workflow Orchestration

## Goal

Documenta o ciclo de vida completo de worktrees e branches usado pelo
orchestrator para isolar agentes LLM e integrar seus resultados.

## Boundaries

**Fazer:**
- Usar `GitClient` (wrapper síncrono sobre `execSync`) para todas as operações git
- Seguir convenções de naming de `branch-namer.ts`: `programatic-agent/<runId>/agent-N` e `.../integration`
- Worktrees temporárias em `.programatic-agent-worktrees/<runId>/` (auto-gitignored)
- Merge deterministicamente por `agentId` ascendente via `git merge --no-ff`
- Resolver conflitos via integration agent LLM (quando factory real disponível)

**Nao fazer:**
- Usar operações git assíncronas (`exec`/`spawn`) — o projeto usa `execSync` intencionalmente
- Criar branches fora do padrão `programatic-agent/<runId>/...`
- Deixar worktrees órfãs — sempre cleanup via `WorktreeManager`
- Permitir que stubs resolvam conflitos — apenas real agents têm permissão

## Workflow

### Preflight
1. `runPreflight()` valida: git repo, branch resolvida, HEAD commit, dirty state, remote, push dry-run
2. Retorna `PreflightResult` com `valid`, `errors[]`, `warnings[]`

### Worktree Central (Integration)
1. Criada em `.programatic-agent-worktrees/<runId>/integration`
2. Branch: `programatic-agent/<runId>/integration` a partir do HEAD atual
3. Auto-anexada ao `.gitignore` na primeira run

### Por Estágio
1. Decompor tasks → 1 por arquivo (ou 1 whole-project se `files: []`)
2. Criar worktree por agente: `.programatic-agent-worktrees/<runId>/agent-N/`
3. Branch por agente: `programatic-agent/<runId>/agent-N`
4. Quando agente termina: validate → stage → commit (`--no-verify`) → remove worktree
5. Merge deterministicamente todos os branches na integration worktree (ordem `agentId`)
6. Se conflitos: spawn integration agent LLM para resolver
7. Próximo estágio brancha a partir do HEAD da integration atualizado

### Cleanup
- Worktree central removida ao fim da run
- Branches preservadas como artefatos

## Gotchas

- Commits de agentes usam `--no-verify` porque o preflight já validou o estado.
- Push usa retry com backoff exponencial (até 3 tentativas).
- O integration agent é sempre `agentId: 9999`.
- Stub agents (`--stub`) não resolvem conflitos — qualquer conflito aborta direto.
- `git-client.ts` é thin wrapper — não há libgit2 ou isomorphic-git.
