import { describe, expect, it } from 'vitest';
import { DEV_MODE_DIR } from '../types.js';
import {
  ROUTER_PREFIX,
  devPaths,
  devSessionPaths,
  prefixPrompt,
  taskSpecContract,
} from './dev-protocol.js';

// `devPaths` is imported by modules three fronts own (`dev-driver.ts`,
// `plan-to-pipeline.ts`, `dev-state.ts`) and its strings are baked into agent
// prompts and into `plan-to-pipeline.test.ts`'s expectations. The session
// namespacing landed BESIDE it, not on top of it — this block is the pin that
// keeps that true while the call sites migrate one front at a time.
describe('devPaths (compatibility pin)', () => {
  it('is rooted at the dev-mode dir', () => {
    expect(DEV_MODE_DIR).toBe('.huu/dev');
    expect(devPaths.root).toBe('.huu/dev');
  });

  it('keeps the session index at the root', () => {
    expect(devPaths.goal).toBe('.huu/dev/goal.md');
    expect(devPaths.state).toBe('.huu/dev/state.json');
    expect(devPaths.journal).toBe('.huu/dev/journal.md');
  });

  it('keeps every epoch path unnamespaced', () => {
    expect(devPaths.epochDir(1)).toBe('.huu/dev/epoch-1');
    expect(devPaths.atlas(2)).toBe('.huu/dev/epoch-2/atlas.md');
    expect(devPaths.findingsDir(1)).toBe('.huu/dev/epoch-1/findings');
    expect(devPaths.findings(1, 'recon')).toBe('.huu/dev/epoch-1/findings/recon.json');
    expect(devPaths.epochReport(3)).toBe('.huu/dev/epoch-3/report.md');
    expect(devPaths.frontDir(1, 'api')).toBe('.huu/dev/epoch-1/api');
    expect(devPaths.frontTasks(1, 'api')).toBe('.huu/dev/epoch-1/api/tasks.json');
    expect(devPaths.frontReport(1, 'api')).toBe('.huu/dev/epoch-1/api/report.md');
  });
});

