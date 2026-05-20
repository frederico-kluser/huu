import type { AgentTask } from '../lib/types.js';

/**
 * Creates one task per file. Empty `files` produces a single whole-project task.
 * `branchName`, `worktreePath`, `stageIndex`, `stageName` are filled by the
 * orchestrator before dispatch.
 */
export function decomposeTasks(
  files: string[],
  startAgentId: number,
  stageIndex: number,
  stageName: string,
): AgentTask[] {
  if (files.length === 0) {
    return [
      {
        agentId: startAgentId,
        files: [],
        branchName: '',
        worktreePath: '',
        stageIndex,
        stageName,
      },
    ];
  }
  return files.map((file, i) => ({
    agentId: startAgentId + i,
    files: [file],
    branchName: '',
    worktreePath: '',
    stageIndex,
    stageName,
  }));
}
