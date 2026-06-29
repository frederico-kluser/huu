/**
 * Resolve the `$file` fan-out token in a step name for HUMAN display.
 *
 * Work steps with `scope: "per-file"` / `"memory"` carry a template name like
 * `"3. Write tests for $file"`. The orchestrator expands `$file` to the exact
 * relative path in the AGENT PROMPT (machine-facing, must be precise — see
 * `orchestrator/index.ts`). UI card titles are HUMAN-facing, so here `$file`
 * collapses to the file's BASENAME (`"3. Write tests for Button.tsx"`) — short
 * enough to survive the kanban's title truncation, with the full path still
 * shown in the card's dedicated file row / drawer.
 *
 * Stage-level cards (a merge spanning every per-file branch) have no single
 * file: pass `null`/`undefined` and the token collapses to the plural `"files"`
 * so the raw `$file` never reaches the user.
 *
 * Pure string substitution. Mirrored verbatim in `web/client/title-util.js`
 * (the browser client is vanilla ESM and cannot import this typed module) —
 * keep the two in sync; `title-format.test.ts` is the source-of-truth spec.
 */
export function substituteFileInTitle(
  title: string,
  file: string | null | undefined,
): string {
  if (!title.includes('$file')) return title;
  const label = file ? basename(file) : 'files';
  return title.replaceAll('$file', label);
}

/** Last path segment of a `/`- or `\`-separated path (trailing slashes ignored). */
function basename(file: string): string {
  const trimmed = file.replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const seg = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return seg || file;
}