describe('devSessionPaths', () => {
  const s = devSessionPaths('S');

  it('puts every epoch artefact under the session segment', () => {
    expect(s.sessionId).toBe('S');
    expect(s.root).toBe('.huu/dev/S');
    expect(s.epochDir(1)).toBe('.huu/dev/S/epoch-1');
    expect(s.atlas(1)).toBe('.huu/dev/S/epoch-1/atlas.md');
    expect(s.findingsDir(1)).toBe('.huu/dev/S/epoch-1/findings');
    expect(s.findings(1, 'api-recon')).toBe('.huu/dev/S/epoch-1/findings/api-recon.json');
    expect(s.epochReport(1)).toBe('.huu/dev/S/epoch-1/report.md');
    expect(s.pipeline(1)).toBe('.huu/dev/S/epoch-1/pipeline.json');
    expect(s.frontDir(1, 'api')).toBe('.huu/dev/S/epoch-1/api');
    expect(s.frontTasks(1, 'api')).toBe('.huu/dev/S/epoch-1/api/tasks.json');
    expect(s.frontReport(1, 'api')).toBe('.huu/dev/S/epoch-1/api/report.md');
    expect(s.reviewDir(1, 'api')).toBe('.huu/dev/S/epoch-1/api/review');
    expect(s.reviewFindings(1, 'api', 'T-003')).toBe('.huu/dev/S/epoch-1/api/review/T-003.json');
  });

  it('namespaces the knowledge phase too', () => {
    expect(s.knowledgeDir(1)).toBe('.huu/dev/S/epoch-1/knowledge');
    expect(s.gapsDir(1)).toBe('.huu/dev/S/epoch-1/knowledge/gaps');
    expect(s.gapFile(1, 'G-001-stack')).toBe('.huu/dev/S/epoch-1/knowledge/gaps/G-001-stack.md');
    expect(s.knowledgeIndex(1)).toBe('.huu/dev/S/epoch-1/knowledge/index.json');
    expect(s.briefsDir(1)).toBe('.huu/dev/S/epoch-1/knowledge/briefs');
    expect(s.brief(1, 'G-001-stack')).toBe('.huu/dev/S/epoch-1/knowledge/briefs/G-001-stack.md');
    expect(s.briefJson(1, 'G-001-stack')).toBe(
      '.huu/dev/S/epoch-1/knowledge/briefs/G-001-stack.json',
    );
    expect(s.knowledgeDigest(1)).toBe('.huu/dev/S/epoch-1/knowledge/digest.md');
  });

  it('separates epochs within one session', () => {
    expect(s.frontTasks(1, 'api')).not.toBe(s.frontTasks(2, 'api'));
  });

  // THE reason this exists: `resolveMemoryFiles` reads `filesFrom` out of the
  // integration worktree, which branches from a checkout that may already
  // contain a PREVIOUS session's committed `.../api/tasks.json`, and it
  // validates nothing beyond `existsSync`. Two sessions sharing a path means a
  // new run's fan-out can dispatch the old run's swarm.
  it('never collides between two sessions', () => {
    const a = devSessionPaths('sess-a');
    const b = devSessionPaths('sess-b');

    const paths = (p: ReturnType<typeof devSessionPaths>): string[] => [
      p.root,
      p.epochDir(1),
      p.atlas(1),
      p.findingsDir(1),
      p.findings(1, 'recon'),
      p.epochReport(1),
      p.pipeline(1),
      p.frontDir(1, 'api'),
      p.frontTasks(1, 'api'),
      p.frontReport(1, 'api'),
      p.reviewDir(1, 'api'),
      p.reviewFindings(1, 'api', 'T-001'),
      p.knowledgeDir(1),
      p.gapsDir(1),
      p.gapFile(1, 'G-001'),
      p.knowledgeIndex(1),
      p.briefsDir(1),
      p.brief(1, 'G-001'),
      p.briefJson(1, 'G-001'),
      p.knowledgeDigest(1),
    ];

    const fromA = paths(a);
    const fromB = paths(b);
    expect(fromA).toHaveLength(fromB.length);
    expect(fromA.filter((p) => fromB.includes(p))).toEqual([]);
    for (const p of fromA) {
      expect(p === a.root || p.startsWith(`${a.root}/`)).toBe(true);
    }
  });

  // A blank id would collapse `.huu/dev//epoch-1` back onto the very path the
  // namespacing exists to vacate; a separator would escape it entirely; and
  // whitespace splits into two argv tokens inside `GitClient.exec`.
  it.each(['', '   ', '.', '..', 'a/b', 'a\\b', 'a b', 'a\tb'])(
    'rejects the unusable id %j',
    (bad) => {
      expect(() => devSessionPaths(bad)).toThrow(/invalid dev session id/);
    },
  );

  // Sanitizing would map two distinct ids onto one directory — exactly the
  // collision being prevented — so ids are taken verbatim.
  it('does not sanitize the id', () => {
    expect(devSessionPaths('Sess.A_1-x').root).toBe('.huu/dev/Sess.A_1-x');
  });
});

describe('taskSpecContract', () => {
  const text = taskSpecContract(1, 'api', 4);

  it('orders the recon to replace tasks.json instead of merging it', () => {
    expect(text).toContain('.huu/dev/epoch-1/api/tasks.json');
    expect(text).toMatch(/REPLACE it wholesale/);
    expect(text).toMatch(/never merge it/);
  });

  it('still carries the spec shape and the partitioning rule', () => {
    expect(text).toContain('.huu/dev/epoch-1/api/T-001.md');
    expect(text).toContain('PARTITIONING RULE');
    expect(text).toContain('at most 4');
  });
});

describe('ROUTER_PREFIX', () => {
  it('is not a pi slash command', () => {
    // It used to be the literal `/skill:project-router`, which pi expands ONLY
    // when it is the first characters of the message — and huu's role header
    // always precedes it, so it never once expanded.
    expect(ROUTER_PREFIX.startsWith('/')).toBe(false);
    expect(ROUTER_PREFIX).not.toContain('/skill:');
  });

  it('tells the agent how the routing surface is actually reachable', () => {
    expect(ROUTER_PREFIX).toContain('project-router');
    expect(ROUTER_PREFIX).toContain('read');
  });

  it('stays short — every agent of every step pays for it', () => {
    expect(ROUTER_PREFIX.length).toBeLessThan(400);
  });
});

describe('prefixPrompt', () => {
  it('is the identity function without a prefix', () => {
    expect(prefixPrompt('body', undefined)).toBe('body');
  });

  it('puts the prefix first', () => {
    expect(prefixPrompt('body', 'HEAD')).toBe('HEAD\n\nbody');
  });
});
