import { describe, it, expect } from 'vitest';
import { validateAgentDefinition, effectiveTools } from '../types.js';
import type { AgentDefinition } from '../types.js';
import { plannerAgent, PLANNER_SYSTEM_PROMPT } from '../definitions/planner.js';
import { testerAgent, TESTER_SYSTEM_PROMPT } from '../definitions/tester.js';
import { reviewerAgent, REVIEWER_SYSTEM_PROMPT } from '../definitions/reviewer.js';
import { researcherAgent, RESEARCHER_SYSTEM_PROMPT } from '../definitions/researcher.js';
import { mergerAgent, MERGER_SYSTEM_PROMPT } from '../definitions/merger.js';
import { refactorerAgent, REFACTORER_SYSTEM_PROMPT } from '../definitions/refactorer.js';
import { docWriterAgent, DOC_WRITER_SYSTEM_PROMPT } from '../definitions/doc-writer.js';
import { debuggerAgent, DEBUGGER_SYSTEM_PROMPT } from '../definitions/debugger.js';
import { contextCuratorAgent, CONTEXT_CURATOR_SYSTEM_PROMPT } from '../definitions/context-curator.js';
import { inferTaskRole } from '../../orchestrator/scheduler.js';
import type { AtomicTask } from '../../orchestrator/beatsheet.js';

// ── All agents roster ───────────────────────────────────────────────

const ALL_AGENTS: Array<{
  agent: AgentDefinition;
  prompt: string;
  expectedRole: string;
  expectedModel: string;
}> = [
  { agent: plannerAgent, prompt: PLANNER_SYSTEM_PROMPT, expectedRole: 'planning', expectedModel: 'sonnet' },
  { agent: testerAgent, prompt: TESTER_SYSTEM_PROMPT, expectedRole: 'testing', expectedModel: 'sonnet' },
  { agent: reviewerAgent, prompt: REVIEWER_SYSTEM_PROMPT, expectedRole: 'review', expectedModel: 'opus' },
  { agent: researcherAgent, prompt: RESEARCHER_SYSTEM_PROMPT, expectedRole: 'research', expectedModel: 'haiku' },
  { agent: mergerAgent, prompt: MERGER_SYSTEM_PROMPT, expectedRole: 'merging', expectedModel: 'sonnet' },
  { agent: refactorerAgent, prompt: REFACTORER_SYSTEM_PROMPT, expectedRole: 'refactoring', expectedModel: 'haiku' },
  { agent: docWriterAgent, prompt: DOC_WRITER_SYSTEM_PROMPT, expectedRole: 'documentation', expectedModel: 'haiku' },
  { agent: debuggerAgent, prompt: DEBUGGER_SYSTEM_PROMPT, expectedRole: 'debugging', expectedModel: 'opus' },
  { agent: contextCuratorAgent, prompt: CONTEXT_CURATOR_SYSTEM_PROMPT, expectedRole: 'curation', expectedModel: 'haiku' },
];

// ── Helper to create a mock task ────────────────────────────────────

function makeTask(title: string, action: string): AtomicTask {
  return {
    id: 'task-test',
    actId: 'act-1',
    sequenceId: 'seq-1',
    title,
    precondition: 'none',
    action,
    postcondition: 'done',
    verification: 'check',
    dependencies: [],
    critical: false,
    estimatedEffort: 'small',
    status: 'pending',
  };
}

// ── Validation tests ────────────────────────────────────────────────

describe('agent definitions validation', () => {
  for (const { agent } of ALL_AGENTS) {
    it(`${agent.name} passes validation`, () => {
      expect(() => validateAgentDefinition(agent)).not.toThrow();
    });
  }

  it('all 9 agents have unique names', () => {
    const names = ALL_AGENTS.map(({ agent }) => agent.name);
    expect(new Set(names).size).toBe(9);
  });

  it('all 9 agents have unique roles', () => {
    const roles = ALL_AGENTS.map(({ agent }) => agent.role);
    expect(new Set(roles).size).toBe(9);
  });
});

// ── Model tiering tests ─────────────────────────────────────────────

describe('model tiering', () => {
  for (const { agent, expectedModel } of ALL_AGENTS) {
    it(`${agent.name} uses ${expectedModel} model`, () => {
      expect(agent.model).toBe(expectedModel);
    });
  }

  it('opus is reserved for critical review and deep analysis', () => {
    const opusAgents = ALL_AGENTS.filter(({ agent }) => agent.model === 'opus');
    const opusNames = opusAgents.map(({ agent }) => agent.name).sort();
    expect(opusNames).toEqual(['debugger', 'reviewer']);
  });

  it('haiku is used for mechanical/low-risk tasks', () => {
    const haikuAgents = ALL_AGENTS.filter(({ agent }) => agent.model === 'haiku');
    const haikuNames = haikuAgents.map(({ agent }) => agent.name).sort();
    expect(haikuNames).toEqual(['context-curator', 'doc-writer', 'refactorer', 'researcher']);
  });

  it('sonnet is the operational default for core work', () => {
    const sonnetAgents = ALL_AGENTS.filter(({ agent }) => agent.model === 'sonnet');
    const sonnetNames = sonnetAgents.map(({ agent }) => agent.name).sort();
    expect(sonnetNames).toEqual(['merger', 'planner', 'tester']);
  });
});

