import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { AgentEvent, AgentFactory, SpawnedAgent } from '../../types.js';
import { buildAgentMessageHeader } from '../_shared/build-message.js';
import { createDisposableState } from '../_shared/lifecycle.js';
import { translateJcodeOutput } from './event-mapper.js';
import { buildJcodeSessionEnvironment } from './hermetic.js';

/**
 * jcodeAgentFactory — spawns `jcode run` as a subprocess.
 *
 * Unlike the pi backend which uses the `@mariozechner/pi-coding-agent` SDK,
 * this backend invokes the `jcode` CLI via `child_process.spawn`. The subprocess
 * receives the prompt on stdin, emits tagged stdout lines (`[write]`, `[tokens]`,
 * `[thinking]`, etc.) that the event mapper translates into uniform AgentEvents,
 * and exits when the turn completes.
 *
 * Hermetic by default:
 *  - `JCODE_MEMORY_ENABLED=false` — zero embeddings, stateless runs.
 *  - `JCODE_NO_TELEMETRY=1` — no external telemetry.
 *  - Agent dir → `~/.huu/jcode-agent` — isolated runtime.
 *
 * The escape hatch `HUU_JCODE_HERMETIC=0` reverts to host-global jcode config.
 */

/** CLI arguments common to every jcode spawn. */
const JCODE_BASE_ARGS = ['run', '--no-update'] as const;

export const jcodeAgentFactory: AgentFactory = async (
  task,
  config,
  _systemPromptHint,
  cwd,
  onEvent,
  runtimeContext,
) => {
  const modelId = config.modelId.trim();
  if (!modelId) throw new Error('Model ID missing.');

  // Hermetic composition: isolated env so jcode never reads host-global config,
  // never writes embeddings, and never sends telemetry.
  const jcodeEnv = buildJcodeSessionEnvironment();
  if (jcodeEnv.hermetic) {
    onEvent({
      type: 'log',
      message: `jcode hermetic: agent dir=${jcodeEnv.agentDir}, memory=off, telemetry=off`,
    });
  }

  const lifecycle = createDisposableState([]);

  // Track the full transcript for getTranscript() — every stdout line.
  const transcriptLines: string[] = [];

  let child: ChildProcess | null = null;

  // Resolved when the subprocess exits (or errors on spawn).
  let resolveDone: (() => void) | null = null;
  let rejectDone: ((err: Error) => void) | null = null;

  const donePromise = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });

  function spawnJcode(promptText: string): ChildProcess {
    const args = [
      ...JCODE_BASE_ARGS,
      '--provider-profile',
      'deepseek-v4-pro',
      '--model',
      modelId,
    ];

    onEvent({
      type: 'log',
      message: `jcode spawn: jcode ${args.join(' ')}`,
    });

    const proc = spawn('jcode', args, {
      cwd,
      env: jcodeEnv.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child = proc;

    // ---- stdout: translate each line through the event mapper ----
    const stdout = createInterface({ input: proc.stdout! });
    stdout.on('line', (line: string) => {
      transcriptLines.push(line);
      try {
        translateJcodeOutput(line, onEvent);
      } catch (err) {
        onEvent({
          type: 'log',
          level: 'warn',
          message: `jcode event translate error: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
      }
    });

    // ---- stderr: surface as warn-level logs ----
    const stderr = createInterface({ input: proc.stderr! });
    stderr.on('line', (line: string) => {
      transcriptLines.push(`[stderr] ${line}`);
      onEvent({
        type: 'log',
        level: 'warn',
        message: `jcode stderr: ${line}`,
      });
    });

    // ---- lifecycle events ----
    proc.on('error', (err) => {
      onEvent({
        type: 'error',
        message: `jcode spawn error: ${err.message}`,
      });
      rejectDone?.(err);
    });

    proc.on('close', (code, signal) => {
      if (signal) {
        onEvent({
          type: 'log',
          message: `jcode process killed by signal ${signal}`,
        });
      }
      if (code !== 0 && code !== null && !signal) {
        const msg = `jcode exited with code ${code}`;
        onEvent({ type: 'error', message: msg });
        rejectDone?.(new Error(msg));
        return;
      }
      resolveDone?.();
    });

    // ---- Write prompt to stdin and close it ----
    proc.stdin!.write(promptText);
    proc.stdin!.end();

    return proc;
  }

  const spawned: SpawnedAgent = {
    agentId: task.agentId,
    task,

    async abort(): Promise<void> {
      // SIGTERM tells jcode to stop the current model call gracefully. The
      // subprocess will emit any remaining output and exit. If it doesn't exit
      // within a reasonable time, the orchestrator's dispose() will handle it.
      if (lifecycle.isDisposed()) return;
      if (child && !child.killed) {
        child.kill('SIGTERM');
      }
    },

    async checkpoint(): Promise<string | null> {
      // jcode runs as a subprocess with no persistent session file — there is
      // no checkpoint to capture. The orchestrator falls back to kill+requeue
      // (today's behavior), which is correct: jcode is stateless with
      // JCODE_MEMORY_ENABLED=false, so the re-ran agent just re-reads the
      // worktree files and continues idempotently.
      return null;
    },

    async steer(_message: string): Promise<void> {
      // jcode subprocess has no mid-flight steering channel — the stdin is
      // already closed after the initial prompt. The orchestrator simply logs
      // the steer message as an event.
      onEvent({
        type: 'log',
        level: 'warn',
        message: 'jcode backend does not support steer(); message dropped',
      });
    },

    async prompt(message: string): Promise<void> {
      lifecycle.assertLive();

      const fullMessage = buildAgentMessageHeader(
        task,
        message,
        cwd,
        runtimeContext?.ports,
        runtimeContext?.shimAvailable ?? false,
      );

      // Spawn the subprocess and pipe the full prompt.
      spawnJcode(fullMessage);

      try {
        await donePromise;
      } catch (err) {
        // The error is already emitted via onEvent above. Re-throw so the
        // orchestrator can record the failure on the task.
        throw err;
      }

      // If the subprocess exited successfully but left an error in its last
      // lines, surface it.
      const lastError = findLastError(transcriptLines);
      if (lastError) {
        onEvent({ type: 'error', message: lastError });
        throw new Error(lastError);
      }

      onEvent({ type: 'done' });
    },

    async getTranscript(): Promise<string> {
      // The raw stdout transcript, one line per entry. Callers (e.g. the
      // CheckStep judge) use this as a SECOND verdict source when events may
      // have been dropped or truncated. Never throws.
      try {
        return transcriptLines.join('\n');
      } catch {
        return '';
      }
    },

    dispose: async () => {
      if (lifecycle.isDisposed()) return;
      // Kill the child if still running. SIGKILL is the dispose guarantee:
      // we've already attempted a graceful abort (SIGTERM) before dispose,
      // so at this point the agent MUST stop.
      if (child && !child.killed) {
        child.kill('SIGKILL');
        child = null;
      }
      await lifecycle.dispose();
    },
  };

  return spawned;
};

/**
 * Scan the transcript for a jcode `[error]` line and return the message.
 * Used after the subprocess exits successfully (code 0) but jcode itself
 * reported a logical error.
 */
function findLastError(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i]!.match(/^\[error\]\s?(.+)$/i);
    if (m) return m[1]!;
  }
  return null;
}
