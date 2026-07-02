# Roadmap — huu: "Poder Máximo, Teto do Usuário, Nunca Quebra"

> Plano de engenharia para o controle de recursos do huu rodando **muitos
> projetos em paralelo** sem derrubar o processo. Nasceu de um incidente real:
> 9 auditorias simultâneas pela UI web mataram o processo por OOM (SIGKILL do
> kernel), ~190 agentes/worktrees somados, num único processo Node sem teto
> honesto de RAM.
>
> **Princípio inegociável:** *encher a máquina até o teto que o usuário escolher,
> degradando (enfileirar, pausar, reduzir concorrência) em vez de quebrar.*
> Throughput menor é aceitável; parar/crashar não é.
>
> Este documento descreve o que **já foi entregue (Fase 1)** e **todo o restante
> do plano (Fases 2 e 3)**.

## Sumário das fases

| Fase | Estado | O que muda | Ganho | Risco |
|---|---|---|---|---|
| **1 — dias** | ✅ **Entregue** | Dial por % (`budget.ts`), PSI como freio, seed pessimista, lazy-admission na web, `oom_score_adj`, fast-ramp | Enche até o teto sem quebrar; fim da admissão cega da UI | Medição in-process imprecisa (mitigada por folga) |
| **2 — semanas** | 🔨 **Parcial** (2.1 + 2.2 + 2.3 ✅ entregues; 2.4/2.5 pendentes) | cgroup-pai `memory.high/max` por %, controlador senpai+AIMD com histerese, sessão pi persistente, fila SQLite WAL, zram | OOM **global impossível** via kernel; degrada/retoma em vez de morrer | Thrash invisível; oscilação; CPU do zram |
| **3 — estrutural** | ⏳ Planejado | Agentes em subprocessos, cgroup+`oom_score` por-agente, PSS honesto, hierarquia completa de degradação, container-por-run, multi-host | Vítima legítima de OOM; medição exata = margens menores = mais agentes; escala >1 host | Complexidade de IPC, órfãos, determinismo do resume |

---

## Fase 1 — ENTREGUE (resumo do que existe hoje)

O orçamento de RAM por porcentagem virou o **invariante de admissão** e o sinal
mudou de "% de RAM usada" (tardio) para **PSI** (dianteiro):

- **Dial por %** — `HUU_RAM_PERCENT` / `--ram-percent` / Setting web "RAM budget %"
  (default 85, faixa 10–95). Machine-global. `src/lib/budget.ts` (`resolveRamPercent`,
  `ramBudgetBytes`, piso de reserva do SO de 512 MiB).
- **PSI como freio** — `SystemMetrics.memPressureSome10` (cgroup `memory.pressure` →
  `/proc/pressure/memory`; `null` ⇒ fallback pro gate de %-RAM). Congela admissão a
  partir de `admitPsiThreshold` (0.5%).
- **Seed pessimista** — `DEFAULT_AGENT_MEMORY_ESTIMATE_MB` 250 → 1536 (EMA corrige
  pra baixo). Inverte o erro do incidente: numa máquina 31 GiB/15.8 usados, 85% admite
  ~7 agentes no arranque vs ~43 com o seed antigo.
- **Fast-ramp** — `executeTaskPool` limita spawns/tick a `max(1, ceil(busy·0.5))`.
- **Admissão preguiçosa na web** — `WebRunManager` + `AdmissionController`
  (`src/lib/admission-controller.ts`, compartilhado com `run-many`): primeiro run
  admite na hora, resto fica `queued` até haver folga sustentada.
- **`oom_score_adj`** — `src/lib/oom-score.ts`, `HUU_OOM_SCORE_ADJ`, default conservador.

**Limite conhecido (motiva a Fase 2):** a medição é **in-process** — todos os
agentes compartilham o RSS do único processo Node, então o footprint por-agente é
*atribuído* (ruidoso), não *medido*; e o teto de RAM é uma promessa de software, não
uma invariante de kernel. A Fase 2 fecha isso.

---

## Fase 2 — cgroup-pai + controlador adaptativo + sessão persistente + fila + zram

**Objetivo:** tornar o OOM-kill **global** IMPOSSÍVEL via kernel, e ganhar
recuperação graciosa sob pressão (degradar/retomar em vez de morrer).

