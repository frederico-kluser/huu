# ADR 0002 — `src/lib/types.ts` como fonte única vs custo medido de singleton

**Data:** 2026-07-30
**Status:** aceito

## Contexto

A convenção arquitetural do `huu` exige que todo tipo novo vá em
`src/lib/types.ts` (skill `following-architecture-conventions`). O arquivo tem
1.274 linhas (medição de 2026-07-30). A tabela de singletons do `METODO.md` §3
documenta o custo: **24 toques** medidos e **todo card que introduz tipo novo
serializa** contra os outros.

A serialização viola o modelo de ondas paralelas que o `METODO.md` desenha:
numa onda de 6 cards independentes, basta que 2 criem tipos para que a onda
perca 2 dos 6 slots de paralelismo. O custo não é o arquivo em si — é o
**bloqueio de worktree** que ele impõe.

O card `M7-03` (`src/lib/types.ts` → barrel por domínio) resolve o problema
quebrando o singleton em `types/` por domínio com re-exports por `types.ts`.
Este ADR é o pré-requisito normativo que `M7-03` exige: a convenção que manda
tipo novo em `types.ts` é normativa, e mudá-la exige uma decisão arquitetural
documentada.

## Decisão

**D1.** `src/lib/types.ts` deixa de ser a fonte única de tipos. Os tipos serão
distribuídos em arquivos por domínio sob `src/lib/types/`, cada um com seus
próprios tipos, e `types.ts` passa a ser um barrel que apenas re-exporta.

**D2.** A execução fica a cargo do card `M7-03`. Até lá, a convenção atual
(tipo novo em `types.ts`) permanece em vigor — este ADR autoriza a mudança,
não a executa.

**D3.** Após `M7-03`, o tamanho de `types.ts` deve ser ≤ 200 linhas
(apenas re-exports e comentários de orientação). O limite de 200 linhas
acomoda um comentário de cabeçalho por domínio (~10 linhas cada) mais o
`export * from` correspondente, para os ~14 domínios atuais, com folga.

## Guarda executável

```bash
test "$(wc -l < src/lib/types.ts)" -le 200
```

Esta guarda falha se `types.ts` voltar a acumular definições de tipo depois
de `M7-03`. Antes de `M7-03`, a guarda falha por construção (1.274 > 200) —
isso é correto: a guarda mede o estado **pós-M7-03**. O card `M7-03` é o
pré-requisito que torna a guarda verde.

## Supera

- `src/lib/types.ts` — deixa de ser a fonte única de tipos e passa a ser
  barrel de re-exports.
- `METODO.md` §3 (tabela de singletons) — o item "types.ts é singleton por
  decisão, não por acidente" é substituído por "types.ts era singleton; a
  decisão foi revertida com guarda".

## Reafirma explicitamente

- `METODO.md` §3 (regra de enumerar singletons antes de dimensionar a onda)
  — a regra de diagnóstico permanece; `types.ts` apenas não é mais um
  singleton.
- Convenção de imports (`following-architecture-conventions`) — imports de
  tipos continuam apontando para `src/lib/types.js`; o barrel garante que
  nenhum import quebra.

## Consequências

**Positivas.**
- Cards que introduzem tipos em domínios diferentes não serializam mais —
  `types/pipeline.ts` e `types/ui.ts` podem ser editados em worktrees
  paralelas sem conflito.
- O custo de serialização (24 toques medidos) é eliminado para ondas futuras.

**Custos e desvios registrados.**
- Um novo tipo exige decidir em qual arquivo de domínio ele vai — a convenção
  "tudo em `types.ts`" era mais simples mecanicamente, embora mais cara em
  paralelismo.
- Se a disciplina de re-export falhar (alguém importar de
  `src/lib/types/pipeline.js` diretamente), o barrel perde a função de
  contrato único. A guarda executável detecta inchaço de `types.ts`, mas
  não detecta bypass do barrel.

## O que este ADR NÃO decide

- Não define o corte exato dos domínios (pipeline, ui, git, web, etc.) — isso
  é escopo de `M7-03`.
- Não proíbe imports diretos de `types/<dominio>.js` — mas também não os
  recomenda; o barrel permanece como o contrato público.
- Não altera a regra de que `types.ts` é o arquivo de tipos do módulo `lib` —
  ele continua sendo, apenas como barrel.

## Limites do que é verificável aqui

A guarda executável verifica o **tamanho** de `types.ts`. Ela não verifica
que todo tipo exportado por `types/<dominio>.ts` é re-exportado por
`types.ts`. Um teste complementar (escopo de `M7-03`) deve garantir que
`npm run typecheck` passa com imports apontando apenas para
`src/lib/types.js`.
