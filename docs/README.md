# Documentação do `huu`

Índice central da documentação. O `huu` é uma CLI/TUI (TypeScript + React/Ink)
que roda pipelines de agentes LLM em git worktrees isolados, com merge
determinístico ao fim de cada estágio.

> Voltar ao [README](../README.md) · [English README](../README.en.md)

## Por onde começar

| Quero… | Leia |
|---|---|
| Instalar e rodar pela primeira vez | [Onboarding](onboarding.pt-BR.md) · [EN](onboarding.md) |
| Operar no dia a dia (Docker, env vars, FAQ, roadmap) | [Operações](operations.pt-BR.md) · [EN](operations.md) |
| Escrever meu próprio pipeline JSON | [Guia do schema](pipeline-json-guide.md) |
| Fazer uma etapa descobrir os arquivos da próxima (scope `memory`) | [Scope memory](memory-scope.pt-BR.md) · [EN](memory-scope.md) |
| Rodar auditorias na esteira (GitHub Actions / GitLab) | [CI](ci.pt-BR.md) · [EN](ci.md) |

## Referência

| Tópico | Doc |
|---|---|
| Arquitetura em camadas e regras de import | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Schema JSON do pipeline (referência completa) | [pipeline-json-guide.md](pipeline-json-guide.md) |
| Scope `memory` — fan-out dirigido por arquivo de memória (`huu-memory-v1`, `$hint`) | [memory-scope.md](memory-scope.md) · [pt-BR](memory-scope.pt-BR.md) |
| CI sem Docker (`--no-docker`, `huu auto`, receitas prontas) | [ci.md](ci.md) · [pt-BR](ci.pt-BR.md) |
| Controle do Pi Coding Agent (modelo mental, CLI, env, sessão) | [pi-coding-agent.md](pi-coding-agent.md) |
| Modo Web UI (`huu --web`) | [WEB-UI.md](WEB-UI.md) |
| Isolamento de portas (shim de `bind()`, internals) | [PORT-SHIM.md](PORT-SHIM.md) |
| Referência de teclado da TUI | [KEYBOARD.md](KEYBOARD.md) |

## Outros recursos

- [CHANGELOG](../CHANGELOG.md) — histórico de versões (Keep a Changelog).
- [`.agents/skills/catalog.md`](../.agents/skills/catalog.md) — o sistema de
  skills que roteia toda tarefa neste repo (comece pela `project-router`;
  17 skills: router, conhecimento, tarefa e meta). Visão humana em
  [`agent-skills.md`](../agent-skills.md).
- [`CLAUDE.md`](../CLAUDE.md) / [`AGENTS.md`](../AGENTS.md) — instruções para
  agentes de IA que trabalham neste repositório.
