#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
coala.py — Motor de memória persistente CoALA sobre SQLite (apenas stdlib) · v2.

Arquitetura (Sumers et al., "Cognitive Architectures for Language Agents"):
  - Memória Episódica    -> registos cronológicos ancorados no tempo
  - Memória Semântica    -> factos atemporais com proveniência e supersessão
  - Memória Procedimental-> conhecimento executável (skills, comandos, contratos)
  - Working Memory       -> `recall` materializa excertos orçamentados p/ prompt

Memória LOCAL por projeto — NÃO existe memória global. A base vive em
  <projeto>/.agents/<projeto>-coala-memory-agent-skill/memory/coala.sqlite
e é resolvida por esta ordem (a primeira que se aplica):
  1. --db <caminho>      2. env COALA_DB
  3. motor vendorizado: este ficheiro está em <x>-coala-memory-agent-skill/scripts/
  4. descoberta: sobe a partir do diretório atual até .agents/*-coala-memory-agent-skill/coala.json
  5. nada encontrado -> erro (exit 3) com a instrução de instalação; nunca cai numa base global.

Modo WAL ativo. FTS5 (BM25) para ranking léxico + vetores para ranking semântico,
fusão Reciprocal Rank Fusion (RRF) executada em SQL com funções de janela.

Uso:  python3 scripts/coala.py <comando> [opções]   |   python3 scripts/coala.py --selftest
"""

from __future__ import annotations

import argparse
import fnmatch
import glob
import hashlib
import io
import json
import os
import re
import shutil
import sqlite3
import stat
import struct
import subprocess
import sys
import tempfile
import urllib.parse
from datetime import datetime, timezone

# ----------------------------------------------------------------- constantes
ENGINE_VERSION = "2.0.0"
SCHEMA_VERSION = 2               # PRAGMA user_version (v0/v1 = esquema original, sem meta)
RRF_K = 60                       # constante k da fórmula RRF (Cormack et al., 2009)
EMBED_DIMS = 256                 # dimensões do vetor (fallback hashing)
CHUNK_MAX_CHARS = 1200           # tamanho máximo de um chunk
TOKEN_CHARS = 4                  # estimativa: 1 token ≈ 4 caracteres
MAX_OUTPUT_BYTES = 48 * 1024     # portão de saída: 48 KB
DEFAULT_BUDGET = 2000            # orçamento padrão do recall (tokens estimados)

DB_ENV = "COALA_DB"
W_FTS_ENV = "COALA_RRF_W_FTS"
W_VEC_ENV = "COALA_RRF_W_VEC"

SKILL_SUFFIX = "-coala-memory-agent-skill"   # convenção: <projeto>-coala-memory-agent-skill
MANIFEST_NAME = "coala.json"                 # manifesto da instalação local
INGEST_CONFIG_NAME = "ingest.json"           # fontes de material do projeto
DB_SUBPATH = ("memory", "coala.sqlite")
INSTALL_HINT = ("python3 ~/Agent-Skills/coala-agent-skill/scripts/coala-install.py"
                " install --project <raiz-do-projeto>")
# memória global aposentada em 2026-09-26: só é referida para o `doctor` avisar se ressurgir
LEGACY_GLOBAL_DB = os.path.join(os.path.expanduser("~"), ".coala-memory", "coala.sqlite")

MEMORY_TYPES = ("episodic", "semantic", "procedural")
ORIGINS = ("owner", "agent", "untrusted", "system")
REQUIRED_TABLES = ("memory_entries", "entity_nodes", "entity_edges", "chunks", "chunks_fts",
                   "provenance", "coala_meta", "ingest_sources")

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS memory_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_type TEXT NOT NULL CHECK (memory_type IN ('episodic','semantic','procedural')),
  content TEXT NOT NULL,
  origin_class TEXT NOT NULL DEFAULT 'agent'
    CHECK (origin_class IN ('owner','agent','untrusted','system')),
  supersession_key TEXT,
  superseded_by INTEGER REFERENCES memory_entries(id),
  recorded_at TEXT NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  source TEXT,
  tags TEXT
);
CREATE TABLE IF NOT EXISTS entity_nodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  kind TEXT
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
CREATE TABLE IF NOT EXISTS coala_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ingest_sources (
  path TEXT PRIMARY KEY,
  sha256 TEXT NOT NULL,
  size INTEGER,
  segments INTEGER NOT NULL,
  key_base TEXT NOT NULL,
  rule TEXT,
  ingested_at TEXT NOT NULL,
  git_commit TEXT
);
CREATE INDEX IF NOT EXISTS idx_memory_supersession ON memory_entries(supersession_key, superseded_by);
CREATE INDEX IF NOT EXISTS idx_memory_type ON memory_entries(memory_type);
CREATE INDEX IF NOT EXISTS idx_memory_recorded ON memory_entries(recorded_at);
CREATE INDEX IF NOT EXISTS idx_chunks_entry ON chunks(entry_id);
CREATE INDEX IF NOT EXISTS idx_edges_src ON entity_edges(src);
CREATE INDEX IF NOT EXISTS idx_edges_dst ON entity_edges(dst);
"""

VEC_EXT_SQL = """
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[256]);
"""

# ------------------------------------------------------------- contrato erros
class CoalaError(Exception):
    """Erro com contrato estável: 'Erro: <o quê> — Solução: <o que fazer>'."""
    exit_code = 1
    label = "Erro"

    def __init__(self, what: str, solution: str):
        super().__init__(f"{self.label}: {what} — Solução: {solution}")
        self.what = what
        self.solution = solution

    def render(self) -> str:
        return f"{self.label}: {self.what} — Solução: {self.solution}"


class UsageError(CoalaError):
    exit_code = 2
    label = "Erro"


class DependencyError(CoalaError):
    exit_code = 3
    label = "Erro"


# ------------------------------------------------------------------- utilitários
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def est_tokens(text: str) -> int:
    """Estimativa determinística de tokens: ceil(chars / 4), mínimo 1."""
    if not text:
        return 0
    return max(1, (len(text) + TOKEN_CHARS - 1) // TOKEN_CHARS)


def tokenize(text: str) -> list:
    return re.findall(r"[0-9A-Za-zÀ-ÿ_]+", (text or "").lower())


def chunk_text(text: str, max_chars: int = CHUNK_MAX_CHARS) -> list:
    """Divide o conteúdo em chunks por parágrafos, respeitando max_chars."""
    text = (text or "").strip()
    if not text:
        return []
    chunks = []
    current = ""
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        while len(para) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.append(para[:max_chars])
            para = para[max_chars:].strip()
        if not para:
            continue
        if current and len(current) + len(para) + 2 > max_chars:
            chunks.append(current)
            current = para
        else:
            current = f"{current}\n\n{para}" if current else para
    if current:
        chunks.append(current)
    return chunks or [text[:max_chars]]


def file_sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def engine_version_of(path: str) -> str:
    """Lê ENGINE_VERSION de um coala.py (sem o importar)."""
    try:
        with open(path, encoding="utf-8") as fh:
            m = re.search(r'^ENGINE_VERSION\s*=\s*"([^"]+)"', fh.read(), re.M)
        return m.group(1) if m else "?"
    except OSError:
        return "?"


def ro_uri(path: str) -> str:
    return "file:" + urllib.parse.quote(os.path.abspath(path)) + "?mode=ro"


# --------------------------------------------------- embeddings (fallback local)
def embed_text(text: str, dims: int = EMBED_DIMS) -> list:
    """
    Fallback determinístico SEM dependências externas (documentado em schema.md):
    hashing de unigramas (peso 1.0) + bigramas (peso 0.75) -> vetor float32 de
    `dims` dimensões, normalizado em L2. A semelhança de cosseno em Python
    aproxima sobreposição semântico-léxica; nunca falha por falta da extensão.
    """
    vec = [0.0] * dims
    toks = tokenize(text)
    feats = [(t, 1.0) for t in toks]
    feats += [(f"{a} {b}", 0.75) for a, b in zip(toks, toks[1:])]
    for feat, weight in feats:
        digest = hashlib.sha1(feat.encode("utf-8")).digest()
        idx = int.from_bytes(digest[:4], "big") % dims
        vec[idx] += weight
    norm = sum(v * v for v in vec) ** 0.5
    if norm > 0:
        vec = [v / norm for v in vec]
    return vec


def pack_vec(vec: list) -> bytes:
    return struct.pack(f"<{len(vec)}f", *vec)


def unpack_vec(blob: bytes) -> list:
    n = len(blob) // 4
    return list(struct.unpack(f"<{n}f", blob[: n * 4]))


def cosine(a: list, b: list) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


# ------------------------------------------------------------- redação segredos
SECRET_PATTERNS = [
    (re.compile(r"\bsk-[A-Za-z0-9_\-]{8,}"), "sk-[REDACTADO]"),
    (re.compile(r"\bwhsec_[A-Za-z0-9_\-]{6,}"), "whsec_[REDACTADO]"),
    (re.compile(r"\bcfut_[A-Za-z0-9_\-]{6,}"), "cfut_[REDACTADO]"),
    (re.compile(r"\bgd_pat_[A-Za-z0-9_\-]{10,}"), "gd_pat_[REDACTADO]"),
    (re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}"), "gh*_[REDACTADO]"),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), "github_pat_[REDACTADO]"),
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), "AKIA[REDACTADO]"),
    (re.compile(r"\bxox[baprs]-[A-Za-z0-9\-]{10,}"), "xox*-[REDACTADO]"),
    (re.compile(r"\bhf_[A-Za-z0-9]{20,}"), "hf_[REDACTADO]"),
    (re.compile(r"\bglpat-[A-Za-z0-9_\-]{16,}"), "glpat-[REDACTADO]"),
    (re.compile(r"\bnpm_[A-Za-z0-9]{30,}"), "npm_[REDACTADO]"),
    (re.compile(r"\beyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}"), "jwt-[REDACTADO]"),
    (re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----"),
     "[CHAVE-PRIVADA-REMOVIDA]"),
    (re.compile(r"(?i)\b(api[_-]?key|apikey|access[_-]?token|auth[_-]?token|token|secret|"
                r"client[_-]?secret|password|passwd)"
                r"(\s*[=:]\s*)[\"']?[A-Za-z0-9_\-/+\.]{12,}[\"']?"),
     lambda m: f"{m.group(1)}{m.group(2)}[REDACTADO]"),
]


def redact(text: str) -> str:
    """Mascara valores com aspeto de segredo. Aplica-se a TODA a saída."""
    if not text:
        return text
    for pattern, repl in SECRET_PATTERNS:
        text = pattern.sub(repl, text)
    return text


def emit(text: str) -> None:
    """Escreve no stdout aplicando redação e o portão de 48 KB."""
    data = redact(text)
    if not data.endswith("\n"):
        data += "\n"
    raw = data.encode("utf-8")
    if len(raw) > MAX_OUTPUT_BYTES:
        head = raw[: MAX_OUTPUT_BYTES - 256].decode("utf-8", errors="ignore")
        data = (head
                + "\n\n… [TRUNCADO: saída excedeu 48 KB — restringe com --type/--tags/--limit"
                  " ou usa `search`/`recall` com consultas mais específicas]\n")
    sys.stdout.write(data)
    sys.stdout.flush()


# ------------------------------------------------------- resolução da base local
def skill_dir_of_engine(engine_file: str = None):
    """Se o motor está vendorizado em <x>-coala-memory-agent-skill/scripts/, devolve a skill."""
    here = os.path.dirname(os.path.abspath(engine_file or __file__))
    skill = os.path.dirname(here)
    if os.path.basename(here) == "scripts" and os.path.basename(skill).endswith(SKILL_SUFFIX):
        return skill
    return None


def skill_dir_of_db(path: str):
    """Se a base está em <x>-coala-memory-agent-skill/memory/, devolve a skill."""
    mem = os.path.dirname(os.path.abspath(path))
    skill = os.path.dirname(mem)
    if os.path.basename(mem) == DB_SUBPATH[0] and os.path.basename(skill).endswith(SKILL_SUFFIX):
        return skill
    return None


def project_root_of(skill_dir: str) -> str:
    """<projeto>/.agents/<skill> -> <projeto>."""
    return os.path.dirname(os.path.dirname(os.path.abspath(skill_dir)))


def find_project_skill(start: str = None):
    """Sobe a partir de `start` até encontrar .agents/*-coala-memory-agent-skill/coala.json."""
    d = os.path.abspath(start or os.getcwd())
    while True:
        agents = os.path.join(d, ".agents")
        if os.path.isdir(agents):
            try:
                names = sorted(os.listdir(agents))
            except OSError:
                names = []
            found = [os.path.join(agents, n) for n in names
                     if n.endswith(SKILL_SUFFIX)
                     and os.path.isfile(os.path.join(agents, n, MANIFEST_NAME))]
            if len(found) > 1:
                raise UsageError(
                    f"há mais do que uma memória CoALA em {agents} "
                    f"({', '.join(os.path.basename(f) for f in found)})",
                    "indica qual usar com --db <skill>/memory/coala.sqlite")
            if found:
                return found[0]
        parent = os.path.dirname(d)
        if parent == d:
            return None
        d = parent


def resolve_db(override: str = None, cwd: str = None, env=None, engine_file: str = None):
    """Devolve (caminho_da_base, como_foi_resolvida, skill_dir|None). Nunca usa base global."""
    env = os.environ if env is None else env
    if override:
        p = os.path.abspath(os.path.expanduser(override))
        return p, "--db", skill_dir_of_db(p)
    if env.get(DB_ENV):
        p = os.path.abspath(os.path.expanduser(env[DB_ENV]))
        return p, f"env {DB_ENV}", skill_dir_of_db(p)
    skill = skill_dir_of_engine(engine_file)
    if skill:
        return os.path.join(skill, *DB_SUBPATH), "motor da skill local", skill
    skill = find_project_skill(cwd)
    if skill:
        return os.path.join(skill, *DB_SUBPATH), "descoberta a partir do diretório atual", skill
    start = os.path.abspath(cwd or os.getcwd())
    raise DependencyError(
        f"nenhuma memória CoALA local encontrada a partir de {start} (procura "
        f".agents/*{SKILL_SUFFIX}/{MANIFEST_NAME}; não existe memória global)",
        f"instala a memória no projeto com `{INSTALL_HINT}` ou indica --db <caminho>")


def db_path(override: str = None) -> str:
    return resolve_db(override)[0]


# -------------------------------------------------------------------- base dados
def harden_perms(path: str) -> None:
    for suffix in ("", "-wal", "-shm"):
        p = path + suffix
        if os.path.exists(p):
            try:
                os.chmod(p, 0o600)
            except OSError:
                pass


def init_schema(conn: sqlite3.Connection) -> str:
    """Cria/migra o esquema (idempotente, só aditivo). Devolve o nome do backend vetorial."""
    try:
        conn.executescript(SCHEMA_SQL)
    except sqlite3.OperationalError as exc:
        if "fts5" in str(exc).lower() or "no such module" in str(exc).lower():
            raise DependencyError(
                f"o SQLite desta máquina não tem FTS5 ({exc})",
                "instala um SQLite compilado com FTS5 (padrão no Python ≥3.9 do sistema) "
                "ou usa outro python3")
        raise CoalaError(f"falha ao criar o esquema ({exc})", "verifica permissões do ficheiro DB")

    ver = conn.execute("PRAGMA user_version").fetchone()[0]
    if ver < SCHEMA_VERSION:
        ts = now_iso()
        first = conn.execute("SELECT MIN(recorded_at) FROM memory_entries").fetchone()[0]
        conn.execute("INSERT OR IGNORE INTO coala_meta(key, value) VALUES ('created_at', ?)",
                     (first or ts,))
        conn.execute("INSERT OR REPLACE INTO coala_meta(key, value) VALUES ('schema_version', ?)",
                     (str(SCHEMA_VERSION),))
        conn.execute("INSERT OR REPLACE INTO coala_meta(key, value) VALUES ('schema_migrated_at', ?)",
                     (ts,))
        conn.execute("INSERT OR REPLACE INTO coala_meta(key, value) VALUES ('engine_version', ?)",
                     (ENGINE_VERSION,))
        conn.execute(f"PRAGMA user_version = {int(SCHEMA_VERSION)}")
        conn.commit()

    backend = "hashing-256"
    try:  # extensão opcional sqlite-vec; nunca falhar por falta dela
        import sqlite_vec  # type: ignore
        if hasattr(conn, "enable_load_extension"):
            conn.enable_load_extension(True)
        try:
            sqlite_vec.load(conn)  # type: ignore[attr-defined]
        except Exception:
            conn.load_extension("vec0")
        conn.enable_load_extension(False)
        conn.executescript(VEC_EXT_SQL)
        backend = "sqlite-vec"
    except Exception:
        backend = "hashing-256"
    return backend


def connect_path(path: str):
    """Abre a base num caminho explícito (WAL, FK, busy_timeout) e garante o esquema."""
    parent = os.path.dirname(path)
    if parent and not os.path.isdir(parent):
        os.makedirs(parent, mode=0o700, exist_ok=True)
    try:
        conn = sqlite3.connect(path)
    except sqlite3.Error as exc:
        raise CoalaError(
            f"não foi possível abrir a base de dados em {path} ({exc})",
            "verifica permissões do diretório ou indica --db para outro caminho")
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    backend = init_schema(conn)
    harden_perms(path)
    return conn, path, backend


def connect(override: str = None):
    """Resolve a base local (ver docstring do módulo) e abre-a. Devolve (conn, path, backend)."""
    path, _how, _skill = resolve_db(override)
    return connect_path(path)


def open_ro(path: str) -> sqlite3.Connection:
    """Ligação só-de-leitura (nunca escreve, nunca cria)."""
    if not os.path.isfile(path):
        raise CoalaError(f"a base {path} não existe", "confirma o caminho (ou corre `init`)")
    conn = sqlite3.connect(ro_uri(path), uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def table_names(conn) -> set:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


# --------------------------------------------------------------- proveniência
def add_provenance(conn, entry_id: int, note: str) -> None:
    row = conn.execute("SELECT note FROM provenance WHERE entry_id=?", (entry_id,)).fetchone()
    if row and row["note"]:
        conn.execute("UPDATE provenance SET note=? WHERE entry_id=?",
                     (row["note"] + " | " + note, entry_id))
    else:
        conn.execute("INSERT INTO provenance(entry_id, note) VALUES (?,?)", (entry_id, note))


def supersede_entry(conn, old_id: int, new_id: int, ts: str) -> bool:
    """Marca `old_id` como suplantado por `new_id`. Devolve True se fez efeito."""
    row = conn.execute("SELECT superseded_by FROM memory_entries WHERE id=?", (old_id,)).fetchone()
    if row is None or row["superseded_by"] is not None:
        return False
    conn.execute(
        "UPDATE memory_entries SET superseded_by=?, valid_until=COALESCE(valid_until, ?) WHERE id=?",
        (new_id, ts, old_id))
    add_provenance(conn, old_id, f"Suplantado por #{new_id} em {ts}")
    add_provenance(conn, new_id, f"Suplanta #{old_id}")
    return True


def expire_entry(conn, entry_id: int, ts: str, reason: str) -> bool:
    """Fecha o tempo de validade de um registo ativo (sem o apagar nem reescrever)."""
    cur = conn.execute(
        "UPDATE memory_entries SET valid_until=? WHERE id=? AND superseded_by IS NULL"
        " AND (valid_until IS NULL OR valid_until > ?)", (ts, entry_id, ts))
    if cur.rowcount:
        add_provenance(conn, entry_id, f"Expirado em {ts}: {reason}")
        return True
    return False


def index_content(conn, backend: str, entry_id: int, content: str) -> int:
    n = 0
    for ch in chunk_text(content):
        vec = embed_text(ch)
        cur = conn.execute("INSERT INTO chunks(entry_id, text, embedding) VALUES (?,?,?)",
                           (entry_id, ch, pack_vec(vec)))
        conn.execute("INSERT INTO chunks_fts(rowid, text) VALUES (?,?)", (cur.lastrowid, ch))
        if backend == "sqlite-vec":
            try:
                import sqlite_vec  # type: ignore
                conn.execute("INSERT INTO chunks_vec(rowid, embedding) VALUES (?,?)",
                             (cur.lastrowid, sqlite_vec.serialize_float32(vec)))
            except Exception:
                pass
        n += 1
    return n


def insert_entry(conn, backend: str, memory_type: str, content: str, origin: str,
                 key: str = None, source: str = None, tags: str = None,
                 valid_from: str = None, valid_until: str = None):
    """
    Insere um registo + chunks/FTS/vetores + proveniência. Se `key` (chave de
    supersessão) coincidir com registos ativos anteriores, cada um é suplantado
    por este (superseded_by + valid_until + nota de proveniência).
    Devolve (entry_id, [ids suplantados]).
    """
    ts = now_iso()
    cur = conn.execute(
        "INSERT INTO memory_entries(memory_type, content, origin_class, supersession_key,"
        " recorded_at, valid_from, valid_until, source, tags)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (memory_type, content, origin, key, ts, valid_from, valid_until, source, tags))
    entry_id = cur.lastrowid
    index_content(conn, backend, entry_id, content)
    add_provenance(conn, entry_id,
                   f"Registado em {ts}; origem={origin}; fonte={source or 'n/a'}")
    superseded = []
    if key:
        for old_id in active_key_conflicts(conn, key, exclude_id=entry_id):
            if supersede_entry(conn, old_id, entry_id, ts):
                superseded.append(old_id)
    return entry_id, superseded


def active_key_conflicts(conn, key: str, exclude_id: int = None) -> list:
    sql = ("SELECT id FROM memory_entries WHERE supersession_key=? AND superseded_by IS NULL")
    params = [key]
    if exclude_id is not None:
        sql += " AND id != ?"
        params.append(exclude_id)
    return [r["id"] for r in conn.execute(sql, params).fetchall()]


def ensure_entities(conn, names: list, kind: str = "conceito") -> list:
    ids = []
    for name in names:
        name = name.strip()
        if not name:
            continue
        row = conn.execute("SELECT id FROM entity_nodes WHERE name=?", (name,)).fetchone()
        if row:
            ids.append(row["id"])
        else:
            cur = conn.execute("INSERT INTO entity_nodes(name, kind) VALUES (?,?)", (name, kind))
            ids.append(cur.lastrowid)
    return ids


def link_entities(conn, src_id: int, dst_id: int, rel: str) -> bool:
    try:
        conn.execute("INSERT INTO entity_edges(src, dst, rel) VALUES (?,?,?)",
                     (src_id, dst_id, rel))
        return True
    except sqlite3.IntegrityError:
        return False


# ------------------------------------------------------------------ filtros/busca
def build_filter(mtype: str = None, tags: list = None, include_superseded: bool = False,
                 include_expired: bool = False, now: str = None, any_tags: list = None):
    """`tags` = TODAS têm de estar presentes (AND); `any_tags` = basta UMA (OR)."""
    conds = []
    params = []
    if not include_superseded:
        conds.append("e.superseded_by IS NULL")
    if not include_expired:
        conds.append("(e.valid_until IS NULL OR e.valid_until > ?)")
        params.append(now or now_iso())
    if mtype:
        conds.append("e.memory_type = ?")
        params.append(mtype)
    for tag in (tags or []):
        conds.append("(',' || LOWER(COALESCE(e.tags,'')) || ',') LIKE ?")
        params.append(f"%,{tag.strip().lower()},%")
    anyt = [t.strip().lower() for t in (any_tags or []) if t.strip()]
    if anyt:
        conds.append("(" + " OR ".join("(',' || LOWER(COALESCE(e.tags,'')) || ',') LIKE ?" for _ in anyt) + ")")
        params += [f"%,{t},%" for t in anyt]
    where = (" AND " + " AND ".join(conds)) if conds else ""
    return where, params


def build_fts_query(qtext: str) -> str:
    toks = tokenize(qtext)
    if not toks:
        raise UsageError(f"a consulta {qtext!r} não tem termos pesquisáveis",
                         "usa palavras com letras ou números (ex.: `search \"deploy cloudflare\"`)")
    return " OR ".join('"' + t.replace('"', '""') + '"' for t in toks)


def fts_search(conn, qtext: str, where: str, params: list, limit: int = 100) -> list:
    """
    Ranking léxico BM25 (mais baixo = melhor). Devolve [(eid, bm25)].
    Nota: bm25() só pode ser usado onde o FTS5 está no FROM direto, por isso a
    agregação por entrada (melhor chunk) é feita fora do SQL.
    """
    match = build_fts_query(qtext)
    sql = ("SELECT c.entry_id AS eid, bm25(chunks_fts) AS s"
           " FROM chunks_fts"
           " JOIN chunks c ON c.id = chunks_fts.rowid"
           " JOIN memory_entries e ON e.id = c.entry_id"
           " WHERE chunks_fts MATCH ? " + where +
           " ORDER BY s ASC LIMIT ?")
    try:
        rows = conn.execute(sql, [match] + list(params) + [max(limit * 4, 200)]).fetchall()
    except sqlite3.OperationalError as exc:
        raise CoalaError(f"consulta FTS5 inválida ({exc})", "simplifica a consulta (palavras soltas)")
    best = {}
    for r in rows:
        eid, s = r["eid"], r["s"]
        if eid not in best or s < best[eid]:
            best[eid] = s
    return sorted(best.items(), key=lambda kv: (kv[1], kv[0]))[:limit]


def vector_search(conn, qtext: str, where: str, params: list, limit: int = 100) -> list:
    """Ranking vetorial por cosseno (maior = melhor). Devolve [(eid, sim)]."""
    qvec = embed_text(qtext)
    sql = ("SELECT c.entry_id AS eid, c.embedding AS emb FROM chunks c"
           " JOIN memory_entries e ON e.id = c.entry_id"
           " WHERE c.embedding IS NOT NULL" + where)
    best = {}
    for row in conn.execute(sql, list(params)).fetchall():
        if not row["emb"]:
            continue
        sim = cosine(qvec, unpack_vec(row["emb"]))
        eid = row["eid"]
        if eid not in best or sim > best[eid]:
            best[eid] = sim
    ranked = sorted(best.items(), key=lambda kv: (-kv[1], kv[0]))
    return ranked[:limit]


def hybrid_search(conn, qtext: str, where: str, params: list, limit: int = 10,
                  w_fts: float = 1.0, w_vec: float = 1.0, k: int = RRF_K) -> list:
    """
    Fusão Reciprocal Rank Fusion em SQL com funções de janela:
        score(d) = Σ_m  w_m / (k + r_m(d)),  k = 60
    onde r_m(d) é o posto do documento d no método m (1-based).
    """
    fts = fts_search(conn, qtext, where, params, limit=max(limit * 10, 100))
    vec = vector_search(conn, qtext, where, params, limit=max(limit * 10, 100))

    conn.execute("DROP TABLE IF EXISTS temp.fts_scores")
    conn.execute("DROP TABLE IF EXISTS temp.vec_scores")
    conn.execute("CREATE TEMP TABLE fts_scores(eid INTEGER PRIMARY KEY, s REAL)")
    conn.execute("CREATE TEMP TABLE vec_scores(eid INTEGER PRIMARY KEY, sim REAL)")
    conn.executemany("INSERT OR REPLACE INTO fts_scores(eid, s) VALUES (?,?)", fts)
    conn.executemany("INSERT OR REPLACE INTO vec_scores(eid, sim) VALUES (?,?)", vec)

    sql = """
    WITH fts_ranked AS (
        SELECT eid, ROW_NUMBER() OVER (ORDER BY s ASC) AS r FROM fts_scores
    ),
    vec_ranked AS (
        SELECT eid, ROW_NUMBER() OVER (ORDER BY sim DESC) AS r FROM vec_scores
    ),
    all_ranks AS (
        SELECT eid, r, 'fts' AS m FROM fts_ranked
        UNION ALL
        SELECT eid, r, 'vec' AS m FROM vec_ranked
    )
    SELECT a.eid AS eid,
           SUM(CASE a.m WHEN 'fts' THEN :wf ELSE :wv END / (:k + a.r)) AS rrf,
           MIN(CASE a.m WHEN 'fts' THEN a.r END) AS fts_rank,
           MIN(CASE a.m WHEN 'vec' THEN a.r END) AS vec_rank
    FROM all_ranks a
    GROUP BY a.eid
    ORDER BY rrf DESC, eid ASC
    LIMIT :lim
    """
    rows = conn.execute(sql, {"wf": w_fts, "wv": w_vec, "k": k, "lim": limit}).fetchall()
    sim_map = dict(vec)
    score_map = dict(fts)
    out = []
    for r in rows:
        out.append({
            "eid": r["eid"],
            "rrf": r["rrf"],
            "fts_rank": r["fts_rank"],
            "vec_rank": r["vec_rank"],
            "fts_score": score_map.get(r["eid"]),
            "vec_sim": sim_map.get(r["eid"]),
        })
    return out


def recency_score(recorded_at: str, now: str = None) -> float:
    try:
        t0 = datetime.fromisoformat(recorded_at)
        t1 = datetime.fromisoformat(now or now_iso())
        days = max(0.0, (t1 - t0).total_seconds() / 86400.0)
    except Exception:
        return 0.5
    return 1.0 / (1.0 + days / 30.0)


def budgeted_selection(order: list, rows: dict, scores: dict, budget: int,
                       top: int, has_query: bool, header_overhead: int = 40):
    """
    Working memory: seleção gulosa de excertos por relevância+recência dentro do
    orçamento de tokens estimados. Entra quem couber; um excerto grande nunca
    bloqueia os seguintes (usa-se `continue`, não `break`).
    Devolve [(combinado, recência, relevância, row), ...].
    """
    max_score = max(scores.values()) if scores else 1.0
    chosen, used = [], 0
    for eid in order:
        r = rows.get(eid)
        if r is None:
            continue
        rel = (scores.get(eid, 0.0) / max_score) if (has_query and max_score) else 0.5
        rec = recency_score(r["recorded_at"])
        combined = 0.7 * rel + 0.3 * rec
        cost = est_tokens(r["content"]) + header_overhead
        if used + cost > budget:
            continue
        used += cost
        chosen.append((combined, rec, rel, r))
        if len(chosen) >= top:
            break
    return chosen


# ---------------------------------------------------------------- apresentação
def fmt_validity(row, now: str = None) -> str:
    now = now or now_iso()
    if row["superseded_by"]:
        return f"SUPERADO por #{row['superseded_by']}"
    if row["valid_until"]:
        if row["valid_until"] <= now:
            return f"EXPIRADO ({row['valid_until']})"
        return f"válido até {row['valid_until']}"
    if row["valid_from"]:
        return f"válido desde {row['valid_from']}"
    return "válido"


def entry_lines(row, extra: str = None) -> str:
    tags = row["tags"] or ""
    head = (f"── #{row['id']} · {row['memory_type']} · origem:{row['origin_class']}"
            f" · {fmt_validity(row)}")
    if row["source"]:
        head += f" · fonte: {row['source']}"
    if tags:
        head += f" · tags: {tags}"
    if extra:
        head += f"\n   {extra}"
    return head + "\n" + row["content"].strip()


# ------------------------------------------------------------ ingestão (material)
INGEST_MODES = ("markdown", "text", "whole", "pdf")
DEFAULT_EXCLUDES = [".git/**", "**/.git/**", "node_modules/**", "**/node_modules/**",
                    ".agents/**", ".claude/**", "dist/**", "build/**", ".next/**", "out/**",
                    "**/__pycache__/**"]
TEXT_MAX_BYTES = 2 * 1024 * 1024
MAX_SEG_CHARS = CHUNK_MAX_CHARS   # segmentos de material alinhados com os chunks


def split_paragraphs(text: str) -> list:
    return [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]


def pack(paras: list, max_chars: int = MAX_SEG_CHARS, repeat_head: str = "") -> list:
    """Empacota parágrafos em segmentos ≤ max_chars; parte parágrafos gigantes."""
    segs, cur = [], repeat_head
    for p in paras:
        while len(p) > max_chars:                      # parágrafo maior que o segmento
            if cur.strip():
                segs.append(cur.strip())
                cur = repeat_head
            cut = p.rfind(" ", 0, max_chars)
            cut = cut if cut > 0 else max_chars
            segs.append((repeat_head + p[:cut]).strip())
            p = p[cut:].strip()
        if len(cur) + len(p) + 2 > max_chars and cur.strip():
            segs.append(cur.strip())
            cur = repeat_head
        cur += p + "\n\n"
    if cur.strip():
        segs.append(cur.strip())
    return segs


def segments_markdown(text: str, head_prefix: str = "") -> list:
    """Segmenta markdown por cabeçalhos, mantendo o cabeçalho em cada segmento."""
    lines = text.splitlines()
    blocks, head, buf = [], None, []
    for ln in lines:
        if re.match(r"^#{1,4}\s", ln):
            blocks.append((head, "\n".join(buf).strip()))
            head, buf = ln.strip(), []
        else:
            buf.append(ln)
    blocks.append((head, "\n".join(buf).strip()))
    segs = []
    for head, body in blocks:
        if not body and not head:
            continue
        repeat = (head + "\n\n") if head else head_prefix
        content_head = (head_prefix + "\n\n" if head_prefix else "")
        for s in pack(split_paragraphs(body), repeat_head=repeat):
            segs.append((content_head + s).strip())
    return segs


def segments_pdf(pdf_path: str, rel: str, max_pages: int = 0, warn=None) -> list:
    """Extrai texto (pdftotext) e segmenta por páginas, com marcador de página."""
    cmd = ["pdftotext", "-q", "-enc", "UTF-8", pdf_path, "-"]
    if max_pages:
        cmd[2:2] = ["-f", "1", "-l", str(max_pages)]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except (OSError, subprocess.TimeoutExpired) as exc:
        if warn:
            warn(f"{rel}: pdftotext falhou ({exc}) — ignorado")
        return None
    if out.returncode != 0:
        if warn:
            warn(f"{rel}: pdftotext saiu com {out.returncode} — ignorado")
        return None
    segs = []
    for pageno, page in enumerate(out.stdout.split("\f"), start=1):
        paras = split_paragraphs(page)
        if not paras:
            continue
        for s in pack(paras, repeat_head=f"[{rel} · pág. {pageno}]\n\n"):
            segs.append(s)
    return segs


def read_text(path: str) -> str:
    try:
        with open(path, encoding="utf-8") as fh:
            return fh.read()
    except UnicodeDecodeError:
        with open(path, encoding="utf-8", errors="replace") as fh:
            return fh.read()


def load_ingest_config(path: str) -> dict:
    """Lê e valida o ingest.json (fontes de material do projeto)."""
    try:
        with open(path, encoding="utf-8") as fh:
            cfg = json.load(fh)
    except OSError as exc:
        raise CoalaError(f"não foi possível ler {path} ({exc})", "confirma o caminho do ingest.json")
    except json.JSONDecodeError as exc:
        raise CoalaError(f"{path} não é JSON válido (linha {exc.lineno}: {exc.msg})",
                         "corrige o ficheiro (ver references/instalar.md da coala-agent-skill)")
    if not isinstance(cfg, dict) or not isinstance(cfg.get("rules"), list):
        raise CoalaError(f"{path} não tem a lista `rules`", "define `rules: [{name, include, mode, type, origin, tags}]`")
    cfg.setdefault("key_prefix", "proj")
    cfg.setdefault("path_prefix", "")
    excludes = list(DEFAULT_EXCLUDES)
    for ex in cfg.get("exclude") or []:
        if ex not in excludes:
            excludes.append(ex)
    cfg["_exclude"] = excludes
    names = set()
    for i, rule in enumerate(cfg["rules"]):
        where = f"{path}: rules[{i}]"
        if not isinstance(rule, dict):
            raise CoalaError(f"{where} não é um objeto", "cada regra é {name, include, mode, type, origin, tags}")
        name = rule.get("name")
        if not name or name in names:
            raise CoalaError(f"{where}: `name` em falta ou repetido ({name!r})", "dá um nome único a cada regra")
        names.add(name)
        inc = rule.get("include")
        if isinstance(inc, str):
            inc = [inc]
        if not inc or not all(isinstance(x, str) and x for x in inc):
            raise CoalaError(f"{where}: `include` vazio", "lista padrões glob relativos à raiz (ex.: docs/**/*.md)")
        rule["include"] = inc
        rule.setdefault("mode", "markdown")
        rule.setdefault("type", "semantic")
        rule.setdefault("origin", "agent")
        rule.setdefault("tags", "")
        if rule["mode"] not in INGEST_MODES:
            raise CoalaError(f"{where}: mode {rule['mode']!r} inválido", f"usa um de {', '.join(INGEST_MODES)}")
        if rule["type"] not in MEMORY_TYPES:
            raise CoalaError(f"{where}: type {rule['type']!r} inválido", f"usa um de {', '.join(MEMORY_TYPES)}")
        if rule["origin"] not in ORIGINS:
            raise CoalaError(f"{where}: origin {rule['origin']!r} inválido", f"usa um de {', '.join(ORIGINS)}")
    graph = cfg.get("graph") or {}
    for e in graph.get("edges") or []:
        if not (isinstance(e, list) and len(e) == 3 and all(isinstance(x, str) and x for x in e)):
            raise CoalaError(f"{path}: aresta inválida {e!r}", "usa [origem, relação, destino]")
    return cfg