### 2.1 Self-cgroup no boot (`memory.high` / `memory.max`) — ✅ ENTREGUE

> **Entregue (2026-07-02)** em `src/lib/cgroup-self-wrap.ts` + gate no topo do
> `cli.tsx`, com um desvio deliberado do desenho abaixo: o scope é dimensionado
> pela **reserva do SO** (`MemoryHigh = total − reserva`, `MemoryMax = total −
> reserva/2`, `MemorySwapMax` via `HUU_SWAP_MAX_MB`), NÃO pelo dial — o dial é o
> alvo de utilização interno (re-tunável ao vivo pela web) e o scope é a linha
> de segurança do HOST, fixada no boot. O wrapper docker ganhou o teto
> equivalente (`--memory`/`--memory-swap`/`--pids-limit`). Escapes:
> `HUU_NO_CGROUP=1` (nativo) e `HUU_NO_MEM_LIMIT=1` (container). O texto
> original segue como registro do desenho:

Re-executar o huu dentro de um *scope* transitório com o orçamento derivado do mesmo
% do dial:

```bash
systemd-run --scope -p MemoryHigh=85% -p MemoryMax=92% -p MemoryAccounting=yes huu …
```

ou manipular `/sys/fs/cgroup` diretamente quando systemd não estiver disponível.
Para 85% de 32 GiB: `memory.high ≈ 27.2 GiB`, `memory.max ≈ 29.4 GiB` (gap de ~2.2 GiB
= espaço pro kernel reclamar antes do OOM **confinado ao cgroup**).

