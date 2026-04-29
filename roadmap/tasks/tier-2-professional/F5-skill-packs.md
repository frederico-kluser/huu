# F5 · Skill Packs (Progressive Disclosure)

> **Tier:** 2 (Professional) · **Esforço:** 5–7 dias · **Bloqueia:** F23
> **Dependências:** F0.1 (schema), F3 (long-term: tool MCP `load_skill`).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

Hoje cada agent paralelo recebe o mesmo system prompt completo. Em
pipeline com 50 agentes × prompt 5KB = 250KB de tokens só de baseline.

**Solução:** progressive disclosure. System prompt injeta apenas
`name + description` de cada skill (~50-100 tokens × N skills = ~1.7K
total). Quando o agente decide que precisa de uma skill, emite
`LOAD_SKILL: <name>`. Wrapper interno (não MCP cliente!) intercepta,
injeta o body completo (~5K tokens), reinicia turn.

Economia: 5K × 50 agentes - 1.7K × 50 = ~165K tokens por baseline.

## Current state in `huu`

- `src/prompts/` — prompts hard-coded como TS strings. Sistema prompt
  é estático.
- `src/lib/refinement-prompts.ts` — prompts especiais para refinement
  chat.
- Sem schema SKILL.md. Sem loader.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/core/skills/load_skill_tool.py`
- `/home/ondokai/Projects/bernstein/templates/skills/{role}/SKILL.md`
  (não verificado in-tree mas referenciado em docs).

## Dependencies (DAG)

- **F0.1** — pipeline schema ganha `step.skills: [name1, name2]` opcional.
- **F3** *(soft)* — `load_skill` exposto como tool MCP (post-MVP).

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/skills/loader.ts` | Discover SKILL.md em `~/.huu/skills/` e `<repo>/.huu/skills/`. |
| `src/skills/index.ts` | API: `loadSkillIndex(repoRoot) → SkillIndex`. |
| `src/skills/parser.ts` | Parse SKILL.md (YAML frontmatter + body). |
| `src/skills/interceptor.ts` | Detecta `LOAD_SKILL: <name>` no output do agente. |
| `src/skills/skills.test.ts` | Tests. |
| `templates/skills/example-refactor.md` | Skill exemplo bundled. |

### Existing files to modify

| Path | Change |
|---|---|
| `src/schema/pipeline-v1.ts` | Adicionar `step.skills: z.array(z.string()).optional()`. |
| `src/orchestrator/real-agent.ts` | Antes de cada turn: injetar baseline skill listing. Depois: detectar `LOAD_SKILL`, expand. |

### SKILL.md format

```markdown
---
name: refactor-mocha-to-vitest
description: Migra testes Mocha para Vitest preservando comportamento.
triggers: [test migration, mocha, vitest]
references: [migration-patterns.md]
---

## Quando usar

Quando precisa converter `describe`/`it` Mocha para `vitest` mantendo
asserções e mocks compatíveis.

## Como aplicar

1. Substituir imports `mocha` → `vitest`.
2. Preservar `before/after` hooks (Vitest tem mesma API).
3. ...

## Exemplos

```typescript
// Antes (Mocha + Chai)
import { expect } from 'chai';
describe('foo', () => { it('bar', () => expect(1).to.equal(1)); });

// Depois (Vitest)
import { describe, it, expect } from 'vitest';
describe('foo', () => { it('bar', () => expect(1).toBe(1)); });
```
```

### Code sketch (`src/skills/parser.ts`)

```typescript
import * as yaml from 'js-yaml';

export interface Skill {
  name: string;
  description: string;
  triggers?: string[];
  references?: string[];
  body: string;
  filePath: string;
}

export function parseSkill(rawMarkdown: string, filePath: string): Skill {
  const m = rawMarkdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error(`Skill missing frontmatter: ${filePath}`);
  const [, frontmatter, body] = m;
  const meta = yaml.load(frontmatter) as any;
  if (!meta?.name || !meta.description) {
    throw new Error(`Skill missing name/description: ${filePath}`);
  }
  return {
    name: meta.name,
    description: meta.description,
    triggers: meta.triggers,
    references: meta.references,
    body: body.trim(),
    filePath,
  };
}
```

### Code sketch (`src/skills/loader.ts`)

```typescript
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { parseSkill, type Skill } from './parser.js';

export interface SkillIndex {
  byName: Map<string, Skill>;
  /** Tier 1: name+description summary, ready for system prompt injection. */
  baseline: string;
}

const SKILL_DIRS = [
  () => path.join(os.homedir(), '.huu', 'skills'),
  (repoRoot: string) => path.join(repoRoot, '.huu', 'skills'),
];

export async function loadSkillIndex(repoRoot: string): Promise<SkillIndex> {
  const skills: Skill[] = [];
  for (const dirFn of SKILL_DIRS) {
    const dir = typeof dirFn === 'function' ? dirFn(repoRoot) : dirFn;
    try {
      const files = await fs.readdir(dir);
      for (const f of files) {
        if (!f.endsWith('.md') && !f.endsWith('.SKILL.md')) continue;
        const raw = await fs.readFile(path.join(dir, f), 'utf-8');
        try {
          skills.push(parseSkill(raw, path.join(dir, f)));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn(`[skills] skipping ${f}: ${err}`);
        }
      }
    } catch { /* dir doesn't exist */ }
  }
  // Repo skills override home skills (same name)
  const byName = new Map<string, Skill>();
  for (const s of skills) byName.set(s.name, s);

  const baseline = [...byName.values()]
    .map((s) => `- **${s.name}**: ${s.description}`)
    .join('\n');

  return { byName, baseline };
}
```

