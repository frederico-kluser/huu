/**
 * HUU — Multi-agent orchestrator for software development.
 *
 * @remarks
 * HUU decomposes complex tasks into a hierarchical Beat Sheet, delegates to
 * 11 specialized agents running in isolated Git worktrees, and integrates
 * their work through a 4-tier progressive merge pipeline. All state lives
 * in a single SQLite WAL database.
 *
 * @packageDocumentation
 */

// ── Shared types ─────────────────────────────────────────────────────
export * from './types/index.js';

// ── Database layer ───────────────────────────────────────────────────
export * from './db/index.js';

// ── Git operations ───────────────────────────────────────────────────
export * from './git/index.js';

// ── Agent system ─────────────────────────────────────────────────────
export * from './agents/index.js';

// ── Orchestrator & Beat Sheet ────────────────────────────────────────
export * from './orchestrator/index.js';

// ── Memory & Learning ────────────────────────────────────────────────
export * from './memory/index.js';

// ── MCP Bridge ───────────────────────────────────────────────────────
export * from './mcp/index.js';

// ── Audit System ─────────────────────────────────────────────────────
export * from './audit/index.js';
