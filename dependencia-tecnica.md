# Débito técnico — Auto-scaling de agentes

Itens deferidos da implementação inicial do modo auto-scale. Cada item lista
o estado atual, motivação para implementar, esboço de implementação e
restrições conhecidas.

---

## 1. PSI (Pressure Stall Information) como sinal de pressão

**Status:** não implementado. Decisões usam apenas `cpuPercent` e `memPercent`
(% utilização) lidos do cgroup do container.

**Por quê migrar:**
% de utilização confunde "muito disco em cache" com "thrashing iminente".
PSI mede tempo *stalled* (tarefas presas esperando recurso), que é o sinal
direto de "o sistema está sofrendo agora". Cenários reais:

- RAM 92% + PSI mem `some avg10` = 0% → file cache saudável, OK criar agente.
- RAM 70% + PSI mem `some avg10` = 30% → thrashing começando, NÃO criar.

**Como implementar:**
- Ler `/sys/fs/cgroup/memory.pressure` e `/sys/fs/cgroup/cpu.pressure`.
- Parsear linha `some avg10=<x> avg60=<y> avg300=<z> total=<n>`.
- Gate adicional no trip-wire: `RAM ≥ 95% AND mem.some.avg10 > 20%`.
- Gate adicional no scale-up stop: `mem.some.avg10 > 10%`.

**Restrição:** Linux com cgroup v2 apenas. Em macOS/Windows nativo (rodando
sem Docker) cai no fallback baseado em %.

**Refs:**
- https://docs.kernel.org/accounting/psi.html
- https://kubernetes.io/docs/reference/instrumentation/understand-psi-metrics/
- https://facebookmicrosites.github.io/cgroup2/docs/pressure-metrics.html

---

## 2. Testes do Autoscaler

**Status:** sem cobertura.

**Por quê:** trade-off entrega vs. garantia na primeira versão. Vitest já
está configurado, então adicionar é barato; só foi adiado para encurtar
o ciclo inicial.

**O que cobrir:**

- Mock de métricas → assert das chamadas em `setConcurrency()` /
  `killNewestAgent()`.
- Histerese: amostras alternando 89%/91% não devem oscilar (banda morta).
- Cooldown: dois kills em sequência exigem ≥ 5 s entre eles.
- Trip-wire: 95% dispara kill imediato, sem esperar o tick de 5 s.
- Re-enqueue: task matada volta pra `pendingTasks` e é re-pegada no próximo slot.
- Loop infinito: task matada 3× consecutivas vira `error` com
  `errorKind: 'preempted'`.
- Cálculo de headroom: 16 GB host + 4 GB usados → permite até 17 adds num tick.
- CPU EMA: pico transitório de 100% por 1 s não deve disparar trip-wire.

**Stack:** vitest (já configurado em `package.json`).

---

## 3. Disk pressure como sinal independente

**Status:** sinal lido (`statvfs` no `worktreeBaseDir`) mas tratado apenas
como gate de scale-up — não há trip-wire de kill por disco.

**Por quê pode ser necessário:**
N worktrees × tamanho do repo pode estourar disco antes da RAM. Um
`git worktree add` sob disk-full corrompe estado interno do git e exige
limpeza manual.

**Como aprofundar:**
- Threshold de scale-up stop: `disk used ≥ 90%`.
- Trip-wire por disco: `disk used ≥ 95%` → kill mais recente.
- Em Docker, atenção: `statvfs` reflete o filesystem montado no path,
  pode ser overlay do container ou bind mount do host — comportamento
  difere por configuração.

---

## 4. Heurística de "headroom" baseada em histórico

**Status:** valor fixo de **500 MB/agente** para o cálculo de scale-up.

**Por quê melhorar:**
500 MB é uma estimativa razoável para o pi-coding-agent base, mas pipelines
com modelos pesados ou customer code que sobe dev server vão consumir
significativamente mais. Estimar errado → sub-utilização (custo) ou
sobre-utilização (kill em cascata).

**Como aprofundar:**
- Medir RSS médio dos agentes terminados (`process.memoryUsage().rss` no
  fim do `spawnAndRun`).
- Manter média móvel ponderada por pipeline.
- Adicionar buffer de segurança (ex.: P95 + 20%).
- Persistir entre runs em `.huu-cache/agent-rss.json` para warm start.

---

## 5. Bound mínimo do scale-down

**Status:** scale-down pode chegar a 0 agentes ativos sob pressão extrema.

**Discussão:**
Se o host está realmente em chamas (95%+) e mata todos os agentes, a
pipeline trava sem progresso. Vale clampar em `min=1` para garantir
forward progress mínimo? Trade-off: 1 agente residual num host saturado
pode piorar a saturação se o trabalho dele for pesado.

**Decisão pendente:** confirmar com usuário se vale o clamp ou se prefere
"matar tudo" como sinal claro de que o host não dá conta.

---

## 6. Observabilidade do Autoscaler

**Status:** estado interno (kills, ciclos, decisões) não é exposto em
manifesto/logs estruturados.

**Por quê melhorar:**
Após um run, é difícil diagnosticar "por que só rodou 12 agentes em vez de
30 quando a fila tinha 50?". Causa pode ser pressão real, threshold mal
calibrado, ou bug no cálculo.

**Como aprofundar:**
- Estender `AgentEvent` ou `LogEntry` com `kind: 'autoscale_decision'`
  contendo `{ tick, memPercent, cpuPercent, action, toAdd, victim, reason }`.
- Persistir no `RunLogger` para análise post-mortem.
- Mostrar no `RunDashboard` um sparkline de "concurrency over time" com
  marks nos kills.

---

## 7. Suporte fora do Linux

**Status:** o cgroup-aware metrics só funciona em Linux. macOS e Windows
caem no fallback `os.totalmem()` / `os.cpus()` (host-wide).

**Restrição:** o `huu` por padrão se re-executa em Docker, então 99% dos
usos finais são Linux dentro do container. Mas:
- `npm run dev` direto (sem Docker) em Mac/Windows ignora limites.
- Container rodando em Docker Desktop (LinuxKit VM) → cgroup do container
  funciona, mas a VM tem seu próprio limite que não vemos.

**Como aprofundar:**
- Em macOS: usar `sysctl hw.memsize` + `vm_stat`.
- Em Windows: GetPhysicallyInstalledSystemMemory + GlobalMemoryStatusEx.
- Detectar Docker Desktop e avisar que limites da VM não são visíveis.
