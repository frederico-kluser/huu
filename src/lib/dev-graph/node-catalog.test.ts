import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEV_METHODOLOGIES } from '../dev-mode/methodology-registry.js';
import { DEVGRAPH_SLUG_PATTERN } from './graph-types.js';
import {
  ACTION_BLOCKS,
  NODE_KINDS,
  blockIds,
  findBlock,
  methodologyOptions,
} from './node-catalog.js';

// The palette order is served to the browser, so it is a CONTRACT: appending is
// additive, reordering is not. This literal is the pin.
const EXPECTED_BLOCK_ORDER = [
  'recon',
  'implement',
  'tdd',
  'tests',
  'security-review',
  'performance-review',
  'refactor',
  'docs',
  'characterize',
  'lint-fix',
  'consolidate',
  'custom',
  // Appended (never inserted): the `-findings` family, the blocks that WRITE a
  // work-order list so a later node can fan out one agent per problem.
  'security-findings',
  'performance-findings',
  'review-findings',
];

/** The blocks that turn an audit into one task file per finding. */
const FINDINGS_BLOCK_IDS = ['security-findings', 'performance-findings', 'review-findings'];

describe('node-catalog / ACTION_BLOCKS', () => {
  it('ships exactly the contracted blocks, in the contracted order', () => {
    expect(ACTION_BLOCKS.map((block) => block.id)).toEqual(EXPECTED_BLOCK_ORDER);
  });

  it('gives every block a slug id', () => {
    for (const block of ACTION_BLOCKS) {
      expect(DEVGRAPH_SLUG_PATTERN.test(block.id), block.id).toBe(true);
    }
  });

  it('has no duplicate block id', () => {
    expect(new Set(ACTION_BLOCKS.map((b) => b.id)).size).toBe(ACTION_BLOCKS.length);
  });

  it('gives every block a pt-BR label and a one-line description', () => {
    for (const block of ACTION_BLOCKS) {
      expect(block.label.length, block.id).toBeGreaterThan(0);
      expect(block.description.length, block.id).toBeGreaterThan(0);
      expect(block.description.includes('\n'), block.id).toBe(false);
    }
  });

  it('leaves only `custom` without a prompt template', () => {
    for (const block of ACTION_BLOCKS) {
      if (block.id === 'custom') expect(block.promptTemplate).toBe('');
      else expect(block.promptTemplate.length, block.id).toBeGreaterThan(0);
    }
  });

  it('injects the graph objective with $goal in every non-custom template', () => {
    for (const block of ACTION_BLOCKS) {
      if (block.id === 'custom') continue;
      expect(block.promptTemplate.includes('$goal'), block.id).toBe(true);
    }
  });

  it('uses the $file fan-out token exactly where the scope substitutes it', () => {
    for (const block of ACTION_BLOCKS) {
      const perAgent = block.defaultScope === 'per-file' || block.defaultScope === 'memory';
      expect(block.promptTemplate.includes('$file'), block.id).toBe(perAgent);
    }
  });

  it('only declares scopes the pipeline layer understands', () => {
    for (const block of ACTION_BLOCKS) {
      expect(['project', 'per-file', 'memory']).toContain(block.defaultScope);
    }
  });

  it('ships exactly the producers a fan-out may start from', () => {
    // `graph-validate.ts` rejects `fanOutFrom` pointing at any block whose
    // `produces` is not true (`fanout-source-not-producer`), so THIS list is
    // the set of legal fan-out sources in the whole editor. It used to be
    // `['recon']` alone, which forced every fan-out to start at a file
    // shortlist; the `-findings` family is what makes "one agent per PROBLEM"
    // expressible at all.
    const producers = ACTION_BLOCKS.filter((block) => block.produces);
    expect(producers.map((block) => block.id)).toEqual(['recon', ...FINDINGS_BLOCK_IDS]);
  });

  it('never marks a producer read-only (writing a list needs the write tool)', () => {
    // The invariant `produces === true ⇒ readOnly === false`, straight from the
    // doc of `WorkStep.readOnly` (src/lib/types/pipeline.ts:262-272): readOnly
    // is a HARNESS-level tool allowlist with no `write`, so "an audit that
    // writes its findings to a file needs `write` and must NOT set this".
    // A producer marked readOnly would be handed a session that cannot write
    // the list it exists to write.
    for (const block of ACTION_BLOCKS) {
      if (block.produces) expect(block.readOnly, block.id).toBe(false);
    }
  });

  it('marks the two audit blocks read-only', () => {
    const readOnly = ACTION_BLOCKS.filter((block) => block.readOnly).map((block) => block.id);
    expect(readOnly).toEqual(['security-review', 'performance-review']);
  });

  it('turns the critic loop on for the blocks that change code with judgement', () => {
    const reviewed = ACTION_BLOCKS.filter((block) => block.review).map((block) => block.id);
    expect(reviewed).toEqual(['implement', 'tdd', 'tests', 'refactor', 'characterize']);
  });

  it('gives every block but `custom` a mechanically checkable judge clause', () => {
    for (const block of ACTION_BLOCKS) {
      if (block.id === 'custom') expect(block.judgeClause).toBeUndefined();
      else expect(block.judgeClause?.length ?? 0, block.id).toBeGreaterThan(0);
    }
  });

  it('never writes memory-file format boilerplate into a producer prompt', () => {
    // huu appends the MEMORY CONTRACT at run time (src/lib/memory-contract.ts);
    // a template that also spelled the format would drift from it.
    for (const block of ACTION_BLOCKS) {
      expect(block.promptTemplate.includes('huu-memory-v1'), block.id).toBe(false);
    }
  });
});

