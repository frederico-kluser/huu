/**
 * Brazilian Portuguese catalog. Typed as `Record<MessageKey, string>`: leave an
 * `en` key untranslated and `tsc` fails before the app ever runs.
 */

import type { MessageKey } from '../../catalog.js';
import { commonPtBR } from './common.js';
import { cliPtBR } from './cli.js';
import { tuiPtBR } from './tui.js';
import { tuiRunPtBR } from './tui-run.js';
import { tuiEditorPtBR } from './tui-editor.js';
import { webPtBR } from './web.js';

export const ptBR: Record<MessageKey, string> = {
  ...commonPtBR,
  ...cliPtBR,
  ...tuiPtBR,
  ...tuiRunPtBR,
  ...tuiEditorPtBR,
  ...webPtBR,
};
