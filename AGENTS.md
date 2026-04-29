# huu

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
| `port-isolation` | Per-agent port allocation, bind() shim (LD_PRELOAD/DYLD), `.env.huu`, native compile |
| `ui-tui-ink` | Ink (React for terminals) component patterns, screen routing |
| `build-dev-tools` | Build, dev, test commands and tooling config |
| `llm-integration` | OpenRouter model selection, Pi SDK, thinking detection |
| `docker-runtime` | Host wrapper, signal lifecycle, image variants, HEALTHCHECK |

Consult the relevant skill before starting any task.

## Arquitetura (Resumo)

```
[host]   cli.tsx top-level → decideReexec → reexecInDocker
                ↓ (when not in container, not --help, not init-docker/status)
         docker run --cidfile … ghcr.io/…/huu:latest
                ↓
[container]  cli.tsx → app.tsx (entry + screen router)
                ↓
              ui/components/ (Ink React views)
                ↓
              orchestrator/ (worker pool, stage lifecycle, merge)
                ↓
              git/ (worktree manager, branch ops, preflight, merge)
                ↓
              lib/ (types, pipeline-io, file-scanner, run-id, status,
                    init-docker, docker-reexec, active-run-sentinel,
                    api-key, prune, debug-logger, run-logger)
```

Dependencies flow **downward only** — lower layers never import upper layers.

The Docker host wrapper (`lib/docker-reexec.ts`) is invoked from the very top
of `cli.tsx` BEFORE the heavy Ink/React imports, so on the wrapper path none
of the TUI code loads. Inside the container, `HUU_IN_CONTAINER=1` (set by
the Dockerfile) short-circuits the gate so the same binary runs the TUI
directly. See the `docker-runtime` skill for the full lifecycle.

## Commit Rules

- Run `npm run typecheck && npm test` antes de cada commit. **Não há CI
  automatizada** — convenção é responsabilidade do contribuidor. Para
  endurecer localmente, ativar o pre-push hook: `git config core.hooksPath .githooks`.
- Prefer Conventional Commits
- Never force-push to main

## Release procedure (manual — sem CI)

Para release v`X.Y.Z` (semver; em 0.x.x, breaking changes vão em minor
bumps por convenção):

1. Atualizar `package.json` `version` e `CHANGELOG.md` (mover entradas
   de `[Unreleased]` para `[X.Y.Z] - YYYY-MM-DD`, seguindo
   [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/)).

2. Validar local:
   ```bash
   npm run typecheck
   npm test
   docker build -t huu:local .
   ./scripts/smoke-image.sh
   ./scripts/smoke-pipeline.sh
   ```

3. Tag + commit:
   ```bash
   git add package.json CHANGELOG.md
   git commit -m "chore(release): vX.Y.Z"
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

4. **Opcional** — publicar imagem no GHCR. Pré-requisito: `docker login
   ghcr.io` com Personal Access Token de escopo `write:packages`.

   ```bash
   # Garante buildx + QEMU configurados (uma vez por máquina):
   docker buildx create --use --name huu-builder 2>/dev/null \
       || docker buildx use huu-builder

   # Build multi-arch + push direto pro GHCR
   docker buildx build \
       --platform linux/amd64,linux/arm64 \
       --tag ghcr.io/frederico-kluser/huu:X.Y.Z \
       --tag ghcr.io/frederico-kluser/huu:X.Y \
       --tag ghcr.io/frederico-kluser/huu:X \
       --tag ghcr.io/frederico-kluser/huu:latest \
       --push \
       .
   ```

5. Smoke contra imagem publicada:
   ```bash
   ./scripts/smoke-image.sh ghcr.io/frederico-kluser/huu:X.Y.Z
   ./scripts/smoke-pipeline.sh ghcr.io/frederico-kluser/huu:X.Y.Z
   ```

Se o passo 4 for pulado, usuários precisam buildar local com
`docker build -t huu:local .` (caminho default documentado no README).

## Smoke tests

Sem CI automatizada, é responsabilidade do mantenedor / contribuidor
rodar smoke local antes de cada release ou PR não-trivial:

```bash
docker build -t huu:local .
./scripts/smoke-image.sh        # ~10s — sanity da imagem
./scripts/smoke-pipeline.sh     # ~60s — pipeline fim-a-fim com --stub
```

Ambos saem 0 em sucesso, !=0 em falha — encadeáveis em `&&`.

## References (carregue sob demanda)
- Skill catalog: `agent-skills.md`

