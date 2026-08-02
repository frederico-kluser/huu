---
name: translating-the-ui
description: Procedure and conventions for huu's bilingual UI (en + pt-BR) — the single catalog under src/lib/i18n, the typed t() that THROWS on a key missing from any locale, the three enforcement layers (tsc parity, initI18n boot audit, per-call throw), the browser half fed by GET /api/i18n and data-i18n attributes, and the coverage test that scans the source for untranslated references. Use whenever you add, change or remove a user-facing string in src/ui, src/web, src/cli.tsx or any lib message that reaches a screen; when a key must be assembled at run time; when adding a locale; or when a CatalogIntegrityError / MissingTranslationError shows up.
metadata:
  version: 0.1.0
  type: task
---

# Translating the UI

## When to use

Any change that adds, edits or deletes text a human reads: `src/ui/components/`,
`src/app.tsx`, `src/cli.tsx`, `src/web/client/**`, `src/web/serve.ts`, and the
handful of `src/lib/` modules whose messages surface on a screen
(`git-preflight.ts`). Also: adding a locale, or debugging a
`CatalogIntegrityError` / `MissingTranslationError`.

## Injected knowledge

### One catalog, two front-ends

`src/lib/i18n/` is the lowest layer and imports **nothing but itself** — that is
what lets `src/cli.tsx` call `initI18n(process.env)` at the very top of the
module, before the Docker gate and before React/Ink load, so even the host
wrapper's stderr is translated.

```
locales/en/{common,cli,tui,tui-run,tui-editor,web}.ts   ← SOURCE: defines MessageKey
locales/pt-BR/{same six}.ts                              ← Record<MessageKey, string>
catalog.ts   MessageKey, CATALOGS, localesMissing()
validate.ts  validateCatalogs(), assertCatalogsComplete()
index.ts     t(), translate(), tStatus(), initI18n(), messagesFor()
```

The browser does **not** get a second table: `GET /api/i18n?locale=` serves
`messagesFor(locale)` and `src/web/client/i18n.js` adopts it. Same reasoning as
`devModelRoles` riding `/api/bootstrap` — one source of truth, no drift.

### A missing translation is an ERROR, in three layers

Each layer catches what the previous one cannot. Do not weaken one because
another exists.

1. **`tsc`** — `en` defines `MessageKey`; `pt-BR` is `Record<MessageKey, string>`.
   A key added to `en` alone fails `npm run typecheck`, naming the key. Types
   cannot see empty strings, orphans or placeholder drift.
2. **Boot** — every entrypoint calls `initI18n()` → `assertCatalogsComplete()`,
   which aborts with `CatalogIntegrityError` on a missing/empty/orphan key or on
   `{placeholder}` sets that differ between locales. Types are gone at run time;
   this is the net.
3. **Call site** — `t()`/`translate()` throw `MissingTranslationError` when the
   key is missing from **any** shipped locale, including one the user is not
   running. Reason: an English-only key must not survive just because nobody
   switched to `pt-BR`.

`HUU_I18N_STRICT=0` downgrades 2 and 3 to a stderr warning + raw key. That is
the escape hatch for operators, not a development mode.

The fourth net is `src/lib/i18n/coverage.test.ts`: it walks `src/`, collects
every referenced key, and fails on an untranslated reference **or** an orphan
catalog key. Keys built at run time are exempted by prefix in
`DYNAMIC_PREFIXES` — add yours there or the orphan check will flag the family.

### Call shapes

| Surface | Import | Call |
|---|---|---|
| TUI / CLI / server | `../lib/i18n/index.js` | `t('tui.home.menu_quit')` — typed |
| Runtime-built key | same | `translate(\`status.${code}\`)` — untyped |
| Kanban status code | same | `tStatus('NO CHANGES')` → `status.no_changes` |
| Browser JS | `../i18n.js` | `t('web.settings.title')` |
| Browser markup | — | `data-i18n="web.settings.title"` |

Markup variants: `data-i18n` (textContent), `-html` (innerHTML),
`-placeholder`, `-title`, `-aria-label`. `applyI18n()` walks them and is
idempotent, which is why the language switcher re-applies instead of reloading —
a reload would drop the SSE stream and the live board.

Interpolate with `{name}`; a slot without a matching param throws
`MissingParamError`. Keep the placeholder SET identical across locales (the boot
audit compares them) but let translators move them freely inside the sentence.

