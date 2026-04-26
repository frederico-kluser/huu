---
name: ui-tui-ink
description: >-
  Define Ink (React for terminals) component patterns, screen routing, and
  keyboard handling. Use when adding or modifying TUI screens. Do not use for
  business logic, git operations, or non-terminal UI work.
paths: "src/ui/**/*.tsx, src/app.tsx, src/cli.tsx"
---
# UI / TUI (Ink)

## Goal

Documenta os padrões de componentes React Ink usados na interface de terminal
do programatic-agent.

## Boundaries

**Fazer:**
- Usar `Box`, `Text`, `useInput`, `useApp`, `useStdout` do Ink
- Usar discriminated union `Screen` para routing entre telas em `app.tsx`
- Componentes funcionais com retorno tipado: `React.JSX.Element`
- Hooks customizados em `ui/hooks/` (ex: `useTerminalClear`)
- Adapters em `ui/adapters/` para transformar domain types em UI types
- Lazy-load componentes pesados (ex: `model-selector-ink` via `void import(...)`)

**Nao fazer:**
- Colocar lógica de negócio (orquestração, git) diretamente em componentes UI
- Usar `export default`
- Criar telas sem adicionar o `kind` correspondente na union `Screen` de `app.tsx`
- Ignorar cleanup de listeners/subscribers em `useEffect`

## Workflow

### Adicionar Nova Tela
1. Adicionar `kind` na union `Screen` em `app.tsx`
2. Criar componente em `ui/components/NomeDaTela.tsx`
3. Adicionar bloco de render condicional em `app.tsx`
4. Implementar navegação via `useInput` ou callbacks

### Componentes Principais
- **PipelineEditor** — lista de steps, add/delete/reorder (Shift+↑↓), rename, import/export
- **StepEditor** — edição de um step (name, prompt, files); TAB cycle fields
- **FileMultiSelect** — árvore de arquivos interativa; Space toggle, A select all, C clear, / filter
- **ModelSelectorOverlay** — quick-pick (recents + favorites + recommended) + lazy table view
- **ApiKeyPrompt** — input de API key com mask (`*`)
- **RunDashboard** — KanbanBoard com cards de agentes; ajuste de concorrência (`+`/`-`)
- **AgentDetailModal** — timeline, logs, arquivos modificados do agente

### Keyboard Handling
- `useInput` do Ink para capturar teclas
- Atalhos documentados no README (N new, I import, Q quit, G go, etc.)
- `isActive` option para evitar conflitos entre listeners

## Gotchas

- Toda a UI é em inglês (mensagens, labels, atalhos), apesar do README e alguns comentários estarem em português.
- `useTerminalClear` apaga scrollback no mount/unmount para evitar linhas fantasmas.
- `agent-card-adapter.ts` mapeia `AgentStatus` → `KanbanCardData` (columns: todo/doing/done).
- O RunDashboard instancia `Orchestrator` em `useMemo` e inicia em `useEffect`.
- Não há biblioteca de state management — apenas React state + prop drilling.
- Não há error boundaries em componentes React — erros em handlers podem crashar a TUI.
