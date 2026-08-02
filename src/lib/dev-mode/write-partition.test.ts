import { describe, expect, it } from 'vitest';
import {
  checkWritePartition,
  formatWritePartitionViolations,
  type TaskSpec,
} from './write-partition.js';

function spec(path: string, content: string): TaskSpec {
  return { path, content };
}

describe('write-partition', () => {
  it('returns ok:true when no specs claim any files', () => {
    const result = checkWritePartition([
      spec('T-001.md', '# T-001\n\nJust do the thing.\n'),
      spec('T-002.md', '# T-002\n\nAnother thing.\n'),
    ]);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('returns ok:true when specs claim disjoint sets of files', () => {
    const result = checkWritePartition([
      spec('T-001.md', `# T-001
## Files this task OWNS
- \`src/api/health.ts\` — handler

## Done when
- endpoint works
`),
      spec('T-002.md', `# T-002
## Files this task OWNS
- \`src/api/index.ts\` — registration

## Done when
- registered
`),
    ]);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('returns ok:true when a single spec claims files (no other specs to conflict with)', () => {
    const result = checkWritePartition([
      spec('T-001.md', `# T-001
## Files this task OWNS
- \`src/foo.ts\`
- \`src/bar.ts\`
`),
    ]);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('returns ok:true for empty input', () => {
    const result = checkWritePartition([]);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('dois specs mesmo arquivo recusa', () => {
  it('detects two specs claiming the exact same file', () => {
    const result = checkWritePartition([
      spec('T-001.md', `# T-001
## Files this task OWNS
- \`src/api/routes.ts\` — the route handler
`),
      spec('T-002.md', `# T-002
## Files this task OWNS
- \`src/api/routes.ts\` — register new middleware
`),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations).toEqual([
      { path: 'src/api/routes.ts', specs: ['T-001.md', 'T-002.md'] },
    ]);
  });

  it('detects a spec claiming a directory and another claiming a file inside it', () => {
    const result = checkWritePartition([
      spec('T-001.md', `# T-001
## Files this task OWNS
- docs/ — all documentation
`),
      spec('T-002.md', `# T-002
## Files this task OWNS
- \`docs/api.md\` — the API reference
`),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({
      path: 'docs/api.md',
      specs: expect.arrayContaining(['T-001.md', 'T-002.md']),
    });
  });

  it('detects three specs claiming overlapping files (one is a directory prefix)', () => {
    const result = checkWritePartition([
      spec('T-001.md', `# T-001
## Files this task OWNS
- \`src/shared/config.ts\` — the config
`),
      spec('T-002.md', `# T-002
## Files this task OWNS
- src/shared/ — the shared directory
`),
      spec('T-003.md', `# T-003
## Files this task OWNS
- \`src/shared/config.ts\` — also needs config access
`),
    ]);
    expect(result.ok).toBe(false);
    // config.ts has 3 owners (T-001 + T-003 exact, plus T-002 via prefix)
    const configViolation = result.violations.find((v) => v.path === 'src/shared/config.ts');
    expect(configViolation).toBeDefined();
    expect(configViolation!.specs.length).toBeGreaterThanOrEqual(2);
  });

  it('does NOT flag a spec that claims both a directory and a file inside it as a violation (same spec)', () => {
    const result = checkWritePartition([
      spec('T-001.md', `# T-001
## Files this task OWNS
- src/shared/ — the shared directory
- \`src/shared/config.ts\` — the config file
`),
      spec('T-002.md', `# T-002
## Files this task OWNS
- \`src/other.ts\`
`),
    ]);
    expect(result.ok).toBe(true);
  });

  it('handles the heading variation "Files this task OWNS" with backticked paths', () => {
    const result = checkWritePartition([
      spec('T-001.md', `# T-001
## Files this task OWNS
- \`src/x.ts\` — x
`),
      spec('T-002.md', `# T-002
## Files this task OWNS
- \`src/x.ts\` — x again
`),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBe(1);
  });

  it('stops reading owned paths at the next heading', () => {
    const result = checkWritePartition([
      spec('T-001.md', `# T-001
## Files this task OWNS
- \`src/a.ts\`
- \`src/b.ts\`

## Done when
- \`src/shared.ts\` is not owned
`),
      spec('T-002.md', `# T-002
## Files this task OWNS
- \`src/a.ts\`
`),
    ]);
    expect(result.ok).toBe(false);
    // Only src/a.ts should be a violation, not src/shared.ts
    expect(result.violations).toEqual([
      { path: 'src/a.ts', specs: ['T-001.md', 'T-002.md'] },
    ]);
    // src/b.ts should NOT be a violation (only claimed by T-001)
    expect(result.violations.find((v) => v.path === 'src/b.ts')).toBeUndefined();
    // src/shared.ts should NOT appear at all
    expect(result.violations.find((v) => v.path === 'src/shared.ts')).toBeUndefined();
  });

  it('handles multiple violations in one call', () => {
    const result = checkWritePartition([
      spec('T-001.md', `# T-001
## Files this task OWNS
- \`src/a.ts\`
- \`src/b.ts\`
`),
      spec('T-002.md', `# T-002
## Files this task OWNS
- \`src/a.ts\`
- \`src/b.ts\`
`),
    ]);
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBe(2);
    const paths = result.violations.map((v) => v.path).sort();
    expect(paths).toEqual(['src/a.ts', 'src/b.ts']);
  });
});

describe('formatWritePartitionViolations', () => {
  it('returns empty string for empty violations', () => {
    expect(formatWritePartitionViolations([])).toBe('');
  });

  it('includes file paths and spec names', () => {
    const text = formatWritePartitionViolations([
      { path: 'src/foo.ts', specs: ['T-001.md', 'T-002.md'] },
    ]);
    expect(text).toContain('src/foo.ts');
    expect(text).toContain('T-001.md');
    expect(text).toContain('T-002.md');
    expect(text).toContain('Write-set partition violation');
  });
});
