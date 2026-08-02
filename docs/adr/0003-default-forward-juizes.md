# ADR 0003 — O `default: true` forward dos juízes permanece, com risco documentado e mitigação nomeada

**Data:** 2026-07-30
**Status:** aceito

## Contexto

Todo `CheckStep` de pipeline no `huu` declara outcomes com rotas enumeradas
(`approved` → próximo passo, `rework` → reexecuta), e **exatamente um**
outcome com `default: true`. Quando o juiz falha (modelo inalcançável,
veredito fora do enum, timeout), o outcome `default` dispara — e em todos
os pipelines atuais (7 auditorias, 1 test suite, dev mode) o default aponta
para **forward** (prossegue, não bloqueia).

O diagnóstico `METODO.md` §4.1 (item A2) registrou: **"nenhum teste no
repositório prova que um juiz pode dizer não."** Ou seja, a capacidade de
bloquear existe no código (o schema aceita `rework` como outcome), mas não
havia prova de que ela funciona.

O card `M2-04` ("Sonda negativa dos juízes") respondeu a isso com duas
camadas de teste: (a) `judge-conditions.test.ts` verifica que toda condição
de auditoria contém cláusula `$baseCommit..HEAD`, frase fail-closed, e
nenhuma cláusula `git status` inválida; (b) `report-contract.ts` +
fixtures quebradas provam que o avaliador de contrato **consegue** rejeitar.

A questão que este ADR resolve: confirmar que o `default: true` forward é
a decisão arquitetural correta **desde que** a mitigação `M2-04` exista e
passe — e que remover a mitigação sem substituí-la viola a decisão.

## Decisão

**D1.** O `default: true` forward em `CheckStep` permanece como política
padrão de todos os pipelines. A alternativa — `default: true` apontando
para `rework` ou um terminal de falha — foi descartada porque paralisaria
o pipeline em falhas transientes de modelo sem produzir diagnóstico
acionável.

**D2.** A mitigação `M2-04` (sonda negativa dos juízes) é parte integrante
desta decisão. Se os testes de `M2-04` forem removidos ou deixarem de
passar sem substituição equivalente, esta decisão perde sua ancoragem de
verificação e deve ser reavaliada.

**D3.** O risco de "juiz cego" (forward silencioso quando o juiz deveria
bloquear) é aceito como risco residual **documentado**, não como risco
desconhecido. A existência deste ADR e da guarda executável transforma
"ninguém sabia" em "alguém decidiu com os olhos abertos".

## Guarda executável

```bash
npx vitest run -t 'judge-conditions'
```

Esta guarda falha se os testes de sonda negativa dos juízes (`M2-04`)
deixarem de existir ou deixarem de passar. O parâmetro `-t` com o padrão
`judge-conditions` cobre tanto o teste de condições de auditoria quanto
o teste de contrato de relatório — ambos criados por `M2-04` e ambos
necessários para a mitigação.

## Supera

- `METODO.md` §4.1 (diagnóstico A2 — "nenhum teste prova que um juiz pode
  dizer não") — o diagnóstico que motivou `M2-04` é superado pela
  existência dos testes; este ADR torna a superação permanente.

## Reafirma explicitamente

- `METODO.md` §6 (`M2-04` — Sonda negativa dos juízes) — o card e seus
  critérios de aceitação permanecem como a mitigação canônica.
- Schema de `CheckStep` (`huu-pipeline-v2`) — outcome `default: true`
  obrigatório, rotas enumeradas, `maxRuns` como teto.
- `METODO.md` §4.1 integralmente — o diagnóstico permanece como registro
  histórico do que foi encontrado e corrigido.

## Consequências

**Positivas.**
- O pipeline não para em falha transiente de modelo (timeout de API, modelo
  sobrecarregado, veredito malformado) — o custo de uma rodada perdida é
  menor que o custo de um pipeline parado.
- O risco de "juiz cego" tem nome, dono (`M2-04`) e teste automatizado —
  não é mais uma lacuna de garantia, é um risco aceito com tripwire.

**Custos e desvios registrados.**
- Um juiz que deveria bloquear mas falha por razão não-antecipada (fora do
  escopo de `M2-04`) produz forward silencioso. A última linha de defesa é
  o run log humano: o veredito do juiz e o outcome disparado são registrados
  no `AgentManifestEntry`, visíveis no kanban e no log de execução.
- Se um novo pipeline for criado sem que suas condições de juiz passem pela
  sonda `M2-04`, ele herda o risco sem a mitigação. O card `M2-04` cobre
  apenas os 7 pipelines de auditoria + test suite — pipelines novos exigem
  cobertura adicional.

## O que este ADR NÃO decide

- Não avalia se `rework` ou `fail` deveriam ser o default para pipelines
  futuros de criticidade maior — cada pipeline decide seus outcomes.
- Não proíbe um `CheckStep` com `default: true` apontando para `rework` —
  apenas estabelece que forward é o padrão e que a mitigação `M2-04` é o
  que o torna seguro.
- Não cobre juízes do dev mode (`review` loop por card) — o dev mode tem
  sua própria política de convergência com forward-default em toda falha
  (`running-dev-mode` skill).

## Limites do que é verificável aqui

A guarda executável verifica que os testes de `M2-04` existem e passam.
Ela não verifica que **todo** pipeline novo passa por `M2-04` — isso exige
expansão do próprio `M2-04` ou um lint check (escopo de card futuro).
