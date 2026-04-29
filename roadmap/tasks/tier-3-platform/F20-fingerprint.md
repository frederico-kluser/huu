# F20 · `huu fingerprint` (OSS Plagiarism Detection)

> **Tier:** 3 (Platform) · **Esforço:** 8–12 dias
> **Dependências:** zero (standalone).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

LLMs ocasionalmente reproduzem código OSS literalmente — risco legal.
**`huu fingerprint`** constrói índice MinHash/SimHash de OSS conhecido
e checa se diffs gerados batem.

Diferenciador legal-grade contra Bernstein no nicho regulated.

## Current state in `huu`

- Zero.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/cli/commands/fingerprint_cmd.py`

## Dependencies (DAG)

Nenhuma.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/fingerprint/minhash.ts` | MinHash sketch implementation. |
| `src/fingerprint/index-builder.ts` | Build corpus index from filesystem. |
| `src/fingerprint/checker.ts` | Check file against index. |
| `src/cli/commands/fingerprint.ts` | Subcomandos `build` / `check`. |

### Algorithm choice

**MinHash com shingles de tokens** (não chars):
- Tokenize código por word boundary.
- Shingle window=5 tokens.
- 128 hashes para Jaccard estimation.
- Threshold default: similarity ≥ 0.8 = match.

### Code sketch (`src/fingerprint/minhash.ts`)

```typescript
import * as crypto from 'node:crypto';

const NUM_HASHES = 128;
const SHINGLE_SIZE = 5;

export type Sketch = Uint32Array; // length = NUM_HASHES

const SEEDS: number[] = Array.from({ length: NUM_HASHES }, (_, i) => i + 1);

function hashShingle(shingle: string, seed: number): number {
  const h = crypto.createHash('sha1');
  h.update(`${seed}:${shingle}`);
  return h.digest().readUInt32BE(0);
}

function tokenize(text: string): string[] {
  return text.split(/[\s\W]+/).filter(Boolean);
}

function shingles(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + SHINGLE_SIZE <= tokens.length; i++) {
    out.push(tokens.slice(i, i + SHINGLE_SIZE).join(' '));
  }
  return out;
}

export function sketch(text: string): Sketch {
  const tokens = tokenize(text);
  const shings = shingles(tokens);
  if (shings.length === 0) return new Uint32Array(NUM_HASHES);

  const result = new Uint32Array(NUM_HASHES).fill(0xFFFFFFFF);
  for (const sh of shings) {
    for (let i = 0; i < NUM_HASHES; i++) {
      const h = hashShingle(sh, SEEDS[i]);
      if (h < result[i]) result[i] = h;
    }
  }
  return result;
}

export function jaccard(a: Sketch, b: Sketch): number {
  let same = 0;
  for (let i = 0; i < NUM_HASHES; i++) if (a[i] === b[i]) same++;
  return same / NUM_HASHES;
}
```

### Code sketch (`src/cli/commands/fingerprint.ts`)

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { sketch, jaccard, type Sketch } from '../../fingerprint/minhash.js';

const INDEX_FILE = '.huu/fingerprint-index.json';

interface IndexEntry { id: string; source: string; sketch: number[]; }

export async function runFingerprintCommand(argv: string[]): Promise<number> {
  const sub = argv[0];
  switch (sub) {
    case 'build': {
      const corpusDir = argv[argv.indexOf('--corpus') + 1];
      if (!corpusDir) { console.error('huu fingerprint build --corpus <dir>'); return 2; }
      const entries: IndexEntry[] = [];
      for await (const f of walkFiles(corpusDir)) {
        const content = await fs.readFile(f, 'utf-8').catch(() => '');
        if (content.length < 100) continue;
        entries.push({
          id: path.relative(corpusDir, f),
          source: corpusDir,
          sketch: Array.from(sketch(content)),
        });
      }
      await fs.mkdir(path.dirname(INDEX_FILE), { recursive: true });
      await fs.writeFile(INDEX_FILE, JSON.stringify(entries, null, 2));
      console.log(`Indexed ${entries.length} files`);
      return 0;
    }
    case 'check': {
      const target = argv[1];
      if (!target) { console.error('huu fingerprint check <file>'); return 2; }
      const indexRaw = await fs.readFile(INDEX_FILE, 'utf-8').catch(() => '[]');
      const index: IndexEntry[] = JSON.parse(indexRaw);
      const content = await fs.readFile(target, 'utf-8');
      const targetSketch = sketch(content);
      const threshold = parseFloat(argv[argv.indexOf('--threshold') + 1] ?? '0.8');
      const matches = index
        .map((e) => ({ id: e.id, source: e.source, similarity: jaccard(targetSketch, new Uint32Array(e.sketch)) }))
        .filter((m) => m.similarity >= threshold)
        .sort((a, b) => b.similarity - a.similarity);

      if (matches.length === 0) console.log('No matches found.');
      else {
        for (const m of matches.slice(0, 10)) {
          console.log(`${(m.similarity * 100).toFixed(1)}%  ${m.source}/${m.id}`);
        }
      }
      return matches.length > 0 ? 1 : 0;
    }
    default:
      console.error('Usage: huu fingerprint { build --corpus <dir> | check <file> [--threshold N] }');
      return 2;
  }
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) yield* walkFiles(full);
    else if (ent.isFile() && /\.(ts|js|tsx|jsx|py|rs|go|java)$/.test(ent.name)) yield full;
  }
}
```

## Libraries

Nenhuma nova (crypto built-in).

## Tests

```typescript
import { describe, it, expect } from 'vitest';
import { sketch, jaccard } from './minhash.js';

describe('minhash', () => {
  it('similar texts have high Jaccard', () => {
    const a = sketch('the quick brown fox jumps over the lazy dog');
    const b = sketch('the quick brown fox jumps over the lazy cat');
    expect(jaccard(a, b)).toBeGreaterThan(0.5);
  });

  it('distinct texts have low Jaccard', () => {
    const a = sketch('alice in wonderland was a curious girl');
    const b = sketch('the moon casts shadows over silent forests');
    expect(jaccard(a, b)).toBeLessThan(0.2);
  });
});
```

## Acceptance criteria

- [ ] `huu fingerprint build --corpus ~/oss-corpus` indexa em <60s para 1000 files.
- [ ] `huu fingerprint check src/file.ts` reporta similarity rankings.
- [ ] Threshold configurável.
- [ ] False positive rate em corpus de teste < 5% para code distinto.

## Out of scope

- ❌ Embedding-based (mais caro; MinHash basta MVP).
- ❌ License inference.
- ❌ Auto-attribution.

## Risk register

| Risco | Mitigação |
|---|---|
| Index muito grande | Threshold default exclusivo; usar binary format se >100MB. |
| Boilerplate código (e.g. `package.json`) gera false positives | Filtrar arquivos por extensão e tamanho mínimo. |

## Estimated effort

8–12 dias (algoritmo + corpus tooling + tests).

## After this task is merged

Diferenciador legal-grade.
