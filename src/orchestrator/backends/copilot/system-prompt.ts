import type { AgentTask } from '../../../lib/types.js';
import type { AgentPortBundle } from '../../port-allocator.js';
import { buildAgentMessageHeader } from '../_shared/build-message.js';

/**
 * Wraps the shared role/scope header with Copilot-specific safety notes.
 *
 * Why a wrapper instead of editing `agents-md-generator`: the Pi system
 * prompt already forbids ALL git commands (commit/push/branch/etc.), so
 * the stash hazard never materializes for Pi. Copilot's CLI emits its
 * own coding agent persona that DOES use git, and `git stash` is global
 * to the repo — colliding across worktrees (issue copilot-cli/1725).
 * Adding the rule for everyone would just be noise on the Pi side.
 */
export function buildCopilotMessageHeader(
  task: AgentTask,
  userPrompt: string,
  cwd: string,
  ports?: AgentPortBundle,
  shimAvailable = false,
): string {
  const base = buildAgentMessageHeader(task, userPrompt, cwd, ports, shimAvailable);
  return `${base}\n\n## Git Stash Warning\n\nNEVER run \`git stash\` — \`refs/stash\` is shared across worktrees in the same repo (Copilot CLI issue #1725). If you need to set work aside, commit to a temporary branch with \`git commit --no-verify\` instead.\n`;
}
