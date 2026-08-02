import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import {
  READ_ONLY_TOOL_NAMES,
  pickThinkingLevel,
  pickToolAllowlist,
  resolvePiSessionPlan,
  sessionTranscriptText,
} from './factory.js';

describe('pickThinkingLevel', () => {
  it('bumps a thinking model to the model max when maxThinking is requested', () => {
    expect(pickThinkingLevel('medium', true, 'xhigh')).toBe('xhigh');
    expect(pickThinkingLevel('medium', true, 'high')).toBe('high');
  });

  it('keeps the base level when maxThinking is not requested', () => {
    expect(pickThinkingLevel('medium', false, 'xhigh')).toBe('medium');
    expect(pickThinkingLevel('off', false, 'xhigh')).toBe('off');
  });

  it('leaves a non-thinking model off even when maxThinking is requested', () => {
    expect(pickThinkingLevel('off', true, 'xhigh')).toBe('off');
    expect(pickThinkingLevel('off', true, 'off')).toBe('off');
  });

  it('never downgrades below the base level', () => {
    // Model only supports up to 'low' but the base was 'medium' → stay 'medium'.
    expect(pickThinkingLevel('medium', true, 'low')).toBe('medium');
    // pi-ai not recognizing reasoning ('off') must not knock the resolver off.
    expect(pickThinkingLevel('medium', true, 'off')).toBe('medium');
  });

  it('is a no-op when the model max equals the base', () => {
    expect(pickThinkingLevel('medium', true, 'medium')).toBe('medium');
  });
});

describe('resolvePiSessionPlan (Fase 2.3 session plan)', () => {
  it('opens the checkpoint when restoreSessionPath points at an existing file (resume)', () => {
    const base = mkdtempSync(join(tmpdir(), 'pi-plan-'));
    const cwd = join(base, 'run', 'agent-3');
    const sdir = join(base, 'run', '.huu-sessions', 'agent-3');
    mkdirSync(sdir, { recursive: true });
    const checkpoint = join(sdir, 'session.jsonl');
    writeFileSync(checkpoint, '{"type":"session"}\n', 'utf8');

    expect(resolvePiSessionPlan(cwd, checkpoint)).toEqual({
      mode: 'open',
      sessionFile: checkpoint,
    });
  });

  it('creates fresh with the session dir OUTSIDE the worktree (sibling .huu-sessions)', () => {
    const cwd = join(sep, 'repo', '.huu-worktrees', 'run-1', 'agent-7');
    const plan = resolvePiSessionPlan(cwd, undefined);
    expect(plan.mode).toBe('create');
    const sessionDir = (plan as { mode: 'create'; sessionDir: string }).sessionDir;
    expect(sessionDir).toBe(join(dirname(cwd), '.huu-sessions', 'agent-7'));
    // The transcript-never-committed invariant: the session dir must not live
    // under the worktree, or finalize's `git stageAll` would commit it.
    expect(sessionDir.startsWith(cwd + sep)).toBe(false);
  });

  it('degrades to create-fresh when the checkpoint file is missing (swept session)', () => {
    const cwd = join(sep, 'repo', '.huu-worktrees', 'run-1', 'agent-7');
    const plan = resolvePiSessionPlan(cwd, join(sep, 'gone', 'session.jsonl'), () => false);
    expect(plan.mode).toBe('create');
  });
});

describe('pickToolAllowlist', () => {
  it('withholds edit and write from a read-only role', () => {
    const tools = pickToolAllowlist(true, true);
    expect(tools).toBeDefined();
    expect(tools).not.toContain('edit');
    expect(tools).not.toContain('write');
    // bash stays: the critic and the judge are REQUIRED to run the project's
    // own build/test commands before they may conclude anything. Withholding
    // it would break the one rule that anchors them to something executable.
    expect(tools).toContain('bash');
    expect(tools).toContain('read');
  });

  it('restricts a read-only role even outside hermetic mode', () => {
    // Correctness outranks the HUU_PI_HERMETIC=0 parity escape hatch here.
    expect(pickToolAllowlist(true, false)).toEqual([...READ_ONLY_TOOL_NAMES]);
  });

  it('leaves a WRITING agent on pi defaults, hermetic or not', () => {
    // The restriction must not smuggle in an expansion. pi ships grep/find/ls
    // unenabled; turning them on for every agent of every existing pipeline
    // would change each one's system prompt and tool-choice behavior with no
    // option set. Absent option ⇒ byte-identical behavior, no exception for
    // improvements.
    expect(pickToolAllowlist(false, true)).toBeUndefined();
    expect(pickToolAllowlist(false, false)).toBeUndefined();
  });
});

describe('sessionTranscriptText (Bug B verdict source)', () => {
  // pi's AgentMessage shape, fed structurally (the real type lives in the
  // transitive @mariozechner/pi-agent-core). AssistantMessage.content is a
  // block array: {type:'text'}, {type:'thinking'} and {type:'toolCall'}.
  const assistant = (content: unknown[], stopReason = 'stop') => ({
    role: 'assistant',
    content,
    stopReason,
    timestamp: 1,
  });

  it('joins the text blocks of assistant messages, oldest first', () => {
    const messages = [
      { role: 'user', content: 'ignore me' },
      assistant([{ type: 'text', text: 'first answer' }]),
      assistant([{ type: 'text', text: 'second answer' }]),
    ];
    expect(sessionTranscriptText(messages)).toBe('first answer\nsecond answer');
  });

  it('keeps multi-block assistant messages in block order', () => {
    const messages = [
      assistant([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }]),
    ];
    expect(sessionTranscriptText(messages)).toBe('a\nb');
  });

  it('excludes thinking blocks, tool calls and non-assistant roles', () => {
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'the prompt' }] },
      { role: 'toolResult', content: [{ type: 'text', text: 'ls output' }], isError: false },
      assistant([
        { type: 'thinking', thinking: '{"label":"ok"}' }, // reasoning decoy
        { type: 'toolCall', id: 't1', name: 'bash', arguments: { command: 'pwd' } },
        { type: 'text', text: '```json\n{"label":"low"}\n```' },
      ]),
    ];
    expect(sessionTranscriptText(messages)).toBe('```json\n{"label":"low"}\n```');
  });

  it('handles string content and returns empty for nothing relevant', () => {
    expect(sessionTranscriptText([{ role: 'assistant', content: 'plain string' }])).toBe(
      'plain string',
    );
    expect(sessionTranscriptText([])).toBe('');
    expect(sessionTranscriptText([{ role: 'bashExecution', command: 'ls' }])).toBe('');
    expect(sessionTranscriptText([null, 'junk', 42])).toBe('');
  });
});