- **`memory.high`** = throttle + reclaim **sem matar** (doc do kernel: *"Going over the
  high limit never invokes the OOM killer… the high limit should be used in scenarios
  where an external process monitors the limited cgroup to alleviate heavy reclaim
  pressure"*). O huu **é** esse monitor externo (o controlador PSI da §2.2) — sem ele,
  fica em "lentidão antes da morte" (thrash invisível).
- **`memory.max`** = rede de segurança: OOM confinado ao cgroup do huu, **nunca** ao
  sistema todo. Só dispara se o reclaim não acompanhar.
- huu **já é cgroup-aware** (`resource-monitor.ts` lê `memory.current/max` e
  `memory.pressure`), então `ramTotalBytes` passa a refletir o `memory.max` do scope
  automaticamente — o dial da Fase 1 reaproveita o envelope sem reescrita.

**Critério de pronto:** induzir um pico além do teto → observar `memory.high`
throttlando + reclaim, e o huu parando de admitir, **em vez de** qualquer kill.

### 2.2 Controlador adaptativo (estilo senpai/TMO + Netflix concurrency-limits) — ✅ ENTREGUE

> **Entregue** em `auto-scaler.ts` (`updateController()`): `controlledLimit` com
> incremento aditivo Vegas `+max(3, ⌈0.1·limit⌉)` sob `PSI < targetPsi` (0.5%), corte
> AIMD `×0.5` acima da banda de corte (2× = 1.0%) com hold de 5 s, e histerese no meio;
> clampado no teto do budget de RAM. O freeze binário do `shouldSpawn` migrou pra banda
> de corte, então o controlador roda a máquina NO setpoint sem o gate brigar. Máquina-global
> (dirige o `B` do único budget do `GlobalScheduler`). Verificado em runtime (sweep PSI
> 0→3→0→0.7→5). Pinado por `auto-scaler.test.ts`.

Trocar o "alvo por folga" estático por um controlador com **feedback de PSI**:

- **Alvo de pressão**: `PSI_some avg10 ≈ 0.5–1%` — deliberadamente MAIS ALTO que os
  0.1% do senpai (Meta), porque o objetivo do huu é **encher** a máquina, não
  economizar RAM. Operar a uma pressão de regime baixa-mas-não-nula extrai o máximo.
- **Lei de controle proporcional** (versão de produção do TMO, ASPLOS'22):
  `reclaim = current × reclaim_ratio × max(0, 1 − PSI_some / PSI_threshold)` — reclama
  menos conforme a pressão se aproxima do alvo. (A Meta migrou de ajustar
  `memory.high` *stateful* para o knob *stateless* `memory.reclaim`; avaliar qual cabe.)
- **Fast-ramp + AIMD** (Netflix Vegas): sobe aditivo `+max(3, 10% do limite)`/tick
  enquanto `PSI < alvo`; corta multiplicativo `×0.5` ao cruzar `PSI > 2×alvo`.
- **Histerese obrigatória**: limiar de subida (0.5%) ≠ de descida (2%) + cooldown de
  alguns ticks após cada corte — senão o controlador oscila perto do teto.
- **Cadência**: 1 s pra admissão, 5–6 s pras decisões de reclaim (o senpai usa 6 s pra
  deixar refaults se manifestarem).

**Critério de pronto:** sob carga, `PSI some avg10` estabiliza perto do alvo sem
oscilar; nenhum OOM-kill; throughput maior que o teto estático da Fase 1.

### 2.3 Sessão pi persistente (pausar em vez de matar) — ✅ ENTREGUE

> **Entregue.** O guard (single-run em `index.ts` + cross-run no `GlobalScheduler`) agora
> chama `pauseAgent()` por padrão: checkpoint da sessão pi (`SpawnedAgent.checkpoint()` →
> caminho do arquivo de sessão) → dispose (libera RAM) → PRESERVA worktree + branch +
> transcript → requeue em fase `paused`. O `shouldSpawn` retoma a task IN-PLACE (reusa a
> worktree + `restoreSessionPath`) quando a folga volta. Fallback garantido pra
> kill+requeue quando não dá pra fazer checkpoint (ausente/null/erro) e via `HUU_NO_PAUSE=1`
> ⇒ **zero regressão por construção**. pi factory: `inMemory()` → `SessionManager.create/open`,
> com o `.jsonl` num dir `.huu-sessions/` FORA da worktree (senão o finalize commitava o
> transcript). Provado por uma spike de runtime contra o SDK pi real (abort no meio →
> resume não refaz tool calls) + `requeue.test.ts` / `multi-run-priority.test.ts`. UI:
> fase `paused` (coluna DONE, `PAUSED` âmbar, badge `⏸N`) no Ink e na web.
>
> **Nota (Fase 3):** a restrição in-process abaixo continua valendo — o pause libera RAM
> via dispose+GC (mesmo mecanismo do kill de hoje), não via SIGSTOP/cgroup por-agente.

Hoje, sob pressão, o guard **mata** o agente e re-enfileira a task do zero — perde o
contexto de raciocínio (tokens já gastos) **e** o trabalho parcial na worktree. O
`pi-coding-agent` (v0.73) **já suporta** persistência/resume de sessão, mas o huu usa
`SessionManager.inMemory()`.

- Trocar por `SessionManager.create(cwd, sessionDir)` → o pi salva o transcript em
  disco a cada `message_end` (formato v3 JSONL), com `switchSession`/`--resume`.
- Transformar "matar agente" (perda total) em **checkpoint+dispose** (recuperável):
  abortar num boundary de turno → persistir sessão → `dispose()` (libera heap) →
  recriar do arquivo de sessão + a mesma worktree e continuar.
- **Restrição-chave**: agentes rodam **in-process** (mesmo heap) — pausar só libera RAM
  via serialização + dispose; SIGSTOP/cgroup por-agente só valem com subprocessos
  (Fase 3). Custo de retomar = re-hidratar contexto (re-paga tokens de *input*,
  mitigável por prompt caching), sem re-derivar nem re-executar tools.
- Pausar e enfileirar (FIFO) são **complementares**: FIFO limita quantos *começam*, o
  checkpoint preserva os que já *começaram* quando é preciso recuar.

### 2.4 Fila durável (SQLite WAL, single-writer)

Hoje a fila de projetos vive no navegador (perde-se ao fechar/crashar). Journalizar o
progresso por-stage:

- SQLite em modo **WAL** (`synchronous=NORMAL`, `busy_timeout`), um processo *writer*
  dedicado consumindo a fila — padrão de River/SkyPilot.
- Como a worktree de integração **nunca rebobina** (merge `--no-ff`, ordem ascendente
  de agentId), basta persistir "último stage mergeado por run" + estado de cada task.
  Retomar = reabrir do último stage commitado.
- Cuidado com a contenção contra o `index.lock` do git (retry com backoff).

### 2.5 zram (absorver picos sem matar)

Habilitar ~20–25% da RAM (6–8 GiB em 32) como `swap` comprimido (LZ4, ~2–3×). Sob
pressão, páginas de agentes congelados (SIGSTOP, Fase 3) são empurradas pro zram em
vez de provocar kill — aumenta a "RAM efetiva" e suaviza o joelho da curva.
Limitar a ≤30% da RAM (acima disso compete com o workload e pode travar suspend);
overhead de CPU ~5–15% sob pressão.

**Critério de pronto da Fase 2:** matar o processo no meio de um run → o run **retoma**
do último stage mergeado; um pico além do teto vira throttle+reclaim+espera, nunca kill.

---

## Fase 3 — Subprocessos, hierarquia de degradação, container-por-run

**Objetivo:** medição **honesta** de footprint + **vítima legítima** de OOM +
isolamento de crash + escala além de 1 host.

### 3.1 Agentes como subprocessos

Migrar cada sessão pi (ou um **pool reutilizável** de workers) para
`child_process.fork` de um worker script:

- **Pool reutilizável** pra amortizar os ~32 MB + startup do V8 por processo;
  **`fork`** (não `worker_threads`) pra isolamento real de crash — um agente que estoura
  **não derruba o orquestrador** (que hoje é ponto único de falha).
- IPC pra comandos/controle; streaming do LLM via pipe/socket dedicado.
- Ciclo de vida: spawn → health-check → timeout → **cleanup de órfãos por cgroup** (não
  por PID, evita zumbis).

### 3.2 cgroup + `oom_score_adj` por-agente

- `systemd-run --scope -p MemoryHigh=<budget/slots>` por subprocesso de agente.
- `oom_score_adj` **alto** (+500…+1000) nos agentes e **−1000** no orquestrador — agora
  **seguro**, porque existe vítima legítima: sob OOM, o kernel mata um AGENTE
  (recuperável via sessão persistente da §2.3), **nunca** o huu. (Na Fase 1 o default é
  conservador justamente porque ainda não há essa vítima.)

### 3.3 Medição honesta de footprint (PSS/USS)

- Ler `smaps_rollup` (**PSS** — páginas compartilhadas divididas pelo nº de processos;
  **USS** — só privadas) por subprocesso, e `memory.current` do cgroup-pai como verdade.
- Agregar **PSS** evita dupla-contagem das páginas COW do runtime Node compartilhadas
  entre forks (somar RSS engana: superconta o compartilhado).
- **Semear** footprint de agente novo com o p50/p95 **medido** dos agentes vivos (não
  seed fixo). Buffers off-heap do cliente HTTP (streaming do LLM) passam a ser contados
  automaticamente pelo `memory.current` do subprocesso — some o problema do "external
  invisível ao V8" (o `--max-old-space-size` não os conta).
- **Gatilho mensurável pra adotar a Fase 3**: se a diferença entre footprint estimado
  in-process e o `memory.current` real for **> 20%**, subprocessos se pagam.

### 3.4 Hierarquia completa de degradação

Ordenada por **(RAM recuperada / trabalho perdido)** — aplicar nesta ordem sob pressão:

1. **Parar de admitir** novos (custo zero; estanca o crescimento).
2. **`memory.high` throttle + reclaim** (kernel trabalha; latência sobe, nada morre).
3. **`SIGSTOP` nos agentes mais novos** (congela CPU; com zram, páginas saem da RAM;
   reversível com `SIGCONT`, zero perda). *Obs.: SIGSTOP sozinho não libera RAM — só
   converte "congelado" em "RAM livre" com swap/zram por trás.*
4. **Checkpoint + dispose** dos agentes que perderam menos trabalho (libera RAM de
   verdade; recupera via sessão persistente).
5. **Matar** (último recurso; só o que não dá pra checkpointar).

### 3.5 Container-por-run + multi-host (opcional/escala)

- O huu já se re-executa em Docker; estender pra **um container/cgroup por run** dá
  isolamento e contabilidade limpos (a um custo de startup + coleta de SSE/logs).
- **Multi-host** quando 1 máquina não basta: fila durável (§2.4) + N workers, push com
  backpressure ou work-stealing.

**Critério de pronto da Fase 3:** PSS agregado bate com `memory.current` ±10%; matar 1
agente não afeta os demais; resume determinístico de um run após kill no meio de um stage.

---

## Dial recomendado (exposto ao usuário)

O usuário informa **um** % e o sistema deriva os quatro valores com as mesmas razões:

| Perfil | `memory.high` | `memory.max` | Alvo PSI | zram | Para |
|---|---|---|---|---|---|
| **Conservador 70%** | 70% | 77% | 0.3% | opcional | máquina compartilhada / desktop em uso |
| **Equilibrado 85%** (default) | 85% | 92% | 0.5–1% | 20% | servidor dedicado |
| **Turbo 95%** | 95% | `total − 1.5 GiB` | 1–2% | 25% **obrigatório** | "arrancar tudo" |

Benchmarks que mudam a recomendação: `PSI full avg10 > 0` sustentado (todas as tasks
paradas) → baixar um nível; `PSI some avg10` cronicamente < alvo → pode subir.

---

## Caveats

- **Turbo (95%) é o trade-off explícito "mais máquina × mais risco":** a folga
  `high→max` encolhe; se o reclaim não acompanhar a rajada, o SO INTEIRO pode travar.
  O piso de reserva (`memory.max ≤ total − 1.5 GiB`) é inegociável em turbo, e turbo só
  com zram habilitado + PSI monitorado de perto.
- **Thrash invisível do `memory.high`:** sem o monitor externo (o controlador PSI), o
  cgroup fica em reclaim throttle indefinido. Mitigar com watchdog.
- **Oscilação do controlador perto do teto:** mitigada por histerese (limiares
  separados) + cooldown + corte multiplicativo.
- **Determinismo do resume:** depende de a integração nunca rebobinar e da idempotência
  por-stage; efeitos colaterais não-idempotentes quebram o exactly-once.
- **Divergência das fontes do senpai:** a lei de produção (proporcional, `memory.reclaim`)
  e a do `senpai.py` open-source (quadrática, `memory.high`) são diferentes — adotar a
  lógica proporcional + histerese adaptada, não copiar constantes cegamente (os 0.1% do
  senpai são pra economizar; o huu quer encher).

---

## Referências verificáveis

- **Kernel / cgroups v2 / PSI:** docs.kernel.org/admin-guide/cgroup-v2.html;
  docs.kernel.org/accounting/psi.html; facebookmicrosites.github.io/cgroup2 e /psi.
- **systemd:** freedesktop.org systemd.resource-control (`MemoryHigh`/`MemoryMax` em %);
  `systemd-run --scope`, `systemd-oomd`.
- **Kubernetes:** node-pressure-eviction, reserve-compute-resources (Allocatable =
  Capacity − reserved − eviction-threshold).
- **senpai/TMO (Meta):** Weiner et al., "TMO: Transparent Memory Offloading in
  Datacenters" (ASPLOS'22; CACM 2025); github.com/facebookincubator/senpai e /oomd.
- **Netflix concurrency-limits:** "Performance Under Load";
  github.com/Netflix/concurrency-limits (AIMD/Vegas/Gradient).
- **Node/V8 memória:** nodejs.org/learn/diagnostics/memory; nodejs/node #24225 (external
  heap); fork vs worker_threads.
- **smaps/PSS/USS:** kernel proc `smaps_rollup`; puma PR #2099 (COW).
- **SIGSTOP/zram/zswap:** chrisdown.name "Debunking zswap and zram myths".
- **SQLite WAL / durable execution:** sqlite.org WAL; riverqueue.com/docs/sqlite;
  docs.temporal.io (replay determinístico).

---

> **Onde isto vive nos docs do agente:** os fatos da Fase 1 estão em `AGENTS.md`
> ("Dynamic concurrency" + "Multi-run scheduling") e nas skills
> `working-on-orchestrator` / `building-web-ui`. Quando uma fase futura for
> implementada, mover seu resumo pra lá e atualizar este roadmap.
