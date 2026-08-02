import { describe, expect, it } from 'vitest';
import { generateAgentSystemPrompt } from './agents-md-generator.js';

/**
 * The header is the HIGHEST-PRIORITY text an agent reads — it precedes the step
 * prompt in the same message. These tests exist because it silently
 * contradicted every dev-mode prompt for a long time and nothing caught it:
 * there was no test on this file at all. Each case below pins one contradiction
 * that was actually shipped.
 */
describe('generateAgentSystemPrompt', () => {
  const base = {
    agentId: 7,
    stageName: '1b. api — implementar',
    prompt: 'Do the thing described in your spec.',
    files: [] as string[],
  };

  it('never frames the run as a refactoring session', () => {
    const whole = generateAgentSystemPrompt(base);
    const scoped = generateAgentSystemPrompt({ ...base, files: ['src/a.ts'] });
    for (const text of [whole, scoped]) {
      // The framing, not the word: "no refactors" as a SCOPE rule is wanted;
      // "Refactoring Session" / "Refactoring Instructions" as the agent's
      // identity is the defect — a front that builds a feature was being told
      // it was refactoring.
      expect(text).not.toMatch(/refactoring (session|instructions|orchestrator)/i);
      expect(text).not.toMatch(/for the refactoring/i);
    }
  });

  it('drops the rules that fought the dev-mode prompts', () => {
    const text = generateAgentSystemPrompt({ ...base, files: ['src/a.ts'] });
    // "Do NOT create new files unless absolutely necessary" fought every front
    // whose job is to create files.
    expect(text).not.toMatch(/do not create new files/i);
    // "Maintain or improve test coverage" fought the TDD step that FREEZES the
    // test files.
    expect(text).not.toMatch(/test coverage/i);
    // "Do NOT run git commands" fought the TDD tests step's "Commit your work".
    expect(text).not.toMatch(/do not run git commands/i);
    // The one git rule that IS true survives.
    expect(text).toContain('git push');
  });

  describe('write scope', () => {
    it('renders the spec-declared ownership, not the spec path, when present', () => {
      const text = generateAgentSystemPrompt({
        ...base,
        // A memory-scope task: `files` is the BRIEFING, not the target.
        files: ['.huu/dev/s1/epoch-1/api/T-001.md'],
        ownedPaths: ['src/api/routes.ts', 'src/api/schema.ts'],
      });
      expect(text).toContain('Your assignment is briefed in:');
      expect(text).toContain('.huu/dev/s1/epoch-1/api/T-001.md');
      expect(text).toContain('The files you may WRITE are exactly these');
      expect(text).toContain('src/api/routes.ts');
      expect(text).toContain('src/api/schema.ts');
      // The regression: the spec must never be presented as the editable file.
      expect(text).not.toMatch(/ONLY modify files from your assigned list/i);
    });

    it('falls back to the file list when no ownership was declared', () => {
      const text = generateAgentSystemPrompt({ ...base, files: ['src/a.ts', 'src/b.ts'] });
      expect(text).toContain('src/a.ts');
      expect(text).toContain('Those are also the files you are expected to change');
    });

    it('uses the step write-set globs when there is no spec ownership', () => {
      const text = generateAgentSystemPrompt({ ...base, writes: ['.huu/audits/**'] });
      expect(text).toContain('.huu/audits/**');
      expect(text).toContain('Write only inside that surface');
    });

    it('says whole-project when nothing is declared at all', () => {
      const text = generateAgentSystemPrompt(base);
      expect(text).toContain('Whole project');
    });
  });

  describe('read-only roles', () => {
    const ro = generateAgentSystemPrompt({ ...base, agentId: -7, readOnly: true });

    it('does not invite the agent to edit anything', () => {
      // The exact shipped defect: the whole-project branch told every critic,
      // judge and reporter "you may read and modify any file" and "Apply
      // changes using the edit tool".
      expect(ro).not.toMatch(/modify any file/i);
      expect(ro).not.toMatch(/apply changes using the edit tool/i);
      expect(ro).not.toContain('Whole project');
    });

    it('states the capability boundary as a fact, not a request', () => {
      expect(ro).toContain('REPORT ONLY');
      expect(ro).toContain('`edit` and `write` tools are not available');
      // bash MUST survive: the critic and the judge are both required to run
      // the project's own commands before concluding.
      expect(ro).toContain('bash');
    });
  });

  it('keeps the step prompt verbatim', () => {
    const text = generateAgentSystemPrompt({ ...base, prompt: 'EXACT STEP TEXT $file' });
    expect(text).toContain('EXACT STEP TEXT $file');
  });
});
