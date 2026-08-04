import { describe, it, expect } from 'vitest';
import { translateJcodeOutput } from './event-mapper.js';
import {
  resolveHermeticEnabled,
  jcodeAgentDir,
  buildJcodeSessionEnvironment,
} from './hermetic.js';
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
