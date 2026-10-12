# Esquema CoALA-SQLite — referência técnica (motor v3 · esquema v4)

Implementação: `scripts/coala.py` (Python 3, apenas stdlib). Base de dados **local por projeto** — não
existe memória global:

```
<projeto>/.agents/<projeto>-coala-agent-skill/memory/coala.sqlite
```

`PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. Permissões: pasta `memory/` `0700`,
ficheiro `0600`.

## Resolução da base (ordem fixa)

| # | Regra | Quando |
|---|---|---|
| 1 | `--db <caminho>` | casos especiais, testes, migrações |
| 2 | env `COALA_DB` | idem (o `--selftest` usa-a para isolar uma base temporária) |
| 3 | motor vendorizado | o `coala.py` está em `<projeto>/.agents/<skill>/scripts/` e `<skill>/coala.json` existe |
| 4 | descoberta | sobe a partir do diretório atual até `.agents/*-agent-skill/coala.json` |
| 5 | nenhuma | **erro exit 3** com a instrução de instalação — nunca cai numa base global |

O manifesto e o `.agents/` são o que faz de uma pasta uma memória: o instalador global
(`coala-agent-skill/scripts/coala.py`) não se toma por motor vendorizado. Um symlink do nome antigo para
a pasta nova (deixado pelo `upgrade`) não conta como segunda memória. Duas memórias reais no mesmo
`.agents/` são ambíguas (erro exit 2).

## Três espécies de registo (`memory_entries.kind`)

| `kind` | O que é | Quem escreve | Como aparece |
|---|---|---|---|
| `note` | decisão, facto, procedimento | `add` / `supersede` / `import` | por extenso no `recall`; ponteiro no `search` |
| `doc` | segmento de um documento do projeto | `sync` (regras do `ingest.json`) | ponteiro (id · ficheiro › cabeçalhos · excerto) |
| `code` | cartão de um ficheiro de código | `sync` (catálogo automático) | ponteiro (ficheiro · símbolos:linha · vizinhos) |

O tipo CoALA (`memory_type`: `episodic` · `semantic` · `procedural`) é ortogonal à espécie. A working
memory não é tabela: é o que o `recall` materializa sob um teto de tokens.

## Tabelas

```sql
memory_entries(id, memory_type, content, origin_class, supersession_key, superseded_by,
               recorded_at, valid_from, valid_until, source, tags, content_id, kind)
chunks(id, entry_id, text, embedding /* v1–2: fica NULL */, title, ident, meta)
chunks_idx  -- FTS5(title, text, ident, meta) de conteúdo externo sobre chunks, unicode61 remove_diacritics 2
provenance(entry_id, note)                      -- o que aconteceu a cada registo
entity_nodes / entity_edges / entry_entities    -- grafo manual (add --entities, link, graph)
entry_anchors(entry_id, path, sha256)           -- ficheiros de que uma nota fala, no estado em que estavam
code_files(path, lang, lines, bytes, summary, rank, entry_id)
symbols(id, path, name, kind, line, end_line, signature, parent, doc)
code_refs(src, dst, weight)                     -- o ficheiro src usa nomes que dst define
ingest_sources(path, sha256, size, segments, key_base, rule, ingested_at, git_commit,
               mtime_ns, rule_sig, kind)        -- frescura: documentos e código