def expand_sources(cfg: dict, root: str) -> list:
    """Atribui cada ficheiro à PRIMEIRA regra que o apanha. Devolve [(relpath, regra)] ordenado."""
    assigned, order = {}, []
    for rule in cfg["rules"]:
        for pat in rule["include"]:
            for p in sorted(glob.glob(os.path.join(root, pat), recursive=True)):
                if not os.path.isfile(p):
                    continue
                rel = os.path.relpath(p, root).replace(os.sep, "/")
                if rel.startswith("../") or rel in assigned:
                    continue
                if any(fnmatch.fnmatch(rel, ex) for ex in cfg["_exclude"]):
                    continue
                assigned[rel] = rule
                order.append(rel)
    return [(rel, assigned[rel]) for rel in order]


def logical_path(cfg: dict, relpath: str) -> str:
    prefix = (cfg.get("path_prefix") or "").strip("/")
    return f"{prefix}/{relpath}" if prefix else relpath


def rule_tags(rule: dict, relpath: str) -> str:
    base = os.path.basename(relpath)
    stem = os.path.splitext(base)[0]
    parent = os.path.basename(os.path.dirname(relpath))
    tags = rule.get("tags") or ""
    for k, v in (("{stem}", stem), ("{name}", base), ("{dir}", parent), ("{rule}", rule["name"])):
        tags = tags.replace(k, v)
    return tags or None


