/* Resolve the `$file` fan-out token in a step name for HUMAN display.

   Per-file / memory work steps are named with a `$file` template (e.g.
   "3. Write tests for $file"). Card titles are human-facing, so `$file`
   collapses to the worked file's BASENAME ("3. Write tests for Button.tsx").
   Stage-level cards (a merge spanning every per-file branch) have no single
   file: pass a falsy `file` and the token becomes the plural "files" so the
   raw `$file` never reaches the user.

   Pure + DOM-free, so it unit-tests in Node (see ../title-util.test.js).
   Mirror of src/lib/title-format.ts (the typed source-of-truth spec) — the
   browser client is vanilla ESM and can't import the typed lib, so keep the
   two in sync. */

export function substituteFileInTitle(title, file) {
  if (!title || title.indexOf('$file') === -1) return title;
  const label = file ? basename(file) : 'files';
  return title.split('$file').join(label);
}

function basename(file) {
  const trimmed = String(file).replace(/[\\/]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const seg = idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
  return seg || String(file);
}
