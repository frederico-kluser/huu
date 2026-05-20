/**
 * Shared write-tool detection across backends. Each backend's event mapper
 * imports this so the orchestrator's `file_write` events are emitted from a
 * single canonical set — drift between Pi tool names and Copilot tool names
 * caused real bugs in earlier prototypes.
 *
 * Pi exposes simple verbs (`edit`, `write`, `create`, `patch`); Copilot
 * uses both verb-only forms and `<verb>_file` forms; some MCP servers add
 * their own. Keep this set permissive on the input side so a new backend
 * doesn't silently lose `file_write` events when a tool gets renamed.
 */
export const WRITE_TOOLS: ReadonlySet<string> = new Set([
  // Pi defaults (real-agent.ts legacy set)
  'edit',
  'write',
  'create',
  'patch',
  // Copilot CLI tool names (verified docs.github.com Apr 2026)
  'edit_file',
  'str_replace',
  'create_file',
  'write_file',
  'apply_patch',
]);

/**
 * The path argument key varies across SDKs and even across models within
 * the same SDK (Anthropic uses `path`, OpenAI sometimes `file_path`,
 * older Pi versions emitted `filePath`). Returns null when the args
 * don't carry a usable path — the caller falls back to the tool name only.
 */
export function extractFileFromArgs(args: unknown): string | null {
  if (!args || typeof args !== 'object') return null;
  const a = args as Record<string, unknown>;
  if (typeof a.path === 'string') return a.path;
  if (typeof a.file_path === 'string') return a.file_path;
  if (typeof a.filePath === 'string') return a.filePath;
  return null;
}

/**
 * Lower-cased membership check. Tool names from different SDKs occasionally
 * land with surprising casing (e.g. some MCP servers shout `Write`).
 */
export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name.toLowerCase());
}
