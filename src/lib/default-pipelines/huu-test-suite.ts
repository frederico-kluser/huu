// Default test pipeline shipped with huu. The same constant is used both by
// the first-run bootstrap (lib/pipeline-bootstrap.ts) — which materializes
// `pipelines/huu-test-suite.pipeline.json` in the user's repo — and by the
// checked-in copy at `pipelines/huu-test-suite.pipeline.json` (kept in sync
// manually; see scripts/sync-default-pipeline.ts if/when one is added).
//
// IMPORTANT: keep this file pure (no fs / no env). It is imported on the
// hot path of `App` mount, before any side effects.

import type { Pipeline } from '../types.js';

export const DEFAULT_PIPELINE_FILENAME = 'huu-test-suite.pipeline.json';
export const DEFAULT_PIPELINE_NAME = 'huu Test Suite';

const STEP1_PROMPT = `Voce eh o agente de bootstrap de testes do huu. Objetivo: deixar o projeto com infra de teste funcionando, escrever \`huu-tests.md\` na raiz com instrucoes operacionais, e inicializar \`huu-tests-faq.json\` como base de conhecimento incremental.

=== PASSO 1 — Detectar a stack ===
Inspecione a raiz e principais subpastas para identificar a linguagem e (se houver) o runner de teste ja configurado:
- Node.js / TypeScript / JavaScript: package.json, tsconfig.json, vitest.config.*, jest.config.*, *.test.*, *.spec.*.
- React/Vue/Svelte: package.json + framework deps, *.tsx/*.jsx.
- Python: pyproject.toml, setup.py, requirements*.txt, pytest.ini, conftest.py, test_*.py.
- Go: go.mod, *_test.go.
- Rust: Cargo.toml, #[cfg(test)] modules, tests/ folder.
- Ruby: Gemfile + rspec/minitest, *_spec.rb, test/test_*.rb.
- Java: pom.xml (Maven) ou build.gradle (Gradle), src/test/java/**.
- .NET: *.csproj + xunit/nunit/mstest.

Se o projeto for poliglota, escolha a stack MAJORITARIA por numero de arquivos fonte e mencione no huu-tests.md.

=== PASSO 2 — Garantir um runner funcional ===
Caso ja exista runner configurado: rode um teste minimo (cria um sample efemero se necessario) para confirmar que a infra responde. Se a config estiver quebrada, conserte ate o sample passar.

Caso NAO exista runner configurado: instale o padrao recomendado da stack detectada (NUNCA escolha um runner exotico):
- Node puro: Vitest (npm i -D vitest; scripts: "test": "vitest run").
- React (Vite/Next/CRA): Vitest + @testing-library/react + jsdom.
- Python: pytest (pip install pytest, ou pyproject [project.optional-dependencies]).
- Go: \`go test ./...\` (ja vem com a toolchain).
- Rust: \`cargo test\` (ja vem com cargo).
- Ruby: RSpec se o projeto ja indicar inclinacao, senao Minitest.
- Java + Maven: JUnit 5 (Jupiter) + Mockito + maven-surefire >= 3.
- Java + Gradle: JUnit 5 + Mockito (test { useJUnitPlatform() }).
- .NET: xUnit (dotnet add package xunit).

Adicione a config minima e descubra empiricamente os comandos exatos.

=== PASSO 3 — Escrever huu-tests.md NA RAIZ ===
Caminho: ./huu-tests.md
Conteudo OBRIGATORIO (em portugues, conciso, sem floreio):

# huu-tests.md

## Stack
- Linguagem: <detectada>
- Runner: <escolhido/detectado> (1 linha de justificativa)

## Como rodar todos os testes
\`\`\`bash
<comando exato>
\`\`\`

## Como rodar UM unico arquivo de teste
\`\`\`bash
<comando exato com placeholder de path>
\`\`\`
(CRITICO — as etapas seguintes da pipeline dependem disto.)

## Como rodar UM unico teste por nome (se suportado)
\`\`\`bash
<comando exato ou "nao suportado pelo runner">
\`\`\`

## Como escrever testes neste projeto
- Convencao de nome/path: <ex: foo.ts -> foo.test.ts ao lado; ou tests/test_modulo.py>
- Helpers/mocks usados no projeto: <listar imports comuns ou "nenhum">
- Setup files / fixtures: <ex: vitest.config.ts setupFiles, conftest.py>
- O que evitar: <ex: I/O real, internet, hora do sistema, estado global>

## Como medir cobertura
\`\`\`bash
<comando exato — ex: npx vitest run --coverage; pytest --cov; go test -cover; cargo tarpaulin; mvn jacoco:report>
\`\`\`

## FAQ acumulado
Veja \`huu-tests-faq.json\` — base de conhecimento incremental alimentada pelas proximas etapas da pipeline. Schema de cada item:
\`\`\`json
{ "summary": "string ate 256 chars", "knowledge": "string ate 5000 chars" }
\`\`\`

=== PASSO 4 — Inicializar huu-tests-faq.json NA RAIZ ===
Caminho: ./huu-tests-faq.json
Se NAO existe: crie com o conteudo exato \`[]\` (array vazio + newline final).
Se JA existe e eh um array JSON valido: NAO toque (preserve o conhecimento acumulado).
Se existe mas esta corrompido / nao eh array: substitua por \`[]\` e mencione no commit message.

=== REGRAS DUROS ===
- NAO escreva testes para arquivos do projeto nesta etapa — eh trabalho das etapas 2 e 3.
- NAO modifique fonte alem do necessario para a infra de teste subir.
- A unica nova saida desta etapa eh huu-tests.md + huu-tests-faq.json + config minima do runner.
- Garanta que o comando "rodar todos os testes" documentado em huu-tests.md sai com exit 0 (mesmo que seja so o sample).`;

