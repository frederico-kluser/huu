# Scope memory — fan-out de arquivos decidido pelo próprio pipeline

> Uma etapa **descobre** o trabalho e escreve num arquivo de memória; uma
> etapa posterior **fan-outa** um agente por path descoberto. Zero seleção
> humana de arquivos.
>
> English: [memory-scope.md](memory-scope.md) · Referência do schema:
> [pipeline-json-guide.md](pipeline-json-guide.md) (seção `"memory"`)

Os steps do huu tinham duas formas de receber arquivos: o projeto inteiro
(`scope: "project"`, `files: []`) ou uma lista escolhida pelo humano
(`scope: "per-file"`). O scope `memory` adiciona a terceira e mais poderosa:
**uma etapa anterior escreve um JSON `huu-memory-v1` com relative paths, e a
etapa consumidora fan-outa sobre eles em tempo de execução** — o pipeline
decide o próprio trabalho.

## Você NÃO precisa saber o formato — declare o elo (`produces`)

O jeito recomendado de amarrar um par de memória é **declarativo**: a etapa
produtora define `"produces": "<path>"` e a consumidora aponta `filesFrom`
para o mesmo path. Em runtime o huu **appenda o MEMORY CONTRACT ao prompt da
produtora** — o path exato, o formato JSON, o cap que a consumidora vai
impor e a regra do hint. Você nunca cola boilerplate de formato num prompt,
e o JSON salvo fica limpo:

```json
{ "name": "1. Scan", "prompt": "Encontre arquivos com risco; explique cada escolha em 1 linha (vira o hint).", "files": [], "scope": "project", "produces": ".huu/scan-list.json" },
{ "name": "2. Corrigir $file", "prompt": "Corrija o problema em $file. Nota do scanner: $hint", "files": [], "scope": "memory", "filesFrom": ".huu/scan-list.json" }
```

Na TUI você nem digita o path: numa etapa memory, o campo Files abre um
**link picker** listando todos os `produces` declarados por etapas
anteriores — ou deixa você escolher uma etapa anterior e o huu amarra OS
DOIS lados (path auto-nomeado) num gesto só. Duas etapas produzindo o mesmo
path são rejeitadas no load.

## Os dois lados do contrato (o modo manual continua valendo)

`produces` é opcional — um prompt produtor também pode escrever o arquivo na
mão. O contrato tem duas metades, ligadas apenas pelo path do arquivo:

| Lado | Onde se configura | O que você faz |
|---|---|---|
| **Produtora** (qualquer etapa anterior) | `produces: "<path>"` (recomendado — contrato auto-appendado) OU instruções no **prompt** | Promete/escreve o arquivo de memória num path combinado |
| **Consumidora** | Nos **campos do step** | `scope: "memory"` + `filesFrom: "<mesmo path>"` (+ `maxFiles` opcional) |

O huu nunca valida que "alguém prometeu escrever o arquivo" — ele valida na
execução: quando o cursor chega na consumidora, lê o arquivo do **worktree de
integração** (o estado mergeado de tudo que rodou antes) e abre um agente por
path listado.

## O formato do arquivo de memória (`huu-memory-v1`)

```json
{
  "_format": "huu-memory-v1",
  "files": [
    { "path": "src/lib/types.ts", "hint": "extraia o contrato dos steps daqui", "priority": 10 },
    "src/cli.tsx"
  ]
}
```

- Uma entrada é uma string simples (só o path) ou um objeto:
  - `path` — relativo à raiz do repo. Paths absolutos e `..` são rejeitados.
  - `hint` (opcional, ≤600 chars) — contexto por arquivo vindo do produtor.
    Chega ao prompt do consumidor pelo token **`$hint`**.
  - `priority` (número opcional) — ordem de execução: priority decrescente,
    depois ordem da lista.

## A etapa consumidora

```json
{
  "name": "2. Corrigir $file",
  "prompt": "Corrija o problema em $file. Nota do scanner sobre este arquivo: $hint",
  "files": [],
  "scope": "memory",
  "filesFrom": ".huu/scan-list.json",
  "maxFiles": 20
}
```

- `files` fica `[]` — o editor trava isso ao escolher o scope memory.
- `$file` é o path da vez; `$hint` é o hint daquela entrada (string vazia
  quando ausente). `$hint` é substituído antes de `$file`.
- `maxFiles` (default **40**) trava a largura do fan-out: o excedente é
  cortado pela ordem de prioridade, com warning explícito. Avise o cap no
  prompt do produtor para ele não listar demais.
- Uma etapa memory **nunca pode ser a primeira do pipeline** — nada rodou
  ainda para escrever o arquivo. O schema rejeita no load.

## Semântica de execução

1. A produtora roda, commita, e sua stage faz merge no worktree de
   integração — o arquivo de memória agora existe no estado mergeado.