describe('node-catalog / the `-findings` family', () => {
  const findingsBlocks = FINDINGS_BLOCK_IDS.map((id) => {
    const block = findBlock(id);
    if (!block) throw new Error(`missing findings block: ${id}`);
    return block;
  });

  it('writes, produces a list, and is never read-only', () => {
    for (const block of findingsBlocks) {
      expect(block.produces, block.id).toBe(true);
      expect(block.readOnly, block.id).toBe(false);
      expect(block.review, block.id).toBe(false);
      expect(block.defaultScope, block.id).toBe('project');
    }
  });

  it('pairs every read-only review block with a writing `-findings` twin of its OWN', () => {
    // The pair is deliberate and the comment in node-catalog.ts says why:
    // `<axis>-review` REPORTS (readOnly, data dead end), `<axis>-findings`
    // hands work over. Turning one into the other deletes a capability.
    //
    // The axis is derived by stripping `-review`, so a read-only block NOT
    // named `<axis>-review` would silently borrow another block's twin — a
    // read-only block called plainly `security` used to map onto
    // `security-findings` and pass this test without a twin of its own. The
    // suffix assertion and the injectivity check below close that door.
    const twins: string[] = [];
    for (const block of ACTION_BLOCKS) {
      if (!block.readOnly) continue;
      expect(block.id.endsWith('-review'), block.id).toBe(true);
      const axis = block.id.slice(0, -'-review'.length);
      expect(axis.length, block.id).toBeGreaterThan(0);
      const twin = findBlock(`${axis}-findings`);
      expect(twin, block.id).toBeDefined();
      expect(twin?.produces, block.id).toBe(true);
      expect(twin?.readOnly, block.id).toBe(false);
      twins.push(`${axis}-findings`);
    }
    expect(new Set(twins).size, 'two read-only blocks share one twin').toBe(twins.length);
  });

  it('gives every `-findings` block a declared axis it actually writes into', () => {
    // The OTHER direction of the pairing, which the loop above cannot reach:
    // it only ever visits the two read-only blocks, so `review-findings` — the
    // findings block with no `-review` twin — went unexercised. Every findings
    // block must still declare an axis, and the axis in its ID must be the
    // directory its prompt writes into, or the per-axis directory that keeps
    // two findings nodes from colliding is decided by the prompt alone.
    const axes: string[] = [];
    for (const block of ACTION_BLOCKS) {
      if (!block.id.endsWith('-findings')) continue;
      expect(block.produces, block.id).toBe(true);
      const axis = block.id.slice(0, -'-findings'.length);
      expect(axis.length, block.id).toBeGreaterThan(0);
      expect(block.promptTemplate.includes(`\`.huu/findings/${axis}/001-`), block.id).toBe(true);
      axes.push(axis);
    }
    expect(axes).toEqual(FINDINGS_BLOCK_IDS.map((id) => id.slice(0, -'-findings'.length)));
    expect(new Set(axes).size).toBe(axes.length);
  });

  it('gives every findings block a mechanically checkable judge clause', () => {
    for (const block of findingsBlocks) {
      const clause = block.judgeClause ?? '';
      expect(clause.length, block.id).toBeGreaterThan(0);
      // The clause must be something a judge can run a command against, not a
      // vibe: it names the list, the on-disk task files and the placeholder ban.
      expect(clause.includes('committed'), block.id).toBe(true);
      expect(clause.includes('placeholder'), block.id).toBe(true);
      expect(clause.includes('owned by two tasks'), block.id).toBe(true);
    }
  });

  it('anchors every promise the block makes in the prompt itself', () => {
    // Each anchor is a contract the compiler, the judge or the NEXT step
    // depends on. Losing one silently breaks the fan-out below the node.
    const anchors = [
      '$goal', // the graph objective reaches the auditor
      '## Files this task OWNS', // per-task file ownership, as taskSpecContract does
      'PARTITION BY FILE OWNERSHIP', // why ownership exists: parallel branches merge
      'ONE AGENT PER TASK FILE',
      'MEMORY CONTRACT appended at the end of this prompt', // format comes from run time
      'git add', // an uncommitted file does not exist for the next step
      'commit',
      'SELF-CHECK',
    ];
    for (const block of findingsBlocks) {
      for (const anchor of anchors) {
        expect(block.promptTemplate.includes(anchor), `${block.id} / ${anchor}`).toBe(true);
      }
    }
  });

  it('tells the agent to list the TASK FILES, not the source files', () => {
    // The fan-out substitutes `$file` with the listed path, so listing source
    // files would hand the fixer a file instead of its briefing.
    for (const block of findingsBlocks) {
      expect(
        block.promptTemplate.includes('List the task files, never the source files'),
        block.id,
      ).toBe(true);
    }
  });

  it('keeps an empty result legitimate instead of inviting invented findings', () => {
    for (const block of findingsBlocks) {
      expect(block.promptTemplate.includes('An empty list is a valid'), block.id).toBe(true);
    }
  });

  it('probes the DELIVERABLE directory, never its parent', () => {
    // `git check-ignore -q .huu` is a FALSE NEGATIVE under `.huu/**`: that
    // pattern ignores everything INSIDE `.huu` without ignoring `.huu`
    // itself, so the parent answers "OK" while every task file is dropped by
    // `git add`. The real-git block below proves it.
    for (const block of findingsBlocks) {
      expect(block.promptTemplate.includes('git check-ignore -q .huu/findings'), block.id).toBe(
        true,
      );
      expect(block.promptTemplate.includes('git check-ignore -q .huu`'), block.id).toBe(false);
    }
  });

  it('names every .gitignore form the rewrite has to match', () => {
    // The rewrite WORKS for all four; only the instruction used to name one,
    // and an agent that cannot recognize the line it must replace does not
    // apply a remedy that works.
    for (const block of findingsBlocks) {
      for (const form of ['`.huu/`', '`.huu`', '`/.huu/`', '`.huu/**`']) {
        expect(block.promptTemplate.includes(form), `${block.id} / ${form}`).toBe(true);
      }
      expect(block.promptTemplate.includes('`.huu/*`'), block.id).toBe(true);
      expect(block.promptTemplate.includes('`!.huu/findings/`'), block.id).toBe(true);
    }
  });

  it('gives each findings block its OWN output directory', () => {
    // Two findings nodes can sit in the same wave; a shared directory would put
    // their branches in conflict on the very files the hand-over depends on.
    const dirs = findingsBlocks.map((block) => {
      const match = block.promptTemplate.match(/`\.huu\/findings\/([a-z-]+)\//);
      expect(match, block.id).not.toBeNull();
      return match?.[1];
    });
    expect(new Set(dirs).size).toBe(findingsBlocks.length);
  });

  it('states in pt-BR that the block WRITES, so nobody confuses it with the review twin', () => {
    for (const block of findingsBlocks) {
      expect(block.description.includes('ESCREVE'), block.id).toBe(true);
    }
  });
});

describe('node-catalog / the `-findings` persistence instruction, against REAL git', () => {
  // The instruction in STEP 5 is the difference between a fan-out of N agents
  // and a fan-out of zero: the next step reads the MERGED worktree, so a task
  // file `git add` refuses to stage does not exist. This block runs actual git
  // in a throwaway repo — the house rule for anything git-adjacent — over the
  // four `.gitignore` forms a real project writes.
  const IGNORE_FORMS = ['.huu/', '.huu', '/.huu/', '.huu/**'];
  const TASK_FILE = '.huu/findings/security/001-command-injection.md';
  const LIST_FILE = '.huu/findings/mapear.json';

  function git(cwd: string, args: string[]): string {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'huu test',
        GIT_AUTHOR_EMAIL: 'test@huu.invalid',
        GIT_COMMITTER_NAME: 'huu test',
        GIT_COMMITTER_EMAIL: 'test@huu.invalid',
      },
    });
  }

  /** `git check-ignore -q <path>`: exit 0 = ignored, exit 1 = not ignored. */
  function isIgnored(cwd: string, path: string): boolean {
    try {
      execFileSync('git', ['check-ignore', '-q', path], { cwd, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  function makeRepo(ignoreLine: string): string {
    const root = mkdtempSync(join(tmpdir(), 'huu-findings-gitignore-'));
    git(root, ['init', '-q']);
    writeFileSync(join(root, '.gitignore'), `node_modules/\n${ignoreLine}\ndist/\n`, 'utf8');
    writeFileSync(join(root, 'README.md'), '# repo\n', 'utf8');
    git(root, ['add', '.gitignore', 'README.md']);
    git(root, ['commit', '-qm', 'seed']);
    // What the agent writes in STEP 2 and STEP 4.
    mkdirSync(join(root, '.huu/findings/security'), { recursive: true });
    writeFileSync(join(root, TASK_FILE), '# 001 — fix it\n', 'utf8');
    writeFileSync(join(root, LIST_FILE), '[]\n', 'utf8');
    return root;
  }

  /** The MINIMAL rewrite the prompt prescribes, whatever form the line took. */
  function applyPrescribedRewrite(root: string, ignoreLine: string): void {
    const current = readFileSync(join(root, '.gitignore'), 'utf8');
    expect(current.includes(`\n${ignoreLine}\n`)).toBe(true);
    writeFileSync(
      join(root, '.gitignore'),
      current.replace(`\n${ignoreLine}\n`, '\n.huu/*\n!.huu/findings/\n'),
      'utf8',
    );
  }

  it.each(IGNORE_FORMS)('detects and repairs `%s`, so the task files reach the merge', (form) => {
    const root = makeRepo(form);
    try {
      // 1. The probe the prompt tells the agent to run must SEE the problem.
      expect(isIgnored(root, '.huu/findings'), `${form}: probe before the fix`).toBe(true);

      // 2. The rewrite the prompt prescribes.
      applyPrescribedRewrite(root, form);

      // 3. The probe now says OK, and git actually stages the deliverables.
      expect(isIgnored(root, '.huu/findings'), `${form}: probe after the fix`).toBe(false);
      git(root, ['add', '.gitignore', '.huu/findings']);
      git(root, ['commit', '-qm', 'findings']);
      const tracked = git(root, ['ls-files', '--cached', '.huu']).split('\n').filter(Boolean);
      expect(tracked.sort(), form).toEqual([LIST_FILE, TASK_FILE].sort());
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('would have been fooled by the old probe on the parent directory', () => {
    // The regression this fix exists for, kept as a live demonstration: under
    // `.huu/**` the parent is NOT ignored, so the old `git check-ignore -q
    // .huu` reported OK while the deliverables were being dropped.
    const root = makeRepo('.huu/**');
    try {
      expect(isIgnored(root, '.huu'), 'old probe (parent)').toBe(false);
      expect(isIgnored(root, '.huu/findings'), 'new probe (deliverable)').toBe(true);
      expect(isIgnored(root, TASK_FILE), 'the task file itself').toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('node-catalog / findBlock + blockIds', () => {
  it('finds every shipped block by id', () => {
    for (const id of EXPECTED_BLOCK_ORDER) {
      expect(findBlock(id)?.id).toBe(id);
    }
  });

  it('returns undefined for an unknown id', () => {
    expect(findBlock('does-not-exist')).toBeUndefined();
    expect(findBlock('')).toBeUndefined();
  });

  it('lists ids in palette order', () => {
    expect(blockIds()).toEqual(EXPECTED_BLOCK_ORDER);
  });

  it('hands back a fresh array the caller may mutate', () => {
    const ids = blockIds();
    ids.push('mutated');
    expect(blockIds()).toEqual(EXPECTED_BLOCK_ORDER);
  });
});

describe('node-catalog / NODE_KINDS', () => {
  it('describes all four node kinds, entry first', () => {
    expect(NODE_KINDS.map((info) => info.kind)).toEqual(['prompt', 'action', 'research', 'gate']);
  });

  it('gives every kind a label and a description', () => {
    for (const info of NODE_KINDS) {
      expect(info.label.length, info.kind).toBeGreaterThan(0);
      expect(info.description.length, info.kind).toBeGreaterThan(0);
    }
  });
});

describe('node-catalog / methodologyOptions', () => {
  it('projects the registry rather than re-declaring it', () => {
    expect(methodologyOptions().map((option) => option.key)).toEqual(
      DEV_METHODOLOGIES.map((definition) => definition.key),
    );
  });

  it('carries the label and description of each registry entry', () => {
    const options = methodologyOptions();
    for (const [index, definition] of DEV_METHODOLOGIES.entries()) {
      expect(options[index]?.label).toBe(definition.label);
      expect(options[index]?.description).toBe(definition.description);
    }
  });

  it('does not leak the CLI flag or the planner bullet into the browser payload', () => {
    for (const option of methodologyOptions()) {
      expect(Object.keys(option).sort()).toEqual(['description', 'key', 'label']);
    }
  });

  it('hands back a fresh array every call', () => {
    const first = methodologyOptions();
    first.pop();
    expect(methodologyOptions().length).toBe(DEV_METHODOLOGIES.length);
  });
});
