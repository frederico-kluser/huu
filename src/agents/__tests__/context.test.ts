import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prepareContext, estimateTokens } from '../context.js';
import type { AgentDefinition } from '../types.js';

function testAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    name: 'test-agent',
    role: 'tester',
    description: 'Test agent',
    model: 'sonnet',
    tools: [],
    systemPrompt: 'You are a test agent. Follow instructions carefully.',
    ...overrides,
  };
}

describe('prepareContext', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'huu-ctx-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('builds system prompt from agent definition', () => {
    const result = prepareContext({
      agent: testAgent(),
      taskPrompt: 'Do something',
      cwd: tmpDir,
    });
    expect(result.system).toContain('You are a test agent');
  });

  it('includes project rules when CLAUDE.md exists', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      '# Rules\n- Be concise\n',
    );

    const result = prepareContext({
      agent: testAgent(),
      taskPrompt: 'Do something',
      cwd: tmpDir,
    });

    expect(result.system).toContain('<project_rules>');
    expect(result.system).toContain('Be concise');
    expect(result.metadata.sources).toContain(
      path.join(tmpDir, 'CLAUDE.md'),
    );
  });

  it('includes AGENTS.md when CLAUDE.md is absent', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'AGENTS.md'),
      '# Agent Rules\n- Stay focused\n',
    );

    const result = prepareContext({
      agent: testAgent(),
      taskPrompt: 'Do something',
      cwd: tmpDir,
    });

    expect(result.system).toContain('Stay focused');
  });

  it('skips project rules when no rules file exists', () => {
    const result = prepareContext({
      agent: testAgent(),
      taskPrompt: 'Do something',
      cwd: tmpDir,
    });

    expect(result.system).not.toContain('<project_rules>');
    expect(result.metadata.sources).toHaveLength(0);
  });

  it('uses explicit projectRulesPath', () => {
    const rulesPath = path.join(tmpDir, 'custom-rules.md');
    fs.writeFileSync(rulesPath, 'Custom rules here');

    const result = prepareContext({
      agent: testAgent(),
      taskPrompt: 'Do something',
      cwd: tmpDir,
      projectRulesPath: rulesPath,
    });

    expect(result.system).toContain('Custom rules here');
  });

  it('builds user message from task prompt', () => {
    const result = prepareContext({
      agent: testAgent(),
      taskPrompt: 'Implement feature X',
      cwd: tmpDir,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0]!.role).toBe('user');
    expect(result.messages[0]!.content).toBe('Implement feature X');
  });

  it('includes scratchpad in user message', () => {
    const result = prepareContext({
      agent: testAgent(),
      taskPrompt: 'Implement feature X',
      cwd: tmpDir,
      scratchpad: 'Previous context: Y was done',
    });

    expect(result.messages[0]!.content).toContain('<scratchpad>');
    expect(result.messages[0]!.content).toContain('Previous context: Y was done');
    expect(result.messages[0]!.content).toContain('Implement feature X');
    expect(result.metadata.sources).toContain('scratchpad');
  });

  it('scratchpad appears before task prompt', () => {
    const result = prepareContext({
      agent: testAgent(),
      taskPrompt: 'TASK_MARKER',
      cwd: tmpDir,
      scratchpad: 'SCRATCHPAD_MARKER',
    });

    const content = result.messages[0]!.content;
    const scratchpadIdx = content.indexOf('SCRATCHPAD_MARKER');
    const taskIdx = content.indexOf('TASK_MARKER');
    expect(scratchpadIdx).toBeLessThan(taskIdx);
  });

  it('estimates token count', () => {
    const result = prepareContext({
      agent: testAgent({ systemPrompt: 'A'.repeat(400) }),
      taskPrompt: 'B'.repeat(400),
      cwd: tmpDir,
    });

    // 800 chars / 4 chars per token = 200 tokens
    expect(result.metadata.tokensEstimate).toBe(200);
  });

  it('warns when token estimate exceeds budget', () => {
    const result = prepareContext({
      agent: testAgent({ systemPrompt: 'A'.repeat(4000) }),
      taskPrompt: 'B'.repeat(4000),
      cwd: tmpDir,
      tokenBudget: 100,
    });

    const warning = result.metadata.sources.find((s) =>
      s.startsWith('WARNING:'),
    );
    expect(warning).toBeDefined();
    expect(warning).toContain('exceeds budget');
  });

  it('generates stable context for equivalent inputs', () => {
    const input = {
      agent: testAgent(),
      taskPrompt: 'Do something',
      cwd: tmpDir,
    };

    const r1 = prepareContext(input);
    const r2 = prepareContext(input);

    expect(r1.system).toBe(r2.system);
    expect(r1.messages).toEqual(r2.messages);
    expect(r1.metadata.tokensEstimate).toBe(r2.metadata.tokensEstimate);
  });
});

describe('estimateTokens', () => {
  it('estimates ~4 chars per token', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcdefgh')).toBe(2);
  });

  it('rounds up', () => {
    expect(estimateTokens('ab')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});
