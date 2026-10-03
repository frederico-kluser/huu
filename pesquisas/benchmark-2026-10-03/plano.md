# Benchmark A/B — DSH vs modo DEV do huu (2026-10-03)

**O que se compara:** duas ferramentas de agentes (DSH headless · `huu dev`),
**o mesmo modelo** (`xiaomi/mimo-v2.6-pro` via OpenRouter), **o mesmo prompt**
(`prompt.md`), **a mesma máquina** (Acer Predator PHN16-72), apps a correr
local. A variável é o HARNESS — e ele é confound documentado (11–15 pp de
variação só de scaffold; execução única varia 2,2–6,0 pp): por isso o
protocolo declara tudo, corre N execuções por lado e reporta variância.
Fonte metodológica: `pesquisas/2026-10-03-benchmark-dsh-vs-devmode.md`.

## Declaração de confounds (obrigatória no relatório)

| Variável | Fixado como |
|---|---|
| Modelo | `xiaomi/mimo-v2.6-pro` (openrouter) nos DOIS lados · reasoning effort igual nos dois |
| Prompt | `prompt.md`, byte-idêntico nos dois lados |
| Máquina | Acer PHN16-72, mesma sessão, sem carga paralela pesada durante os runs |
| Ferramentas | as de cada harness (declaradas — é a variável sob teste) |
| Execuções | N=2 por lado (piloto; a variância de execução única é 2,2–6,0 pp) |
| Limite de passos/custo | sem teto artificial; wall-time e custo registados por run |

## Custo (contabilidade OTel — dossiê 2 §Q3)

Somar por run TODAS as chamadas LLM em 4 categorias: **input novo · cache-read
· cache-write · output** (contagem FATURADA; `input` sozinho não é total).
USD primeiro do custo reportado pelo provedor (OpenRouter `/generations` →
`total_cost`; reconciliar com `/activity`), tabela versionada em fallback.
**Cache-read nunca a preço cheio** (erro ~5×; são ~90% dos prompt tokens
agênticos). Retentativas contam nos tokens/tempo.

| Lado | Tokens (in/cr/cw/out) | USD (provider-reported) | Wall-time | Tentativas |
|---|---|---|---|---|
| DSH run 1 | | | | |
| DSH run 2 | | | | |
| huu dev run 1 | | | | |
| huu dev run 2 | | | | |

Fontes: lado huu = `run-logger` (`tokensIn/Out/cacheRead/cacheWrite`) + linhas
`[tokens] … [cost:<N>]` do jcode; lado DSH = logs de sessão do DSH +
OpenRouter usage (lacuna prática do dossiê §8.7 a fechar com os logs locais).

## Qualidade — UI (dossiê 2 §Q1)

Screenshots das DOIS apps nos MESMOS viewports (1280×800; lista com dados,
formulário, estado vazio, estado de erro), ordem A/B cega e aleatória.
Escala 0–4 ancorada por 7 dimensões: hierarquia visual · consistência ·
tipografia · espaçamento/composição · responsividade/estados · acessibilidade
· acabamento. Score absoluto por dimensão **e** pareamento A-vs-B reportados
em separado (um vencedor relativo pode ser medíocre em absoluto). Juiz LLM
só como triagem, reportado em κ.

## Qualidade — código (dossiê 2 §Q2)

Rubrica tool-verifiable, MESMA toolchain nos dois lados: lint/typecheck/build
sem erros · testes automatizados (escritos pelos harnesses; corridos) ·
delta de análise estática antes/depois · duplicação · organização/arquitetura
(regras de dependência). Mutation score acima de cobertura quando exequível.

## Execução local (o "app corre")

Checklist por app: arranca com UM comando · API responde (GET/POST/PATCH/DELETE)
· fluxo criar→editar→estado→apagar sem recarregar · persistência entre
reinícios · estado de erro simulado visível. Cada item passa/falha, com prova.

## Orçamento e honestidade

Piloto com N=2: diferenças < 6 pp são ruído de amostragem e DEVEM ser lidas
como empate; o relatório declara execuções, não médias escondidas.