const STEP2_PROMPT = `Voce esta na etapa 2 — escrever testes para 3 arquivos representativos do projeto. Objetivo: ao final, esses 3 arquivos tem testes verdes e o conhecimento adquirido foi destilado em \`huu-tests-faq.json\`.

=== PASSO 1 — OBRIGATORIO: leia huu-tests.md na raiz ANTES de qualquer outra coisa ===
Ele te diz:
- Qual runner usar.
- Comando exato de "rodar UM unico arquivo de teste".
- Convencao de path/nome de arquivos de teste.
- Helpers/mocks/setup do projeto.

Se huu-tests.md NAO existir: aborte com erro claro. A etapa 1 da pipeline eh pre-requisito.

=== PASSO 2 — Leia huu-tests-faq.json (pode estar vazio) ===
Eh um array de \`{ summary, knowledge }\`. Use o conteudo como contexto adicional.

=== PASSO 3 — Escolher 3 arquivos representativos ===
Heuristica de selecao (NAO escolha arquivos triviais):
- Prefira modulos com logica de negocio real (transformacoes, validacoes, calculos, parsers, handlers).
- Prefira arquivos com superficie publica clara (varias funcoes/metodos exportados).
- Cubra DIVERSIDADE: tente pegar 3 areas distintas (ex: 1 util puro, 1 com I/O abstraivel, 1 stateful/orquestrador).
- IGNORE: arquivos puramente declarativos (constantes, types), entry points (index/main), gerados (dist/, build/, *.generated.*), config (eslint/prettier/tsconfig), arquivos < 30 linhas uteis.

Liste os 3 escolhidos antes de comecar a escrever (deixa no log).

=== PASSO 4 — Para CADA um dos 3 arquivos ===
a) Identifique a superficie publica (exports, classes, funcoes, componentes).
b) Crie/atualize o arquivo de teste correspondente seguindo a convencao do huu-tests.md.
c) Escreva testes cobrindo:
   - Comportamento principal de cada export publico.
   - Pelo menos 1 edge case (vazio, null/undefined/None, limite).
   - Pelo menos 1 path de erro (excecao esperada).
d) MOCK dependencias externas (rede, fs, db, time). Testes precisam ser rapidos, isolados e deterministicos.
e) Rode o arquivo de teste usando o comando de single-file do huu-tests.md.

=== PASSO 5 — Recuperacao de erros + alimentar o FAQ ===
Para CADA falha encontrada:
1. Investigue o motivo. Categorize:
   - Bug real no codigo de producao -> CORRIJA o codigo (mudanca minima, sem refactor).
   - Teste mal escrito (assertion errada, mock fraco, expectativa incorreta) -> CORRIJA o teste.
   - Falta de infra/helper (ex: precisa de fake timer, de fixture) -> ADICIONE no arquivo de teste ou em um helper local; NUNCA mexa em huu-tests.md ou na config global sem necessidade absoluta.
2. Rode novamente. Repita ate verde OU ate 3 tentativas por teste (depois disso, deixe a funcao marcada com TODO claro — a etapa 4 vai deletar funcoes que continuarem falhando).
3. Se conseguiu resolver: faca APPEND em huu-tests-faq.json com um novo objeto:
   \`\`\`json
   { "summary": "<ate 256 chars: descreve o problema em 1 frase>", "knowledge": "<ate 5000 chars: contexto, sintoma, causa raiz, fix aplicado, padrao a reusar nos proximos testes>" }
   \`\`\`
   - Re-leia huu-tests-faq.json antes do append (preserve o array anterior).
   - NAO duplique entradas: se ja existe summary semanticamente equivalente, pule.

=== PASSO 6 — Validacao final ===
- Rode os 3 arquivos de teste (single-file cada). Idealmente todos verdes.
- huu-tests-faq.json continua sendo array JSON valido (\`jq . huu-tests-faq.json\` ou equivalente).
- NAO mexeu em huu-tests.md.
- NAO mexeu em arquivos fora dos 3 escolhidos + seus testes + (eventual) helper de teste compartilhado.`;

