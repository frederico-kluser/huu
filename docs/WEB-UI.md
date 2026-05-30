# Web UI Mode (`huu --web`)

Documentação completa do modo de interface gráfica via navegador introduzido nesta branch.

> **TL;DR** — `huu --web --yolo` sobe um servidor local, abre seu navegador e te dá uma interface clicável que espelha 1:1 o TUI, com atualizações em tempo real via WebSocket. O TUI continua sendo o default; `--web` é opt-in.

---

## Sumário

- [Visão geral](#visão-geral)
- [Como usar](#como-usar)
- [Arquitetura](#arquitetura)
- [Stack front-end](#stack-front-end)
- [Protocolo WebSocket](#protocolo-websocket)
- [Segurança](#segurança)
- [Build & desenvolvimento](#build--desenvolvimento)
- [Testes](#testes)
- [Limitações conhecidas](#limitações-conhecidas)
- [Roadmap (fora desta entrega)](#roadmap-fora-desta-entrega)
- [Mapa de arquivos](#mapa-de-arquivos)

---

## Visão geral

O `huu --web` é um caminho alternativo de UI: em vez de renderizar o TUI Ink no terminal, sobe um servidor HTTP+WebSocket local, serve um bundle React estático e abre o navegador automaticamente. Toda a lógica de back-end (orchestrator, FSM, file-scanner, project-recon, pipeline-assistant, integração git) é **a mesma** do TUI — só a camada de apresentação muda.

**Características:**

- 100% clicável (zero atalhos de teclado obrigatórios)
- Responsivo (mobile 320px → desktop 1920px), tap targets ≥44px
- Real-time via WebSocket (estado do kanban, logs, custo, integração)
- Atomic Design (atoms → molecules → organisms → templates → pages)
- Dark mode default; cor magenta (`theme.ai`) reservada para features de IA, igual ao TUI
- Bundle ~70 KB gzip (React + Tailwind tree-shaked)

---

## Como usar

```bash
# Pré-requisitos: ter rodado `npm install` e `npm run build:webui` ao menos uma vez
huu --web --yolo
```

Saída em `stderr` (não polui `stdout` para pipelines):

```
huu: --yolo: skipping Docker. The agent has access to your shell credentials (~/.ssh, ~/.aws, etc.).
huu web UI ready: http://127.0.0.1:53842/?t=901ae99b-5072-4896-b98b-02ae497fabaf
```

O navegador abre automaticamente nessa URL. Se não abrir (ou se você está em ambiente headless), copie e cole no navegador local — o token está embutido.

### Flags

| Flag | Padrão | Descrição |
|---|---|---|
| `--web` | — | Ativa o modo web no lugar do TUI Ink |
| `--web-port=<n>` | porta aleatória | Fixa a porta (útil para SSH tunneling / scripts) |
| `--no-open` | abre o navegador | Não tenta executar `xdg-open`/`open`/`start` |
| `HUU_WEB_NO_OPEN=1` | — | Equivalente a `--no-open` via env var |

### Combina com

- `huu run <pipeline.json> --web --yolo` — abre direto no editor com a pipeline carregada
- `huu --web --yolo --stub` — modo dry-run sem LLM
- `huu --web --yolo --copilot` / `--backend=copilot` — backend fixo
- `huu --web --yolo --auto-scale` — autoscaling de concorrência

### Encerrar o servidor

`Ctrl+C` no terminal onde rodou `huu --web`. Fechar a aba do navegador **não** mata o servidor (é só um cliente; reabrir a URL retoma).

---

## Arquitetura

```
            ┌──────────────────────────────────────────┐
            │  cli.tsx                                 │
            │  ├─ decideReexec (topo)  ──┐             │
            │  │   bloqueia --web sem --yolo (Fase 1) │
            │  │                          │             │
            │  ├─ if (--web): runWebMode  │             │
            │  └─ else:       render(<App/>)  ← TUI    │
            └──────────────────────────────────────────┘
                              │
            ┌─────────────────┴─────────────────────────┐
            │                                            │
        TUI Path                                    Web Path
            │                                            │
    ┌───────▼────────┐                       ┌──────────▼────────┐
    │  src/app.tsx   │                       │  src/cli-web.ts   │
    │  Ink renderer  │                       │  runWebMode()     │
    └───────┬────────┘                       └──────────┬────────┘
            │                                            │
            │      ┌─────────────────────────┐          │
            └─────►│  src/lib/screen-fsm.ts  │◄─────────┤
                   │  FSM pura compartilhada │          │
                   │  (Screen, FsmEvent,     │          │
                   │   reduce, initialState) │          │
                   └─────────────────────────┘          │
                                                         │
                                          ┌──────────────▼──────────────┐
                                          │  src/web/                   │
                                          │  ├─ server.ts (HTTP+WS+token)│
                                          │  ├─ session.ts (FSM driver) │
                                          │  ├─ handlers/ (pipelines,   │
                                          │  │   files, models,         │
                                          │  │   assistant, recon)      │
                                          │  ├─ orchestrator-bridge.ts  │
                                          │  │   (StateCoalescer 8 Hz)  │
                                          │  ├─ ws-protocol.ts (types)  │
                                          │  ├─ browser-open.ts         │
                                          │  └─ dist-static/ ← webui/   │
                                          └──────────────┬──────────────┘
                                                         │
                                                         │ WebSocket
                                                         │
                                          ┌──────────────▼──────────────┐
                                          │  webui/ (React + Vite)      │
                                          │  ├─ lib/use-ws.ts           │
                                          │  ├─ lib/ws-context.tsx      │
                                          │  ├─ atoms (11)              │
                                          │  ├─ molecules (10)          │
                                          │  ├─ organisms (9)           │
                                          │  ├─ templates (3)           │
                                          │  ├─ pages (15, 1 por Screen)│
                                          │  └─ Router.tsx              │
                                          └─────────────────────────────┘
```

### Princípios

1. **FSM pura compartilhada** — `src/lib/screen-fsm.ts` é o coração da navegação. Sem I/O, sem React, sem Ink. Tanto o TUI quanto o web session aplicam `reduce(state, event)` para transicionar.
2. **Back-end agnóstico de UI** — `src/web/` não importa nada de `src/ui/` (que é Ink-específico). Pode importar `lib/`, `orchestrator/`, `models/`.
3. **Front-end isolado em workspace** — `webui/` é npm workspace separado. Build estático embutido em `src/web/dist-static/`. Não pesa no runtime do TUI.
4. **Coalescing idêntico ao TUI** — `StateCoalescer` (`src/web/orchestrator-bridge.ts`) faz broadcast a 8 Hz, espelhando o `STATE_FLUSH_INTERVAL_MS=125` do `RunDashboard.tsx`. Sem flood do navegador.

---

## Stack front-end

| Camada | Tecnologia |
|---|---|
| Bundler | Vite 5 |
| Framework | React 18 |
| Linguagem | TypeScript (strict, no `any`) |
| Estilos | Tailwind CSS 3 + CSS variables HSL |
| Variants | class-variance-authority (`cva`) |
| Ícones | lucide-react |
| Utilities | clsx + tailwind-merge (`cn` helper) |

### Atomic Design — 48 componentes

```
webui/src/
├── atoms/        # 11 — Badge, Button, IconButton, Input, Kbd, Select,
│                 #      Spinner, Textarea, Toast, ToastHost, Tooltip
├── molecules/    # 10 — AgentStatusPill, BackendCard, ConcurrencyControl,
│                 #      CostDisplay, FileChip, LogLine, ModelCard,
│                 #      PipelineCard, StepRow, TokenCounter
├── organisms/    # 9  — AssistantChat, FileMultiSelect, Header, KanbanBoard,
│                 #      LogPanel, ModelSelectorList, PipelineList, Sidebar,
│                 #      StepEditor
├── templates/    # 3  — AppShell, FullscreenModal, SplitPanel
└── pages/        # 15 — Welcome, PipelineAssistant, PipelineEditor,
                  #      PipelineImport, PipelineImportPaste,
                  #      PipelineImportCustom, PipelineExport,
                  #      SavedPipelines, BackendSelector, ModelSelector,
                  #      ApiKey, TimeoutPrompt, Run, Summary, Waiting
```

### Tema

Tokens HSL em `webui/src/index.css` (CSS variables) + espelhamento TS em `webui/src/lib/theme.ts`:

| Token | Cor | Uso |
|---|---|---|
| `--ai` | fuchsia 290° | **Reservado para AI**: Smart Select, Pipeline Assistant, Project Recon, agent logs (mesma regra do TUI `theme.ai`) |
| `--border` | cyan 187° | bordas, foco |
| `--success` | green 142° | sucesso, agents done |
| `--warning` | amber 38° | retry, throttling |
| `--error` | red 0° | erros, kill |
| `--info` | blue 217° | informativo |

Dark mode default via `<html class="dark">`. Toggle em `webui/src/lib/use-theme.ts` persiste em `localStorage`.

---

## Protocolo WebSocket

Definido em `src/web/ws-protocol.ts` (sem imports de Node — consumido também pelo front via path alias `@shared/`).

### Cliente → Servidor (17 tipos)

`nav`, `pipeline.save`, `pipeline.delete`, `pipeline.import`, `pipeline.export`, `pipeline.requestList`, `backend.select`, `model.requestCatalog`, `model.select`, `apiKey.submit`, `files.scan`, `assistant.prompt`, `recon.start`, `run.start`, `run.abort`, `run.setConcurrency`, `ping`

### Servidor → Cliente (13 tipos)

`hello`, `screen`, `state`, `pipelines`, `models`, `files`, `assistant.chunk`, `assistant.done`, `recon.chunk`, `recon.done`, `apiKey.required`, `result`, `error`

### Validação

Type guards `isClientMessage(x)` e `isServerMessage(x)` verificam o discriminator. Mensagens malformadas geram `{type:'error', code:'BAD_MSG'}` sem quebrar a conexão.

### Heartbeat

Ping nível WebSocket a cada 30s; se não houver pong em 10s, server fecha a conexão. O front-end faz reconnect com exponential backoff + jitter.

---

## Segurança

| Camada | Mecanismo |
|---|---|
| Bind | `127.0.0.1` (loopback only) — não exposto na LAN |
| Token | UUID v4 gerado no boot, embutido na URL como `?t=...` |
| Validação | `crypto.timingSafeEqual` em HTTP **e** WS upgrade |
| Logs | Token nunca é logado (comentário `// no-log: token` na construção da URL) |
| CORS | Inexistente (localhost-only) |
| Path traversal | `path.resolve(staticDir, urlPath)` deve começar com `path.resolve(staticDir)` |

### Modelo de ameaça

- ✅ Outro usuário na mesma máquina **não** consegue acessar (precisaria do token, que está só no shell+browser do usuário corrente).
- ✅ Sites maliciosos no browser **não** conseguem fazer DNS rebind / SSRF — o token está em query string, não em cookie, e validação é constant-time.
- ❌ **Não é seguro expor a porta na LAN.** A Fase 1 não suporta isso por design.

---

## Build & desenvolvimento

### Build de produção

Do root do repo:

```bash
npm install                 # instala root + workspace webui (npm workspaces)
npm run build:webui         # roda vite build no webui → src/web/dist-static/
npm run build               # build:webui + tsc + chmod +x dist/cli.js
```

### Desenvolvimento (hot reload do front)

Terminal 1 — back-end:
```bash
npm run dev -- --web --yolo --stub --web-port=3737 --no-open
```

Terminal 2 — Vite dev (HMR):
```bash
npm run dev -w webui
# abre em http://localhost:5173 (mas o WS aponta para a URL do back)
```

Para apontar o front-dev ao back local, o `vite.config.ts` já tem alias; só ajustar a URL do WS em `webui/src/lib/use-ws.ts::deriveWsUrl` se necessário (ou colar manualmente a URL completa do back na barra de endereço para usar o bundle empacotado).

---

## Testes

| Suite | Arquivos | Total |
|---|---|---|
| Total do repo | 47 | **565 testes passando** |
| `screen-fsm` (FSM pura) | `src/lib/screen-fsm.test.ts` | 60 |
| Web server (HTTP+WS+token) | `src/web/server.test.ts` | 10 |
| Web session (FSM driver) | `src/web/session.test.ts` | 10 |
| State coalescer | `src/web/orchestrator-bridge.test.ts` | 5 |
| Browser open | `src/web/browser-open.test.ts` | 1 |

### Smoke test end-to-end

```bash
bash scripts/smoke-web.sh
```

Sobe o binário em porta fixa, valida o 401-sem-token e checa que `huu web UI ready:` apareceu em stderr. Exit 0 = OK.

---

## Limitações conhecidas

> Estas limitações são deliberadas para a Fase 1 — todas têm caminhos de solução planejados.

### 1. `--web` requer `--yolo` (sem Docker)

**Sintoma:** `huu --web` sem `--yolo` sai com código 2 e mensagem:
> `huu: --web requires --yolo in Phase 1 (Docker port-publishing for the web UI is not implemented yet).`

**Causa:** o wrapper Docker re-exec da camada `lib/docker-reexec.ts` ainda não publica portas para o host. O agente roda dentro do container, mas o servidor web ficaria inacessível.

**Workaround:** use `--yolo` (rodar nativo no host). A segurança do isolamento Docker é perdida; o agente tem acesso ao seu `~/.ssh`, `~/.aws` etc. — o que já era o caso para qualquer `--yolo`.

**Solução futura:** reservar porta no host pré-reexec, passar via `HUU_WEB_PORT` env, adicionar `-p 127.0.0.1:p:p` ao `docker run`.

### 2. Refresh do navegador no editor perde o draft local

**Sintoma:** se você está digitando uma pipeline nova no editor e dá F5 no navegador, o conteúdo do editor volta ao estado servidor (que não inclui rascunhos não-salvos).

**Causa:** o `WsContext.currentPipeline` é client-local; o servidor só conhece pipelines que passaram pelo FSM (via `welcome.selectPipeline`, `assistant.done`, `saved.select` ou `pipeline.save`).

**Workaround:** clique "Save" antes de refresh. Ou simplesmente não dê refresh — a conexão WS se mantém viva por horas.

**Solução futura:** debounce + envio automático do draft via novo `editor.draft` ClientMessage que o servidor armazena por sessão.

### 3. Import de pipeline por path usa workaround JSON

**Sintoma:** a página "Import from path" aceita um caminho de arquivo, mas internamente o servidor lê o arquivo e re-envia o JSON via `pipeline.import` (que aceita JSON cru).

**Causa:** não há mensagem dedicada `pipeline.importFromPath` no protocolo.

**Workaround:** funciona normalmente para o usuário final — é detalhe de implementação.

**Solução futura:** adicionar `{type:'pipeline.importFromPath', path}` ao protocolo, com validação de path (deve estar dentro de `cwd`).

### 4. Pipeline Assistant é single-turn no web

**Sintoma:** no TUI, o Pipeline Assistant aceita múltiplas trocas conversacionais antes de gerar a pipeline. No web, é só um prompt → resposta única.

**Causa:** o handler `assistant.prompt` chama `invokeStructured` uma vez. Não há estado de chat persistido por conexão.

**Workaround:** colocar todo o briefing no primeiro prompt.

**Solução futura:** adicionar `assistant.answer` ClientMessage + estado de chat (lista de turnos) por sessão. Streaming chunks já existem; falta só a memória de conversação.

### 5. Bind localhost-only, sem modo remoto/multi-usuário

**Sintoma:** o servidor só aceita conexões de `127.0.0.1`. Não dá pra acessar do seu celular na mesma rede, nem do colega.

**Causa:** por design — Fase 1 prioriza segurança simples.

**Workaround:** SSH tunneling (`ssh -L 53842:127.0.0.1:53842 user@host`).

**Solução futura:** flag `--web-host=0.0.0.0` + autenticação real (não só token na URL). Provavelmente OAuth GitHub.

### 6. `smoke-web.sh` requer porta 45678 livre

**Sintoma:** se outro processo está bindando 45678, o smoke test falha.

**Workaround:** matar o processo (`lsof -ti:45678 | xargs kill`) ou rodar com `HUU_TEST_PORT=<outra>`.

**Solução futura:** parsear a porta do stderr em vez de fixar.

### 7. Sem testes de browser end-to-end

Os 565 testes cobrem unidade (FSM, server, session, coalescer) mas não há Playwright/Cypress validando que cliques no UI realmente disparam os eventos certos. Validado manualmente.

**Solução futura:** adicionar Playwright em CI.

---

## Roadmap (fora desta entrega)

Em ordem aproximada de prioridade:

1. **Suporte Docker** — port-publishing automático, remover gate `--yolo`.
2. **Chat multi-turn no Pipeline Assistant.**
3. **Persistência de draft no editor** (resolve refresh-perde-rascunho).
4. **Modo remoto** — bind configurável + auth real (OAuth GitHub leve, ou token longo-vivo persistido).
5. **Tema light polido** — atualmente o foco foi dark; light funciona mas não está pixel-perfect.
6. **Internacionalização** — i18n para PT-BR / EN (hoje strings hardcoded em EN).
7. **Testes E2E** com Playwright.
8. **Hot reload do back-end** em dev (atualmente `npm run dev` faz watch mas o servidor não reconecta clientes).
9. **Exportar JSON do PipelineExport** via download nativo (já funciona, mas pode ganhar nome de arquivo customizável e copy-to-clipboard).
10. **Screenshot / GIF na README.**

---

## Mapa de arquivos

### Novos (criados nesta entrega)

```
src/
├── cli-web.ts                          # entrypoint do --web (boot do servidor)
├── lib/
│   ├── screen-fsm.ts                   # FSM pura (Screen, FsmEvent, reduce)
│   └── screen-fsm.test.ts              # 60 testes da FSM
└── web/
    ├── ws-protocol.ts                  # tipos do protocolo WS (cliente+servidor)
    ├── server.ts                       # HTTP+WS server + token + static
    ├── server.test.ts
    ├── session.ts                      # FSM driver por conexão
    ├── session.test.ts
    ├── orchestrator-bridge.ts          # StateCoalescer 8 Hz
    ├── orchestrator-bridge.test.ts
    ├── browser-open.ts                 # xdg-open/open/start cross-platform
    ├── browser-open.test.ts
    ├── handlers/
    │   ├── pipelines.ts                # listAll / save / delete / import
    │   ├── files.ts                    # scan
    │   ├── models.ts                   # catalog
    │   ├── assistant.ts                # streaming
    │   └── recon.ts                    # streaming
    └── dist-static/                    # output do vite build (gitignored)

webui/                                  # workspace npm separado
├── package.json
├── vite.config.ts                      # outDir = ../src/web/dist-static
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── index.html
├── README.md
└── src/
    ├── main.tsx
    ├── App.tsx
    ├── Router.tsx                      # switch sobre screen.kind
    ├── index.css                       # Tailwind + CSS vars
    ├── lib/
    │   ├── cn.ts                       # clsx+twMerge helper
    │   ├── theme.ts                    # tokens HSL
    │   ├── use-theme.ts                # dark/light toggle
    │   ├── ws-client.ts                # cliente WS com reconnect
    │   ├── use-ws.ts                   # hook React
    │   ├── ws-context.tsx              # accumulators + Context
    │   └── domain-types.ts             # types derivados
    ├── atoms/                          # 11 componentes
    ├── molecules/                      # 10 componentes
    ├── organisms/                      # 9 componentes
    ├── templates/                      # 3 layouts
    └── pages/                          # 15 páginas

scripts/
└── smoke-web.sh                        # smoke test end-to-end

.agents/skills/
└── web-ui-react/SKILL.md               # skill spec para futuros agentes
```

### Modificados

- `src/cli.tsx` — gate `--web && !--yolo`, parsing das novas flags, branch para `runWebMode`
- `src/app.tsx` — refatorado para consumir `screen-fsm.ts` (TUI continua idêntico)
- `src/web/session.ts` — aceita `initialPipeline` + `autoStart` (idem TUI)
- `package.json` — adiciona workspace `webui`, scripts `build:webui`, dep `ws`
- `.gitignore` — exclui `src/web/dist-static/`
- `README.md` + `README.en.md` — seção Web UI
- `AGENTS.md` — skill `web-ui-react` + seção arquitetural
- `agent-skills.md` — catálogo de skills atualizado
- `CHANGELOG.md` — entries no `[Unreleased]`

---

## Métricas

| Métrica | Valor |
|---|---|
| Arquivos criados | 76 |
| Arquivos modificados | 24 |
| Linhas adicionadas | +12.831 |
| Linhas removidas | −3.184 |
| Componentes React | 48 (11+10+9+3+15) |
| Tipos no protocolo WS | 30 (17 client→server, 13 server→client) |
| Testes adicionados | +26 (FSM +60 contando a extração; novos arquivos: server 10, session 10, coalescer 5, browser-open 1) |
| Bundle final do front | 234 KB (~70 KB gzip) JS + 22 KB CSS |
| Versão alvo | 0.4.0 (minor — feature aditiva, TUI intacto) |

---

## Referências cruzadas

- `AGENTS.md` → seção "Web UI mode" + skill `web-ui-react`
- `.agents/skills/web-ui-react/SKILL.md` → spec da skill
- `CHANGELOG.md` → `[Unreleased]` → `Added`
- `README.md` / `README.en.md` → seção "Web UI"
- `scripts/smoke-web.sh` → smoke test executável