### Gotchas each of which was a real bug

- **Module-level `t()` translates at IMPORT time**, before `initI18n()` resolved
  the locale — and breaks the repo's "module bodies stay pure" rule. A
  `const HINTS = [{ label: t('…') }]` must become a function
  (`editorNavHints()` in `PipelineEditor.tsx` is the precedent).
- **`t` collides** with the house habit of naming a delegated event target or a
  map callback `t` (`const t = e.target`). Rename the local; never alias the
  import, so every call site reads the same. The client typecheck catches it as
  "This expression is not callable".
- **Hand-padded labels die in translation.** `RunModal`'s git block aligned on
  `'  branch   '`. Move padding to the render site (`label.padEnd(9)`) and keep
  only the word in the catalog.
- **Inline `<Text bold>` inside a sentence cannot be translated** — word order
  belongs to the translator. Collapse to one key with a `{label}` placeholder and
  accept losing the inline emphasis.
- **Classifiers stay locale-blind.** `src/lib/card-state.ts` and its browser
  mirror `src/web/client/card-state.js` are pure, mirrored, and pinned by two
  test files; they return English CODES. Translate at the render boundary —
  `tStatus()` in `RunKanban`, `phaseLabel()` in `board.js`.
- **Pipeline DATA is not chrome.** Scaffold step names and prompts in
  `PipelineEditor` go to an LLM. They stay English so a pipeline behaves
  identically whatever language its author's UI was in.

### Language selection

`HUU_LANG` → `HUU_LOCALE` → `LC_ALL` → `LC_MESSAGES` → `LANG`, normalized by
`normalizeLocale` (`pt`, `pt-PT`, `pt_BR.UTF-8` → `pt-BR`); unknown → `en`. The
web UI overrides it per browser via ⚙ Settings (`localStorage` `huu.lang`).

## Procedure

1. Add the key to the right module under `locales/en/` — `common.ts` (shared
   verbs, `status.*` codes), `cli.ts`, `tui.ts` (setup/pickers/editors),
   `tui-run.ts` (run surface), `tui-editor.ts` (pipeline + step editor, home,
   FAQ, summary), `web.ts`.
2. Add the same key to the `pt-BR` twin. Translate the message, not the words:
   keep `{placeholders}`, drop English word order.
3. Use it with the call shape from the table above.
4. Runtime-assembled key? Use `translate()` and register its prefix in
   `DYNAMIC_PREFIXES` in `coverage.test.ts`.
5. `npm run typecheck && npm test` — the i18n suite is `src/lib/i18n/*.test.ts`
   plus `src/web/client/i18n.test.js`.
6. User-facing change? Update `docs/i18n.md` **and** its `docs/i18n.pt-BR.md`
   twin (`npx tsx scripts/check-twins.ts`), and add a `.changes/` fragment.

### Adding a locale

Add it to `LOCALES` + `LOCALE_LABELS` (`types.ts`, `index.ts`), teach
`normalizeLocale` its spellings, create `locales/<id>/` with the six modules
typed `Record<MessageKey, string>`, then let `tsc` list every key you owe.

## References

- `docs/i18n.md` · `docs/i18n.pt-BR.md` (user-facing)
- `src/lib/i18n/index.ts`, `validate.ts`, `coverage.test.ts`,
  `src/web/client/i18n.js`, `GET /api/i18n` in `src/web/server.ts`
- Related skills: building-tui-screens, building-web-ui,
  following-architecture-conventions, writing-tests, writing-project-docs

> Facts verified against source on 2026-08-01.

## <evolution>

After the task completes:

1. Only persist learnings if the task passed its tests/criteria.
2. Keep only non-obvious, durable learnings: surprises, user corrections, discovered conventions, failed approaches. Skip the obvious and the volatile.
3. Append to the LEARNINGS.md of the skill that OWNS the domain. Format: `- [YYYY-MM-DD][source:user|inference][task:<slug>][probation] <fact>` — user feedback outranks inference.
4. SKILL.md bodies have one human writer per surface — never auto-distill LEARNINGS into the body.
5. If a NEW knowledge area emerged, invoke meta-skill-evolution to propose a new skill.
6. Never merge skill changes yourself — leave them as an uncommitted git diff for human review.
