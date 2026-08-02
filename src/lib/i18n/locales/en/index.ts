/**
 * The SOURCE catalog. Its keys define `MessageKey`, so `pt-BR` is a
 * `Record<MessageKey, string>` and a key added here without a translation is a
 * compile error (and, at run time, a `MissingTranslationError`).
 */

import { commonEn } from './common.js';
import { cliEn } from './cli.js';
import { tuiEn } from './tui.js';
import { tuiRunEn } from './tui-run.js';
import { tuiEditorEn } from './tui-editor.js';
import { webEn } from './web.js';

export const en = {
  ...commonEn,
  ...cliEn,
  ...tuiEn,
  ...tuiRunEn,
  ...tuiEditorEn,
  ...webEn,
};