### Code sketch (`src/skills/interceptor.ts`)

```typescript
import type { SkillIndex } from './loader.js';

const LOAD_PATTERN = /^LOAD_SKILL:\s*([\w.-]+)\s*$/m;

/**
 * Inspect the agent output for a LOAD_SKILL: <name> directive.
 * Returns { skillName, skillBody } if matched, or null.
 */
export function detectLoadSkill(output: string, index: SkillIndex): { skillName: string; skillBody: string } | null {
  const m = output.match(LOAD_PATTERN);
  if (!m) return null;
  const skill = index.byName.get(m[1]);
  if (!skill) return null;
  return { skillName: skill.name, skillBody: skill.body };
}

export function injectSkillIntoPrompt(systemPrompt: string, baseline: string, allowedSkills?: string[]): string {
  const filtered = allowedSkills
    ? baseline.split('\n').filter((line) => allowedSkills.some((s) => line.includes(s))).join('\n')
    : baseline;
  if (!filtered) return systemPrompt;
  return `${systemPrompt}\n\n## Available skills\n\nYou can load detailed guidance by emitting on its own line:\n\`\`\`\nLOAD_SKILL: <skill-name>\n\`\`\`\n\nAvailable skills:\n${filtered}`;
}
```

### Wire into agent runtime (`src/orchestrator/real-agent.ts`)

Around the loop where Pi SDK turns are executed:

```typescript
import { loadSkillIndex } from '../skills/loader.js';
import { detectLoadSkill, injectSkillIntoPrompt } from '../skills/interceptor.js';

const skillIndex = await loadSkillIndex(repoRoot);
let systemPrompt = injectSkillIntoPrompt(baseSystemPrompt, skillIndex.baseline, step.skills);

// In the turn loop:
while (notDone) {
  const turn = await piAgent.runTurn(/* ... systemPrompt ... */);
  const expand = detectLoadSkill(turn.output, skillIndex);
  if (expand) {
    systemPrompt += `\n\n## Skill loaded: ${expand.skillName}\n\n${expand.skillBody}`;
    continue; // re-run with expanded prompt
  }
  break;
}
```

### Pi SDK tool-call alternative

Pi SDK supports native tool calling. For models that support it (Claude,
GPT, Gemini), expose `load_skill` as a tool instead of regex parsing.
Falls back to regex for models without tool use. **Implementation
detail:** start with regex; tool-call pathway is robustness improvement
for v2.

## Libraries

- `js-yaml@^4.x.y` — for SKILL.md frontmatter parsing.

## Tests

```typescript
import { describe, it, expect } from 'vitest';
import { parseSkill } from './parser.js';
import { detectLoadSkill, injectSkillIntoPrompt } from './interceptor.js';

describe('parseSkill', () => {
  it('parses valid SKILL.md', () => {
    const md = `---
name: test-skill
description: A test skill.
triggers: [test]
---

Body content.`;
    const s = parseSkill(md, '/x.md');
    expect(s.name).toBe('test-skill');
    expect(s.body).toBe('Body content.');
  });

  it('rejects missing frontmatter', () => {
    expect(() => parseSkill('no frontmatter', '/x.md')).toThrow();
  });
});

describe('detectLoadSkill', () => {
  const index = {
    byName: new Map([['foo', { name: 'foo', description: 'd', body: 'BODY', filePath: '/x' }]]),
    baseline: '- **foo**: d',
  } as any;

  it('matches LOAD_SKILL: foo', () => {
    const r = detectLoadSkill('Some text\nLOAD_SKILL: foo\nmore', index);
    expect(r).toEqual({ skillName: 'foo', skillBody: 'BODY' });
  });

  it('returns null for unknown', () => {
    expect(detectLoadSkill('LOAD_SKILL: bar', index)).toBeNull();
  });
});
```

## Acceptance criteria

- [ ] Skill em `~/.huu/skills/foo.md` carrega no startup.
- [ ] System prompt injetado lista skills disponíveis.
- [ ] Output do agent com `LOAD_SKILL: foo` causa expansão e re-run do turn.
- [ ] Pipeline com `step.skills: ["foo"]` filtra apenas essa skill na injection.
- [ ] Repo skill (`<repo>/.huu/skills/`) sobrescreve home skill com mesmo nome.
- [ ] Skills com YAML inválido emitem warning, não crash.
- [ ] Bundled exemplo em `templates/skills/`.

## Out of scope

- ❌ MCP tool externo (F23 cookbook + F3 expansão).
- ❌ Tier 3 (read_skill_resource) — só Tier 1 + Tier 2 no MVP.
- ❌ Skill packs via npm packages — depende de F23.

## Risk register

| Risco | Mitigação |
|---|---|
| Regex `LOAD_SKILL` não dispara em modelos imprevisíveis | Pi SDK tool calling fallback (v2). |
| Skill body muito grande explode contexto | Cap 10KB no body; warn + truncate se excede. |
| Loop infinito de loading | Cap N=3 expansões por turn. |

## Estimated effort

5–7 dias.

## After this task is merged

Desbloqueia: **F23** (cookbook entries são skills).