const STEP3_PROMPT = `Voce esta na etapa 3 — escrever testes para UM unico arquivo fonte: \`$file\`. Objetivo: \`$file\` termina com testes verdes E o aprendizado vai para \`huu-tests-faq.json\`.

=== PASSO 1 — OBRIGATORIO: leia ANTES de qualquer acao ===
a) \`huu-tests.md\` na raiz (runner, comandos, convencoes).
b) \`huu-tests-faq.json\` na raiz (array de \`{ summary, knowledge }\` — base de conhecimento acumulada nas etapas anteriores; use isso para nao repetir erros que outros agentes ja resolveram).

Se qualquer um dos dois nao existir: aborte com erro. As etapas 1 e 2 da pipeline sao pre-requisito.

=== PASSO 2 — Localizar / criar o arquivo de teste de $file ===
Siga a convencao documentada em huu-tests.md. Exemplos:
- foo.ts -> foo.test.ts ao lado.
- modulo.py -> tests/test_modulo.py.
- Foo.java -> src/test/java/<mesmo pacote>/FooTest.java.
- foo.go -> foo_test.go ao lado.

=== PASSO 3 — Caso A: $file JA tem testes ===
1. Rode-os com o comando de single-file do huu-tests.md.
2. Se TODOS passam: leia \`$file\` e ADICIONE testes para branches/edge-cases/paths-de-erro nao cobertos. Rode novamente — todos tem que continuar verdes.
3. Se ALGUM falha: vai para PASSO 5.

=== PASSO 4 — Caso B: $file NAO tem testes ===
1. Leia \`$file\` e identifique a superficie publica (exports, funcoes, classes, componentes).
2. Crie o arquivo de teste conforme convencao.
3. Cubra:
   - Comportamento principal de cada export publico.
   - Pelo menos 1 edge case por export publico (vazio, null/undefined/None, limite).
   - Paths de erro (excecoes esperadas).
4. MOCK dependencias externas (rede, fs, db, time, APIs). Testes unitarios — rapidos, isolados, deterministicos.
5. Rode com single-file do huu-tests.md.

=== PASSO 5 — Recuperacao de erros + APPEND no FAQ ===
Para cada falha:
1. Categorize:
   - Bug real em \`$file\` -> conserte \`$file\` (mudanca minima, sem refactor).
   - Teste errado -> conserte o teste.
   - Falta de helper/mock -> adicione no proprio arquivo de teste ou em helper local.
2. Re-rode. Ate 3 tentativas por teste; depois disso, deixe-o (etapa 4 limpa).
3. Se resolveu: APPEND em \`huu-tests-faq.json\`:
   - Re-leia o arquivo (outros agentes paralelos podem ter feito append).
   - Adicione \`{ "summary": "<=256>", "knowledge": "<=5000>" }\`.
   - NAO duplique: se ja existe summary semanticamente equivalente, pule.

=== REQUISITOS DUROS ===
- Comando de single-file aplicado ao teste de \`$file\` PRECISA sair com exit 0 (com excecao das funcoes que voce nao conseguiu corrigir em 3 tentativas — deixe falhando com TODO; a etapa 4 deleta).
- ZERO testes com .skip / xit / @Disabled / @pytest.mark.skip sem justificativa.
- NAO mexa em huu-tests.md.
- NAO mexa em config global (package.json scripts, pyproject.toml [tool.X], pom.xml, build.gradle) sem necessidade absoluta.
- As unicas mudancas permitidas alem do teste sao:
  a) \`$file\` (apenas se houver bug REAL exposto pelo teste).
  b) \`huu-tests-faq.json\` (append-only).
  c) helper de teste local pequeno (ao lado do arquivo de teste).

TODA esta pipeline eh sobre testes UNITARIOS. Nada de integracao, nada de e2e.`;

