import { describe, it, expect } from 'vitest';

describe('smoke test', () => {
  it('should pass basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('should import core dependencies', async () => {
    const [simpleGit, Database, ink, OpenAI, mcp] = await Promise.all([
      import('simple-git'),
      import('better-sqlite3'),
      import('ink'),
      import('openai'),
      import('@modelcontextprotocol/sdk/server/index.js'),
    ]);

    expect(simpleGit.simpleGit).toBeDefined();
    expect(Database.default).toBeDefined();
    expect(ink.render).toBeDefined();
    expect(OpenAI.default).toBeDefined();
    expect(mcp.Server).toBeDefined();
  });
});
