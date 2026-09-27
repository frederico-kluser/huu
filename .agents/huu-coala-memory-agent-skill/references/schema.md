# Esquema CoALA-SQLite — referência técnica (v2)

Implementação: `scripts/coala.py` (Python 3, apenas stdlib; motor v2.0.0, esquema v2).
Base de dados **local por projeto** — não existe memória global:

```
<projeto>/.agents/<projeto>-coala-memory-agent-skill/memory/coala.sqlite
```

`PRAGMA journal_mode=WAL`, `foreign_keys=ON`, `busy_timeout=5000`. Permissões: pasta `memory/`
`0700`, ficheiro `0600` (o SQLite cria `-wal`/`-shm` com o mesmo modo do ficheiro principal).

## Resolução da base (ordem fixa)

| # | Regra | Quando |
|---|---|---|
| 1 | `--db <caminho>` | casos especiais, testes, migrações |
| 2 | env `COALA_DB` | idem (o `--selftest` usa-a para isolar uma base temporária) |
| 3 | motor vendorizado | o `coala.py` está em `<x>-coala-memory-agent-skill/scripts/` → usa `<x>…/memory/coala.sqlite` |
| 4 | descoberta | sobe a partir do diretório atual até `.agents/*-coala-memory-agent-skill/coala.json` |
| 5 | nenhuma | **erro exit 3** com a instrução de instalação — nunca cai numa base global |

Duas memórias no mesmo `.agents/` são ambíguas (erro exit 2): um projeto = uma memória.

## DDL (idempotente e só aditivo — `init`/qualquer comando pode correr N vezes)

```sql
-- Memória episódica + semântica + procedimental num registo unificado
CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('episodic','semantic','procedural')),
  content TEXT NOT NULL,                -- texto do conhecimento
  origin_class TEXT NOT NULL DEFAULT 'agent'
    CHECK (origin_class IN ('owner','agent','untrusted','system')),
  supersession_key TEXT,                -- mesma chave = nova versão suplanta a antiga
  superseded_by INTEGER REFERENCES memory_entries(id),
  recorded_at TEXT NOT NULL,            -- quando gravou (bitemporal: system time)
  valid_from TEXT,                      -- quando o facto passou a valer (bitemporal: valid time)
  valid_until TEXT,                     -- NULL = ainda válido
  source TEXT,                          -- URL/caminho/conversa de origem
  tags TEXT                             -- CSV de tags
);
CREATE TABLE IF NOT EXISTS entity_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, kind TEXT
);
CREATE TABLE IF NOT EXISTS entity_edges (
  src INTEGER REFERENCES entity_nodes(id),
  dst INTEGER REFERENCES entity_nodes(id),
  rel TEXT NOT NULL,
  UNIQUE(src,rel,dst)
);
CREATE TABLE IF NOT EXISTS chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER REFERENCES memory_entries(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  embedding BLOB
);
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(text, content='chunks', content_rowid='id');
CREATE TABLE IF NOT EXISTS provenance (
  entry_id INTEGER PRIMARY KEY REFERENCES memory_entries(id),
  note TEXT
);
-- v2: metadados da base (schema_version, created_at, engine_version, schema_migrated_at)
CREATE TABLE IF NOT EXISTS coala_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
-- v2: estado da ingestão do material do projeto (frescura por sha256 + commit git)
CREATE TABLE IF NOT EXISTS ingest_sources (
  path TEXT PRIMARY KEY,                -- relativo à raiz do projeto
  sha256 TEXT NOT NULL,                 -- hash do ficheiro na última ingestão ('(removido)' se saiu)
  size INTEGER,
  segments INTEGER NOT NULL,            -- segmentos ativos gerados (0 = removido)
  key_base TEXT NOT NULL,               -- <key_prefix>/<path_prefix>/<path>
  rule TEXT,                            -- regra do ingest.json que o apanhou
  ingested_at TEXT NOT NULL,
  git_commit TEXT                       -- HEAD do repositório no momento (se git)
);

-- índices de apoio (acréscimos ao DDL mínimo, sem alterar a forma)
CREATE INDEX IF NOT EXISTS idx_memory_supersession ON memory_entries(supersession_key, superseded_by);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(memory_type);
CREATE INDEX IF NOT EXISTS idx_memory_recorded ON memory_entries(recorded_at);
CREATE INDEX IF NOT EXISTS idx_chunks_entry ON chunks(entry_id);
CREATE INDEX IF NOT EXISTS idx_edges_src ON entity_edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON entity_edges(dst);
```

`PRAGMA user_version = 2` marca o esquema v2. Uma base v0/v1 (sem `coala_meta`/`ingest_sources`) é
migrada de forma aditiva na primeira abertura; `created_at` passa a ser o `MIN(recorded_at)`.

