import { describe, it, expect } from 'vitest';

describe('smoke test', () => {
  it('should pass basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should import core dependencies', async () => {
    const [simpleGit, Database, ink, Anthropic, mcp] = await Promise.all([
      import('simple-git'),
      import('better-sqlite3'),
      import('ink'),
      import('@anthropic-ai/sdk'),
      import('@modelcontextprotocol/sdk/server/index.js'),
    ]);

    expect(simpleGit.simpleGit).toBeDefined();
    expect(Database.default).toBeDefined();
    expect(ink.render).toBeDefined();
    expect(Anthropic.default).toBeDefined();
    expect(mcp.Server).toBeDefined();
  });
});
