import type { AgentPortBundle } from './port-allocator.js';
import { formatPortGuidanceForPrompt } from './agent-env.js';

/**
 * The per-agent header, prepended to the FIRST message every backend sends
 * (`_shared/build-message.ts`). It is the highest-priority text the agent ever
 * reads, which is exactly why it must not contradict the step prompt below it.
 *
 * WHAT THIS FILE USED TO SAY, AND WHY IT WAS A DEFECT.
 * The original header was inherited from a linear refactoring tool and framed
 * every run as a "Refactoring Session". Two of its rules actively fought the
 * pipelines huu actually runs:
 *
 *  - `files.length > 0` rendered "## Assigned Files" + "ONLY modify files from
 *    your assigned list". For a `memory`-scope task `files` is `[<the spec
 *    path>]` — so the agent was told its one editable file was its own
 *    briefing, while the step prompt forbade touching it and pointed at a
 *    completely different list inside it. It also said "Do NOT create new
 *    files unless absolutely necessary for the refactoring" and "Maintain or
 *    improve test coverage", which contradict a step that exists to create
 *    files and a TDD step that freezes the tests.
 *  - `files.length === 0` — every judge, critic, recon and reporter — said
 *    "you may read and modify any file … Apply changes using the edit tool",
 *    directly above prompts that say "You report. You do NOT write code."
 *
 * The replacement states only what is TRUE of a huu agent, and takes its write
 * scope from {@link AgentSystemPromptOptions.ownedPaths} (the spec's own
 * `## Files this task OWNS`) when the orchestrator could resolve one.
 */
export interface AgentSystemPromptOptions {
  agentId: number;
  /** The step this agent is executing. Shown so the agent can situate itself. */
  stageName?: string;
  /** The step prompt. */
  prompt: string;
  /**
   * What was decomposed onto this agent. For a `memory`-scope task this is the
   * SPEC path (the briefing), not the work targets — which is why it is
   * rendered as the assignment and never as the write scope.
   */
  files: string[];
  /**
   * Repo-relative paths this agent may write, as declared by its own spec.
   * When present it is the authoritative write scope. When absent the header
   * falls back to `files`, which is correct for a classic per-file step.
   */
  ownedPaths?: string[];
  /** Report-only role: no `edit`/`write` tool is available to this session. */
  readOnly?: boolean;
  /** Globs the STEP declared as its writable surface (`WorkStep.writes`). */
  writes?: string[];
  branchName?: string;
  worktreePath?: string;
  ports?: AgentPortBundle;
  shimAvailable?: boolean;
}

function gitBlock(o: AgentSystemPromptOptions): string {
  if (!o.branchName) return '';
  return `
## Git Context
- **Branch**: \`${o.branchName}\`
- **Worktree**: \`${o.worktreePath || 'shared workspace'}\`
- This is an isolated worktree — a full copy of the repository. Run every command from here.
- Other agents are working in their OWN worktrees at the same time. Your branch is merged with theirs when this stage ends.
- huu commits your work and manages every remote operation. You do not need to commit, and you must **NEVER run \`git push\`** — pushing from an agent worktree breaks the run.
`;
}

/**
 * The write scope, stated once, in the strongest terms the situation supports.
 * Order matters: the spec's declared ownership is the real contract, the
 * step's `writes` globs are the declarative fallback, and the per-file list is
 * the classic case.
 */