// ── Least privilege tests ───────────────────────────────────────────

describe('least privilege tool policy', () => {
  it('reviewer has NO write or execute tools', () => {
    const tools = effectiveTools(reviewerAgent);
    expect(tools).not.toContain('write_file');
    expect(tools).not.toContain('bash');
  });

  it('reviewer disallowed tools include write_file and bash', () => {
    expect(reviewerAgent.disallowedTools).toContain('write_file');
    expect(reviewerAgent.disallowedTools).toContain('bash');
  });

  it('planner has NO write or execute tools', () => {
    const tools = effectiveTools(plannerAgent);
    expect(tools).not.toContain('write_file');
    expect(tools).not.toContain('bash');
  });

  it('researcher has NO write or execute tools', () => {
    const tools = effectiveTools(researcherAgent);
    expect(tools).not.toContain('write_file');
    expect(tools).not.toContain('bash');
  });

  it('context-curator has NO write or execute tools', () => {
    const tools = effectiveTools(contextCuratorAgent);
    expect(tools).not.toContain('write_file');
    expect(tools).not.toContain('bash');
  });

  it('tester has NO write_file tool', () => {
    const tools = effectiveTools(testerAgent);
    expect(tools).not.toContain('write_file');
    expect(tools).toContain('bash');
  });

  it('refactorer has NO bash tool', () => {
    const tools = effectiveTools(refactorerAgent);
    expect(tools).not.toContain('bash');
    expect(tools).toContain('write_file');
  });

  it('doc-writer has NO bash tool', () => {
    const tools = effectiveTools(docWriterAgent);
    expect(tools).not.toContain('bash');
    expect(tools).toContain('write_file');
  });

  it('merger has bash for git commands', () => {
    const tools = effectiveTools(mergerAgent);
    expect(tools).toContain('bash');
    expect(tools).toContain('read_file');
  });

  it('debugger has bash for diagnostic commands', () => {
    const tools = effectiveTools(debuggerAgent);
    expect(tools).toContain('bash');
    expect(tools).toContain('grep');
  });

  it('all agents have read_file', () => {
    for (const { agent } of ALL_AGENTS) {
      const tools = effectiveTools(agent);
      expect(tools).toContain('read_file');
    }
  });
});

// ── System prompt structure tests ───────────────────────────────────

describe('system prompt structure', () => {
  for (const { agent, prompt } of ALL_AGENTS) {
    describe(`${agent.name} prompt`, () => {
      it('includes <role> section', () => {
        expect(prompt).toContain('<role>');
        expect(prompt).toContain('</role>');
      });

      it('includes <constraints> section', () => {
        expect(prompt).toContain('<constraints>');
        expect(prompt).toContain('</constraints>');
      });

      it('includes <done_contract> section', () => {
        expect(prompt).toContain('<done_contract>');
        expect(prompt).toContain('</done_contract>');
      });

      it('includes output format specification', () => {
        expect(prompt).toContain('<output_format>');
      });

      it('mentions escalation for blocked scenarios', () => {
        expect(prompt.toLowerCase()).toContain('escalat');
      });
    });
  }
});

// ── Role routing tests ──────────────────────────────────────────────

describe('scheduler role routing', () => {
  it('routes planning tasks to planning role', () => {
    expect(inferTaskRole(makeTask('Plan the authentication module', 'decompose into subtasks'))).toBe('planning');
  });

  it('routes testing tasks to testing role', () => {
    expect(inferTaskRole(makeTask('Test user login', 'verify authentication flow'))).toBe('testing');
  });

  it('routes review tasks to review role', () => {
    expect(inferTaskRole(makeTask('Review PR changes', 'audit security implications'))).toBe('review');
  });

  it('routes research tasks to research role', () => {
    expect(inferTaskRole(makeTask('Research caching strategies', 'investigate options'))).toBe('research');
  });

  it('routes merge tasks to merging role', () => {
    expect(inferTaskRole(makeTask('Merge feature branch', 'resolve conflicts'))).toBe('merging');
  });

  it('routes refactoring tasks to refactoring role', () => {
    expect(inferTaskRole(makeTask('Refactor auth module', 'simplify token logic'))).toBe('refactoring');
  });

  it('routes documentation tasks to documentation role', () => {
    expect(inferTaskRole(makeTask('Document API endpoints', 'annotate with examples'))).toBe('documentation');
  });

  it('routes debugging tasks to debugging role', () => {
    expect(inferTaskRole(makeTask('Debug login failure', 'diagnose token expiry issue'))).toBe('debugging');
  });

  it('routes curation tasks to curation role', () => {
    expect(inferTaskRole(makeTask('Curate session knowledge', 'summarize key decisions'))).toBe('curation');
  });

  it('defaults unknown tasks to implementation', () => {
    expect(inferTaskRole(makeTask('Something unrelated', 'do the thing'))).toBe('implementation');
  });
});