const STEP4_PROMPT = `Voce eh o agente final — etapa 4. Objetivo: deixar a suite de testes 100% verde DELETANDO apenas as funcoes/blocos de teste que continuam falhando, coletar cobertura e atualizar o badge no README.md.

=== PASSO 1 — Leia huu-tests.md na raiz ===
Pegue os comandos exatos de:
- Rodar TODOS os testes.
- Medir cobertura.

=== PASSO 2 — Rodar a suite completa e identificar falhas ===
Execute o comando de "rodar todos os testes" do huu-tests.md.
Capture a lista de testes FALHANDO no formato \`<arquivo de teste>::<nome do teste>\` (ou equivalente do runner). Se o output do runner nao for parseavel diretamente, re-rode com flag verbose / reporter detalhado.

=== PASSO 3 — Deletar APENAS as funcoes de teste que falham ===
REGRA SAGRADA: voce NUNCA deleta um arquivo de teste inteiro. Voce deleta apenas o BLOCO da funcao/teste que falhou.

Por linguagem/runner, o que constitui "um bloco":
- Vitest/Jest: chamada \`it('name', () => { ... })\` ou \`test('name', () => { ... })\` inteira. Se estiver dentro de um \`describe\` que ficar vazio, pode deixar o \`describe\` vazio mesmo OU removelo. NAO remova o arquivo.
- Mocha: idem (\`it(...)\` / \`describe(...)\`).
- pytest: a \`def test_<nome>(...)\` inteira (incluindo decoradores acima).
- Go: a \`func Test<Nome>(t *testing.T) { ... }\` inteira.
- Rust: a funcao \`#[test] fn <nome>() { ... }\` inteira.
- JUnit: o metodo \`@Test ... void <nome>() { ... }\` inteiro.
- RSpec: o bloco \`it "..." do ... end\` inteiro.
- xUnit/.NET: o metodo \`[Fact] / [Theory] public void <Nome>() { ... }\` inteiro.

Se um arquivo de teste ficar SEM nenhuma funcao de teste depois das remocoes:
- NAO delete o arquivo.
- Deixe um comentario no topo: \`// huu: todos os testes deste arquivo foram removidos pela etapa 4 da pipeline padrao. Reescreva-os antes de re-rodar.\` (use o estilo de comentario da linguagem).

=== PASSO 4 — Re-rodar e confirmar verde ===
Rode \`rodar todos os testes\` de novo. Precisa sair com exit 0 (ou equivalente do runner).
Se ainda houver falhas, repita PASSO 2-3 ate verde OU ate 3 iteracoes; se na 3a iteracao ainda houver falha, registre no log e prossiga (badge vai refletir a realidade).

=== PASSO 5 — Coletar cobertura ===
Use o comando documentado em huu-tests.md. Extraia a porcentagem de LINHAS cobertas (lines / line coverage) — eh a metrica padrao para o badge.
Se o runner reportar apenas statements/branches, use statements como fallback.
Arredonde para inteiro mais proximo. Se o comando de cobertura falhar, use cobertura = 0 e prossiga (nao bloqueie a pipeline).

=== PASSO 6 — Atualizar o badge no README.md ===
Caminho: ./README.md (raiz). Se nao existe, crie-o com \`# <nome do projeto detectado>\\n\\n\` como base.

Formato do badge:
\`![tests](https://img.shields.io/badge/tests-XX%25-<cor>)\`

Cor por threshold:
- \`<\` 50  -> red
- 50 a 79  -> yellow
- \`>=\` 80 -> brightgreen (use exatamente esta string — eh o nome canonico do shields.io)

Regra de insercao idempotente:
1. Se ja existir uma linha contendo \`img.shields.io/badge/tests-\` no README, SUBSTITUA-A pela nova (preserve indentacao). NAO duplique.
2. Senao, insira a linha logo apos o primeiro heading H1 (\`# Titulo\`), com uma linha em branco antes e outra depois.
3. Se nao houver H1, insira no topo absoluto do arquivo.

NAO mexa em outras partes do README. NAO toque em huu-tests.md, huu-tests-faq.json, ou em codigo de producao.

=== PASSO 7 — Verificacao final ===
- \`rodar todos os testes\` continua passando.
- README.md contem exatamente UMA linha com \`img.shields.io/badge/tests-\`.
- Nenhum arquivo de teste foi DELETADO (apenas blocos internos).
- huu-tests-faq.json continua sendo array JSON valido (nao deve ter sido tocado nesta etapa).`;