2. Quando o cursor chega na etapa memory, o huu lê `filesFrom` do worktree
   de integração, valida cada entrada e decompõe em uma task por path
   sobrevivente.
3. O pool roda os agentes em paralelo (auto-escalado), cada um no seu git
   worktree, cada um com seu `$file`/`$hint` substituído.
4. **Loops de check releem o arquivo a cada visita** — se um judge devolver
   o pipeline e alguma etapa reescrever o arquivo de memória, a próxima
   visita fan-outa sobre a versão nova. É a espinha dorsal de loops
   descobrir → trabalhar → redescobrir.

## Regras de falha (determinísticas por design)

| Situação | Comportamento |
|---|---|
| Arquivo de memória **ausente** | A etapa resolve para **zero tasks**: a stage completa vazia com warning alto e o run continua. Ausência pode ser legítima (o scanner não achou nada; runs com stub não escrevem arquivos). |
| Arquivo existe mas está **corrompido** (JSON inválido, `_format` errado, violação de schema, ou zero paths utilizáveis numa lista não-vazia) | O **run falha na hora**. Corrupção nunca é legítima. |
| Entrada escapa do repo (`..`, absoluto), duplica outra, não existe no worktree, ou casa a skip-list de gerados/vendored (`node_modules/`, `dist/`, …) | Descartada individualmente, cada uma com seu warning. |
| Mais entradas utilizáveis que `maxFiles` | Truncado (priority desc, depois ordem da lista) com warning. |
| `config.files["<nome do step>"]` definido num run headless | O override **vence** e o arquivo de memória não é lido (logado) — o escape hatch. |

## Como configurar em cada interface

- **TUI** (`huu`): edite o step → campo **Scope** → tecla **M** (ou ENTER
  para ciclar) → desça para **Files** → ENTER abre um campo de texto para o
  path do `filesFrom`. O editor não salva etapa memory sem ele.
- **JSON**: os campos acima; schema completo no
  [pipeline-json-guide.md](pipeline-json-guide.md).
- **Pipeline Assistant**: peça um fluxo descobrir-e-agir ("escaneie o repo e
  corrija cada arquivo que encontrar") e ele monta o par produtor/consumidor.
- **Headless** (`huu auto`): nada extra — o arquivo de memória é lido em
  runtime. `config.files` sobrescreve por step se você precisar forçar uma
  lista.

## Pipeline mínima completa

```json
{
  "_format": "huu-pipeline-v2",
  "pipeline": {
    "name": "scan-and-fix",
    "steps": [
      {
        "name": "1. Scan",
        "prompt": "Encontre arquivos com console.log esquecido. Escreva .huu/scan-list.json EXATAMENTE como huu-memory-v1: { \"_format\": \"huu-memory-v1\", \"files\": [ { \"path\": \"<relative path>\", \"hint\": \"<1 linha: onde está o problema>\" } ] }. Liste no máximo 20 arquivos; toda entrada DEVE ter hint.",
        "files": [],
        "scope": "project"
      },
      {
        "name": "2. Corrigir $file",
        "prompt": "Remova os console.log esquecidos de $file. Nota do scanner: $hint",
        "files": [],
        "scope": "memory",
        "filesFrom": ".huu/scan-list.json",
        "maxFiles": 20
      }
    ]
  }
}
```

## Nota de orçamento

`maxNodeExecutions` (default 50) conta **visitas do cursor aos steps, não
agentes** — um fan-out memory de 25 arquivos custa **uma** visita. Encadeie
quantos pares produtor→memory o método pedir; o limite real é custo de LLM e
largura do pool, travada pelo `maxFiles`.

## Padrões

- **scan → fix** — um auditor lista os arquivos problemáticos com a ofensa
  no `hint`.
- **recon → estudo** — a `huu Knowledge System` (default instalada) faz
  exatamente isso: o recon escreve `study-list.json` com uma pista por
  arquivo, o estudo fan-outa sobre ela, e depois os dossiês fan-outam de
  novo num agente escritor-de-skill por tópico. Leia o fonte como
  implementação de referência:
  `src/lib/default-pipelines/huu-knowledge-system.ts`.
- **rank → refactor** — um ranking de hotspots lista o top-N com o smell no
  `hint`; o refactor trabalha cada um em paralelo.

## Troubleshooting

- *Stage completou com 0 tasks* — o arquivo de memória não estava no
  worktree de integração no path exato do `filesFrom`. Confira o prompt do
  produtor (typo no path?) e se a stage dele realmente commitou o arquivo.
- *Run falhou com `memory file ... is not valid JSON / does not match
  huu-memory-v1`* — o produtor escreveu um arquivo malformado; endureça o
  prompt dele (cole o formato exato, como no exemplo acima).
- *Menos agentes que entradas listadas* — leia os warnings do log do run:
  paths descartados (inexistentes / skip-list / duplicados / escapando) e o
  truncamento do `maxFiles` são logados um a um.
