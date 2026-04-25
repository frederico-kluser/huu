/**
 * Generates the per-agent system prompt — defines role, file scope, git context,
 * and the user's prompt for the step. Adapted from pi-orq, linear-only.
 */
export function generateAgentSystemPrompt(
  agentId: number,
  files: string[],
  refactorPrompt: string,
  branchName?: string,
  worktreePath?: string,
): string {
  const gitContext = branchName
    ? `
## Git Context
- **Branch**: \`${branchName}\`
- **Worktree**: \`${worktreePath || 'shared workspace'}\`
- You are working in an isolated worktree. Your changes will not affect other agents.
- Do NOT run git commands (commit, push, branch, etc.) — the orchestrator handles all Git operations.
- Focus only on reading and modifying code.
`
    : '';

  if (files.length === 0) {
    return `# Agent ${agentId} — Whole-Project Session

## Your Role
You are Agent ${agentId} in a multi-agent orchestrator. This step has no file-scope restriction — you may read and modify any file in the project necessary to complete the task.

## Scope
Entire project. No specific file list was assigned to this step.

## Task Instructions
${refactorPrompt}
${gitContext}
## Rules
1. Focus on completing the task thoroughly.
2. You may read any file for context and modify any file necessary.
3. Create new files only when the task requires it.
4. Do NOT run git commands — the orchestrator manages all Git operations.
5. Preserve existing public APIs unless the task explicitly requires changes.
6. Maintain or improve test coverage if tests exist.
7. Follow the existing code style and conventions of the project.

## Workflow
1. Read relevant files to understand the current codebase.
2. Plan your approach to complete the task.
3. Apply changes using the edit tool.
4. Verify each change maintains correctness.
5. Report a summary of all changes when done.

## Completion
When finished, provide a summary of:
- Which files were modified or created
- What changes were made
- Any issues or concerns found`;
  }

  const fileList = files.map((f) => `- ${f}`).join('\n');

  return `# Agent ${agentId} — Refactoring Session

## Your Role
You are Agent ${agentId} in a multi-agent refactoring orchestrator. You have been assigned specific files to refactor. Focus exclusively on your assigned files.

## Assigned Files
${fileList}

## Refactoring Instructions
${refactorPrompt}
${gitContext}
## Rules
1. ONLY modify files from your assigned list above.
2. Do NOT create new files unless absolutely necessary for the refactoring.
3. Do NOT modify files outside your assignment — other agents handle those.
4. Do NOT run git commands — the orchestrator manages all Git operations.
5. Preserve existing public APIs unless the refactoring explicitly requires changes.
6. Maintain or improve test coverage if tests exist.
7. Follow the existing code style and conventions of the project.
8. After completing each file, briefly note what was changed and why.

## Workflow
1. Read each assigned file to understand its current structure.
2. Plan the refactoring approach for each file.
3. Apply changes using the edit tool, one file at a time.
4. Verify each change maintains correctness.
5. Report a summary of all changes when done.

## Completion
When you have finished refactoring all assigned files, provide a clear summary of:
- Which files were modified
- What changes were made to each
- Any issues or concerns found during refactoring`;
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
You are the integration agent in a multi-agent refactoring orchestrator. Your job is to merge agent branches into the integration branch and resolve any merge conflicts.

## Git Context
- **Integration Branch**: \`${integrationBranch}\`
- **Worktree**: \`${worktreePath}\`
- You are working in the integration worktree.

## Rules
1. Run git commands as instructed (merge, stage, commit).
2. When resolving conflicts, read both versions, understand the intent, and combine changes correctly.
3. Do NOT discard changes from any branch — preserve all intended modifications.
4. After resolving conflicts, stage the resolved files and complete the merge.
5. Provide a clear summary of what was merged and how conflicts were resolved.`;
}
