import path from 'node:path';
import fs from 'node:fs';
import { simpleGit, type SimpleGit } from 'simple-git';
import { Mutex, Semaphore } from 'async-mutex';

import type {
  WorktreeInfo,
  CreateWorktreeOptions,
  RemoveWorktreeOptions,
  PruneOptions,
  RawWorktreeRecord,
  NodeModulesStrategy,
} from './types.js';

const BRANCH_PREFIX = 'huu-agent/';
const WORKTREE_DIR = '.huu-worktrees';
const DEFAULT_MAX_CONCURRENT_PROCESSES = 4;
const DEFAULT_INSTALL_CONCURRENCY = 2;

export class WorktreeManager {
  private readonly rootGit: SimpleGit;
  private readonly repoRoot: string;
  private readonly worktreeBaseDir: string;
  private readonly worktreeGitCache = new Map<string, SimpleGit>();
  private readonly sharedRefsMutex = new Mutex();
  private readonly installSemaphore: Semaphore;
  private readonly maxConcurrentProcesses: number;

  constructor(
    repoRoot: string,
    options?: {
      worktreeBaseDir?: string;
      maxConcurrentProcesses?: number;
      installConcurrency?: number;
    },
  ) {
    this.repoRoot = path.resolve(repoRoot);
    this.worktreeBaseDir = options?.worktreeBaseDir
      ? path.resolve(options.worktreeBaseDir)
      : path.join(this.repoRoot, WORKTREE_DIR);
    this.maxConcurrentProcesses =
      options?.maxConcurrentProcesses ?? DEFAULT_MAX_CONCURRENT_PROCESSES;
    this.rootGit = simpleGit({
      baseDir: this.repoRoot,
      maxConcurrentProcesses: this.maxConcurrentProcesses,
    });
    this.installSemaphore = new Semaphore(
      options?.installConcurrency ?? DEFAULT_INSTALL_CONCURRENCY,
    );
  }

  /** Access the root git instance (for operations on the main repo). */
  getRootGit(): SimpleGit {
    return this.rootGit;
  }