Tabela **opcional** (só criada se a extensão `sqlite_vec` carregar):

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[256]);
```

## Mapeamento CoALA → tabelas

| Memória CoALA | Onde vive | Semântica |
|---|---|---|
| Episódica | `memory_entries.memory_type='episodic'` | evento datado, ancorado em `recorded_at`/`source` |
| Semântica | `memory_type='semantic'` + `supersession_key` | facto atemporal versionado (bitemporal) |
| Procedimental | `memory_type='procedural'` | conhecimento executável (comandos, contratos, skills) |
| Working Memory | materializada por `recall` (não é tabela) | excertos orçamentados para o prompt |

Bitemporalidade: `recorded_at` = *system time* (quando a memória soube); `valid_from`/`valid_until`
= *valid time* (quando o facto vale no mundo). Um facto suplantado recebe `superseded_by` **e**
`valid_until=COALESCE(valid_until, agora)` — a versão antiga deixa de valer no momento em que é
substituída, mas o registo nunca é apagado.

## Supersessão e expiração (resolução de contradições)

- `add --key K` cria a nova versão e marca **todos** os registos ativos com `supersession_key=K`
  (`superseded_by = novo_id`, `valid_until = agora`) — nunca mais que uma versão ativa por chave.
- `supersede <id> --content "…"` faz o mesmo para um registo concreto, herdando tipo/origem/chave/tags.
- **Expiração** (sem sucessor): quando um segmento ou ficheiro de material desaparece, o `ingest`
  fecha `valid_until` do registo ativo (nota `Expirado em …`). Nada é apagado nem reescrito.
- Cada evento é registado em `provenance.note` (`Suplantado por #N`, `Suplanta #M`, `Expirado`,
  `Importado de <base>#<id>`, fonte, origem). Notas múltiplas são concatenadas com ` | `.
- Por predefinição, `search`/`recall` **excluem** registos suplantados e expirados; `--include-superseded`
  e `--include-expired` trazem-nos de volta (marcados como `SUPERADO por #N` / `EXPIRADO`).

## Ingestão do material do projeto (`ingest` + `ingest.json`)

Cada regra do `ingest.json` diz que ficheiros (glob, com `**`) entram, em que modo e com que
proveniência. A **primeira** regra que apanha um ficheiro ganha; exclusões padrão: `.git`,
`node_modules`, `.agents`, `.claude`, `dist`, `build`, `.next`, `out`, `__pycache__`.

| `mode` | Segmentação | Chave de supersessão |
|---|---|---|
| `markdown` | por cabeçalhos `#…####`, segmentos ≤ 1200 caracteres, cabeçalho repetido | `<key_prefix>/<lógico>#000` |
| `text` | por parágrafos ≤ 1200, prefixo `[<lógico>]` | `<key_prefix>/<lógico>#000` |
| `whole` | ficheiro inteiro num bloco ``` ``` ``` (scripts, manifestos) | `<key_prefix>/<lógico>` |
| `pdf` | `pdftotext -enc UTF-8`, por página, marcador `[<lógico> · pág. N]` | `<key_prefix>/<lógico>#0000` |

`<lógico>` = `<path_prefix>/<caminho relativo>` (ou só o caminho se `path_prefix` vazio) — é também
o `source` do registo. Tags aceitam `{stem}`, `{name}`, `{dir}`, `{rule}`. Idempotência: conteúdo
igual = NO-OP; mudou = supersessão pela mesma chave; segmentos a mais / ficheiro removido = expiram.
Sem `pdftotext`, as regras `pdf` são ignoradas com aviso (degradação graciosa). `graph` no
`ingest.json` declara entidades/arestas aplicadas de forma idempotente.

## Importação entre bases (`import`)

`import --from <base> --key-prefix P | --source-prefix P | --tags T | --ids 5-20 | --all` abre a
origem **só-leitura** e copia preservando tipo, conteúdo, origem, chave, `recorded_at`, validade,
fonte, tags e proveniência (+ nota `Importado de <base>#<id>`). Traz o **fecho da cadeia de
supersessão** (versões anteriores/posteriores dos selecionados) e religa `superseded_by`. É
idempotente (identidade = tipo + conteúdo + `recorded_at` + chave) e mantém o invariante
"≤ 1 versão ativa por chave" (a de `recorded_at` mais recente ganha). `--with-graph` copia entidades.

## Busca híbrida e fórmula RRF

Dois canais independentes, unidos por **Reciprocal Rank Fusion** (Cormack et al., 2009):

```
score(d) = Σ_m  w_m / (k + r_m(d))        k = 60
```

- `m ∈ {fts, vec}`; `r_m(d)` = posto do documento `d` no canal `m` (1-based, melhor = 1).
- `w_fts`, `w_vec` configuráveis: `--w-fts`/`--w-vec` ou env `COALA_RRF_W_FTS`/`COALA_RRF_W_VEC`
  (predefinido 1.0 cada). Ex.: `--w-fts 2 --w-vec 0.5` prioriza léxico.
