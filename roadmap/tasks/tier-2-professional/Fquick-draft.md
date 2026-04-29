# Fquick · `huu draft --quick "goal"`

> **Tier:** 2 (Professional) · **Esforço:** 3 dias
> **Dependências:** F0.1 (schema).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

Bernstein tem `bernstein -g "goal"` — um único shot LLM que gera plan
+ executa. **`huu` recusa autonomia total** (ROADMAP §10), mas pode
oferecer one-shot draft com **gate humano explícito**:

```bash
huu draft --quick "Migrate 40 Mocha tests to Vitest" > draft.huu-pipeline.json
huu run --dry-run draft.huu-pipeline.json    # ver custo
huu run draft.huu-pipeline.json              # executar (TUI confirma)
```

Diferencia:
- **Bernstein:** 1 chamada → executa autonomamente.
- **`huu` quick:** 1 chamada → JSON → humano edita/aprova → executa.

## Current state in `huu`

- `step.interactive: true` chama refinement chat *multi-turno*
  (`src/lib/refinement-prompts.ts`).
- Sem one-shot CLI subcomando.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/src/bernstein/cli/main.py` flag `-g`.

## Dependencies (DAG)

- **F0.1** — output passa schema.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/cli/commands/draft.ts` | Subcomando. |
| `src/lib/draft-quick.ts` | One-shot LLM call + JSON extraction. |

### Code sketch (`src/lib/draft-quick.ts`)

```typescript
import { runRefinementChat } from './refinement-prompts.js';
import { pipelineSchema, type Pipeline } from '../schema/pipeline-v1.js';

const SYSTEM_PROMPT = `You translate a high-level goal into a huu-pipeline-v1 JSON.

Output: valid JSON ONLY (no markdown fences, no prose).

Schema (simplified):
{
  "name": "<short-slug>",
  "steps": [
    {
      "name": "<step name>",
      "prompt": "<instructions; use $file placeholder when files is non-empty>",
      "files": ["<repo-relative paths>"]
    }
  ]
}

Heuristics:
- Decompose into stages: a setup/analysis stage first, then per-file work, then a closing stage (changelog/tests).
- For per-file work: list every file relevant to the change in `files`. Mention $file in the prompt.
- For whole-project work: leave files: [].

Goal: {{GOAL}}

Return JSON only.`;

export async function quickDraft(goal: string, modelId = 'anthropic/claude-sonnet-4-6'): Promise<Pipeline> {
  const prompt = SYSTEM_PROMPT.replace('{{GOAL}}', goal);
  const response = await runRefinementChat(modelId, prompt, '');
  const json = extractJson(response);
  return pipelineSchema.parse(json);
}

function extractJson(s: string): unknown {
  const m = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return JSON.parse(m ? m[1].trim() : s.trim());
}
```

### Code sketch (`src/cli/commands/draft.ts`)

```typescript
import { quickDraft } from '../../lib/draft-quick.js';
import { savePipelineToFile } from '../../lib/pipeline-io.js';

export async function runDraftCommand(argv: string[]): Promise<number> {
  const quick = argv.includes('--quick');
  const interactive = argv.includes('--interactive');
  const out = argv[argv.indexOf('--out') + 1];
  const goalIdx = argv.findIndex((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--out');
  const goal = goalIdx >= 0 ? argv.slice(goalIdx).join(' ') : null;

  if (!goal) { console.error('Usage: huu draft --quick|--interactive "goal" [--out file.json]'); return 2; }

  if (interactive) {
    console.error('Interactive mode: launch the TUI and use a step with `interactive: true`.');
    return 1;
  }

  if (quick) {
    console.log('Drafting...');
    const pipeline = await quickDraft(goal);
    if (out) {
      await savePipelineToFile(out, pipeline);
      console.log(`✓ Wrote ${out}`);
      console.log(`Next: huu run --dry-run ${out}`);
    } else {
      process.stdout.write(JSON.stringify({ _format: 'huu-pipeline-v1', pipeline }, null, 2) + '\n');
    }
    return 0;
  }

  console.error('Specify --quick or --interactive.');
  return 2;
}
```

### Wire into `src/cli.tsx`

```typescript
if (firstArg === 'draft') {
  const { runDraftCommand } = await import('./cli/commands/draft.js');
  process.exit(await runDraftCommand(process.argv.slice(3)));
}
```

## Libraries

Nenhuma nova.

## Tests

```typescript
import { describe, it, expect, vi } from 'vitest';
import * as draftQuick from './draft-quick.js';

describe('quickDraft', () => {
  it('parses returned JSON', async () => {
    vi.spyOn(draftQuick, 'quickDraft').mockResolvedValue({
      name: 'x',
      steps: [{ name: 's', prompt: 'p', files: [] }],
    });
    const p = await draftQuick.quickDraft('test');
    expect(p.name).toBe('x');
  });
});
```

## Acceptance criteria

- [ ] `huu draft --quick "goal"` produz JSON válido em <30s.
- [ ] Output passa `pipelineSchema.parse()`.
- [ ] `--out file.json` escreve em vez de stdout.
- [ ] Documentação: "this is faster than --interactive but lower quality
      for ambiguous goals — review before running."

## Out of scope

- ❌ Auto-execute. Sempre exige `huu run` separado.
- ❌ Refinement loop (já existe via `interactive: true` em step).

## Risk register

| Risco | Mitigação |
|---|---|
| LLM gera JSON inválido | `pipelineSchema.parse()` rejeita; user tenta novamente. |
| Goal ambíguo → plan ruim | Documentar: usar `--interactive` para goals complexos. |

## Estimated effort

3 dias.

## After this task is merged

Fecha o gap "Bernstein é mais rápido que `huu`" no draft.