def segment_file(abs_path: str, logical: str, rule: dict, pdf_pages: int = 0, warn=None):
    """Devolve a lista de segmentos, ou None se o ficheiro foi ignorado (aviso emitido)."""
    mode = rule["mode"]
    if mode == "pdf":
        if not shutil.which("pdftotext"):
            if warn:
                warn(f"{logical}: pdftotext ausente — regra `{rule['name']}` ignorada (instala poppler)")
            return None
        return segments_pdf(abs_path, logical, max_pages=pdf_pages, warn=warn)
    limit = int(rule.get("max_bytes") or TEXT_MAX_BYTES)
    if os.path.getsize(abs_path) > limit:
        if warn:
            warn(f"{logical}: {os.path.getsize(abs_path)} bytes > max_bytes {limit} — ignorado")
        return None
    text = read_text(abs_path)
    if mode == "markdown":
        return segments_markdown(text)
    if mode == "text":
        return pack(split_paragraphs(text), repeat_head=f"[{logical}]\n\n")
    return [f"[{logical}]\n\n```\n{text}\n```"]          # whole


def segment_keys(key_base: str, mode: str, n: int) -> list:
    if mode == "whole":
        return [key_base][:n]
    width = 4 if mode == "pdf" else 3
    return [f"{key_base}#{i:0{width}d}" for i in range(n)]


