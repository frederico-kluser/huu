/**
 * Shared vocabulary: key-hint verbs, placeholders and the status CODES the
 * kanban classifier emits (`src/lib/card-state.ts` stays locale-blind — see
 * `tStatus()`).
 */

export const commonEn = {
  'common.action.select': 'select',
  'common.action.cancel': 'cancel',
  'common.action.navigate': 'navigate',
  'common.action.confirm': 'confirm',
  'common.action.next': 'next',
  'common.action.back': 'back',
  'common.action.quit': 'quit',
  'common.action.save': 'save',
  'common.action.edit': 'edit',
  'common.action.add': 'add',
  'common.action.delete': 'delete',
  'common.action.clear': 'clear',
  'common.action.copy': 'copy',
  'common.action.move': 'move',
  'common.action.open': 'open',
  'common.action.close': 'close',
  'common.action.toggle': 'toggle',
  'common.action.abort': 'abort',
  'common.action.run': 'run',

  'common.field.name': 'Name:',

  'common.none': '(none)',
  'common.empty': '(empty)',
  'common.unnamed': '(unnamed)',
  'common.pending': '(pending)',
  'common.more_up': '↑ more',
  'common.more_down': '↓ more',

  // Kanban / lifecycle status codes.
  'status.pending': 'PENDING',
  'status.running': 'RUNNING',
  'status.review': 'REVIEW',
  'status.fixing': 'FIXING',
  'status.ready': 'READY',
  'status.done': 'DONE',
  'status.failed': 'FAILED',
  'status.timeout': 'TIMEOUT',
  'status.paused': 'PAUSED',
  'status.no_changes': 'NO CHANGES',
  'status.unmerged': 'UNMERGED',
  'status.merged': 'MERGED',
  'status.merging': 'MERGING',
  'status.skipped': 'SKIPPED',
  'status.judging': 'JUDGING',
  'status.ai_resolve': 'AI RESOLVE',
  'status.finalizing': 'FINALIZING',
  'status.committing': 'COMMITTING',
  'status.cleaning_up': 'CLEANING_UP',
  'status.pushing': 'PUSHING',
  'status.validating': 'VALIDATING',
  'status.queued': 'QUEUED',
  'status.aborted': 'ABORTED',

  // Provider blurbs (labels are brand names and stay untranslated).
  'provider.openrouter.description':
    'Pay-per-token access to open + frontier models. Key starts with sk-or-.',
  'provider.azure.description':
    'Your own Azure deployment. Needs an API key + endpoint URL from the portal.',
} as const;
