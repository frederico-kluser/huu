import type { IntegrationStatus } from '../lib/types.js';

/**
 * Builds the prompt for the integration agent. Adapted from pi-orq.
 *
 * Concrete steps, not generic instructions; structured XML for cross-model
 * compatibility; dynamic content at the bottom.
 */
export function buildIntegrationPrompt(
  branchesMerged: string[],
  branchesPending: string[],
  conflicts: IntegrationStatus['conflicts'],
  integrationBranch: string,
): string {
  const lines: string[] = [];

  lines.push('<task>');
  lines.push(`Merge all agent branches into integration branch: ${integrationBranch}`);
  lines.push('</task>');
  lines.push('');

  if (branchesMerged.length > 0) {
    lines.push('<merged>');
    for (const b of branchesMerged) lines.push(`- ${b}`);
    lines.push('</merged>');
    lines.push('');
  }

  if (branchesPending.length > 0) {
    lines.push('<pending>');
    for (const b of branchesPending) lines.push(`- ${b}`);
    lines.push('</pending>');
    lines.push('');
  }

  if (conflicts.length > 0) {
    lines.push('<conflicts>');
    for (const c of conflicts) {
      lines.push(`- ${c.file} (from: ${c.branches.join(', ')})`);
    }
    lines.push('</conflicts>');
    lines.push('');
    lines.push('<resolution-steps>');
    lines.push('1. For each pending branch, run `git merge <branch-name>` via the bash tool');
    lines.push('2. Read conflicting files to understand both sides');
    lines.push('3. Edit files to combine changes correctly — preserve all intended modifications');
    lines.push('4. Run `git add <file>` on each resolved file');
    lines.push('5. Run `git commit -m "..."` to complete each merge');
    lines.push('6. Repeat for each pending branch');
    lines.push('</resolution-steps>');
    lines.push('');
  }

  if (branchesPending.length === 0 && conflicts.length === 0) {
    lines.push('<status>All branches merged successfully. Verify integrated code is consistent.</status>');
    lines.push('');
  }

  lines.push('<output>');
  lines.push('Summarize: branches merged, conflicts resolved (and how), any concerns.');
  lines.push('</output>');

  return lines.join('\n');
}