export function getDefaultPipeline(): Pipeline {
  return {
    name: DEFAULT_PIPELINE_NAME,
    _default: true,
    maxRetries: 1,
    steps: [
      {
        type: 'work',
        name: '1. Analisar stack e gerar huu-tests.md',
        prompt: STEP1_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'work',
        name: '2. Testar 3 arquivos representativos',
        prompt: STEP2_PROMPT,
        files: [],
        scope: 'project',
      },
      {
        type: 'work',
        name: '3. Testar $file (selecionado pelo usuario)',
        prompt: STEP3_PROMPT,
        files: [],
        scope: 'per-file',
      },
      {
        type: 'work',
        name: '4. Limpeza final + badge de cobertura',
        prompt: STEP4_PROMPT,
        files: [],
        scope: 'project',
      },
    ],
  } as Pipeline;
}

/**
 * Serialized wrapper format consumed by `pipeline-io.importPipeline`.
 * Kept here (not in pipeline-io) so the bootstrap doesn't pull the whole
 * io module — which transitively touches fs at module load time via the
 * `huu-home` import.
 */
export function getDefaultPipelineFileContent(): string {
  return (
    JSON.stringify(
      {
        _format: 'huu-pipeline-v2',
        exportedAt: new Date().toISOString(),
        pipeline: getDefaultPipeline(),
      },
      null,
      2,
    ) + '\n'
  );
}