function scopeBlock(o: AgentSystemPromptOptions): string {
  if (o.readOnly) {
    return `## Scope — REPORT ONLY
You do not change this repository. The \`edit\` and \`write\` tools are not available in this session; \`read\`, \`grep\`, \`find\`, \`ls\` and \`bash\` are. Read whatever you need and run whatever commands you need to gather evidence — then report. Attempting to modify a file is not a failure you need to route around: it is simply not part of this role.`;
  }

  const lines: string[] = ['## Scope'];

  if (o.files.length > 0) {
    lines.push('Your assignment is briefed in:');
    for (const f of o.files) lines.push(`- \`${f}\``);
    lines.push('');
  }

  if (o.ownedPaths && o.ownedPaths.length > 0) {
    lines.push('The files you may WRITE are exactly these, as declared by your own spec:');
    for (const p of o.ownedPaths) lines.push(`- \`${p}\``);
    lines.push('');
    lines.push(
      'You may READ anything in the repository. Writing outside that list — including a file another task owns — produces a merge conflict that costs the whole stage. Creating a new file is fine when your spec asks for it.',
    );
  } else if (o.writes && o.writes.length > 0) {
    lines.push('The step declares this writable surface:');
    for (const g of o.writes) lines.push(`- \`${g}\``);
    lines.push('');
    lines.push('You may READ anything. Write only inside that surface.');
  } else if (o.files.length > 0) {
    lines.push(
      'Those are also the files you are expected to change. You may READ anything; change files outside the list only when the task genuinely requires it, and say so in your summary.',
    );
  } else {
    lines.push(
      'Whole project — this step declares no file scope. You may read and change whatever the task requires. Prefer the smallest change that satisfies it.',
    );
  }

  return lines.join('\n');
}

function rulesBlock(o: AgentSystemPromptOptions): string {
  if (o.readOnly) {
    return `## Rules
1. Gather evidence before concluding. Run the commands, read the files, quote what you saw.
2. Report what you can prove. "I could not verify this" is a correct and cheap answer — prefer it to a guess.
3. Do not run git commands that change state (no commit, no branch, no push). Reading history is fine.
4. Follow the output contract in the task below exactly. A malformed answer is worse than a short one.`;
  }
  return `## Rules
1. Do the task. Do not widen it — no refactors, no cleanups and no "improvements" nobody asked for.
2. Stay inside your write scope above.
3. Match the surrounding code's style, module system and error handling. Follow the project's own conventions over your defaults.
4. Preserve existing public APIs unless the task explicitly requires changing them.
5. Verify your work against the task's acceptance criteria before you finish.
6. **NEVER run \`git push\`.** huu owns every remote operation.`;
}

/**
 * Generates the per-agent header: role, scope, git context, rules, and the
 * step's own prompt.
 */
export function generateAgentSystemPrompt(options: AgentSystemPromptOptions): string {
  const title = options.stageName ? `Agent ${options.agentId} — ${options.stageName}` : `Agent ${options.agentId}`;
  const role = options.readOnly
    ? `You are Agent ${options.agentId} in a huu run, in a reviewing role. Another agent produced the work you are looking at; you evaluate it and report. You do not implement.`
    : `You are Agent ${options.agentId} in a huu run — one worker in a wave of agents, each in its own git worktree, all merging at the end of this stage.`;
  const portContext = options.ports
    ? formatPortGuidanceForPrompt(options.ports, options.shimAvailable ?? false)
    : '';

  return `# ${title}

## Your Role
${role}

${scopeBlock(options)}

## Task
${options.prompt}
${gitBlock(options)}${portContext}
${rulesBlock(options)}

## When you finish
State what you changed (or, in a reviewing role, what you concluded), file by file, and name anything you could not do and why.`;
}

/**
 * System prompt for the integration agent that resolves merge conflicts
 * via LLM. The integration agent IS allowed to run git commands.
 */
export function generateIntegrationSystemPrompt(
  agentId: number,
  integrationBranch: string,
  worktreePath: string,
): string {
  return `# Agent ${agentId} — Integration Session

## Your Role
You are the integration agent in a multi-agent orchestrator. Your job is to merge agent branches into the integration branch and resolve any merge conflicts.

## Git Context
- **Integration Branch**: \`${integrationBranch}\`
- **Worktree**: \`${worktreePath}\`
- You are working in the integration worktree.

## Rules
1. Run git commands as instructed (merge, stage, commit).
2. **NEVER run \`git push\`** — the orchestrator manages remote synchronization. Pushing from the integration agent will break the pipeline.
3. When resolving conflicts, read both versions, understand the intent, and combine changes correctly.
4. Do NOT discard changes from any branch — preserve all intended modifications.
5. After resolving conflicts, stage the resolved files and complete the merge.
6. Provide a clear summary of what was merged and how conflicts were resolved.`;
}
