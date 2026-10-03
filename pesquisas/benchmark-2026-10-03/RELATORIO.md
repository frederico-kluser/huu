# Benchmark DSH vs huu DEV — o MESMO prompt, o MESMO modelo (2026-10-03)

Tarefa única (`pesquisas/benchmark-2026-10-03/prompt.md`): app full-stack de
tarefas, simples mas completa, a correr local. Modelos: `xiaomi/mimo-v2.6-pro`
nos dois lados. Máquina: Acer Predator (esta), corridas sequenciais.

- **Lado A** — DSH (`dsh --profile headless`), `bench-2026-10-03/dsh-run1`
- **Lado B** — huu modo DEV (`huu dev --provider=openrouter --model=xiaomi/mimo-v2.6-pro --autonomous`), `bench-2026-10-03/dev-run1`

## 1. Execução — corre localmente?

| critério | A (DSH) | B (huu DEV) |
|---|---|---|
| arranca com UM comando | PASS (`npm start`) | **PASS com ressalva**: `npm start` refere `./.huu-bin/with-ports` que **não existe no repo** → checkout fresco falha; `PORT=3101 node server/index.js` funciona |
| CRUD completo via API | PASS | PASS |
| persistência entre reinícios | PASS | PASS |
| estado de erro detetável | PASS | PASS |

Código: A — 3/3 JS válidos · 2333 LOC · **sem testes** · 10 linhas duplicadas ·
erros tratados (banner + retry). B — 9/9 JS válidos · ~2,5k LOC (app real,
excluindo cópias de worktrees) · **sem testes** · duplicação alta · tratamento
de erros presente na API mas sem sinais de tratamento no frontend.

## 2. Tempo de parede

| lado | início | fim | duração | conteúdo do run |
|---|---|---|---|---|
| A (DSH) | 03:54:00 | 04:26:49 | **32m49s** | 64 passos, auto-verificação via CDP (corrigiu 2 bugs de UI) |
| B (huu DEV) | 04:28:39 | 07:22:53 | **2h54m14s** | 3 épocas · 6 runs · ~20 agentes em worktrees · 5 kill→requeue · loops generator→crítico · juiz por passo |

B demorou **5,3×** o tempo de A para uma app com o mesmo checklist verde.
Muito do tempo é MÉTODO (épocas, revisões, juízes, merges, requeues) — o
produto do huu é o processo auditável, não a velocidade. O run de B terminou
com `goalComplete: false` + exit 1 ao atingir o teto de 3 épocas: o objetivo
residual ficou registado ("tornar a app utilizável de fio a pavio"), efeito
desejado do desenho (honestidade sobre o que falta) mas para o utilizador é
uma entrega não-terminada.

## 3. Custos (metodologia do dossiê: 4 categorias; cache-read NUNCA a preço cheio)

Preços oficiais OpenRouter (2026-10-03): input $0.435/M · output $0.870/M ·
cache-read $0.0036/M (0,8% do input). Provider-reported por-run indisponível
(`/api/v1/activity` exige management key) → estimativa por preços de tabela.

| categoria | A (DSH) tokens · USD | B (huu DEV) tokens · USD |
|---|---|---|
| input fresco | 711.325 · $0.309 | 3.025.190 · $1.316 |
| cache-read | 4.984.192 · $0.018 | 6.743.376 · $0.024 |
| output | 65.617 · $0.057 | 590.342 · $0.514 |
| **total** | 5.76M · **$0.3845** | 16.1M · **≥$1.8538** |

- B custou **≥4,8×** o preço de A (lower bound: as chamadas estruturadas do
  orquestrador do huu — planner/juiz/crítico via LangChain — não têm ledger;
  só os 63 turnos jcode estão contados).
- Anti-bug confirmado: contabilizar cache-read a preço de input daria $2,17 no
  lado A — 5,6× o valor real. A regra do dossiê poupou um erro de 464%.
- Bug de contabilidade no próprio huu: os contadores `tokens:` dos run-logs
  ficaram a zeros (in=0 out=0 cacheR=0 cacheW=0 em todos os agentes) — o
  run-logger não alimenta os contadores; o ledger só existe porque os
  transcripts jcode guardam `token_usage`. **Ação: corrigir o run-logger.**

## 4. Qualidade de código e UI — números e lacunas

- Estrutura: A — server/lib/public com store atómica (tmp+rename), fallback de
  porta, toggle de falha simulada. B — server/{index,api,store} + public/, sem
  testes em ambos; B duplica mais linhas e o `npm start` está partido (ver §1).
- **UI visual (captura à mesma vista 1280×800, `shots/appA-list.png` vs
  `shots/appB-list.png`)**: A vence de forma clara — identidade própria
  ("Pauta" + logo + taglinha), barra de estatísticas com dados reais
  (8 · 6 · 1 · 1), filtros integrados (pesquisa + segmentado de estado +
  prioridade), lista numerada com badges de prioridade, controlo de estado
  por linha e ações Editar/Apagar; sistema de cor quente coerente, hierarquia
  e densidade cuidadas. B é o visual "developer default": formulário primeiro
  (Título/Descrição/Estado/Prioridade + botão Criar), secção "Filtros e
  pesquisa" por baixo, acento azul genérico, selects por estilizar, lista e
  dados abaixo da dobra, sem estatísticas nem identidade. Funcional, mas sem
  desenho. Rubrica rápida (hierarquia · identidade · IA de informação · cor ·
  componentes · densidade · affordances): **A 7–0 B** numa vista.
  Reserva: uma vista só (lista/landing); estados de formulário/erro/vazio
  não capturados.
- **N=2 por lado: NÃO EXECUTADO** — números são de 1 run por lado; com a
  variância de run único da literatura (2,2–6,0pp) diferenças finas de UI/código
  não são significativas. Só os efeitos GIGANTES (5,3× tempo, 4,8× custo,
  npm-start partido vs funcional) são robustos.

## 5. Veredicto (com as ressalvas acima)

Para "uma app que corre local" com o mesmo modelo e o mesmo prompt:

- **DSH vence em tempo (5,3× mais rápido), custo (4,8× mais barato) E UI
  (7–0 na rubrica da vista principal)**, entrega um `npm start` que funciona e
  auto-verificou a UI com screenshots durante o próprio run.
- **huu DEV entrega o mesmo checklist funcional** e um processo muito mais
  auditável (épocas, revisões, juízes, merges, memória de decisões) — mas com
  overhead pesado, um artefacto de arranque partido, contabilidade de tokens
  a zeros nos run-logs, e terminou sem declarar o objetivo completo (por
  desenho: honestidade do teto de épocas).
- Leitura alinhada com o MANIFESTO do huu: o huu NÃO compete com um agente
  "rápido e barato" para features — o seu valor é o processo determinístico e
  auditável. Este benchmark mostra exatamente o preço desse processo
  (tempo ×6, custo ×5) para tarefas de criação — confirmando que o posicionamento
  certo do huu é audição/geração de testes/conhecimento, não build de apps.

## Follow-ups (prioridade)
1. Capturar as vistas restantes (formulário, vazio, erro) e refazer a rubrica
   completa às 7 dimensões com as duas vistas de cada lado.
2. N=2 por lado para variância real.
3. Corrigir o run-logger (contadores de tokens a zeros).
4. `npm start` do dev mode: garantir que a app entregue arranca sem shim externo
   (o commit da época 3 reivindicou isto; o package.json continua a referir o shim).