  /** Get the repo root path. */
  getRepoRoot(): string {
    return this.repoRoot;
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  async create(
    agentId: string,
    baseBranch: string,
    options?: CreateWorktreeOptions,
  ): Promise<WorktreeInfo> {
    this.validateAgentId(agentId);

    const branchName = this.branchNameFor(agentId);
    const worktreePath = this.worktreePathFor(agentId);
    const lock = options?.lock ?? true;
    const lockReason = options?.lockReason ?? `huu-agent:${agentId}`;
    const strategy = options?.nodeModulesStrategy ?? 'none';

    await this.sharedRefsMutex.runExclusive(async () => {
      await this.assertBranchExists(baseBranch);

      // Check if branch already exists (indicates duplicate agent or leftover)
      const branchExists = await this.branchExists(branchName);
      if (branchExists) {
        throw new WorktreeError(
          `Branch "${branchName}" is already checked out in another worktree`,
          { agentId, branch: branchName },
        );
      }

      // Create the branch (no-track, from baseBranch)
      await this.rootGit.raw([
        'branch',
        '--no-track',
        branchName,
        baseBranch,
      ]);

      // Ensure the worktree base directory exists
      fs.mkdirSync(this.worktreeBaseDir, { recursive: true });

      // Create worktree with optional lock
      const args = ['worktree', 'add'];
      if (lock) {
        args.push('--lock', '--reason', lockReason);
      }
      args.push(worktreePath, branchName);

      await this.rootGit.raw(args);
    });

    // Apply node_modules strategy outside the mutex
    if (strategy !== 'none') {
      await this.applyNodeModulesStrategy(worktreePath, strategy);
    }

    const all = await this.list();
    const created = all.find((w) => w.agentId === agentId);
    if (!created) {
      throw new WorktreeError(
        'Worktree was created but could not be found in list()',
        { agentId, branch: branchName, path: worktreePath },
      );
    }
    return created;
  }

  async remove(
    agentId: string,
    options?: RemoveWorktreeOptions,
  ): Promise<void> {
    const force = options?.force ?? false;
    const deleteBranch = options?.deleteBranch ?? true;
    const forceDeleteBranch = options?.forceDeleteBranch ?? false;

    const info = await this.findByAgentId(agentId);
    if (!info) {
      return; // Idempotent
    }

    await this.sharedRefsMutex.runExclusive(async () => {
      // Always unlock before removing to avoid "locked worktree" errors
      if (info.locked) {
        try {
          await this.rootGit.raw(['worktree', 'unlock', info.path]);
        } catch {
          // May already be unlocked or path gone
        }
      }

      try {
        const args = ['worktree', 'remove'];
        if (force) {
          args.push('--force');
        }
        args.push(info.path);
        await this.rootGit.raw(args);
      } catch (err) {
        if (!fs.existsSync(info.path)) {
          // Directory was already removed manually — prune metadata
          await this.rootGit.raw(['worktree', 'prune']);
        } else {
          throw new WorktreeError(
            `Failed to remove worktree: ${errorMessage(err)}`,
            { agentId, path: info.path, command: 'worktree remove' },
          );
        }
      }

      if (deleteBranch && info.branch) {
        const shortBranch = info.branch.replace(/^refs\/heads\//, '');
        try {
          await this.rootGit.raw([
            'branch',
            forceDeleteBranch ? '-D' : '-d',
            shortBranch,
          ]);
        } catch (err) {
          throw new WorktreeError(
            `Worktree removed but branch deletion failed: ${errorMessage(err)}`,
            { agentId, branch: shortBranch, command: 'branch delete' },
          );
        }
      }
    });

    this.worktreeGitCache.delete(agentId);
  }

  async list(): Promise<WorktreeInfo[]> {
    const raw = await this.listRaw();
    return raw
      .filter((r) => r.path.startsWith(this.worktreeBaseDir))
      .map((r) => this.rawToInfo(r));
  }

  async getGit(agentId: string): Promise<SimpleGit> {
    const cached = this.worktreeGitCache.get(agentId);
    if (cached) {
      const info = await this.findByAgentId(agentId);
      if (info && fs.existsSync(info.path)) {
        return cached;
      }
      this.worktreeGitCache.delete(agentId);
    }

    const info = await this.findByAgentId(agentId);
    if (!info) {
      throw new WorktreeError(
        `No worktree found for agent "${agentId}"`,
        { agentId },
      );
    }
    if (!fs.existsSync(info.path)) {
      throw new WorktreeError(
        `Worktree directory does not exist: ${info.path}`,
        { agentId, path: info.path },
      );
    }

    const git = simpleGit({
      baseDir: info.path,
      maxConcurrentProcesses: this.maxConcurrentProcesses,
    });
    this.worktreeGitCache.set(agentId, git);
    return git;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle management
  // ---------------------------------------------------------------------------

  async detectStale(): Promise<WorktreeInfo[]> {
    const all = await this.list();
    return all.filter((w) => w.prunable);
  }

  async pruneStale(options?: PruneOptions): Promise<string> {
    const dryRun = options?.dryRun ?? true;
    const expire = options?.expire ?? 'now';

    const args = ['worktree', 'prune', '--expire', expire];
    if (dryRun) {
      args.push('--dry-run');
    }
    args.push('--verbose');

    return this.rootGit.raw(args);
  }

  // ---------------------------------------------------------------------------
  // Deterministic naming
  // ---------------------------------------------------------------------------

  branchNameFor(agentId: string): string {
    return `${BRANCH_PREFIX}${agentId}`;
  }

  worktreePathFor(agentId: string): string {
    return path.join(this.worktreeBaseDir, agentId);
  }

  agentIdFromBranch(branch: string): string | undefined {
    const short = branch.replace(/^refs\/heads\//, '');
    if (short.startsWith(BRANCH_PREFIX)) {
      return short.slice(BRANCH_PREFIX.length);
    }
    return undefined;
  }

  agentIdFromPath(worktreePath: string): string | undefined {
    if (!worktreePath.startsWith(this.worktreeBaseDir)) {
      return undefined;
    }
    return path.basename(worktreePath);
  }

  // ---------------------------------------------------------------------------
  // Porcelain parser
  // ---------------------------------------------------------------------------

  async listRaw(): Promise<RawWorktreeRecord[]> {
    const out = await this.rootGit.raw([
      'worktree',
      'list',
      '--porcelain',
      '-z',
    ]);
    return parseWorktreePorcelain(out);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private validateAgentId(agentId: string): void {
    if (!agentId || /[^a-zA-Z0-9_-]/.test(agentId)) {
      throw new WorktreeError(
        `Invalid agentId "${agentId}": must be non-empty and contain only alphanumeric, dash, or underscore characters`,
        { agentId },
      );
    }
  }

  private async assertBranchExists(branch: string): Promise<void> {
    try {
      await this.rootGit.raw(['rev-parse', '--verify', branch]);
    } catch {
      throw new WorktreeError(
        `Base branch "${branch}" does not exist`,
        { branch },
      );
    }
  }

  private async branchExists(branch: string): Promise<boolean> {
    try {
      await this.rootGit.raw([
        'rev-parse',
        '--verify',
        `refs/heads/${branch}`,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  private async findByAgentId(
    agentId: string,
  ): Promise<WorktreeInfo | undefined> {
    const all = await this.list();
    return all.find((w) => w.agentId === agentId);
  }

  private rawToInfo(record: RawWorktreeRecord): WorktreeInfo {
    const agentId =
      (record.branch
        ? this.agentIdFromBranch(record.branch)
        : undefined) ??
      this.agentIdFromPath(record.path) ??
      path.basename(record.path);

    return {
      agentId,
      path: record.path,
      branch: record.branch,
      head: record.head,
      detached: record.detached,
      locked: record.locked,
      lockReason: record.lockReason,
      prunable: record.prunable,
      prunableReason: record.prunableReason,
      bare: record.bare,
    };
  }

  private async applyNodeModulesStrategy(
    worktreePath: string,
    strategy: NodeModulesStrategy,
  ): Promise<void> {
    const [, release] = await this.installSemaphore.acquire();
    try {
      switch (strategy) {
        case 'symlink-root': {
          const rootNodeModules = path.join(this.repoRoot, 'node_modules');
          const targetNodeModules = path.join(worktreePath, 'node_modules');

          if (!fs.existsSync(rootNodeModules)) {
            return;
          }

          const rootLockHash = this.lockfileHash(this.repoRoot);
          const wtLockHash = this.lockfileHash(worktreePath);
          if (rootLockHash !== wtLockHash) {
            return;
          }

          if (!fs.existsSync(targetNodeModules)) {
            fs.symlinkSync(rootNodeModules, targetNodeModules, 'dir');
          }
          break;
        }
        case 'copy-on-write': {
          const rootNodeModules = path.join(this.repoRoot, 'node_modules');
          const targetNodeModules = path.join(worktreePath, 'node_modules');

          if (!fs.existsSync(rootNodeModules)) {
            return;
          }

          const rootLockHash = this.lockfileHash(this.repoRoot);
          const wtLockHash = this.lockfileHash(worktreePath);
          if (rootLockHash !== wtLockHash) {
            return;
          }

          if (!fs.existsSync(targetNodeModules)) {
            fs.cpSync(rootNodeModules, targetNodeModules, { recursive: true });
          }
          break;
        }
        case 'pnpm-store':
          break;
        case 'none':
          break;
      }
    } finally {
      release();
    }
  }

  private lockfileHash(dir: string): string | null {
    const candidates = [
      'package-lock.json',
      'pnpm-lock.yaml',
      'yarn.lock',
      'bun.lockb',
    ];
    for (const candidate of candidates) {
      const lockPath = path.join(dir, candidate);
      if (fs.existsSync(lockPath)) {
        const stat = fs.statSync(lockPath);
        return `${candidate}:${stat.size}:${stat.mtimeMs}`;
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Porcelain parser (pure function, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parses `git worktree list --porcelain -z` output.
 *
 * With `-z`, all separators become NUL: each field is terminated by NUL,
 * and records are separated by an empty field (double NUL, i.e. empty string
 * between consecutive NULs).
 *
 * Also handles newline-separated format (without -z) for unit test convenience.
 */
export function parseWorktreePorcelain(raw: string): RawWorktreeRecord[] {
  if (!raw || raw.trim() === '') {
    return [];
  }

  const records: RawWorktreeRecord[] = [];
  let current: RawWorktreeRecord | null = null;

  // Split into individual tokens by NUL
  const tokens = raw.split('\0');

  for (const token of tokens) {
    // Each token might contain newlines (non -z format) or be a single field (-z format)
    // Handle both by splitting on newlines within each token
    const lines = token.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line === '') {
        // Empty line/token = record separator
        if (current?.path) {
          records.push(current);
          current = null;
        }
        continue;
      }

      if (line.startsWith('worktree ')) {
        // Start of a new record
        if (current?.path) {
          records.push(current);
        }
        current = {
          path: line.slice('worktree '.length),
          detached: false,
          locked: false,
          prunable: false,
          bare: false,
        };
      } else if (current) {
        if (line.startsWith('HEAD ')) {
          current.head = line.slice('HEAD '.length);
        } else if (line.startsWith('branch ')) {
          current.branch = line.slice('branch '.length);
        } else if (line === 'detached') {
          current.detached = true;
        } else if (line === 'bare') {
          current.bare = true;
        } else if (line === 'locked') {
          current.locked = true;
        } else if (line.startsWith('locked ')) {
          current.locked = true;
          current.lockReason = line.slice('locked '.length);
        } else if (line === 'prunable') {
          current.prunable = true;
        } else if (line.startsWith('prunable ')) {
          current.prunable = true;
          current.prunableReason = line.slice('prunable '.length);
        }
      }
    }
  }

  // Don't forget the last record
  if (current?.path) {
    records.push(current);
  }

  return records;
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class WorktreeError extends Error {
  public readonly context: Record<string, unknown>;

  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message);
    this.name = 'WorktreeError';
    this.context = context;
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
