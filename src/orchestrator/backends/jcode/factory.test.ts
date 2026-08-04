import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { translateJcodeOutput } from './event-mapper.js';
import { jcodeAgentFactory, withJcodeApiKey } from './factory.js';
import {
  resolveHermeticEnabled,
  jcodeAgentDir,
  buildJcodeSessionEnvironment,
} from './hermetic.js';
import {
  jcodeMissingApiKeyMessage,
  jcodeMissingExecutableMessage,
} from '../../../lib/jcode-bundle.js';
import type { AgentTask, AppConfig } from '../../../lib/types.js';
import type { AgentEvent } from '../../types.js';

// ---------------------------------------------------------------------------
// event-mapper
// ---------------------------------------------------------------------------

describe('translateJcodeOutput', () => {
  function collect(): { events: AgentEvent[]; emit: (e: AgentEvent) => void } {
    const events: AgentEvent[] = [];
    return { events, emit: (e) => events.push(e) };
  }

  it('ignores empty/whitespace-only lines', () => {
    const { events, emit } = collect();
    translateJcodeOutput('', emit);
    translateJcodeOutput('   ', emit);
    expect(events).toEqual([]);
  });

  it('[start] → state_change(streaming) + log "jcode agent started"', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[start]', emit);
    expect(events).toEqual([
      { type: 'state_change', state: 'streaming' },
      { type: 'log', message: 'jcode agent started' },
    ]);
  });

  it('[write] with path → 3 events including file_write', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[write] src/foo.ts', emit);
    expect(events).toEqual([
      { type: 'state_change', state: 'tool_running' },
      { type: 'log', message: 'tool: write → src/foo.ts' },
      { type: 'file_write', file: 'src/foo.ts' },
    ]);
  });

  it('[edit] with path → 3 events including file_write', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[edit] lib/bar.js', emit);
    expect(events).toEqual([
      { type: 'state_change', state: 'tool_running' },
      { type: 'log', message: 'tool: edit → lib/bar.js' },
      { type: 'file_write', file: 'lib/bar.js' },
    ]);
  });

  it('[read] with path → no file_write', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[read] src/foo.ts', emit);
    expect(events).toEqual([
      { type: 'state_change', state: 'tool_running' },
      { type: 'log', message: 'tool: read → src/foo.ts' },
    ]);
  });

  it('[bash] with command → state_change + log', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[bash] npm test', emit);
    expect(events).toEqual([
      { type: 'state_change', state: 'tool_running' },
      { type: 'log', message: 'tool: bash → npm test' },
    ]);
  });

  it('[tokens] with in/out → usage event + token log', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[tokens] in:100 out:50', emit);
    expect(events).toEqual([
      {
        type: 'usage',
        inputTokens: 100,
        outputTokens: 50,
      },
      { type: 'log', message: 'tokens +100in +50out' },
    ]);
  });

  it('[tokens] with full info (cr, cw, cost, model) → usage carries all', () => {
    const { events, emit } = collect();
    translateJcodeOutput(
      '[tokens] in:200 out:80 cr:800 cw:200 cost:0.001234 model:deepseek-v4-pro',
      emit,
    );
    expect(events).toEqual([
      {
        type: 'usage',
        inputTokens: 200,
        outputTokens: 80,
        cacheReadTokens: 800,
        cacheWriteTokens: 200,
        cost: 0.001234,
        model: 'deepseek-v4-pro',
      },
      { type: 'log', message: 'tokens +200in +80out +800cr +200cw $0.001234' },
    ]);
  });

  it('[tokens] with no meaningful values → no usage event', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[tokens] garbage', emit);
    expect(events).toEqual([]);
  });

  it('[thinking] → stream(thinking) delta', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[thinking] let me reason about this', emit);
    expect(events).toEqual([
      { type: 'stream', channel: 'thinking', delta: 'let me reason about this' },
    ]);
  });

  it('[thinking] with empty body → no event', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[thinking] ', emit);
    expect(events).toEqual([]);
  });

  it('[end] → log "jcode agent finished"', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[end]', emit);
    expect(events).toEqual([{ type: 'log', message: 'jcode agent finished' }]);
  });

  it('[error] → error AgentEvent', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[error] rate limit exceeded', emit);
    expect(events).toEqual([{ type: 'error', message: 'rate limit exceeded' }]);
  });

  it('[error] without message → "unknown jcode error"', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[error]', emit);
    expect(events).toEqual([{ type: 'error', message: 'unknown jcode error' }]);
  });

  it('[retry] → warn-level log with attempt count and reason', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[retry] 2/5 rate limit', emit);
    expect(events).toEqual([
      {
        type: 'log',
        level: 'warn',
        message: 'jcode auto-retry 2/5: rate limit',
      },
    ]);
  });

  it('[retry-ok] → info log', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[retry-ok] 3', emit);
    expect(events).toEqual([
      { type: 'log', message: 'jcode auto-retry recovered on attempt 3' },
    ]);
  });

  it('[retry-exhausted] → warn-level log', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[retry-exhausted] timeout after 60s', emit);
    expect(events).toEqual([
      {
        type: 'log',
        level: 'warn',
        message: 'jcode auto-retry exhausted: timeout after 60s',
      },
    ]);
  });

  it('[compaction] → compaction event with reason', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[compaction] threshold', emit);
    expect(events).toEqual([{ type: 'compaction', reason: 'threshold' }]);
  });

  it('[compaction] without reason → "unknown"', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[compaction]', emit);
    expect(events).toEqual([{ type: 'compaction', reason: 'unknown' }]);
  });

  it('untagged line → stream(assistant) delta', () => {
    const { events, emit } = collect();
    translateJcodeOutput('Here is the result of the analysis:', emit);
    expect(events).toEqual([
      { type: 'stream', channel: 'assistant', delta: 'Here is the result of the analysis:' },
    ]);
  });

  it('unknown tag → log (never silently dropped)', () => {
    const { events, emit } = collect();
    translateJcodeOutput('[unknown-tag] some payload', emit);
    expect(events).toEqual([
      { type: 'log', message: '[unknown-tag] some payload' },
    ]);
  });

  it('does not throw on any input', () => {
    const { emit } = collect();
    expect(() => translateJcodeOutput('', emit)).not.toThrow();
    expect(() => translateJcodeOutput('[start]', emit)).not.toThrow();
    expect(() => translateJcodeOutput('plain text', emit)).not.toThrow();
    expect(() => translateJcodeOutput('[tokens] in:abc out:xyz', emit)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// hermetic
// ---------------------------------------------------------------------------

describe('resolveHermeticEnabled (jcode)', () => {
  it('defaults ON; only explicit 0/false opt out', () => {
    expect(resolveHermeticEnabled({})).toBe(true);
    expect(resolveHermeticEnabled({ HUU_JCODE_HERMETIC: '1' })).toBe(true);
    expect(resolveHermeticEnabled({ HUU_JCODE_HERMETIC: '0' })).toBe(false);
    expect(resolveHermeticEnabled({ HUU_JCODE_HERMETIC: 'false' })).toBe(false);
    expect(resolveHermeticEnabled({ HUU_JCODE_HERMETIC: ' FALSE ' })).toBe(false);
  });
});

describe('jcodeAgentDir', () => {
  it('returns ~/.huu/jcode-agent (ends with the expected tail)', () => {
    const dir = jcodeAgentDir();
    expect(dir.endsWith('.huu/jcode-agent')).toBe(true);
  });
});

describe('buildJcodeSessionEnvironment', () => {
  it('hermetic (default): sets JCODE_MEMORY_ENABLED=false, JCODE_NO_TELEMETRY=1, isolates agent dir', () => {
    const result = buildJcodeSessionEnvironment();
    expect(result.hermetic).toBe(true);
    expect(result.agentDir).toBeDefined();
    expect(result.env.JCODE_MEMORY_ENABLED).toBe('false');
    expect(result.env.JCODE_NO_TELEMETRY).toBe('1');
    expect(result.env.JCODE_AGENT_DIR).toBe(result.agentDir);
  });

  it('hermetic: preserves parent env keys', () => {
    const result = buildJcodeSessionEnvironment({
      env: { PARENT_KEY: 'parent-value' } as NodeJS.ProcessEnv,
    });
    expect(result.env.PARENT_KEY).toBe('parent-value');
  });

  it('legacy escape hatch (HUU_JCODE_HERMETIC=0): returns parent env as-is, no forced vars', () => {
    const parent = { HUU_JCODE_HERMETIC: '0', EXISTING: 'yes' } as NodeJS.ProcessEnv;
    const result = buildJcodeSessionEnvironment({ env: parent });
    expect(result.hermetic).toBe(false);
    expect(result.agentDir).toBeUndefined();
    expect(result.env.EXISTING).toBe('yes');
    // Legacy mode does NOT force the hermetic env vars.
    expect(result.env.JCODE_MEMORY_ENABLED).toBeUndefined();
    expect(result.env.JCODE_NO_TELEMETRY).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Missing binary — the actionable failure
// ---------------------------------------------------------------------------

// huu runs pipelines inside a container that deliberately does NOT ship jcode
// (no public distribution URL exists); the host wrapper lends its own install
// as a read-only mount at /opt/jcode. When neither is there, `spawn('jcode')`
// raises ENOENT and the raw text is `spawn jcode ENOENT` — true and useless.
// This drives the REAL spawn with a PATH that has no jcode.
describe('jcodeAgentFactory — jcode absent from the environment', () => {
  const task: AgentTask = {
    agentId: 1,
    files: ['src/foo.ts'],
    branchName: 'huu/test/agent-1',
    worktreePath: '/tmp/does-not-matter',
    stageIndex: 0,
    stageName: 'Stage 1',
  };
  const config = { apiKey: 'k', modelId: 'deepseek-v4' } as AppConfig;

  async function runWithoutJcodeOnPath(): Promise<{ error: Error; events: AgentEvent[] }> {
    const savedPath = process.env.PATH;
    // A PATH with no jcode anywhere. `spawn` resolves the binary through the
    // env it is handed (libuv swaps `environ` before execvp), and the jcode
    // session env is spread from process.env — so setting it here is enough.
    process.env.PATH = join(tmpdir(), 'huu-no-jcode-here');
    const events: AgentEvent[] = [];
    try {
      const agent = await jcodeAgentFactory(
        task,
        config,
        '',
        process.cwd(),
        (e) => events.push(e),
        undefined,
      );
      let error: Error | null = null;
      try {
        await agent.prompt('do the thing');
      } catch (e) {
        error = e as Error;
      }
      await agent.dispose();
      if (!error) throw new Error('expected prompt() to reject when jcode is missing');
      return { error, events };
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
    }
  }

  it('rejects with an ACTIONABLE message instead of a raw ENOENT', async () => {
    const { error } = await runWithoutJcodeOnPath();
    expect(error.message).not.toMatch(/^spawn jcode ENOENT$/);
    expect(error.message).toContain('/opt/jcode');
    expect(error.message).toContain('--no-docker');
    expect(error.message).toContain('npm run dev');
  });

  it('emits the same message as an error event so the agent log shows it', async () => {
    const { events } = await runWithoutJcodeOnPath();
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toBe(jcodeMissingExecutableMessage());
  });
});

// ---------------------------------------------------------------------------
// The DeepSeek credential — pure precedence
// ---------------------------------------------------------------------------

describe('withJcodeApiKey', () => {
  it('injects the key huu resolved (config.apiKey) into the spawn env', () => {
    const { env, source } = withJcodeApiKey({ PATH: '/usr/bin' }, 'sk-resolved');
    expect(source).toBe('config');
    expect(env.DEEPSEEK_API_KEY).toBe('sk-resolved');
    // Everything the parent env carried still travels.
    expect(env.PATH).toBe('/usr/bin');
  });

  it('trims the resolved key (a trailing newline from a secret mount is not a key)', () => {
    const { env } = withJcodeApiKey({}, '  sk-resolved\n');
    expect(env.DEEPSEEK_API_KEY).toBe('sk-resolved');
  });

  it('the resolved key WINS over a different inherited value', () => {
    const { env, source } = withJcodeApiKey(
      { DEEPSEEK_API_KEY: 'sk-stale-from-shell' },
      'sk-resolved',
    );
    expect(source).toBe('config');
    expect(env.DEEPSEEK_API_KEY).toBe('sk-resolved');
  });

  it('falls back to the inherited env var when huu resolved nothing', () => {
    const { env, source } = withJcodeApiKey({ DEEPSEEK_API_KEY: 'sk-from-shell' }, '');
    expect(source).toBe('env');
    expect(env.DEEPSEEK_API_KEY).toBe('sk-from-shell');
  });

  it('NEVER blanks an existing env var with an empty resolved key', () => {
    for (const empty of ['', '   ', undefined]) {
      const { env, source } = withJcodeApiKey({ DEEPSEEK_API_KEY: 'sk-from-shell' }, empty);
      expect(source).toBe('env');
      expect(env.DEEPSEEK_API_KEY).toBe('sk-from-shell');
    }
  });

  it('reports source "none" and creates no empty var when there is no key anywhere', () => {
    const { env, source } = withJcodeApiKey({ PATH: '/usr/bin' }, '');
    expect(source).toBe('none');
    // Not `''` — an empty variable would look "set" to jcode and to any
    // downstream reader.
    expect('DEEPSEEK_API_KEY' in env).toBe(false);
  });

  it('never mutates the env it was handed', () => {
    const parent: NodeJS.ProcessEnv = { DEEPSEEK_API_KEY: 'sk-from-shell' };
    const { env } = withJcodeApiKey(parent, 'sk-resolved');
    expect(parent.DEEPSEEK_API_KEY).toBe('sk-from-shell');
    expect(env).not.toBe(parent);
  });
});

// ---------------------------------------------------------------------------
// The DeepSeek credential — end to end through a REAL spawn
// ---------------------------------------------------------------------------

// A subprocess is the only thing that can prove the key actually TRAVELS: the
// container gets the key as a secret mount and the wrapper excludes the env
// var, so before this the spawned jcode saw no DEEPSEEK_API_KEY at all. The
// stand-in `jcode` here echoes back what it received, so the assertion is on
// the child's own view of its environment, not on huu's intent.
describe('jcodeAgentFactory — the DeepSeek key reaches the subprocess', () => {
  const task: AgentTask = {
    agentId: 1,
    files: ['src/foo.ts'],
    branchName: 'huu/test/agent-1',
    worktreePath: '/tmp/does-not-matter',
    stageIndex: 0,
    stageName: 'Stage 1',
  };

  // Drains stdin with the `read` BUILTIN, never `cat`: PATH below holds only
  // this temp dir, so an external command would not resolve — and a stand-in
  // that exits without consuming the prompt makes huu's `stdin.write` raise
  // EPIPE, which surfaces as an uncaught exception, not a test failure.
  const FAKE_JCODE = [
    '#!/bin/sh',
    'while read -r _line; do :; done',
    'echo "key=${DEEPSEEK_API_KEY:-<unset>}"',
    '',
  ].join('\n');

  /**
   * Run one agent against a stand-in `jcode` and return its raw transcript.
   * `envKey` is what the PARENT process exports (undefined = unset).
   */
  async function transcriptWith(
    configApiKey: string,
    envKey: string | undefined,
  ): Promise<{ transcript: string; events: AgentEvent[] }> {
    const dir = mkdtempSync(join(tmpdir(), 'huu-jcode-key-'));
    writeFileSync(join(dir, 'jcode'), FAKE_JCODE);
    chmodSync(join(dir, 'jcode'), 0o755);

    const savedPath = process.env.PATH;
    const savedKey = process.env.DEEPSEEK_API_KEY;
    process.env.PATH = dir;
    if (envKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = envKey;

    const events: AgentEvent[] = [];
    try {
      const agent = await jcodeAgentFactory(
        task,
        { apiKey: configApiKey, modelId: 'deepseek-v4-pro' } as AppConfig,
        '',
        dir,
        (e) => events.push(e),
        undefined,
      );
      await agent.prompt('do the thing');
      // `getTranscript` is optional on SpawnedAgent; the jcode backend
      // implements it, and reading the child's own echo is the whole point.
      expect(agent.getTranscript).toBeDefined();
      const transcript = await agent.getTranscript!();
      await agent.dispose();
      return { transcript, events };
    } finally {
      if (savedPath === undefined) delete process.env.PATH;
      else process.env.PATH = savedPath;
      if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = savedKey;
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it('the key huu resolved lands in the child env, even with NO env var set', async () => {
    const { transcript } = await transcriptWith('sk-resolved-by-huu', undefined);
    expect(transcript).toContain('key=sk-resolved-by-huu');
  });

  it('the resolved key overrides a stale exported one', async () => {
    const { transcript } = await transcriptWith('sk-resolved-by-huu', 'sk-stale-from-shell');
    expect(transcript).toContain('key=sk-resolved-by-huu');
    expect(transcript).not.toContain('sk-stale-from-shell');
  });

  it('an empty resolved key leaves the exported one intact (no blanking)', async () => {
    const { transcript } = await transcriptWith('', 'sk-from-shell');
    expect(transcript).toContain('key=sk-from-shell');
    expect(transcript).not.toContain('key=<unset>');
  });

  it('refuses to spawn — with an ACTIONABLE message — when no key exists anywhere', async () => {
    const savedKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    const events: AgentEvent[] = [];
    try {
      await expect(
        jcodeAgentFactory(
          task,
          { apiKey: '', modelId: 'deepseek-v4-pro' } as AppConfig,
          '',
          process.cwd(),
          (e) => events.push(e),
          undefined,
        ),
      ).rejects.toThrow(/DEEPSEEK_API_KEY/);
    } finally {
      if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = savedKey;
    }

    // Same text on the agent log, so the failure is visible where the user
    // watches the run — mirrors the missing-binary path.
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    expect((err as { message: string }).message).toBe(jcodeMissingApiKeyMessage());
  });
});

describe('jcodeMissingApiKeyMessage', () => {
  it('names the variable, every way to supply it, and the setup guide', () => {
    const msg = jcodeMissingApiKeyMessage();
    // The variable the provider profile actually reads.
    expect(msg).toContain('DEEPSEEK_API_KEY');
    // Every supported channel, so the user is not left guessing which one huu
    // honors — the saved key, the env var, the `_FILE` companion.
    expect(msg).toContain('Options');
    expect(msg).toContain('DEEPSEEK_API_KEY_FILE');
    expect(msg).toContain('/run/secrets/deepseek_api_key');
    expect(msg).toContain('docs/jcode-setup-guide.md');
  });
});
