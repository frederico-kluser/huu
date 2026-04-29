import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentFactory } from './types.js';

/**
 * Fake LLM agent for M4 verification. Sleeps a randomized few seconds,
 * writes a stub markdown file inside the worktree, emits a few log events.
 */
export const stubAgentFactory: AgentFactory = async (
  task,
  _config,
  _systemPromptHint,
  cwd,
  onEvent,
  _runtimeContext,
) => {
  let disposed = false;

  return {
    agentId: task.agentId,
    task,
    async prompt(message: string): Promise<void> {
      onEvent({ type: 'log', message: `stub agent #${task.agentId} starting on ${task.files.length === 0 ? 'whole project' : task.files[0]}` });
      onEvent({ type: 'state_change', state: 'streaming' });

      const totalDelay = 2000 + Math.floor(Math.random() * 3000);
      const steps = 3;
      const stepDelay = totalDelay / steps;

      for (let i = 0; i < steps; i++) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
        if (disposed) return;
        onEvent({ type: 'log', message: `stub step ${i + 1}/${steps}: simulating LLM call...` });
      }

      const safeName = task.stageName.replace(/[^a-z0-9-_]/gi, '_');
      const stubFile = `STUB_${safeName}_${task.agentId}.md`;
      const stubPath = join(cwd, stubFile);
      const content = [
        `# Stub run for stage "${task.stageName}", agent ${task.agentId}`,
        '',
        `Files: ${task.files.length === 0 ? '(whole project)' : task.files.join(', ')}`,
        `Prompt received:`,
        '',
        '```',
        message,
        '```',
      ].join('\n');

      try {
        writeFileSync(stubPath, content, 'utf8');
        onEvent({ type: 'file_write', file: stubFile });
        onEvent({ type: 'log', message: `wrote ${stubFile}` });
      } catch (err) {
        onEvent({ type: 'error', message: `failed to write stub file: ${err instanceof Error ? err.message : String(err)}` });
        return;
      }

      onEvent({ type: 'done' });
    },
    async dispose(): Promise<void> {
      disposed = true;
    },
  };
};