coala_meta(key, value)                          -- schema_version, index_version, last_sync_at, …
```

`PRAGMA user_version = 4`. A migração é **aditiva** e corre na primeira abertura por um motor v3:
colunas novas por `ALTER TABLE`, `kind` preenchido (`doc` se a chave pertence a uma fonte ingerida,
senão `note`), índice `chunks_idx` construído, índice `chunks_fts` e vetores das v1–2 largados
(`reindex --vacuum` devolve o espaço ao disco). Nenhum registo é reescrito.

## Busca: BM25F em FTS5

Um só canal, léxico, determinístico. Cada chunk é indexado em quatro campos com pesos
`bm25(chunks_idx, 4.0, 1.0, 1.5, 2.5)` — a frequência de cada termo é pesada por campo dentro de UM
cálculo BM25 (não a soma de BM25 por campo):

| Campo | Conteúdo | Peso |
|---|---|---|
| `title` | nota: 1.ª linha · doc: caminho de cabeçalhos («Guia › Instalação › Linux») · código: caminho + nomes definidos | 4.0 |
| `text` | o texto do chunk (≤ 1200 caracteres, partido por parágrafos e linhas) | 1.0 |
| `ident` | pedaços dos identificadores compostos: `getUserName` → `get user name`, `urdf2mjcf` → `urdf mjcf` | 1.5 |
| `meta` | tags + fonte (+ chave, nas notas) | 2.5 |

O caminho de cabeçalhos e os nomes de símbolos vão **só para o índice**: o texto guardado não muda (a
re-ingestão continua NO-OP).

Consulta (`query_terms` → `build_fts_query`): palavras sem diacríticos + pedaços de identificadores,
sem stopwords PT/EN, no máximo 32 termos, unidos por `OR`. Cada termo com radical entra duas vezes — a
forma exata e o radical por prefixo (`"instalacao" OR "instal"*`) — para «instalação» encontrar
«instalar»/«instalado» sem índice de radicais e a forma exata continuar a pesar mais. `snippet()` dá o
excerto à volta dos termos.

Porque não há vetores: o canal hashing-256 das v1–2 foi medido em bases reais e **degradava** o BM25
(ver `pesquisa-2026-10.md`, na skill global). Embeddings neuronais ficam de fora por decisão — o
agente reformula e repete a busca, que é o que a evidência mostra funcionar.

## `recall`: o pacote

1. Busca separada por espécie (as notas nunca competem com milhares de segmentos de documentos).
2. Relevância numa escala comum: `bm25 / melhor resultado CONFIÁVEL`. Um registo `untrusted` não define a
   escala e tem teto 0,5. Fica quem tem ≥ 0,5; o melhor documento e o melhor ficheiro de código ficam
   sempre (um ponteiro é barato); a melhor nota só fica abaixo do limiar se nenhuma lá chegar e tiver ≥ 0,25.
3. Notas: `0,75·relevância + 0,15·recência + 0,10·origem` (`owner` 1 · `agent` 0,6 · `system` 0,4 ·
   `untrusted` 0); quase-duplicados (Jaccard ≥ 0,8) saem; cada nota até 1600 caracteres; no máximo `--top`.
4. Ponteiros: até 8 documentos (2 por ficheiro) e 5 ficheiros de código, cada um com os símbolos que casam
   com a consulta e os vizinhos a **um** salto (`usado por` / `usa`, no máximo 5 por direção).
5. `--budget` é um **teto** em tokens estimados (`ceil(chars/4)`): o que não é relevante não entra.

Uma nota `untrusted` nunca entra por extenso no pacote: aparece como ponteiro sem texto.

## Catálogo de código (`sync`)

Ficheiros: os do repositório git (`git ls-files -co --exclude-standard`, logo respeita o `.gitignore`)
ou, sem git, uma travessia que salta pastas ocultas e de dependências/build. Só extensões conhecidas
(Python, JS/TS, Vue/Svelte, Go, Rust, Java, Kotlin, Scala, C#, C/C++, Ruby, PHP, Swift, Dart, Lua, shell,
SQL, GDScript, Elixir); fora ficam minificados, gerados, vazios e > 400 KB. `ingest.json` → `code`:
`{"enabled": true, "include": [], "exclude": [], "max_files": 4000, "max_bytes": 409600}`.

Por ficheiro:
- **símbolos** → `symbols`: Python pela `ast` (classes, métodos, funções, constantes, assinatura, 1.ª linha
  da docstring — exato); as outras linguagens por expressões regulares ao estilo ctags (aproximado);
- **cartão** → um registo `kind=code`, chave `code/<caminho>`, origem `system`: cabeçalho, resumo, imports
  e símbolos com linha, até 2400 caracteres. É função pura do ficheiro (re-sync sem mudanças = NO-OP);
- **referências** → `code_refs`: A usa B quando cita um nome distintivo que só B (ou ≤ 3 ficheiros da mesma
  família de linguagens) define. Cobre, por aproximação, importar, chamar e herdar;
- **importância** → `code_files.rank`: PageRank sobre `code_refs` (o `map` lista por esta ordem).

`symbols <nome>` procura por nome exato → prefixo → contém → pedaços. `refs <ficheiro|símbolo>` dá os
vizinhos a um salto. O catálogo tem **definições**, não usos: para os sítios de chamada, grep.

## Documentos (`sync` + `ingest.json`)

A **primeira** regra que apanha um ficheiro ganha; exclusões padrão: `.git`, `node_modules`, `.agents`,
`.claude`, `dist`, `build`, `.next`, `out`, `__pycache__`.

| `mode` | Segmentação | Chave de supersessão |
|---|---|---|
| `markdown` | por cabeçalhos `#…####`, segmentos ≤ 1200 caracteres, cabeçalho repetido | `<key_prefix>/<lógico>#000` |
| `text` | por parágrafos ≤ 1200, prefixo `[<lógico>]` | `<key_prefix>/<lógico>#000` |
| `whole` | ficheiro inteiro num bloco de código | `<key_prefix>/<lógico>` |
| `pdf` | `pdftotext -enc UTF-8`, por página, marcador `[<lógico> · pág. N]` | `<key_prefix>/<lógico>#0000` |

