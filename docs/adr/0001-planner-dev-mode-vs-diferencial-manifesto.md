# ADR 0001 — O planner em runtime do dev mode permanece como exceção legítima ao diferencial nº 2 do MANIFESTO

**Data:** 2026-07-30
**Status:** aceito

## Contexto

O `MANIFESTO.md` (diferencial nº 2) estabelece "Zero planner LLM em runtime"
como identidade do `huu` — o grafo de tarefas é o JSON que o humano escreve,
não algo que um modelo decide executar. O modo de desenvolvimento (`huu dev`,
`src/lib/dev-mode/`) introduz um planner LLM que decompõe uma meta humana em
fronts paralelos. Esta é a **única** ocorrência de planner em runtime em todo
o sistema.

O MANIFESTO já reconhece esta exceção desde o card `M0-01`
(MANIFESTO.md:145-149), com três ancoragens que limitam o planner por
construção:

- O humano subscreve a **META** (`goal.md`, imutável, nunca reescrito pelo
  planner).
- O humano subscreve o **MÉTODO** (formato de épocas, fixo — global recon →
  fronts paralelos → consolidação → gate → seal).
- O planner apenas **DECOMPÕE**, nunca inventa escopo. O `DevPlan` é validado
  contra schema e topologia antes de virar pipeline.

A questão que este ADR resolve: confirmar que a exceção **persiste**, que a
nota no MANIFESTO é o registro normativo dela, e que removê-la sem um ADR
sucessor viola a decisão.

## Decisão

**D1.** O planner LLM do modo de desenvolvimento (`src/lib/dev-mode/planner.ts`)
permanece como exceção legítima ao diferencial nº 2 do MANIFESTO.

**D2.** A nota de exceção em `MANIFESTO.md:145-149` é o registro normativo
desta decisão. Removê-la ou enfraquecê-la sem um ADR que a supere explicitamente
constitui violação.

**D3.** As três ancoragens (meta imutável, método fixo, decomposição sem
invenção de escopo) são parte integrante da exceção — removê-las sem substituí-las
por uma ancoragem equivalente desfigura a exceção e exige novo ADR.

## Guarda executável

```bash
rg -q 'Exceção.*huu dev' MANIFESTO.md
```

Esta guarda falha se a nota de exceção for removida do MANIFESTO.
O regex ancora na palavra exata "Exceção" (com inicial maiúscula e
cedilha, como escrita no MANIFESTO:145) conectada a `huu dev` — o
nome do modo cuja exceção está sendo registrada. É específico o
suficiente para detectar remoção e flexível o bastante para
sobreviver a pequenas revisões de redação entre as duas âncoras.

## Supera

- `MANIFESTO.md` §2 ("Zero planner LLM em runtime"), no que este ADR qualifica
  como "regra geral com uma exceção documentada".

## Reafirma explicitamente

- `MANIFESTO.md` §2 integralmente — a regra geral permanece; o dev mode é a
  exceção, não a nova regra.
- `METODO.md` §0.4 (regra de precedência) — o MANIFESTO vence em identidade;
  esta decisão não altera a hierarquia de documentos.

## Consequências

**Positivas.**
- A identidade do `huu` não se dissolve: "zero planner LLM" continua verdadeiro
  para todo pipeline que não seja `huu dev`.
- O dev mode pode evoluir sem que cada mudança no planner desencadeie uma crise
  de identidade.

**Custos e desvios registrados.**
- Toda defesa do MANIFESTO passa a carregar a cláusula "exceto dev mode".
- Se um segundo modo de runtime com planner surgir, este ADR não cobre — exige
  novo ADR.

## O que este ADR NÃO decide

- Não avalia se o planner atual (`planner.ts`) é o melhor algoritmo de
  decomposição — apenas que a categoria "planner LLM como exceção" é aceita.
- Não autoriza planner em runtime em nenhum outro caminho de código.
- Não congela a implementação do dev mode — as três ancoragens podem ser
  reforçadas, mas não removidas, sem novo ADR.

## Limites do que é verificável aqui

A guarda executável verifica a **presença textual** da exceção no MANIFESTO.
Ela não verifica que o planner de fato respeita as três ancoragens — isso é
coberto por testes (schema validation, `plan-to-pipeline.ts` topology check) e
pelo prompt do planner (`goal.md` imutável, método fixo).
