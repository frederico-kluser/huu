import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentFactory } from '../../types.js';
import { createDisposableState } from '../_shared/lifecycle.js';

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
  const lifecycle = createDisposableState([]);

  return {
    agentId: task.agentId,
    task,
    async abort(): Promise<void> {
      // Disposing flips the flag the prompt loop polls every step.
      // No real cancellation channel exists for the stub.
      await lifecycle.dispose();
    },
    async prompt(message: string): Promise<void> {
      const target = task.files.length === 0 ? 'whole project' : task.files[0];
      onEvent({
        type: 'log',
        message: `stub agent #${task.agentId} starting on ${target}`,
      });
      onEvent({ type: 'state_change', state: 'streaming' });

      // Simulate streamed output the way a real backend does: deltas that do
      // NOT line up with line boundaries, plus a thinking channel. Exercises
      // the orchestrator's line coalescing and the web firehose end-to-end.
      onEvent({ type: 'stream', channel: 'thinking', delta: 'Considering how to handle ' });
      onEvent({ type: 'stream', channel: 'thinking', delta: `${target}...\n` });

      const totalDelay = 2000 + Math.floor(Math.random() * 3000);
      const steps = 3;
      const stepDelay = totalDelay / steps;

      for (let i = 0; i < steps; i++) {
        await new Promise((resolve) => setTimeout(resolve, stepDelay));
        if (lifecycle.isDisposed()) return;
        onEvent({ type: 'stream', channel: 'assistant', delta: `step ${i + 1}: ` });
        onEvent({ type: 'stream', channel: 'assistant', delta: 'simulating LLM call...\n' });
        onEvent({
          type: 'log',
          message: `stub step ${i + 1}/${steps}: simulating LLM call...`,
        });
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
        onEvent({
          type: 'error',
          message: `failed to write stub file: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }

      onEvent({ type: 'done' });
    },
    dispose: lifecycle.dispose,
  };
};