def git_head(root: str):
    try:
        out = subprocess.run(["git", "-C", root, "rev-parse", "HEAD"],
                             capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return None
    return out.stdout.strip() if out.returncode == 0 else None


def live_entries_for_base(conn, key_base: str, now: str) -> list:
    return conn.execute(
        "SELECT id, supersession_key AS k FROM memory_entries WHERE superseded_by IS NULL"
        " AND (valid_until IS NULL OR valid_until > ?)"
        " AND (supersession_key = ? OR substr(supersession_key, 1, ?) = ?)",
        (now, key_base, len(key_base) + 1, key_base + "#")).fetchall()


def apply_graph(conn, graph: dict):
    """Entidades/arestas declaradas no ingest.json (idempotente)."""
    if not graph:
        return 0, 0
    new_e = new_x = 0
    for ent in graph.get("entities") or []:
        name = (ent.get("name") or "").strip() if isinstance(ent, dict) else str(ent).strip()
        if not name:
            continue
        kind = ent.get("kind") if isinstance(ent, dict) else None
        if conn.execute("SELECT 1 FROM entity_nodes WHERE name=?", (name,)).fetchone() is None:
            conn.execute("INSERT INTO entity_nodes(name, kind) VALUES (?,?)", (name, kind or "conceito"))
            new_e += 1
    for src, rel, dst in graph.get("edges") or []:
        before = conn.execute("SELECT COUNT(*) FROM entity_nodes").fetchone()[0]
        a, b = ensure_entities(conn, [src, dst])
        new_e += conn.execute("SELECT COUNT(*) FROM entity_nodes").fetchone()[0] - before
        if link_entities(conn, a, b, rel):
            new_x += 1
    return new_e, new_x


def run_ingest(conn, backend, cfg: dict, root: str, only: list = None, pdf_pages: int = 0,
               dry_run: bool = False, verbose: bool = False) -> dict:
    """
    Ingestão idempotente guiada pelo ingest.json:
      conteúdo e metadados iguais = NO-OP · conteúdo ou tipo/origem/tags/fonte mudaram =
      nova versão por supersessão (mesma chave) ·
      segmento/ficheiro desapareceu = o registo EXPIRA (valid_until), nunca é apagado.
    """
    now = now_iso()
    warnings, details = [], []
    warn = warnings.append
    rule_names = [r["name"] for r in cfg["rules"]]
    if only:
        bad = [n for n in only if n not in rule_names]
        if bad:
            raise UsageError(f"regra(s) desconhecida(s): {', '.join(bad)}",
                             f"usa --only com {', '.join(rule_names)}")
    assignment = expand_sources(cfg, root)
    assigned_paths = {p for p, _ in assignment}
    selected = [(p, r) for p, r in assignment if not only or r["name"] in only]
    has_sources = "ingest_sources" in table_names(conn)
    head = git_head(root)
    stats = {n: dict(files=0, segments=0, new=0, same=0, updated=0, expired=0, skipped=0)
             for n in rule_names}

    for relpath, rule in selected:
        st = stats[rule["name"]]
        abs_path = os.path.join(root, relpath)
        logical = logical_path(cfg, relpath)
        key_base = f"{cfg['key_prefix']}/{logical}"
        segs = segment_file(abs_path, logical, rule, pdf_pages=pdf_pages, warn=warn)
        if segs is None:
            st["skipped"] += 1
            continue
        st["files"] += 1
        st["segments"] += len(segs)
        tags = rule_tags(rule, relpath)
        keys = segment_keys(key_base, rule["mode"], len(segs))
        f_new = f_upd = f_same = f_exp = 0
        for key, content in zip(keys, segs):
            row = conn.execute(
                "SELECT id, content, valid_until, memory_type, origin_class, tags, source"
                " FROM memory_entries WHERE supersession_key=? AND superseded_by IS NULL"
                " ORDER BY id DESC LIMIT 1", (key,)).fetchone()
            live = row is not None and (row["valid_until"] is None or row["valid_until"] > now)
            same_meta = row is not None and (row["memory_type"], row["origin_class"], row["tags"] or None,
                                             row["source"]) == (rule["type"], rule["origin"], tags, logical)
            if live and row["content"] == content and same_meta:
                f_same += 1
                continue
            if dry_run:
                if row is None:
                    f_new += 1
                else:
                    f_upd += 1
                continue
            entry_id, sup = insert_entry(conn, backend, rule["type"], content, rule["origin"],
                                         key=key, source=logical, tags=tags)
            add_provenance(conn, entry_id, f"Ingerido de {logical} (regra {rule['name']}) em {now}")
            if sup:
                f_upd += 1
            else:
                f_new += 1
        keyset = set(keys)
        for r in live_entries_for_base(conn, key_base, now):
            if r["k"] in keyset:
                continue
            f_exp += 1
            if not dry_run:
                expire_entry(conn, r["id"], now, f"segmento já não existe em {logical}")
        st["new"] += f_new
        st["updated"] += f_upd
        st["same"] += f_same
        st["expired"] += f_exp
        if verbose:
            details.append(f"  · {logical}: {len(segs)} seg · novos={f_new} iguais={f_same}"
                           f" atualizados={f_upd} expirados={f_exp}")
        if not dry_run:
            sha = file_sha256(abs_path)
            size = os.path.getsize(abs_path)
            prev = conn.execute("SELECT * FROM ingest_sources WHERE path=?", (relpath,)).fetchone()
            if prev is None or (prev["sha256"], prev["segments"], prev["key_base"], prev["rule"]) != (
                    sha, len(segs), key_base, rule["name"]):
                conn.execute(
                    "INSERT OR REPLACE INTO ingest_sources(path, sha256, size, segments, key_base,"
                    " rule, ingested_at, git_commit) VALUES (?,?,?,?,?,?,?,?)",
                    (relpath, sha, size, len(segs), key_base, rule["name"], now, head))
            conn.commit()

    removed = []
    if has_sources:
        rows = conn.execute("SELECT * FROM ingest_sources WHERE segments > 0").fetchall()
        for r in rows:
            if r["path"] in assigned_paths:
                continue
            if only and r["rule"] not in only:
                continue
            n_exp = 0
            for e in live_entries_for_base(conn, r["key_base"], now):
                n_exp += 1
                if not dry_run:
                    expire_entry(conn, e["id"], now, f"fonte {r['path']} removida/excluída")
            removed.append({"path": r["path"], "expired": n_exp})
            if r["rule"] in stats:
                stats[r["rule"]]["expired"] += n_exp
            if not dry_run:
                conn.execute("UPDATE ingest_sources SET segments=0, sha256='(removido)', ingested_at=?"
                             " WHERE path=?", (now, r["path"]))
        if not dry_run:
            conn.commit()

    ent_new = edge_new = 0
    if not dry_run and not only:
        ent_new, edge_new = apply_graph(conn, cfg.get("graph"))
        conn.commit()
    totals = {k: sum(s[k] for s in stats.values())
              for k in ("files", "segments", "new", "same", "updated", "expired", "skipped")}
    return {"root": root, "dry_run": dry_run, "rules": stats, "removed": removed,
            "graph": {"entities_new": ent_new, "edges_new": edge_new},
            "totals": totals, "warnings": warnings, "details": details, "git_commit": head}


def freshness_report(conn, cfg: dict, root: str) -> dict:
    """Compara os ficheiros atuais com a última ingestão (sha256 por ficheiro)."""
    assignment = expand_sources(cfg, root)
    assigned = {p for p, _ in assignment}
    rows = {}
    if "ingest_sources" in table_names(conn):
        rows = {r["path"]: r for r in conn.execute("SELECT * FROM ingest_sources").fetchall()}
    fresh, stale, new, removed = [], [], [], []
    for p, _rule in assignment:
        row = rows.get(p)
        if row is None or row["segments"] == 0:
            new.append(p)
        elif file_sha256(os.path.join(root, p)) != row["sha256"]:
            stale.append(p)
        else:
            fresh.append(p)
    for p, row in rows.items():
        if p not in assigned and row["segments"] > 0:
            removed.append(p)
    return {"fresh": fresh, "stale": stale, "new": new, "removed": removed}


# ------------------------------------------------------------------------ doctor
def _mode(path: str):
    try:
        return stat.S_IMODE(os.stat(path).st_mode)
    except OSError:
        return None


def doctor_report(path: str, how: str, skill: str = None, deep: bool = False,
                  freshness: bool = True) -> list:
    checks = []

    def add(level, name, detail, solution=None):
        checks.append({"level": level, "check": name, "detail": str(detail), "solution": solution})

    ok_py = sys.version_info >= (3, 8)
    add("OK" if ok_py else "FAIL", "python3", ".".join(map(str, sys.version_info[:3])),
        None if ok_py else "usa Python ≥ 3.8")
    add("OK", "sqlite", sqlite3.sqlite_version)
    try:
        m = sqlite3.connect(":memory:")
        m.execute("CREATE VIRTUAL TABLE t USING fts5(x)")
        m.close()
        add("OK", "fts5", "disponível")
    except sqlite3.Error as exc:
        add("FAIL", "fts5", f"indisponível ({exc})", "usa um python3/SQLite com FTS5")
    try:
        import sqlite_vec  # type: ignore  # noqa: F401
        add("OK", "sqlite-vec", "disponível (kNN nativo)")
    except Exception:
        add("INFO", "sqlite-vec", "ausente — fallback vetorial hashing-256 (degradação graciosa)")
    pdft = shutil.which("pdftotext")
    add("OK" if pdft else "INFO", "pdftotext",
        pdft or "ausente — regras `pdf` do ingest são ignoradas (instala poppler)")
    add("INFO", "base", f"{path} ({how})")
    if skill:
        add("INFO", "skill local", skill)
    if not os.path.isfile(path):
        add("FAIL", "base existe", f"{path} não existe",
            "corre `coala.py init` ou reinstala com o instalador")
        return checks

    parent = os.path.dirname(path)
    dm = _mode(parent)
    ok = dm is not None and dm & 0o077 == 0
    add("OK" if ok else "WARN", "permissões da pasta", oct(dm) if dm is not None else "?",
        None if ok else f"chmod 700 {parent}")
    for suffix in ("", "-wal", "-shm"):
        p = path + suffix
        if os.path.exists(p):
            fm = _mode(p)
            ok = fm is not None and fm & 0o077 == 0
            add("OK" if ok else "WARN", f"permissões {os.path.basename(p)}", oct(fm),
                None if ok else f"chmod 600 {p}")

    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA busy_timeout=5000")
        jm = conn.execute("PRAGMA journal_mode").fetchone()[0]
        add("OK" if jm.lower() == "wal" else "WARN", "journal_mode", jm,
            None if jm.lower() == "wal" else "abre a base com o motor (ativa WAL)")
        chk = conn.execute("PRAGMA integrity_check" if deep else "PRAGMA quick_check").fetchone()[0]
        add("OK" if chk == "ok" else "FAIL",
            "integridade (" + ("integrity_check" if deep else "quick_check") + ")", chk,
            None if chk == "ok" else "restaura um backup: `coala.py restore --from <ficheiro> --yes`")
        tables = table_names(conn)
        missing = [t for t in REQUIRED_TABLES if t not in tables]
        add("OK" if not missing else "FAIL", "esquema",
            "tabelas completas" if not missing else "faltam: " + ", ".join(missing),
            None if not missing else "corre `coala.py init` (aditivo, idempotente)")
        if "memory_entries" not in tables or "chunks" not in tables:
            return checks
        uv = conn.execute("PRAGMA user_version").fetchone()[0]
        add("OK" if uv == SCHEMA_VERSION else "WARN", "versão do esquema",
            f"v{uv} (motor v{ENGINE_VERSION} espera v{SCHEMA_VERSION})",
            None if uv == SCHEMA_VERSION else "corre `coala.py init` para migrar (aditivo)")

        def q1(sql, *a):
            return conn.execute(sql, a).fetchone()[0]

        try:
            conn.execute("INSERT INTO chunks_fts(chunks_fts) VALUES('integrity-check')")
            add("OK", "índice FTS5", "integrity-check ok")
        except sqlite3.Error as exc:
            add("FAIL", "índice FTS5", str(exc),
                "reconstrói com `INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild')` ou restaura um backup")
        n_chunks = q1("SELECT COUNT(*) FROM chunks")
        n_doc = q1("SELECT COUNT(*) FROM chunks_fts_docsize") if "chunks_fts_docsize" in tables else n_chunks
        add("OK" if n_doc == n_chunks else "WARN", "chunks ↔ FTS5", f"{n_chunks} chunks · {n_doc} indexados",
            None if n_doc == n_chunks else "reconstrói o índice (`rebuild`)")
        orphans = q1("SELECT COUNT(*) FROM chunks c LEFT JOIN memory_entries e ON e.id=c.entry_id"
                     " WHERE e.id IS NULL")
        add("OK" if orphans == 0 else "FAIL", "chunks órfãos", orphans,
            None if orphans == 0 else "restaura um backup (não apagues à mão)")
        nochunk = q1("SELECT COUNT(*) FROM memory_entries e WHERE NOT EXISTS"
                     " (SELECT 1 FROM chunks c WHERE c.entry_id=e.id)")
        add("OK" if nochunk == 0 else "WARN", "registos sem chunks", nochunk,
            None if nochunk == 0 else "esses registos não aparecem na busca — reinsere-os com `supersede`")
        dangling = q1("SELECT COUNT(*) FROM memory_entries e WHERE e.superseded_by IS NOT NULL"
                      " AND NOT EXISTS (SELECT 1 FROM memory_entries x WHERE x.id=e.superseded_by)")
        add("OK" if dangling == 0 else "FAIL", "cadeia de supersessão", "íntegra" if dangling == 0
            else f"{dangling} apontam para ids inexistentes",
            None if dangling == 0 else "restaura um backup")
        dups = conn.execute(
            "SELECT supersession_key AS k, COUNT(*) AS n FROM memory_entries WHERE superseded_by IS NULL"
            " AND supersession_key IS NOT NULL GROUP BY 1 HAVING n > 1 LIMIT 5").fetchall()
        add("OK" if not dups else "FAIL", "uma versão ativa por chave",
            "ok" if not dups else ", ".join(f"{r['k']}×{r['n']}" for r in dups),
            None if not dups else "suplanta as versões a mais com `supersede <id>`")
        noprov = q1("SELECT COUNT(*) FROM memory_entries e WHERE NOT EXISTS"
                    " (SELECT 1 FROM provenance p WHERE p.entry_id=e.id)")
        add("OK" if noprov == 0 else "WARN", "proveniência", "todos os registos têm nota" if noprov == 0
            else f"{noprov} registos sem nota")
        now = now_iso()
        total = q1("SELECT COUNT(*) FROM memory_entries")
        sup = q1("SELECT COUNT(*) FROM memory_entries WHERE superseded_by IS NOT NULL")
        exp = q1("SELECT COUNT(*) FROM memory_entries WHERE superseded_by IS NULL"
                 " AND valid_until IS NOT NULL AND valid_until <= ?", now)
        by_type = ", ".join(f"{r[0]}={r[1]}" for r in conn.execute(
            "SELECT memory_type, COUNT(*) FROM memory_entries GROUP BY 1 ORDER BY 1"))
        by_origin = ", ".join(f"{r[0]}={r[1]}" for r in conn.execute(
            "SELECT origin_class, COUNT(*) FROM memory_entries GROUP BY 1 ORDER BY 1"))
        add("INFO", "contagens", f"{total} registos ({total - sup - exp} ativos · {sup} suplantados ·"
            f" {exp} expirados) · tipos: {by_type or '—'} · origens: {by_origin or '—'} ·"
            f" entidades {q1('SELECT COUNT(*) FROM entity_nodes')} ·"
            f" arestas {q1('SELECT COUNT(*) FROM entity_edges')}")

        if freshness and skill:
            cfgp = os.path.join(skill, INGEST_CONFIG_NAME)
            if not os.path.isfile(cfgp):
                add("INFO", "frescura", "sem ingest.json — nada a comparar")
            else:
                try:
                    cfg = load_ingest_config(cfgp)
                    fr = freshness_report(conn, cfg, project_root_of(skill))
                    detail = (f"{len(fr['fresh'])} atuais · {len(fr['stale'])} alterados ·"
                              f" {len(fr['new'])} por ingerir · {len(fr['removed'])} removidos")
                    pend = fr["stale"] + fr["new"] + fr["removed"]
                    if pend:
                        detail += " (ex.: " + ", ".join(pend[:3]) + ")"
                    add("OK" if not pend else "WARN", "frescura (material × memória)", detail,
                        None if not pend else "corre `coala.py ingest` (idempotente)")
                except CoalaError as exc:
                    add("WARN", "frescura", exc.what, exc.solution)
        if skill:
            man_p = os.path.join(skill, MANIFEST_NAME)
            local_engine = os.path.join(skill, "scripts", "coala.py")
            if os.path.isfile(man_p) and os.path.isfile(local_engine):
                try:
                    with open(man_p, encoding="utf-8") as fh:
                        man = json.load(fh)
                    expected = (man.get("engine") or {}).get("sha256")
                except (OSError, ValueError):
                    man, expected = None, None
                if man is None:
                    add("WARN", "manifesto", f"{man_p} ilegível", "reinstala com o instalador")
                else:
                    cur = file_sha256(local_engine)
                    add("OK" if expected == cur else "WARN", "motor local",
                        f"v{engine_version_of(local_engine)} · sha256 {cur[:12]}…"
                        + ("" if expected == cur else " (difere do manifesto)"),
                        None if expected == cur else f"reinstala: `{INSTALL_HINT}`")
    finally:
        conn.close()
    if os.path.exists(LEGACY_GLOBAL_DB) and os.path.abspath(path) != os.path.abspath(LEGACY_GLOBAL_DB):
        add("WARN", "memória global legada", f"{LEGACY_GLOBAL_DB} existe (não é usada por este motor)",
            "arquiva-a — ver references/migrar.md da coala-agent-skill")
    return checks


# ------------------------------------------------------------- backup/import
def backup_db(path: str, out: str = None, label: str = "coala"):
    """Snapshot consistente (API de backup do SQLite) → ficheiro autónomo 0600. Devolve (out, check, n)."""
    if not os.path.isfile(path):
        raise CoalaError(f"a base {path} não existe", "nada a copiar — corre `init` primeiro")
    out = (os.path.abspath(os.path.expanduser(out)) if out
           else os.path.join(os.path.dirname(path), "backups", f"{label}-{stamp()}.sqlite"))
    if os.path.exists(out):
        raise CoalaError(f"o destino {out} já existe", "escolhe outro --out (backups nunca sobrescrevem)")
    os.makedirs(os.path.dirname(out), mode=0o700, exist_ok=True)
    src = sqlite3.connect(path)
    dst = sqlite3.connect(out)
    try:
        src.backup(dst)
        dst.execute("PRAGMA journal_mode=DELETE")   # ficheiro autónomo (sem -wal/-shm)
    finally:
        dst.close()
        src.close()
    os.chmod(out, 0o600)
    chk = sqlite3.connect(out)
    try:
        res = chk.execute("PRAGMA quick_check").fetchone()[0]
        n = chk.execute("SELECT COUNT(*) FROM memory_entries").fetchone()[0]
    finally:
        chk.close()
    return out, res, n


def parse_ids(spec: str) -> set:
    out = set()
    for part in (spec or "").split(","):
        part = part.strip()
        if not part:
            continue
        m = re.fullmatch(r"(\d+)\s*-\s*(\d+)", part)
        if m:
            a, b = int(m.group(1)), int(m.group(2))
            out.update(range(min(a, b), max(a, b) + 1))
        elif part.isdigit():
            out.add(int(part))
        else:
            raise UsageError(f"--ids inválido: {part!r}", "usa ids e intervalos, ex.: --ids 5-20,23")
    return out


def _chunks(seq, n=500):
    seq = list(seq)
    for i in range(0, len(seq), n):
        yield seq[i:i + n]


def import_entries(dest, backend, src_path: str, key_prefixes=None, source_prefixes=None,
                   tags=None, ids=None, all_rows=False, with_graph=False, graph_entities=None,
                   dry_run=False) -> dict:
    """
    Copia registos de outra base CoALA preservando tipo, conteúdo, origem, chave,
    recorded_at, validade, fonte, tags, proveniência e a cadeia de supersessão
    (fecho transitivo: versões anteriores/posteriores dos selecionados vêm juntas).
    Idempotente: um registo com o mesmo (tipo, conteúdo, recorded_at, chave) é "já presente".
    """
    src = open_ro(src_path)
    try:
        if "memory_entries" not in table_names(src):
            raise CoalaError(f"{src_path} não é uma base CoALA (sem memory_entries)",
                             "indica a base de origem correta em --from")
        conds, params = [], []
        for p in key_prefixes or []:
            conds.append("substr(COALESCE(supersession_key,''),1,?) = ?")
            params += [len(p), p]
        for p in source_prefixes or []:
            conds.append("substr(COALESCE(source,''),1,?) = ?")
            params += [len(p), p]
        for t in tags or []:
            conds.append("(',' || LOWER(COALESCE(tags,'')) || ',') LIKE ?")
            params.append(f"%,{t.strip().lower()},%")
        if all_rows:
            conds.append("1=1")
        sel = set()
        if conds:
            sel |= {r[0] for r in src.execute(
                "SELECT id FROM memory_entries WHERE " + " OR ".join(conds), params)}
        if ids:
            for chunk in _chunks(ids):
                q = ",".join("?" * len(chunk))
                sel |= {r[0] for r in src.execute(f"SELECT id FROM memory_entries WHERE id IN ({q})", chunk)}
        direct = len(sel)
        frontier = set(sel)
        while frontier:                                   # fecho da cadeia de supersessão
            found = set()
            for chunk in _chunks(frontier):
                q = ",".join("?" * len(chunk))
                found |= {r[0] for r in src.execute(
                    f"SELECT superseded_by FROM memory_entries WHERE id IN ({q})"
                    " AND superseded_by IS NOT NULL", chunk)}
                found |= {r[0] for r in src.execute(
                    f"SELECT id FROM memory_entries WHERE superseded_by IN ({q})", chunk)}
            frontier = found - sel
            sel |= frontier
        prov = {}
        if "provenance" in table_names(src):
            for chunk in _chunks(sel):
                q = ",".join("?" * len(chunk))
                for r in src.execute(f"SELECT entry_id, note FROM provenance WHERE entry_id IN ({q})", chunk):
                    prov[r[0]] = r[1]
        ts = now_iso()
        mapping, imported, present = {}, [], 0
        rows = []
        for chunk in _chunks(sorted(sel)):
            q = ",".join("?" * len(chunk))
            rows += src.execute(f"SELECT * FROM memory_entries WHERE id IN ({q}) ORDER BY id", chunk).fetchall()
        for r in rows:
            if r["supersession_key"] is not None:
                hit = dest.execute(
                    "SELECT id FROM memory_entries WHERE supersession_key=? AND recorded_at=?"
                    " AND memory_type=? AND content=? LIMIT 1",
                    (r["supersession_key"], r["recorded_at"], r["memory_type"], r["content"])).fetchone()
            else:
                hit = dest.execute(
                    "SELECT id FROM memory_entries WHERE supersession_key IS NULL AND recorded_at=?"
                    " AND memory_type=? AND content=? LIMIT 1",
                    (r["recorded_at"], r["memory_type"], r["content"])).fetchone()
            if hit is not None:
                mapping[r["id"]] = hit[0]
                present += 1
                continue
            if dry_run:
                imported.append(r["id"])
                continue
            cur = dest.execute(
                "INSERT INTO memory_entries(memory_type, content, origin_class, supersession_key,"
                " recorded_at, valid_from, valid_until, source, tags) VALUES (?,?,?,?,?,?,?,?,?)",
                (r["memory_type"], r["content"], r["origin_class"], r["supersession_key"],
                 r["recorded_at"], r["valid_from"], r["valid_until"], r["source"], r["tags"]))
            new_id = cur.lastrowid
            index_content(dest, backend, new_id, r["content"])
            note = prov.get(r["id"])
            dest.execute("INSERT OR REPLACE INTO provenance(entry_id, note) VALUES (?,?)",
                         (new_id, (note + " | " if note else "")
                          + f"Importado de {os.path.abspath(src_path)}#{r['id']} em {ts}"))
            mapping[r["id"]] = new_id
            imported.append(r["id"])
        relinked = conflicts = 0
        if not dry_run:
            for r in rows:
                sb = r["superseded_by"]
                if sb is not None and sb in mapping and r["id"] in mapping:
                    cur = dest.execute("UPDATE memory_entries SET superseded_by=? WHERE id=?"
                                       " AND superseded_by IS NULL", (mapping[sb], mapping[r["id"]]))
                    relinked += cur.rowcount
            keys = {r["supersession_key"] for r in rows if r["supersession_key"]}
            for k in sorted(keys):                         # invariante: ≤ 1 versão ativa por chave
                act = dest.execute("SELECT id FROM memory_entries WHERE supersession_key=? AND"
                                   " superseded_by IS NULL ORDER BY recorded_at, id", (k,)).fetchall()
                for old in act[:-1]:
                    if supersede_entry(dest, old[0], act[-1][0], ts):
                        conflicts += 1
        ent_new = edge_new = 0
        if with_graph and not dry_run and "entity_nodes" in table_names(src):
            wanted = {n.strip() for n in (graph_entities or []) if n.strip()}
            nodes = {r["id"]: (r["name"], r["kind"]) for r in src.execute("SELECT id, name, kind FROM entity_nodes")}
            keep = {i: v for i, v in nodes.items() if not wanted or v[0] in wanted}
            for name, kind in keep.values():
                if dest.execute("SELECT 1 FROM entity_nodes WHERE name=?", (name,)).fetchone() is None:
                    dest.execute("INSERT INTO entity_nodes(name, kind) VALUES (?,?)", (name, kind))
                    ent_new += 1
            for e in src.execute("SELECT src, dst, rel FROM entity_edges"):
                if e["src"] in keep and e["dst"] in keep:
                    a, b = ensure_entities(dest, [keep[e["src"]][0], keep[e["dst"]][0]])
                    edge_new += 1 if link_entities(dest, a, b, e["rel"]) else 0
        if not dry_run:
            dest.commit()
        return {"from": os.path.abspath(src_path), "selected": len(sel), "selected_direct": direct,
                "chain_added": len(sel) - direct, "imported": len(imported), "already_present": present,
                "relinked": relinked, "conflicts_resolved": conflicts,
                "entities_new": ent_new, "edges_new": edge_new, "dry_run": dry_run}
    finally:
        src.close()


# ----------------------------------------------------------------------- comandos
def cmd_init(args) -> int:
    path, how, skill = resolve_db(args.db)
    conn, path, backend = connect_path(path)
    conn.commit()
    wal = conn.execute("PRAGMA journal_mode").fetchone()[0]
    uv = conn.execute("PRAGMA user_version").fetchone()[0]
    emit(f"OK: esquema CoALA v{uv} pronto em {path} ({how})\n"
         f"  modo journal={wal} · backend vetorial={backend} · FTS5 disponível · motor v{ENGINE_VERSION}")
    conn.close()
    return 0


def cmd_where(args) -> int:
    path, how, skill = resolve_db(args.db)
    root = project_root_of(skill) if skill else None
    exists = os.path.isfile(path)
    payload = {"db": path, "resolved_by": how, "skill": skill, "project_root": root,
               "exists": exists, "engine": os.path.abspath(__file__), "engine_version": ENGINE_VERSION}
    if args.json:
        emit(json.dumps(payload, ensure_ascii=False))
    else:
        lines = [f"Base: {path}" + ("" if exists else " (ainda não criada — corre `init`)"),
                 f"  resolvida por: {how}"]
        if skill:
            lines.append(f"  skill local: {skill}")
            lines.append(f"  projeto: {root}")
        lines.append(f"  motor: {os.path.abspath(__file__)} (v{ENGINE_VERSION})")
        emit("\n".join(lines))
    return 0


def cmd_add(args) -> int:
    if not (args.content or "").strip():
        raise UsageError("--content vazio", "fornece o texto do conhecimento a guardar")
    conn, path, backend = connect(args.db)
    ts = now_iso()
    origin = args.origin
    if origin != "untrusted" and args.source:
        # conteúdo web marcado automaticamente como não-confiável
        if re.match(r"^https?://", args.source.strip(), re.I) and args.origin == "agent":
            origin = "untrusted"

    entry_id, superseded = insert_entry(conn, backend, args.type, args.content.strip(), origin,
                                        key=args.key, source=args.source, tags=args.tags,
                                        valid_from=args.valid_from, valid_until=args.valid_until)

    add_provenance(conn, entry_id,
                   f"Registado via CLI em {ts}"
                   + (f"; suplanta {', '.join('#%d' % i for i in superseded)}" if superseded else ""))

    entity_ids = []
    if args.entities:
        names = [n.strip() for n in re.split(r"[,;]", args.entities) if n.strip()]
        entity_ids = ensure_entities(conn, names)
        for a, b in zip(entity_ids, entity_ids[1:]):
            link_entities(conn, a, b, "co-ocorre")

    conn.commit()
    conn.close()
    payload = {"ok": True, "id": entry_id, "type": args.type, "origin": origin,
               "superseded": superseded, "entities": entity_ids,
               "supersession_key": args.key, "db": path}
    if args.json:
        emit(json.dumps(payload, ensure_ascii=False))
    else:
        msg = f"OK: registo #{entry_id} ({args.type}, origem:{origin}) gravado em {path}"
        if superseded:
            msg += f"\n  supersessão: suplantou {', '.join('#%d' % i for i in superseded)} (chave: {args.key})"
        if entity_ids:
            msg += f"\n  entidades ligadas: {len(entity_ids)}"
        emit(msg)
    return 0


def cmd_search(args) -> int:
    conn, path, backend = connect(args.db)
    tags = [t for t in (args.tags or "").split(",") if t.strip()]
    any_tags = [t for t in (getattr(args, "any_tags", None) or "").split(",") if t.strip()]
    where, params = build_filter(args.type, tags, args.include_superseded, args.include_expired,
                                 any_tags=any_tags)
    w_fts = args.w_fts if args.w_fts is not None else float(os.environ.get(W_FTS_ENV, "1.0"))
    w_vec = args.w_vec if args.w_vec is not None else float(os.environ.get(W_VEC_ENV, "1.0"))
    fused = hybrid_search(conn, args.query, where, params, limit=args.limit,
                          w_fts=w_fts, w_vec=w_vec)
    ids = [f["eid"] for f in fused]
    rows = {}
    if ids:
        qmarks = ",".join("?" * len(ids))
        for r in conn.execute(f"SELECT * FROM memory_entries WHERE id IN ({qmarks})", ids).fetchall():
            rows[r["id"]] = r

    if args.json:
        out = []
        for f in fused:
            r = rows[f["eid"]]
            out.append({
                "id": r["id"], "type": r["memory_type"], "origin": r["origin_class"],
                "content": redact(r["content"]), "source": r["source"], "tags": r["tags"],
                "valid_from": r["valid_from"], "valid_until": r["valid_until"],
                "superseded_by": r["superseded_by"], "recorded_at": r["recorded_at"],
                "score": {"rrf": round(f["rrf"], 6), "fts_rank": f["fts_rank"],
                          "vec_rank": f["vec_rank"], "fts_bm25": f["fts_score"],
                          "vec_cosine": f["vec_sim"]},
            })
        emit(json.dumps({"query": args.query, "backend": backend, "results": out},
                        ensure_ascii=False))
    else:
        if not fused:
            emit(f"Sem resultados para {args.query!r} (base: {path}).\n"
                 "  Dicas: termos diferentes, `--include-superseded`, ou `add` primeiro.")
        else:
            blocks = [f"Resultados para {args.query!r} — fusão RRF (k={RRF_K}, w_fts={w_fts},"
                      f" w_vec={w_vec}) · backend vetorial: {backend}"]
            for f in fused:
                r = rows[f["eid"]]
                extra = (f"score rrf={f['rrf']:.4f} · "
                         f"fts#{f['fts_rank'] if f['fts_rank'] is not None else '–'}")
                if f["vec_rank"] is not None and f["vec_sim"] is not None:
                    extra += f" · vec#{f['vec_rank']} (cos={f['vec_sim']:.3f})"
                blocks.append(entry_lines(r, extra))
            emit("\n\n".join(blocks))
    conn.close()
    return 0


def cmd_recall(args) -> int:
    conn, path, backend = connect(args.db)
    tags = [t for t in (args.tags or "").split(",") if t.strip()]
    any_tags = [t for t in (getattr(args, "any_tags", None) or "").split(",") if t.strip()]
    where, params = build_filter(args.type, tags, args.include_superseded, args.include_expired,
                                 any_tags=any_tags)
    budget = max(1, args.budget)

    if args.query:
        fused = hybrid_search(conn, args.query, where, params, limit=max(args.top * 4, 40),
                              w_fts=1.0, w_vec=1.0)
        scores = {f["eid"]: f["rrf"] for f in fused}
        order = [f["eid"] for f in fused]
    else:
        rows = conn.execute(
            "SELECT e.id AS id FROM memory_entries e WHERE 1=1" + where +
            " ORDER BY e.recorded_at DESC LIMIT ?", list(params) + [max(args.top * 6, 60)]).fetchall()
        order = [r["id"] for r in rows]
        scores = {}

    if not order:
        emit("(working memory vazia — nada recuperado com estes filtros)")
        conn.close()
        return 0

    qmarks = ",".join("?" * len(order))
    rows = {r["id"]: r for r in conn.execute(
        f"SELECT * FROM memory_entries WHERE id IN ({qmarks})", order).fetchall()}

    chosen = budgeted_selection(order, rows, scores, budget, args.top, bool(args.query))
    used = sum(est_tokens(r["content"]) + 40 for _, _, _, r in chosen)

    if args.json:
        payload = {
            "budget_tokens": budget, "used_tokens": used, "count": len(chosen),
            "items": [{"id": r["id"], "type": r["memory_type"], "origin": r["origin_class"],
                       "content": redact(r["content"]), "tags": r["tags"], "source": r["source"],
                       "recorded_at": r["recorded_at"], "valid_until": r["valid_until"],
                       "score": {"combined": round(c, 4), "relevance": round(rel, 4),
                                 "recency": round(rec, 4)}}
                      for c, rec, rel, r in chosen],
        }
        emit(json.dumps(payload, ensure_ascii=False))
    else:
        blocks = [f"# Working Memory (coala recall) — {used}/{budget} tokens estimados,"
                  f" {len(chosen)} excertos · {path}"]
        for c, rec, rel, r in chosen:
            blocks.append(entry_lines(r, f"score={c:.3f} (rel={rel:.2f} · rec={rec:.2f})"))
        emit("\n\n".join(blocks))
    conn.close()
    return 0


def cmd_graph(args) -> int:
    conn, path, backend = connect(args.db)
    node = conn.execute("SELECT id, name, kind FROM entity_nodes WHERE LOWER(name)=LOWER(?)",
                        (args.entity,)).fetchone()
    if node is None:
        raise CoalaError(f"a entidade {args.entity!r} não existe em {path}",
                         "cria-a com `add --entities \"nome,...\"` ou `link <src> <rel> <dst>`")
    depth = max(1, args.depth)
    sql = """
    WITH RECURSIVE reach(id, name, kind, depth, path, rel_from) AS (
        SELECT id, name, kind, 0, ',' || id || ',', NULL
        FROM entity_nodes WHERE id = :root
        UNION ALL
        SELECT n.id, n.name, n.kind, r.depth + 1, r.path || n.id || ',', e.rel
        FROM reach r
        JOIN (
            SELECT src AS a, dst AS b, rel FROM entity_edges
            UNION
            SELECT dst AS a, src AS b, rel FROM entity_edges
        ) e ON e.a = r.id
        JOIN entity_nodes n ON n.id = e.b
        WHERE r.depth < :depth
          AND instr(r.path, ',' || n.id || ',') = 0
    )
    SELECT id, name, kind, depth, rel_from FROM reach ORDER BY depth, name
    """
    rows = conn.execute(sql, {"root": node["id"], "depth": depth}).fetchall()
    if args.json:
        emit(json.dumps({"entity": args.entity, "depth": depth,
                         "nodes": [{"name": r["name"], "kind": r["kind"], "depth": r["depth"],
                                    "via_rel": r["rel_from"]} for r in rows]},
                        ensure_ascii=False))
    else:
        lines = [f"Grafo a partir de {node['name']!r} (profundidade ≤ {depth}, travessia CTE recursiva):"]
        for r in rows:
            pad = "  " * r["depth"]
            via = f"  ← rel: {r['rel_from']}" if r["rel_from"] else "  (raiz)"
            lines.append(f"{pad}{'└─ ' if r['depth'] else ''}{r['name']}"
                         f" [{r['kind'] or 'entidade'}] d={r['depth']}{via}")
        emit("\n".join(lines))
    conn.close()
    return 0


def cmd_link(args) -> int:
    conn, path, backend = connect(args.db)
    ids = ensure_entities(conn, [args.src, args.dst])
    created = link_entities(conn, ids[0], ids[1], args.rel)
    conn.commit()
    conn.close()
    if args.json:
        emit(json.dumps({"ok": True, "src": args.src, "rel": args.rel, "dst": args.dst,
                         "created": created}, ensure_ascii=False))
    else:
        estado = "criada" if created else "já existia"
        emit(f"OK: aresta {args.src} --{args.rel}--> {args.dst} ({estado})")
    return 0


def cmd_supersede(args) -> int:
    if not (args.content or "").strip():
        raise UsageError("--content vazio", "fornece o novo conteúdo do facto")
    conn, path, backend = connect(args.db)
    old = conn.execute("SELECT * FROM memory_entries WHERE id=?", (args.id,)).fetchone()
    if old is None:
        raise CoalaError(f"o registo #{args.id} não existe em {path}",
                         "confirma o id com `search` ou `stats`")
    if old["superseded_by"] is not None:
        raise CoalaError(
            f"o registo #{args.id} já foi suplantado por #{old['superseded_by']}",
            "suplanta a versão ativa ou usa `search --include-superseded` para ver o histórico")
    ts = now_iso()
    new_id, _auto = insert_entry(conn, backend, old["memory_type"], args.content.strip(),
                                 args.origin or old["origin_class"], key=old["supersession_key"],
                                 source=args.source or old["source"], tags=args.tags or old["tags"],
                                 valid_from=args.valid_from or ts, valid_until=args.valid_until)
    supersede_entry(conn, old["id"], new_id, ts)
    add_provenance(conn, new_id, f"Substituição explícita de #{old['id']} via `supersede` em {ts}")
    conn.commit()
    conn.close()
    if args.json:
        emit(json.dumps({"ok": True, "old_id": old["id"], "new_id": new_id,
                         "supersession_key": old["supersession_key"]}, ensure_ascii=False))
    else:
        emit(f"OK: #{old['id']} suplantado por #{new_id} ({old['memory_type']}).\n"
             f"  o antigo ficou com superseded_by=#{new_id} e valid_until={ts}")
    return 0


def cmd_stats(args) -> int:
    conn, path, backend = connect(args.db)
    now = now_iso()
    total = conn.execute("SELECT COUNT(*) AS n FROM memory_entries").fetchone()["n"]
    by_type = {r["memory_type"]: r["n"] for r in conn.execute(
        "SELECT memory_type, COUNT(*) AS n FROM memory_entries GROUP BY memory_type").fetchall()}
    by_origin = {r["origin_class"]: r["n"] for r in conn.execute(
        "SELECT origin_class, COUNT(*) AS n FROM memory_entries GROUP BY origin_class").fetchall()}
    superseded = conn.execute(
        "SELECT COUNT(*) AS n FROM memory_entries WHERE superseded_by IS NOT NULL").fetchone()["n"]
    expired = conn.execute(
        "SELECT COUNT(*) AS n FROM memory_entries WHERE superseded_by IS NULL"
        " AND valid_until IS NOT NULL AND valid_until <= ?", (now,)).fetchone()["n"]
    active = total - superseded - expired
    chunks_n = conn.execute("SELECT COUNT(*) AS n FROM chunks").fetchone()["n"]
    ents = conn.execute("SELECT COUNT(*) AS n FROM entity_nodes").fetchone()["n"]
    edges = conn.execute("SELECT COUNT(*) AS n FROM entity_edges").fetchone()["n"]
    sources = conn.execute("SELECT COUNT(*) AS n FROM ingest_sources WHERE segments > 0").fetchone()["n"]
    schema_v = conn.execute("PRAGMA user_version").fetchone()[0]
    size = 0
    for suffix in ("", "-wal", "-shm"):
        try:
            size += os.path.getsize(path + suffix)
        except OSError:
            pass
    conn.close()
    data = {
        "db": path, "size_bytes": size, "backend_vector": backend,
        "schema_version": schema_v, "engine_version": ENGINE_VERSION,
        "entries": {"total": total, "active": active, "superseded": superseded,
                    "expired": expired},
        "by_type": by_type, "by_origin": by_origin,
        "chunks": chunks_n, "entities": ents, "edges": edges, "ingested_files": sources,
    }
    if args.json:
        emit(json.dumps(data, ensure_ascii=False))
    else:
        human = f"{size / 1024:.1f} KB" if size < 1024 * 1024 else f"{size / (1024 * 1024):.2f} MB"
        lines = [
            f"Base de dados: {path} ({human}, WAL ativo)",
            f"Esquema v{schema_v} · motor v{ENGINE_VERSION} · backend vetorial: {backend}",
            f"Registos: {total} total · {active} ativos · {superseded} superados · {expired} expirados",
            "  por tipo:    " + ("  ".join(f"{k}={v}" for k, v in sorted(by_type.items())) or "—"),
            "  por origem:  " + ("  ".join(f"{k}={v}" for k, v in sorted(by_origin.items())) or "—"),
            f"Chunks indexados: {chunks_n} · entidades: {ents} · arestas: {edges}"
            f" · ficheiros ingeridos: {sources}",
        ]
        emit("\n".join(lines))
    return 0


def _write_text_atomic(path: str, text: str, mode: int = 0o644) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(text)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def cmd_export(args) -> int:
    conn, path, backend = connect(args.db)
    entries = conn.execute("SELECT * FROM memory_entries ORDER BY id").fetchall()
    prov = {r["entry_id"]: r["note"] for r in
            conn.execute("SELECT * FROM provenance").fetchall()}
    edges = conn.execute(
        "SELECT s.name AS src, e.rel AS rel, d.name AS dst"
        " FROM entity_edges e JOIN entity_nodes s ON s.id=e.src"
        " JOIN entity_nodes d ON d.id=e.dst").fetchall()

    if args.format == "jsonl":
        # dump CANÓNICO: determinístico (sem carimbo de geração), um objeto por linha — p/ diff git
        lines = [json.dumps({
            "id": r["id"], "type": r["memory_type"], "origin": r["origin_class"],
            "key": r["supersession_key"], "superseded_by": r["superseded_by"],
            "recorded_at": r["recorded_at"], "valid_from": r["valid_from"],
            "valid_until": r["valid_until"], "source": r["source"], "tags": r["tags"],
            "content": redact(r["content"]), "provenance": redact(prov.get(r["id"]) or ""),
        }, ensure_ascii=False, sort_keys=True) for r in entries]
        lines += [json.dumps({"edge": [e["src"], e["rel"], e["dst"]]}, ensure_ascii=False)
                  for e in sorted(edges, key=lambda e: (e["src"], e["rel"], e["dst"]))]
        text = "\n".join(lines) + ("\n" if lines else "")
    elif args.format == "json":
        payload = {
            "db": path, "generated_at": now_iso(), "backend_vector": backend,
            "entries": [{
                "id": r["id"], "type": r["memory_type"], "origin": r["origin_class"],
                "content": redact(r["content"]), "supersession_key": r["supersession_key"],
                "superseded_by": r["superseded_by"], "recorded_at": r["recorded_at"],
                "valid_from": r["valid_from"], "valid_until": r["valid_until"],
                "source": r["source"], "tags": r["tags"],
                "provenance": redact(prov.get(r["id"]) or ""),
            } for r in entries],
            "edges": [dict(e) for e in edges],
        }
        text = json.dumps(payload, ensure_ascii=False)
    else:
        groups = {"episodic": "Memória Episódica", "semantic": "Memória Semântica",
                  "procedural": "Memória Procedimental"}
        lines = [f"# Exportação CoALA — {path} — {now_iso()}",
                 "> Valores com aspeto de segredo aparecem mascarados.", ""]
        for mtype, title in groups.items():
            rows = [r for r in entries if r["memory_type"] == mtype]
            lines.append(f"## {title} ({len(rows)})")
            for r in rows:
                lines.append(f"### #{r['id']} · {r['origin_class']} · {fmt_validity(r)}"
                             f" · registado {r['recorded_at']}")
                if r["source"]:
                    lines.append(f"- fonte: {r['source']}")
                if r["tags"]:
                    lines.append(f"- tags: {r['tags']}")
                if r["supersession_key"]:
                    sup = f"- chave de supersessão: `{r['supersession_key']}`"
                    sup += (f" · suplantado por #{r['superseded_by']}" if r["superseded_by"]
                            else " · versão ativa")
                    lines.append(sup)
                if r["id"] in prov:
                    lines.append(f"- proveniência: {redact(prov[r['id']])}")
                lines.append("")
                lines.append(redact(r["content"].strip()))
                lines.append("")
            lines.append("")
        if edges:
            lines.append("## Grafo de entidades")
            for e in edges:
                lines.append(f"- {e['src']} --{e['rel']}--> {e['dst']}")
        text = "\n".join(lines)
    conn.close()
    if args.out:
        out = os.path.abspath(os.path.expanduser(args.out))
        _write_text_atomic(out, redact(text))
        emit(f"OK: {len(entries)} registos exportados ({args.format}) para {out}")
    else:
        emit(text)
    return 0


def cmd_doctor(args) -> int:
    path, how, skill = resolve_db(args.db)
    checks = doctor_report(path, how, skill, deep=args.deep, freshness=not args.no_freshness)
    fails = sum(1 for c in checks if c["level"] == "FAIL")
    warns = sum(1 for c in checks if c["level"] == "WARN")
    if args.json:
        emit(json.dumps({"db": path, "resolved_by": how, "skill": skill, "ok": fails == 0,
                         "fails": fails, "warns": warns, "checks": checks}, ensure_ascii=False))
    else:
        lines = [f"coala doctor — {path}"]
        for c in checks:
            line = f"  {c['level']:<5} {c['check']}: {c['detail']}"
            if c["solution"] and c["level"] in ("FAIL", "WARN"):
                line += f"\n        → {c['solution']}"
            lines.append(line)
        lines.append(f"RESULTADO: {'SAUDÁVEL' if fails == 0 else 'COM FALHAS'} · {fails} falha(s) · {warns} aviso(s)")
        emit("\n".join(lines))
    if fails:
        raise CoalaError(f"o doctor encontrou {fails} falha(s)", "segue a Solução de cada linha FAIL acima")
    return 0


def cmd_backup(args) -> int:
    path, how, skill = resolve_db(args.db)
    out, res, n = backup_db(path, args.out)
    if args.json:
        emit(json.dumps({"ok": res == "ok", "backup": out, "entries": n, "check": res}, ensure_ascii=False))
    else:
        emit(f"OK: backup consistente em {out} ({n} registos · quick_check={res} · 0600)")
    if res != "ok":
        raise CoalaError(f"o backup {out} não passou o quick_check ({res})", "repete o backup e corre `doctor --deep`")
    return 0


def cmd_restore(args) -> int:
    path, how, skill = resolve_db(args.db)
    src_path = os.path.abspath(os.path.expanduser(args.from_db))
    if os.path.abspath(src_path) == os.path.abspath(path):
        raise UsageError("--from aponta para a própria base", "indica um ficheiro de backup diferente")
    src = open_ro(src_path)
    try:
        res = src.execute("PRAGMA quick_check").fetchone()[0]
        if "memory_entries" not in table_names(src) or res != "ok":
            raise CoalaError(f"{src_path} não é uma base CoALA íntegra (quick_check={res})",
                             "escolhe outro backup (lista em memory/backups/)")
        n_src = src.execute("SELECT COUNT(*) FROM memory_entries").fetchone()[0]
    finally:
        src.close()
    if not args.yes:
        raise UsageError(f"restore substitui {path} pelo conteúdo de {src_path} ({n_src} registos)",
                         "repete com --yes (antes é feito backup automático da base atual)")
    pre = None
    if os.path.isfile(path):
        pre, _, _ = backup_db(path, label="coala-pre-restore")
    os.makedirs(os.path.dirname(path), mode=0o700, exist_ok=True)
    src = sqlite3.connect(ro_uri(src_path), uri=True)
    dst = sqlite3.connect(path)
    try:
        src.backup(dst)
        dst.execute("PRAGMA journal_mode=WAL")
    finally:
        dst.close()
        src.close()
    conn, path, backend = connect_path(path)
    n = conn.execute("SELECT COUNT(*) FROM memory_entries").fetchone()[0]
    conn.close()
    if args.json:
        emit(json.dumps({"ok": True, "db": path, "from": src_path, "entries": n,
                         "pre_restore_backup": pre}, ensure_ascii=False))
    else:
        emit(f"OK: {path} restaurada a partir de {src_path} ({n} registos)"
             + (f"\n  a base anterior ficou em {pre}" if pre else ""))
    return 0


def cmd_import(args) -> int:
    key_prefixes = args.key_prefix or []
    source_prefixes = args.source_prefix or []
    tags = [t for t in (args.tags or "").split(",") if t.strip()]
    ids = parse_ids(args.ids) if args.ids else set()
    if not (key_prefixes or source_prefixes or tags or ids or args.all):
        raise UsageError("import sem seletor", "usa --key-prefix, --source-prefix, --tags, --ids ou --all")
    path, how, skill = resolve_db(args.db)
    src_path = os.path.abspath(os.path.expanduser(args.from_db))
    if src_path == os.path.abspath(path):
        raise UsageError("--from é a própria base de destino", "indica a base de origem")
    if args.dry_run:
        if os.path.isfile(path):
            dest, backend = open_ro(path), None
        else:
            dest, backend = sqlite3.connect(":memory:"), None
            dest.row_factory = sqlite3.Row
            init_schema(dest)
    else:
        dest, path, backend = connect_path(path)
    try:
        res = import_entries(dest, backend, src_path, key_prefixes, source_prefixes, tags, ids,
                             args.all, args.with_graph,
                             [n for n in (args.graph_entities or "").split(",") if n.strip()],
                             args.dry_run)
    finally:
        dest.close()
    res["db"] = path
    if args.json:
        emit(json.dumps(res, ensure_ascii=False))
    else:
        emit(f"{'DRY-RUN: ' if args.dry_run else 'OK: '}import de {res['from']} → {path}\n"
             f"  selecionados={res['selected']} (diretos={res['selected_direct']} + cadeia={res['chain_added']})"
             f" · importados={res['imported']} · já presentes={res['already_present']}\n"
             f"  cadeias religadas={res['relinked']} · conflitos de chave resolvidos={res['conflicts_resolved']}"
             f" · entidades novas={res['entities_new']} · arestas novas={res['edges_new']}")
    return 0


def cmd_ingest(args) -> int:
    path, how, skill = resolve_db(args.db)
    if args.config:
        cfg_path = os.path.abspath(os.path.expanduser(args.config))
    elif skill:
        cfg_path = os.path.join(skill, INGEST_CONFIG_NAME)
    else:
        cfg_path = None
    if not cfg_path or not os.path.isfile(cfg_path):
        raise CoalaError(f"sem configuração de ingestão ({cfg_path or 'skill local desconhecida'})",
                         "cria ingest.json na skill local (o instalador gera um predefinido) ou passa --config")
    cfg = load_ingest_config(cfg_path)
    if args.root:
        root = os.path.abspath(os.path.expanduser(args.root))
    elif skill:
        root = project_root_of(skill)
    elif os.path.basename(os.path.dirname(cfg_path)).endswith(SKILL_SUFFIX):
        root = project_root_of(os.path.dirname(cfg_path))
    else:
        root = os.getcwd()
    only = [s.strip() for s in args.only.split(",") if s.strip()] if args.only else None
    if args.dry_run:
        if os.path.isfile(path):
            conn, backend = open_ro(path), None
        else:
            conn, backend = sqlite3.connect(":memory:"), None
            conn.row_factory = sqlite3.Row
            init_schema(conn)
    else:
        conn, path, backend = connect_path(path)
    try:
        rep = run_ingest(conn, backend, cfg, root, only=only, pdf_pages=args.pdf_pages,
                         dry_run=args.dry_run, verbose=args.verbose)
    finally:
        conn.close()
    rep["db"] = path
    rep["config"] = cfg_path
    if args.json:
        emit(json.dumps(rep, ensure_ascii=False))
    else:
        tag = "  (dry-run)" if args.dry_run else ""
        lines = [f"Ingestão de {root} → {path}{tag}", f"  config: {cfg_path}"]
        for name, s in rep["rules"].items():
            lines.append(f"  {name:22s} ficheiros={s['files']:4d} segmentos={s['segments']:5d}"
                         f" novos={s['new']:5d} iguais={s['same']:5d} atualizados={s['updated']:4d}"
                         f" expirados={s['expired']:4d}" + (f" ignorados={s['skipped']}" if s["skipped"] else ""))
        lines += rep["details"]
        for r in rep["removed"]:
            lines.append(f"  removido: {r['path']} ({r['expired']} registos expirados)")
        if not args.dry_run:
            lines.append(f"  grafo: entidades novas={rep['graph']['entities_new']}"
                         f" arestas novas={rep['graph']['edges_new']}")
        t = rep["totals"]
        lines.append(f"TOTAL novos={t['new']} iguais={t['same']} atualizados={t['updated']}"
                     f" expirados={t['expired']}" + tag
                     + ("  → NO-OP (nada mudou)" if not args.dry_run and t['new'] + t['updated'] + t['expired'] == 0 else ""))
        for w in rep["warnings"]:
            lines.append(f"  aviso: {w}")
        emit("\n".join(lines))
    return 0


# --------------------------------------------------------------------- selftest
def _tiny_pdf(text: str) -> bytes:
    """PDF mínimo válido (1 página, Helvetica) para testar o modo `pdf` sem dependências."""
    objs = [b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R"
            b" /Resources << /Font << /F1 5 0 R >> >> >>"]
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode("latin-1")
    objs.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    objs.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    out, offsets = b"%PDF-1.4\n", []
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + o + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    out += b"".join(b"%010d 00000 n \n" % off for off in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return out


def run_selftest() -> int:
    tmp = tempfile.mkdtemp(prefix="coala-selftest-")
    fake_db = os.path.join(tmp, "coala.sqlite")
    real_env = os.environ.get(DB_ENV)
    os.environ[DB_ENV] = fake_db
    results = []

    def check(name: str, cond: bool, detail: str = ""):
        results.append((name, bool(cond), detail))
        estado = "PASS" if cond else "FAIL"
        print(f"  [{estado}] {name}" + (f" — {detail}" if detail and not cond else ""))

    class _Args:
        pass

    def run_cmd(func, **kw):
        a = _Args()
        a.db, a.json = kw.pop("db", fake_db), kw.pop("json", False)
        for k, v in kw.items():
            setattr(a, k, v)
        buf = io.StringIO()
        old = sys.stdout
        sys.stdout = buf
        try:
            code = func(a)
        finally:
            sys.stdout = old
        return code, buf.getvalue()

    print(f"— coala selftest v{ENGINE_VERSION} (DB temporário: {fake_db}; nenhuma base real é tocada)")
    try:
        conn, path, backend = connect(fake_db)

        # 1. init idempotente + esquema
        tables = {r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type IN ('table','view')").fetchall()}
        needed = {"memory_entries", "entity_nodes", "entity_edges", "chunks",
                  "chunks_fts", "provenance"}
        check("01 init cria o esquema completo", needed <= tables, f"faltam: {needed - tables}")
        init_schema(conn)  # segunda vez: idempotente
        check("02 init é idempotente", True)

        # 3. inserção episódica
        ep_id, _ = insert_entry(conn, backend, "episodic",
                                "2026-09-25: deploy do worker de cache concluído sem erros.",
                                "agent", tags="deploy,cache", source="sessao-42")
        row = conn.execute("SELECT * FROM memory_entries WHERE id=?", (ep_id,)).fetchone()
        check("03 add episódico insere registo", row is not None and row["memory_type"] == "episodic")

        # 4. semântica com proveniência
        s1, _ = insert_entry(conn, backend, "semantic", "A API de pagamentos usa a porta 8080.",
                             "owner", key="api-porta", tags="api", source="decisao-reuniao")
        check("04 add semântico regista proveniência",
              conn.execute("SELECT 1 FROM provenance WHERE entry_id=?", (s1,)).fetchone() is not None)

        # 5. supersessão por chave
        s2, sup_ids = insert_entry(conn, backend, "semantic",
                                   "A API de pagamentos passou a usar a porta 8081.",
                                   "owner", key="api-porta", tags="api")
        old = conn.execute("SELECT * FROM memory_entries WHERE id=?", (s1,)).fetchone()
        check("05 supersessão por chave marca o anterior",
              old["superseded_by"] == s2 and old["valid_until"] is not None and s1 in sup_ids)
        check("06 proveniência da supersessão registada",
              "Suplantado" in (conn.execute("SELECT note FROM provenance WHERE entry_id=?",
                                            (s1,)).fetchone() or {"note": ""})["note"])

        # 7. supersede explícito (caminho do comando `supersede`)
        pr_id, _ = insert_entry(conn, backend, "procedural",
                                "Deploy: `wrangler deploy --env prod` a partir de /srv/api.",
                                "agent", tags="deploy,cloudflare")
        pr2_id, _ = insert_entry(conn, backend, "procedural",
                                 "Deploy: `wrangler deploy --env prod` (v2).",
                                 "agent", tags="deploy,cloudflare", source="revisao")
        fez = supersede_entry(conn, pr_id, pr2_id, now_iso())
        old_pr = conn.execute("SELECT * FROM memory_entries WHERE id=?", (pr_id,)).fetchone()
        check("07 supersede explícito substitui o facto",
              fez and old_pr["superseded_by"] == pr2_id)

        # 8. embeddings determinísticos e normalizados
        v1 = embed_text("memória persistente do agente")
        v2 = embed_text("memória persistente do agente")
        norm = sum(x * x for x in v1) ** 0.5
        check("08 embedding determinístico e normalizado",
              v1 == v2 and abs(norm - 1.0) < 1e-6 and len(v1) == EMBED_DIMS,
              f"norm={norm:.6f} dims={len(v1)}")

        # 9. busca vetorial isola o ranking (sem depender do FTS)
        va = embed_text("a api de pagamentos usa a porta")
        sa = cosine(va, embed_text("A API de pagamentos usa a porta 8080."))
        sb = cosine(va, embed_text("deploy do worker de cache"))
        check("09 busca vetorial ordena por semelhança de cosseno", sa > sb > 0,
              f"cos(alvo)={sa:.3f} cos(ruído)={sb:.3f}")
        vres = vector_search(conn, "api pagamentos porta", "", [], limit=5)
        check("10 vector_search devolve pares (eid, sim)",
              len(vres) >= 2 and all(0.0 <= s <= 1.0 for _, s in vres))

        # 11. busca FTS (léxico)
        fres = fts_search(conn, "porta 8081", "", [], limit=5)
        check("11 busca FTS5 encontra o facto ativo por termo",
              any(eid == s2 for eid, _ in fres), f"resultados: {[e for e, _ in fres]}")

        # 12. fusão RRF via SQL/janela
        fused = hybrid_search(conn, "api pagamentos porta 8081", "", [], limit=5)
        check("12 RRF funde FTS+vetor e ranqueia",
              len(fused) >= 1 and fused[0]["eid"] == s2 and fused[0]["rrf"] > 0,
              f"ordem: {[f['eid'] for f in fused]}")

        # 13. canal vetorial isolado (w_fts=0: só o cosseno decide)
        vec_only = hybrid_search(conn, "worker cache", "", [], limit=5, w_fts=0.0, w_vec=1.0)
        vec_order = [eid for eid, _ in vector_search(conn, "worker cache", "", [], limit=5)]
        check("13 canal vetorial decide sozinho quando w_fts=0",
              [f["eid"] for f in vec_only] == vec_order and ep_id in vec_order,
              f"rrf={[f['eid'] for f in vec_only]} vec={vec_order}")

        # 14. orçamento do recall (função real de seleção)
        long_ids = []
        for i in range(6):
            eid, _ = insert_entry(conn, backend, "episodic",
                                  f"nota de teste para o orçamento nº{i} " * 8, "system")
            long_ids.append(eid)
        qmarks = ",".join("?" * len(long_ids))
        lrows = {r["id"]: r for r in conn.execute(
            f"SELECT * FROM memory_entries WHERE id IN ({qmarks})", long_ids).fetchall()}
        chosen = budgeted_selection(long_ids, lrows, {}, budget=200, top=99, has_query=False)
        used = sum(est_tokens(r["content"]) + 40 for _, _, _, r in chosen)
        check("14 orçamento do recall respeita o limite de tokens",
              used <= 200 and 0 < len(chosen) < 6, f"used={used} escolhidos={len(chosen)}")

        # 15. redação de segredos
        secret_id, _ = insert_entry(conn, backend, "procedural",
                                    "Chave Stripe: sk-teste1234567890abcd; webhook whsec_abcdef123456;"
                                    " auth cfut_zzzzzzzzzzzz", "untrusted")
        row = conn.execute("SELECT content FROM memory_entries WHERE id=?", (secret_id,)).fetchone()
        masked = redact(row["content"])
        leak_free = all(tok not in masked for tok in
                        ("sk-teste1234567890abcd", "whsec_abcdef123456", "cfut_zzzzzzzzzzzz"))
        check("15 redação mascara segredos (sk-/whsec_/cfut_)",
              leak_free and masked.count("[REDACTADO]") == 3, masked[:80])

        # 16. redação aplicada na SAÍDA real dos comandos (export md/json/jsonl + recall)
        conn.commit()  # o export/recall abrem outra ligação: os dados têm de estar gravados
        saida = run_cmd(cmd_export, format="md", out=None)[1]
        saida += run_cmd(cmd_export, format="json", out=None)[1]
        saida += run_cmd(cmd_export, format="jsonl", out=None)[1]
        saida += run_cmd(cmd_recall, query="chave stripe webhook", type=None, tags=None, budget=2000,
                         top=20, include_superseded=True, include_expired=True)[1]
        secretos = ("sk-teste1234567890abcd", "whsec_abcdef123456", "cfut_zzzzzzzzzzzz")
        check("16 export(md/json/jsonl)+recall nunca imprimem segredos",
              all(s not in saida for s in secretos) and "[REDACTADO]" in saida,
              f"vazamento: {[s for s in secretos if s in saida]}")

        # 17. esquema v2: meta + ingest_sources + user_version
        uv = conn.execute("PRAGMA user_version").fetchone()[0]
        t2 = table_names(conn)
        check("17 esquema v2 (coala_meta, ingest_sources, user_version)",
              uv == SCHEMA_VERSION and {"coala_meta", "ingest_sources"} <= t2, f"uv={uv}")
        created = conn.execute("SELECT value FROM coala_meta WHERE key='created_at'").fetchone()[0]
        init_schema(conn)
        check("18 migração de esquema é idempotente (meta estável)",
              conn.execute("SELECT value FROM coala_meta WHERE key='created_at'").fetchone()[0] == created)

        # 19–22. resolução da base LOCAL (sem memória global)
        proj = os.path.join(tmp, "proj")
        skill = os.path.join(proj, ".agents", "demo" + SKILL_SUFFIX)
        os.makedirs(os.path.join(skill, "scripts"))
        os.makedirs(os.path.join(proj, "src", "deep"))
        with open(os.path.join(skill, MANIFEST_NAME), "w", encoding="utf-8") as fh:
            json.dump({"skill": os.path.basename(skill)}, fh)
        p1, h1, _ = resolve_db("/x/y.sqlite", env={DB_ENV: "/z.sqlite"})
        p2, h2, _ = resolve_db(None, env={DB_ENV: "/z.sqlite"})
        check("19 precedência --db > COALA_DB", p1 == "/x/y.sqlite" and p2 == "/z.sqlite" and "COALA_DB" in h2)
        p3, h3, sk3 = resolve_db(None, env={}, engine_file=os.path.join(skill, "scripts", "coala.py"))
        check("20 motor vendorizado usa a memória da sua skill",
              p3 == os.path.join(skill, "memory", "coala.sqlite") and sk3 == skill, p3)
        p4, h4, sk4 = resolve_db(None, cwd=os.path.join(proj, "src", "deep"), env={},
                                 engine_file=os.path.join(tmp, "coala.py"))
        check("21 descoberta sobe a partir do diretório atual", sk4 == skill and "descoberta" in h4, p4)
        try:
            resolve_db(None, cwd=tmp, env={}, engine_file=os.path.join(tmp, "coala.py"))
            sem_global = False
        except DependencyError as exc:
            sem_global = "Solução" in exc.render() and exc.exit_code == 3
        check("22 sem instalação → erro exit 3 (nunca base global)", sem_global)
        other = os.path.join(proj, ".agents", "outro" + SKILL_SUFFIX)
        os.makedirs(other)
        with open(os.path.join(other, MANIFEST_NAME), "w", encoding="utf-8") as fh:
            fh.write("{}")
        try:
            find_project_skill(proj)
            ambig = False
        except UsageError:
            ambig = True
        check("23 duas memórias no mesmo .agents → erro de ambiguidade", ambig)
        shutil.rmtree(other)

        # 24–25. motor vendorizado real (subprocesso, sem COALA_DB)
        vend = os.path.join(skill, "scripts", "coala.py")
        shutil.copy2(os.path.abspath(__file__), vend)
        env2 = {k: v for k, v in os.environ.items() if k != DB_ENV}
        out = subprocess.run([sys.executable, vend, "--json", "where"], capture_output=True,
                             text=True, env=env2, cwd=tmp, timeout=60)
        w = json.loads(out.stdout or "{}")
        check("24 `where` do motor vendorizado aponta para memory/ da skill",
              out.returncode == 0 and w.get("db") == os.path.join(skill, "memory", "coala.sqlite"),
              out.stderr[-200:])
        plain = os.path.join(tmp, "plain")
        os.makedirs(plain)
        shutil.copy2(os.path.abspath(__file__), os.path.join(plain, "coala.py"))
        out = subprocess.run([sys.executable, os.path.join(plain, "coala.py"), "stats"],
                             capture_output=True, text=True, env=env2, cwd=plain, timeout=60)
        check("25 CLI sem memória local → exit 3 com Erro/Solução",
              out.returncode == 3 and "Erro:" in out.stderr and "Solução:" in out.stderr,
              f"rc={out.returncode} {out.stderr[-160:]}")

        # 26–27. backup/restore
        conn.commit()
        bk, res_bk, n_bk = backup_db(fake_db)
        n_now = conn.execute("SELECT COUNT(*) FROM memory_entries").fetchone()[0]
        check("26 backup consistente (0600, quick_check ok, mesma contagem)",
              res_bk == "ok" and n_bk == n_now and _mode(bk) == 0o600, f"{res_bk} {n_bk}/{n_now}")
        insert_entry(conn, backend, "episodic", "registo depois do backup", "agent")
        conn.commit()
        try:
            run_cmd(cmd_restore, from_db=bk, yes=False)
            guarded = False
        except UsageError:
            guarded = True
        run_cmd(cmd_restore, from_db=bk, yes=True)
        conn.close()
        conn, path, backend = connect(fake_db)
        n_after = conn.execute("SELECT COUNT(*) FROM memory_entries").fetchone()[0]
        pre = [f for f in os.listdir(os.path.dirname(bk)) if f.startswith("coala-pre-restore")]
        check("27 restore exige --yes, repõe o backup e guarda a base anterior",
              guarded and n_after == n_bk and len(pre) == 1, f"{n_after}/{n_bk} pre={pre}")

        # 28–30. import com cadeia de supersessão, idempotência e invariante por chave
        dest_db = os.path.join(tmp, "dest.sqlite")
        dconn, _, dbackend = connect_path(dest_db)
        r1 = import_entries(dconn, dbackend, fake_db, key_prefixes=["api-porta"])
        rows = dconn.execute("SELECT * FROM memory_entries WHERE supersession_key='api-porta'"
                             " ORDER BY recorded_at, id").fetchall()
        src_rows = conn.execute("SELECT * FROM memory_entries WHERE supersession_key='api-porta'"
                                " ORDER BY recorded_at, id").fetchall()
        chain_ok = (len(rows) == 2 and rows[0]["superseded_by"] == rows[1]["id"]
                    and rows[1]["superseded_by"] is None
                    and [r["recorded_at"] for r in rows] == [r["recorded_at"] for r in src_rows])
        pnote = dconn.execute("SELECT note FROM provenance WHERE entry_id=?", (rows[1]["id"],)).fetchone()[0]
        check("28 import preserva cadeia, recorded_at e proveniência",
              r1["imported"] == 2 and chain_ok and "Importado de" in pnote, str(r1))
        r2 = import_entries(dconn, dbackend, fake_db, key_prefixes=["api-porta"])
        check("29 import é idempotente (2.ª vez = 0 importados)",
              r2["imported"] == 0 and r2["already_present"] == 2, str(r2))
        insert_entry(dconn, dbackend, "semantic", "A API passou para a porta 9090.", "owner", key="k-conf")
        dconn.commit()
        insert_entry(conn, backend, "semantic", "Versão antiga do facto k-conf.", "owner", key="k-conf")
        conn.execute("UPDATE memory_entries SET recorded_at='2000-01-01T00:00:00+00:00'"
                     " WHERE supersession_key='k-conf'")
        conn.commit()
        r3 = import_entries(dconn, dbackend, fake_db, key_prefixes=["k-conf"])
        act = dconn.execute("SELECT content FROM memory_entries WHERE supersession_key='k-conf'"
                            " AND superseded_by IS NULL").fetchall()
        check("30 import mantém ≤1 versão ativa por chave (a mais recente ganha)",
              len(act) == 1 and "9090" in act[0][0] and r3["conflicts_resolved"] == 1, str(r3))
        dconn.close()

        # 31–37. ingestão guiada por ingest.json
        (proj_root, skill_dir) = (proj, skill)
        os.makedirs(os.path.join(proj_root, "docs", "sub"))
        with open(os.path.join(proj_root, "README.md"), "w", encoding="utf-8") as fh:
            fh.write("# Projeto demo\n\nIntrodução ao projeto demo.\n\n## Arquitetura\n\nUsa SQLite local.\n")
        with open(os.path.join(proj_root, "docs", "sub", "guia.md"), "w", encoding="utf-8") as fh:
            fh.write("# Guia\n\nPasso um.\n\n## Detalhe\n\nPasso dois.\n")
        with open(os.path.join(proj_root, "run.sh"), "w", encoding="utf-8") as fh:
            fh.write("#!/bin/sh\necho ok\n")
        cfg = {"key_prefix": "proj", "path_prefix": "demo",
               "rules": [{"name": "readme", "include": ["README.md"], "mode": "markdown",
                          "type": "semantic", "origin": "agent", "tags": "docs,readme"},
                         {"name": "docs", "include": ["docs/**/*.md"], "mode": "markdown",
                          "type": "semantic", "origin": "agent", "tags": "docs,{dir},{stem}"},
                         {"name": "script", "include": ["*.sh"], "mode": "whole",
                          "type": "procedural", "origin": "agent", "tags": "script"}],
               "graph": {"entities": [{"name": "demo", "kind": "projeto"}],
                         "edges": [["demo", "usa", "SQLite"]]}}
        pdf_ok = bool(shutil.which("pdftotext"))
        if pdf_ok:
            with open(os.path.join(proj_root, "docs", "artigo.pdf"), "wb") as fh:
                fh.write(_tiny_pdf("Hello CoALA memory"))
            cfg["rules"].append({"name": "pdfs", "include": ["docs/**/*.pdf"], "mode": "pdf",
                                 "type": "semantic", "origin": "untrusted", "tags": "pdf,doc:{stem}"})
        cfg_path = os.path.join(skill_dir, INGEST_CONFIG_NAME)
        with open(cfg_path, "w", encoding="utf-8") as fh:
            json.dump(cfg, fh)
        idb = os.path.join(skill_dir, "memory", "coala.sqlite")
        iconn, _, ibackend = connect_path(idb)
        loaded = load_ingest_config(cfg_path)
        rep1 = run_ingest(iconn, ibackend, loaded, proj_root)
        keys = {r[0] for r in iconn.execute("SELECT supersession_key FROM memory_entries")}
        whole = iconn.execute("SELECT tags, memory_type FROM memory_entries WHERE supersession_key='proj/demo/run.sh'").fetchone()
        guia = iconn.execute("SELECT tags FROM memory_entries WHERE supersession_key='proj/demo/docs/sub/guia.md#000'").fetchone()
        check("31 ingest cria segmentos com chaves estáveis e tags {dir}/{stem}",
              rep1["totals"]["new"] >= 5 and "proj/demo/README.md#000" in keys and whole is not None
              and whole[1] == "procedural" and guia is not None and "sub" in guia[0] and "guia" in guia[0],
              str(rep1["totals"]))
        if pdf_ok:
            prow = iconn.execute("SELECT content, origin_class, tags FROM memory_entries"
                                 " WHERE supersession_key='proj/demo/docs/artigo.pdf#0000'").fetchone()
            check("32 modo pdf (pdftotext) marca página e origem untrusted",
                  prow is not None and "pág. 1" in prow[0] and "Hello" in prow[0]
                  and prow[1] == "untrusted" and "doc:artigo" in prow[2], str(prow and prow[0][:60]))
        else:
            segs = segment_file(os.path.join(proj_root, "README.md"), "demo/x.pdf",
                                {"name": "pdfs", "mode": "pdf"}, warn=rep1["warnings"].append)
            check("32 sem pdftotext a regra pdf é ignorada com aviso (degradação graciosa)",
                  segs is None and any("pdftotext" in w for w in rep1["warnings"]))
        rep2 = run_ingest(iconn, ibackend, loaded, proj_root)
        check("33 re-ingestão sem mudanças é NO-OP",
              rep2["totals"]["new"] == 0 and rep2["totals"]["updated"] == 0
              and rep2["totals"]["expired"] == 0 and rep2["totals"]["same"] == rep1["totals"]["new"],
              str(rep2["totals"]))
        with open(os.path.join(proj_root, "README.md"), "w", encoding="utf-8") as fh:
            fh.write("# Projeto demo\n\nIntrodução ao projeto demo (revista).\n")
        rep3 = run_ingest(iconn, ibackend, loaded, proj_root)
        old_ver = iconn.execute("SELECT superseded_by FROM memory_entries WHERE supersession_key="
                                "'proj/demo/README.md#000' ORDER BY id LIMIT 1").fetchone()[0]
        check("34 ficheiro alterado → supersessão; segmentos que sumiram → expiram",
              rep3["totals"]["updated"] == 1 and rep3["totals"]["expired"] == 1 and old_ver is not None,
              str(rep3["totals"]))
        os.remove(os.path.join(proj_root, "run.sh"))
        rep4 = run_ingest(iconn, ibackend, loaded, proj_root)
        gone = iconn.execute("SELECT valid_until, superseded_by FROM memory_entries"
                             " WHERE supersession_key='proj/demo/run.sh'").fetchone()
        check("35 ficheiro removido → registos expiram (nunca apagados)",
              len(rep4["removed"]) == 1 and gone is not None and gone[0] is not None and gone[1] is None,
              str(rep4["removed"]))
        g = iconn.execute("SELECT COUNT(*) FROM entity_edges e JOIN entity_nodes s ON s.id=e.src"
                          " WHERE s.name='demo'").fetchone()[0]
        check("36 grafo declarado no ingest.json é aplicado de forma idempotente", g == 1)
        loaded["rules"][1]["origin"] = "owner"            # mudar só a proveniência de uma regra
        rep5 = run_ingest(iconn, ibackend, loaded, proj_root)
        orig = iconn.execute("SELECT origin_class FROM memory_entries WHERE supersession_key="
                             "'proj/demo/docs/sub/guia.md#000' AND superseded_by IS NULL").fetchone()[0]
        check("37 mudar origem/tags de uma regra gera nova versão (supersessão), não reescrita",
              rep5["totals"]["updated"] == 2 and rep5["totals"]["new"] == 0 and orig == "owner",
              str(rep5["totals"]))
        iconn.close()
        _, out1 = run_cmd(cmd_export, db=idb, format="jsonl", out=None)
        _, out2 = run_cmd(cmd_export, db=idb, format="jsonl", out=None)
        check("38 export jsonl canónico é determinístico", out1 == out2 and out1.count("\n") >= 5)

        # 38–39. doctor
        code, dout = run_cmd(cmd_doctor, db=idb, deep=True, no_freshness=False)
        dj = json.loads(run_cmd(cmd_doctor, db=idb, json=True, deep=False, no_freshness=False)[1])
        check("39 doctor numa base saudável não tem FAIL e mede a frescura",
              code == 0 and dj["fails"] == 0 and any(c["check"].startswith("frescura") for c in dj["checks"]),
              str([c for c in dj["checks"] if c["level"] == "FAIL"]))
        bad = sqlite3.connect(idb)
        bad.execute("INSERT INTO memory_entries(memory_type, content, origin_class, supersession_key,"
                    " recorded_at) VALUES ('semantic','dup','agent','proj/demo/README.md#000', ?)", (now_iso(),))
        bad.commit()
        bad.close()
        try:
            run_cmd(cmd_doctor, db=idb, deep=False, no_freshness=True)
            caught = False
        except CoalaError:
            caught = True
        check("40 doctor deteta >1 versão ativa por chave (FAIL, exit 1)", caught)

        # 41. filtros de tags: --tags (AND) vs --any-tags (OR)
        w_and, p_and = build_filter(tags=["api", "cache"])
        w_or, p_or = build_filter(any_tags=["api", "cache"])
        n_and = conn.execute("SELECT COUNT(*) FROM memory_entries e WHERE 1=1" + w_and, p_and).fetchone()[0]
        n_or = conn.execute("SELECT COUNT(*) FROM memory_entries e WHERE 1=1" + w_or, p_or).fetchone()[0]
        check("41 --tags exige todas (AND) e --any-tags basta uma (OR)", n_and == 0 and n_or >= 2,
              f"and={n_and} or={n_or}")

        conn.commit()
        conn.close()

        # 42. isolamento: o DB temporário existe e a limpeza remove tudo
        check("42 DB temporário isolado de qualquer base real", os.path.exists(fake_db))
    except Exception as exc:  # pragma: no cover - rede de segurança do selftest
        check("erro inesperado no selftest", False, repr(exc))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        if real_env is None:
            os.environ.pop(DB_ENV, None)
        else:
            os.environ[DB_ENV] = real_env
        check("43 limpeza completa da fixture (nada fica em /tmp)", not os.path.exists(tmp))

    passed = sum(1 for _, ok, _ in results if ok)
    total = len(results)
    print(f"\nSELFTEST: {passed}/{total} PASS" + ("" if passed == total else " — HÁ FALHAS"))
    return 0 if passed == total else 1


# ------------------------------------------------------------------------ CLI
class _Parser(argparse.ArgumentParser):
    def error(self, message):
        raise UsageError(f"uso inválido ({message})",
                         "executa `python3 scripts/coala.py --help` para ver a sintaxe correta")


def build_parser() -> argparse.ArgumentParser:
    p = _Parser(
        prog="coala.py",
        description="Motor de memória persistente CoALA (SQLite) LOCAL por projeto: episódica, "
                    "semântica, procedimental + working memory orçamentada. Sem memória global.",
        epilog="Flags globais (em qualquer posição): --json · --db <caminho>. "
               "Env: COALA_DB, COALA_RRF_W_FTS, COALA_RRF_W_VEC. "
               f"Instalar num projeto: {INSTALL_HINT}")
    p.add_argument("--selftest", action="store_true",
                   help="corre testes determinísticos OFFLINE em DB temporário")
    sub = p.add_subparsers(dest="cmd", metavar="<comando>")

    sp = sub.add_parser("init", help="cria/migra o esquema (idempotente, aditivo)")
    sp.set_defaults(func=cmd_init)

    sp = sub.add_parser("where", help="mostra que base local é usada e porquê")
    sp.set_defaults(func=cmd_where)

    sp = sub.add_parser("add", help="insere um registo de memória")
    sp.add_argument("--type", required=True, choices=list(MEMORY_TYPES),
                    help="tipo de memória CoALA")
    sp.add_argument("--content", required=True, help="texto do conhecimento")
    sp.add_argument("--origin", default="agent", choices=list(ORIGINS),
                    help="classe de proveniência (web → use untrusted)")
    sp.add_argument("--key", dest="key", default=None,
                    help="chave de supersessão: repetir a chave suplanta o registo ativo anterior")
    sp.add_argument("--source", default=None, help="URL/caminho/conversa de origem")
    sp.add_argument("--tags", default=None, help="tags separadas por vírgula")
    sp.add_argument("--valid-from", default=None, help="quando o facto passou a valer (ISO)")
    sp.add_argument("--valid-until", default=None, help="quando deixa de valer (ISO; NULL=ainda válido)")
    sp.add_argument("--entities", default=None,
                    help="entidades separadas por vírgula a criar/ligar no grafo")
    sp.set_defaults(func=cmd_add)

    sp = sub.add_parser("search", help="busca híbrida FTS5+vetorial com fusão RRF")
    sp.add_argument("query", help="consulta em linguagem natural")
    sp.add_argument("--type", default=None, choices=list(MEMORY_TYPES))
    sp.add_argument("--tags", default=None, help="filtra por tags (CSV): TODAS têm de estar presentes")
    sp.add_argument("--any-tags", dest="any_tags", default=None, help="filtra por tags (CSV): basta UMA")
    sp.add_argument("--limit", type=int, default=10, help="máximo de resultados (predef: 10)")
    sp.add_argument("--w-fts", dest="w_fts", type=float, default=None, help="peso RRF do canal FTS")
    sp.add_argument("--w-vec", dest="w_vec", type=float, default=None, help="peso RRF do canal vetorial")
    sp.add_argument("--include-superseded", action="store_true", help="inclui registos suplantados")
    sp.add_argument("--include-expired", action="store_true", help="inclui registos expirados")
    sp.set_defaults(func=cmd_search)

    sp = sub.add_parser("recall", help="materializa working memory orçamentada para um prompt")
    sp.add_argument("query", nargs="?", default=None, help="consulta opcional de relevância")
    sp.add_argument("--type", default=None, choices=list(MEMORY_TYPES))
    sp.add_argument("--tags", default=None, help="filtra por tags (CSV): TODAS têm de estar presentes")
    sp.add_argument("--any-tags", dest="any_tags", default=None, help="filtra por tags (CSV): basta UMA")
    sp.add_argument("--budget", type=int, default=DEFAULT_BUDGET,
                    help="orçamento em tokens estimados (predef: 2000)")
    sp.add_argument("--top", type=int, default=12, help="máximo de excertos (predef: 12)")
    sp.add_argument("--include-superseded", action="store_true")
    sp.add_argument("--include-expired", action="store_true")
    sp.set_defaults(func=cmd_recall)

    sp = sub.add_parser("graph", help="travessia de grafo de entidades (CTE recursiva)")
    sp.add_argument("entity", help="nome da entidade raiz")
    sp.add_argument("--depth", type=int, default=2, help="profundidade máxima (predef: 2)")
    sp.set_defaults(func=cmd_graph)

    sp = sub.add_parser("link", help="cria uma aresta explícita entre entidades")
    sp.add_argument("src", help="entidade de origem")
    sp.add_argument("rel", help="relação (ex.: usa, depende_de, substitui)")
    sp.add_argument("dst", help="entidade de destino")
    sp.set_defaults(func=cmd_link)

    sp = sub.add_parser("supersede", help="substitui explicitamente um facto por outro")
    sp.add_argument("id", type=int, help="id do registo a suplantar")
    sp.add_argument("--content", required=True, help="novo conteúdo")
    sp.add_argument("--origin", default=None, choices=list(ORIGINS))
    sp.add_argument("--source", default=None)
    sp.add_argument("--tags", default=None)
    sp.add_argument("--valid-from", default=None)
    sp.add_argument("--valid-until", default=None)
    sp.set_defaults(func=cmd_supersede)

    sp = sub.add_parser("stats", help="contagens por tipo/proveniência/validade + tamanho do DB")
    sp.set_defaults(func=cmd_stats)

    sp = sub.add_parser("export", help="dump para revisão humana ou git (segredos mascarados)")
    sp.add_argument("--format", default="md", choices=["md", "json", "jsonl"],
                    help="md (humano) · json · jsonl (canónico, determinístico, p/ diff git)")
    sp.add_argument("--out", default=None, help="escreve num ficheiro em vez do stdout (sem corte de 48 KB)")
    sp.set_defaults(func=cmd_export)

    sp = sub.add_parser("doctor", help="saúde da base: esquema, FTS5, integridade, contagens, frescura")
    sp.add_argument("--deep", action="store_true", help="integrity_check completo (mais lento)")
    sp.add_argument("--no-freshness", dest="no_freshness", action="store_true",
                    help="não compara o material do projeto com a memória")
    sp.set_defaults(func=cmd_doctor)

    sp = sub.add_parser("backup", help="snapshot consistente (API de backup) em memory/backups/")
    sp.add_argument("--out", default=None, help="caminho do ficheiro de backup (nunca sobrescreve)")
    sp.set_defaults(func=cmd_backup)

    sp = sub.add_parser("restore", help="repõe a base a partir de um backup (faz backup da atual antes)")
    sp.add_argument("--from", dest="from_db", required=True, help="ficheiro de backup")
    sp.add_argument("--yes", action="store_true", help="confirma a substituição")
    sp.set_defaults(func=cmd_restore)

    sp = sub.add_parser("import", help="copia registos de outra base CoALA (preserva histórico)")
    sp.add_argument("--from", dest="from_db", required=True, help="base de origem (aberta só-leitura)")
    sp.add_argument("--key-prefix", action="append", default=None, help="prefixo de supersession_key (repetível)")
    sp.add_argument("--source-prefix", action="append", default=None, help="prefixo de source (repetível)")
    sp.add_argument("--tags", default=None, help="tags (CSV; basta uma)")
    sp.add_argument("--ids", default=None, help="ids e intervalos, ex.: 5-20,23")
    sp.add_argument("--all", action="store_true", help="todos os registos")
    sp.add_argument("--with-graph", dest="with_graph", action="store_true", help="copia também entidades/arestas")
    sp.add_argument("--graph-entities", dest="graph_entities", default=None,
                    help="restringe o grafo copiado a estas entidades (CSV)")
    sp.add_argument("--dry-run", dest="dry_run", action="store_true", help="só conta, não escreve")
    sp.set_defaults(func=cmd_import)

    sp = sub.add_parser("ingest", help="ingere o material do projeto segundo o ingest.json (idempotente)")
    sp.add_argument("--config", default=None, help="caminho do ingest.json (predef: o da skill local)")
    sp.add_argument("--root", default=None, help="raiz do projeto (predef: a da skill local)")
    sp.add_argument("--only", default=None, help="regras a ingerir (CSV)")
    sp.add_argument("--pdf-pages", dest="pdf_pages", type=int, default=0,
                    help="limita páginas por PDF (0 = todas; útil em testes)")
    sp.add_argument("--dry-run", dest="dry_run", action="store_true", help="compara com a base sem escrever")
    sp.add_argument("--verbose", action="store_true", help="detalhe por ficheiro")
    sp.set_defaults(func=cmd_ingest)
    return p


def main(argv=None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    json_mode = False
    db_override = None
    selftest = False
    rest = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--json":
            json_mode = True
        elif a == "--selftest":
            selftest = True
        elif a == "--db":
            i += 1
            if i >= len(argv):
                raise UsageError("--db exige um caminho",
                                 "usa `--db /caminho/coala.sqlite` ou a env COALA_DB")
            db_override = argv[i]
        elif a.startswith("--db="):
            db_override = a.split("=", 1)[1]
        else:
            rest.append(a)
        i += 1

    if selftest:
        return run_selftest()

    parser = build_parser()
    args = parser.parse_args(rest)
    args.json = json_mode
    args.db = db_override

    if not getattr(args, "cmd", None):
        parser.print_help()
        raise UsageError("nenhum comando indicado",
                         "usa `where`, `init`, `add`, `search`, `recall`, `graph`, `supersede`, `stats`,"
                         " `export`, `doctor`, `backup`, `restore`, `import`, `ingest` ou `--selftest`")
    return args.func(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except CoalaError as exc:
        sys.stderr.write(exc.render() + "\n")
        sys.exit(exc.exit_code)
    except KeyboardInterrupt:
        sys.stderr.write("Erro: interrompido pelo utilizador — Solução: reexecuta o comando\n")
        sys.exit(1)
    except BrokenPipeError:
        sys.exit(1)
    except sqlite3.Error as exc:
        sys.stderr.write(f"Erro: falha de SQLite ({exc}) — "
                         "Solução: verifica o estado do ficheiro DB e as permissões\n")
        sys.exit(1)