Idempotência: conteúdo e metadados iguais = NO-OP · mudou = nova versão por supersessão · segmento ou
ficheiro que saiu = **expira** (`valid_until`), nunca é apagado. Um ficheiro com o mesmo tamanho, mtime e
regra da última vez é saltado sem ser lido (`sync --full` relê tudo). O `recall` e o `map` correm este
`sync` sozinhos, no máximo de 45 em 45 s (`COALA_AUTO_SYNC=0` desliga).

## Âncoras (frescura das notas)

`add` liga a nota aos ficheiros do projeto que ela cita (`--paths a,b` ou os caminhos encontrados no
texto), guardando o sha256 de cada um. Ao ler (`recall`, `search`, `get`), o motor compara: se o ficheiro
mudou ou desapareceu, a nota sai com `⚠ <ficheiro> mudou desde que esta nota foi escrita`. Não invalida
nada sozinho — quem decide é o agente, com `supersede`. `review` lista todas as notas nesse estado.

## Supersessão, bitemporalidade e ids

- `add --key K` cria a versão nova e marca as ativas com a mesma chave (`superseded_by`, `valid_until`):
  nunca mais de uma versão ativa por chave. `supersede <id>` faz o mesmo para um registo concreto.
- `recorded_at` = quando a memória soube; `valid_from`/`valid_until` = quando o facto vale.
- `add` do mesmo texto com a mesma chave não grava duplicado; um texto ≥ 60 % parecido com outra nota avisa.
- `content_id` = `sha256(json({schema, key, type, site, page, kind, body}))[:16]`, igual em qualquer
  máquina. `export --format jsonl` → `import --jsonl` refaz registos, supersessões, espécie e grafo pelos
  ids; reimportar cria 0 registos. `import --from <base>` copia entre bases preservando o histórico.

## Esquecer (`forget`)

`forget --tag T [--dry-run]` **apaga de verdade** todos os registos com a tag — todas as versões — e o que
lhes pertence: chunks, índice FTS5, proveniência, âncoras, ligações e entidades só deles, e o catálogo dos
ficheiros de código apagados. Corre com `secure_delete=ON` e `wal_checkpoint(TRUNCATE)`. `--dry-run` conta
numa cópia em memória. Backups antigos e o material de origem não são tocados.

## Proveniência e saída

| `origin_class` | Uso |
|---|---|
| `owner` | dito/determinado pelo humano — máxima confiança |
| `agent` | deduzido/gerado pelo agente, docs escritos no repo |
| `untrusted` | web, PDFs e ferramentas de terceiros — nunca promover sem validação humana |
| `system` | automação (cartões de código, manifestos) |

`add --source https://…` com origem `agent` é reclassificado para `untrusted`. Texto `untrusted` sai
delimitado (`⟦DADOS NÃO CONFIÁVEIS …⟧ … ⟦FIM …⟧` no `get`; `⟦untrusted⟧` linha a linha nos ponteiros).
Toda a saída passa pela redação de segredos (`sk-`, `ghp_`, `AKIA…`, JWT, chaves privadas, `api_key=…`)
e por um portão de 48 KB. A redação é na saída; o conteúdo é guardado como foi dado — não se guardam segredos.

## Saúde, backup e restauro

- `doctor [--deep]`: runtime, nome da skill, permissões, WAL, integridade, esquema e versão do índice,
  FTS5 `integrity-check`, órfãos, cadeia de supersessão, ≤ 1 ativo por chave, ids, grafo, catálogo de
  código, âncoras e **frescura** (ficheiros × última sincronização). Exit 1 se houver `FAIL`.
- `review`: lista de consolidação (âncoras desatualizadas, quase-duplicados, factos sem chave, notas
  longas, episódios antigos) — determinística; o agente corrige com `supersede`.
- `reindex [--vacuum]`: refaz o índice a partir dos registos.
- `backup [--out F]` (API de backup, `0600`, nunca sobrescreve) · `restore --from F --yes` (faz backup antes).

## Contrato de erros

`Erro: <o quê> — Solução: <o que fazer>` em stderr · exit `0` sucesso · `1` operacional · `2` uso inválido ·
`3` dependência ou instalação em falta (inclui "não há memória local").