- O ranking por canal é materializado em tabelas temporárias (`fts_scores`, `vec_scores`) e a fusão
  corre em SQL com **funções de janela**: `ROW_NUMBER() OVER (ORDER BY s ASC)` (FTS, BM25 mais
  baixo é melhor) e `ROW_NUMBER() OVER (ORDER BY sim DESC)` (vetor, cosseno mais alto é melhor);
  depois `SUM(w_m / (k + r))` agrupado por documento.

Canal FTS: `chunks_fts MATCH <consulta>` com tokens entre aspas unidos por `OR` (as aspas impedem
erros de sintaxe FTS5); `bm25(chunks_fts)` dá o score léxico (mais negativo = melhor). Nota: `bm25()`
só pode ser usado onde a tabela FTS está no `FROM` direto, por isso o melhor-por-entrada é calculado
fora do agregado.

Canal vetorial: similaridade de cosseno (em Python) entre o vetor da consulta e o de cada chunk;
fica o melhor chunk por entrada. Registos suplantados/expirados são filtrados **antes** da avaliação
em ambos os canais.

## Fallback vetorial determinístico (sem `sqlite_vec`)

Ordem de tentativa:

1. `import sqlite_vec` (ou `load_extension`) → usa `vec0` + `serialize_float32` para kNN.
2. Caso contrário — e **nunca** com erro — usa o fallback local documentado:

```
tokens = unigramas (peso 1.0) + bigramas consecutivos (peso 0.75)   [minúsculas]
índice = sha1(feature) primeiros 4 bytes → % 256                     [hashing trick]
vetor  = contagens pesadas por índice                                [float32 × 256]
vetor  = vetor / ‖vetor‖₂                                            [normalização L2]
semelhança = cosseno (produto interno de vetores normalizados)       [em Python]
```

É determinístico (SHA-1, sem aleatoriedade de processo), offline, sem pip e sem falhar por falta de
extensão. Limitação assumida: sendo bag-of-words com hashing, aproxima sobreposição léxico-semântica
(não captura sinonímia como um embedding neuronal). A troca por `sqlite_vec`/modelos reais é
transparente: o contrato da busca não muda.

## Chunks

Conteúdo dividido em pedaços de ≤ 1200 caracteres por fronteiras de parágrafo (mantendo frases
juntas). Cada chunk tem: texto (FTS5 via tabela de conteúdo externo) + embedding BLOB
(`struct '<256f'`).

## Estimativa de tokens e portão de saída

- Tokens ≈ `ceil(chars / 4)` (determinístico; é uma estimativa conservadora, não um tokenizer real).
- `recall` enche a working memory por seleção gulosa: ordena por relevância (0.7) + recência (0.3),
  entra quem couber no `--budget`; um excerto grande não bloqueia os seguintes.
- Toda a saída passa por **redação** de segredos (padrões `sk-`, `whsec_`, `cfut_`, `gd_pat_`, `ghp_`,
  `AKIA…`, `xox*`, `hf_`, `glpat-`, `npm_`, JWT, chaves privadas, `api_key=…`) e por um **portão de
  48 KB** (com aviso de truncagem). `export --out <ficheiro>` escreve o dump completo, também redigido.
  A redação é na saída; o conteúdo é guardado tal como foi dado — por isso não se guardam segredos.

## Saúde, backup e restauro

- `doctor [--deep]`: python/SQLite/FTS5/sqlite-vec/pdftotext, resolução da base, permissões,
  `journal_mode`, `quick_check` (ou `integrity_check`), tabelas e `user_version`, `integrity-check`
  do FTS5, chunks↔índice, órfãos, cadeia de supersessão, ≤ 1 ativo por chave, proveniência,
  contagens, **frescura** (ficheiros do `ingest.json` × `ingest_sources`) e motor local × manifesto.
  Exit 1 (com `Erro: … — Solução: …`) se houver alguma linha `FAIL`.
- `backup [--out F]`: snapshot consistente pela API de backup do SQLite em `memory/backups/`
  (`journal_mode=DELETE`, ficheiro autónomo, `0600`, nunca sobrescreve).
- `restore --from F --yes`: valida o backup (`quick_check` + tabelas), faz backup da base atual
  (`coala-pre-restore-*.sqlite`) e só depois repõe.

## Regras de origem (proveniência)

| `origin_class` | Uso |
|---|---|
| `owner` | dito/determinado pelo humano — máxima confiança |
| `agent` | deduzido/gerado pelo agente, docs escritos no repo |
| `untrusted` | web, PDFs e ferramentas de terceiros, dados não validados — nunca promover sem validação |
| `system` | registos de infraestrutura/automação (ex.: manifestos) |

`add --source https://…` com `--origin` no predefinido (`agent`) é reclassificado automaticamente
para `untrusted`. Cada inserção escreve nota em `provenance` (origem, fonte, suplantamentos).

## Contrato de erros

`Erro: <o quê> — Solução: <o que fazer>` em stderr · exit `0` sucesso · `1` operacional ·
`2` uso inválido · `3` dependência ou instalação em falta (inclui "não há memória local").
