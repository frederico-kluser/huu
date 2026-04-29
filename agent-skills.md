# Agent Skills — huu

> Catálogo das skills disponíveis neste repo. Leia para decidir
> qual skill invocar. Gerado por huu_audit-and-improve-skills v4.3.0.

Total: **8 skills**.

## Quick reference

| Skill | Path | O que faz | Triggers |
|---|---|---|---|
| `architecture-conventions` | `.agents/skills/architecture-conventions/` | Define layered architecture boundaries, naming conventions, import rules, and dependenc... | creating new modules, refactoring imports, or reviewing code structure |
| `build-dev-tools` | `.agents/skills/build-dev-tools/` | Define build, dev, test, and CLI commands for the huu project. | running the project, debugging builds, or adding new npm scripts |
| `docker-runtime` | `.agents/skills/docker-runtime/` | Define the host wrapper, signal lifecycle, image variants, HEALTHCHECK semantics... | modifying auto-reexec, entrypoint, Dockerfile, status / sentinel modules |
| `git-workflow-orchestration` | `.agents/skills/git-workflow-orchestration/` | Define git worktree lifecycle, branch naming, merge strategies, and conflict resolution... | modifying git operations, debugging merge failures, or adding new preflight checks |
| `llm-integration` | `.agents/skills/llm-integration/` | Define OpenRouter model selection, Pi SDK usage, thinking/reasoning detection, and API ... | adding model support, debugging agent sessions, or modifying LLM integration |
| `pipeline-agents` | `.agents/skills/pipeline-agents/` | Define pipeline creation, task decomposition, and AgentFactory usage (stub vs real). | adding pipeline features, modifying agent behavior, or testing the orchestrator |
| `port-isolation` | `.agents/skills/port-isolation/` | Define per-agent TCP port allocation, the bind() interceptor (LD_PRELOAD/DYLD), `.env.h... | modifying port allocation, the native shim, the `with-ports` wrapper, or EADDRINUSE under parallelism |
| `ui-tui-ink` | `.agents/skills/ui-tui-ink/` | Define Ink (React for terminals) component patterns, screen routing, and keyboard handl... | adding, modifying TUI screens |

## Full descriptions

### `architecture-conventions`

- **Path**: `.agents/skills/architecture-conventions/SKILL.md`
- **Tools**: default
- **Description** (verbatim do frontmatter):
  > Define layered architecture boundaries, naming conventions, import rules, and dependency direction for the huu codebase. Use when creating new modules, refactoring imports, or reviewing code structure. Do not use for runtime debugging or UI styling decisions.
- **Quando invocar**: creating new modules, refactoring imports, or reviewing code structure

### `build-dev-tools`

- **Path**: `.agents/skills/build-dev-tools/SKILL.md`
- **Tools**: default
- **Description** (verbatim do frontmatter):
  > Define build, dev, test, and CLI commands for the huu project. Use when running the project, debugging builds, or adding new npm scripts. Do not use for runtime logic or UI component development.
- **Quando invocar**: running the project, debugging builds, or adding new npm scripts

### `docker-runtime`

- **Path**: `.agents/skills/docker-runtime/SKILL.md`
- **Tools**: default
- **Description** (verbatim do frontmatter):
  > Define the host wrapper, signal lifecycle, image variants, and HEALTHCHECK semantics for huu's Docker integration. Use when modifying the auto-reexec layer, the entrypoint, the Dockerfile, or any of the *-docker / status / sentinel modules. Do not use for pipeline logic, TUI components, or git worktree concerns.
- **Quando invocar**: modifying auto-reexec, entrypoint, Dockerfile, status / sentinel modules

### `git-workflow-orchestration`

- **Path**: `.agents/skills/git-workflow-orchestration/SKILL.md`
- **Tools**: default
- **Description** (verbatim do frontmatter):
  > Define git worktree lifecycle, branch naming, merge strategies, and conflict resolution for agent runs. Use when modifying git operations, debugging merge failures, or adding new preflight checks. Do not use for general git usage outside the agent context.
- **Quando invocar**: modifying git operations, debugging merge failures, or adding new preflight checks

### `llm-integration`

- **Path**: `.agents/skills/llm-integration/SKILL.md`
- **Tools**: default
- **Description** (verbatim do frontmatter):
  > Define OpenRouter model selection, Pi SDK usage, thinking/reasoning detection, and API key handling. Use when adding model support, debugging agent sessions, or modifying LLM integration. Do not use for pipeline structure or git operations.
- **Quando invocar**: adding model support, debugging agent sessions, or modifying LLM integration

### `pipeline-agents`

- **Path**: `.agents/skills/pipeline-agents/SKILL.md`
- **Tools**: default
- **Description** (verbatim do frontmatter):
  > Define pipeline creation, task decomposition, and AgentFactory usage (stub vs real). Use when adding pipeline features, modifying agent behavior, or testing the orchestrator. Do not use for git worktree operations or UI component work.
- **Quando invocar**: adding pipeline features, modifying agent behavior, or testing the orchestrator

### `port-isolation`

- **Path**: `.agents/skills/port-isolation/SKILL.md`
- **Tools**: default
- **Description** (verbatim do frontmatter):
  > Define per-agent TCP port allocation, the bind() interceptor (LD_PRELOAD / DYLD_INSERT_LIBRARIES), `.env.huu` injection, and the on-demand C compile pipeline. Use when modifying port allocation, the native shim, the `with-ports` wrapper, or when a pipeline hits EADDRINUSE under parallelism. Do not use for general port-related questions outside the agent runtime.
- **Quando invocar**: modifying port allocation, the native shim, or debugging EADDRINUSE under parallelism

### `ui-tui-ink`

- **Path**: `.agents/skills/ui-tui-ink/SKILL.md`
- **Tools**: default
- **Description** (verbatim do frontmatter):
  > Define Ink (React for terminals) component patterns, screen routing, and keyboard handling. Use when adding or modifying TUI screens. Do not use for business logic, git operations, or non-terminal UI work.
- **Quando invocar**: adding, modifying TUI screens

