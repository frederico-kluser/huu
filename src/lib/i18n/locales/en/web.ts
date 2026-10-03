/** Browser UI. Served to the client by `GET /api/i18n` — see src/web/client/i18n.js. */

export const webEn = {
  'web.common.add': 'Add',
  'web.common.auto': 'Auto',
  'web.common.back': '← Back',
  'web.common.clear_all': 'Clear all',
  'web.common.close': 'Close',
  'web.common.default': 'default',
  'web.common.delete': 'Delete',
  'web.common.loading': 'Loading…',
  'web.common.manual': 'Manual',
  'web.common.min': 'min',
  'web.common.na': 'n/a',
  'web.common.no': 'no',
  'web.common.remove': 'Remove',
  'web.common.yes': 'yes',

  'web.boot.failed': 'Failed to load huu: {message}',

  'web.top.stage': 'Stage',
  'web.top.stage_title': 'Pipeline stage / wave',
  'web.top.tasks': 'Tasks',
  'web.top.tasks_title': 'Tasks completed / total',
  'web.top.elapsed': 'Elapsed',
  'web.top.elapsed_title': 'Elapsed time',
  'web.top.cost': 'Cost',
  'web.top.cost_title': 'Estimated cost (USD)',
  'web.top.fewer_agents': 'Fewer agents',
  'web.top.more_agents': 'More agents',
  'web.top.conc_mode':
    'Concurrency mode — click to toggle Auto · Manual (machine throughput lives in ⚙ RAM budget)',
  'web.top.auto': 'auto',
  'web.top.pause': 'Pause',
  'web.top.pause_title': 'Pause / resume the simulation',
  'web.top.resume': 'Resume',
  'web.top.finish': 'Finish',
  'web.top.finish_title': 'Finish the run — stop waiting for retries',
  'web.top.stop': 'Stop',
  'web.top.stop_queue': 'Stop queue',
  'web.top.stop_queue_title': 'Stop the whole queue',
  'web.top.theme': 'Toggle theme',


  'web.launch.title': 'Run a pipeline',
  'web.launch.subtitle':
    'Deterministic processes over thinking agents — pick one, choose a model, go.',
  'web.launch.queue_running': 'Queue running',
  'web.launch.view_board': 'View board →',
  'web.launch.steps_aria': 'Launch steps',
  'web.launch.pick_pipeline': 'Pick a pipeline',
  'web.launch.mark_folders': 'Mark project folders',
  'web.launch.mark_hint':
    'Navigate the filesystem and tick every project this pipeline should run on — each marked folder becomes its own run. Marks persist as you browse.',
  'web.launch.no_pipelines': 'No pipelines found in',

  'web.step.pipeline': 'Pipeline',
  'web.step.projects': 'Projects',
  'web.step.config': 'Config',
  'web.step.queue': 'Queue',

  'web.folder.home': '⌂ Home',
  'web.folder.home_title': 'Jump to the workspace root (HUU_WORKSPACE, default your home folder)',
  'web.folder.parent': '↑ Parent',
  'web.folder.mark_all': '☑ Mark all',
  'web.folder.mark_all_n': '☑ Mark all ({count})',
  'web.folder.unmark_all_n': '☐ Unmark all ({count})',
  'web.folder.mark_all_title':
    'Mark every sub-folder listed here as a project (when all are marked, unmarks them)',
  'web.folder.mark_all_title_n': 'Mark all {count} sub-folders listed here as projects',
  'web.folder.unmark_all_title': 'Every sub-folder here is marked — click to unmark them all',
  'web.folder.use_prefix': 'Use',
  'web.folder.use_suffix': 'selected →',
  'web.folder.no_subdirs': 'No sub-directories',
  'web.folder.mark': 'Mark as project',
  'web.folder.unmark': 'Unmark project',
  'web.folder.is_git': '✓ git',
  'web.folder.not_git': '⚠ not git',
  'web.folder.this_folder': 'this folder',

  'web.config.title': 'Configure this pipeline',
  'web.config.pipeline': 'Pipeline',
  'web.config.projects': 'Projects',
  'web.config.provider': 'Provider',
  'web.config.model': 'Model',
  'web.config.model_placeholder': 'Loading models…',
  'web.config.resolver_model': 'Conflict resolver model',
  'web.config.resolver_placeholder': 'Same as run model',
  'web.config.resolver_placeholder_value': 'Same as run model',
  'web.config.resolver_hint':
    'Used only to resolve merge conflicts during integration · runs at max thinking · empty = same as run model',
  'web.config.concurrency': 'Concurrency',
  'web.config.timeout': 'Max time per agent',
  'web.config.timeout_hint':
    "Time limit for each agent, applied to the whole pipeline. Empty = the global default from Settings (⚙), or the pipeline default if that's unset too.",
  'web.config.add_to_queue': 'Add to queue',
  'web.config.add_hint':
    'This pipeline runs on every project you marked — add more pipelines next, or run the queue.',

  'web.queue.title': 'Queue',
  'web.queue.empty': 'Queue is empty — add a pipeline to get started.',
  'web.queue.add_another': 'Add another pipeline',
  'web.queue.add_start': 'Add & start',
  'web.queue.run': 'Run queue',
  'web.queue.run_n': 'Run queue ({count})',
  'web.queue.running_label': 'Running…',
  'web.queue.default_model': 'default model',
  'web.queue.err_pick_first': 'Pick a pipeline and mark at least one project',
  'web.queue.added_starting': 'Added {count} — starting now',
  'web.queue.added_one': 'Added {count} project to the queue',
  'web.queue.added_other': 'Added {count} projects to the queue',
  'web.queue.project_count_one': '{count} project',
  'web.queue.project_count_other': '{count} projects',
  'web.queue.remove_pipeline': 'Remove pipeline',
  'web.queue.key_needed': 'key needed',
  'web.queue.run_word': 'run',
  'web.queue.run_failed': '{name} failed: {reason}',
  'web.queue.see_board': 'see the board or the huu terminal log',
  'web.queue.finished_ok': 'Queue finished ✓ · saved to History',
  'web.queue.finished_errors': 'Queue finished — {count} failed · saved to History',
  'web.queue.stopped': 'Queue stopped',
  'web.queue.stopping': 'Stopping queue…',

  'web.qstatus.queued': 'queued',
  'web.qstatus.running': 'running',
  'web.qstatus.done': 'done',
  'web.qstatus.failed': 'failed',

  'web.status.idle': 'idle',
  'web.status.queued': 'queued',
  'web.status.running': 'running',
  'web.status.done': 'done',
  'web.status.error': 'error',
  'web.status.review': 'review',
  'web.status.paused_ram': 'paused (RAM)',

  'web.lane.todo': 'To do',
  'web.lane.doing': 'In progress',
  'web.lane.done': 'Done',

  'web.run.spinning_up': 'Spinning up agents…',
  'web.run.preparing': 'Preparing worktrees…',
  'web.run.wave': 'wave {n}',
  'web.run.failed_label': 'Failed:',
  'web.run.done_label': 'Done.',
  'web.run.pipeline_finished': 'Pipeline “{name}” finished.',
  'web.run.switch_projects': 'Switch between running projects',
  'web.run.new_run': '← New run',
  'web.run.run_again': '↻ Run again',
  'web.run.stopping': 'Stopping run…',

  'web.log.title': 'Run log',
  'web.log.running': 'running',
  'web.log.projects': '{count} projects',
  'web.log.queued': '{count} queued',
  'web.log.lines': '{count} lines',
  'web.log.filter_aria': 'Filter log by level',
  'web.log.all': 'All',
  'web.log.warn_only': 'Warnings only',
  'web.log.error_only': 'Errors only',
  'web.log.jump': '↓ Latest',
  'web.log.waiting_first': 'Waiting for the first log line…',
  'web.log.empty': 'No log entries yet.',

  'web.card.task': 'Task {id}',
  'web.card.merge': 'Merge',
  'web.card.judge': 'Judge',
  'web.card.merged_n': '{count} merged',
  'web.card.conflicts_n': '{count} conflict',
  'web.card.resolver': 'resolver',
  'web.card.default': 'default',
  'web.card.next': 'next: {name}',
  'web.card.retry_n': 'retry {count}',
  'web.card.review_waived_title':
    'review waived at the round cap — blocking findings remained',

  'web.phase.agent': 'agent',
  'web.phase.merge': 'merge',
  'web.phase.judge': 'judge',
  'web.phase.timeout': 'timeout',
  'web.phase.failed': 'failed',
  'web.phase.paused': 'paused',
  'web.phase.no_changes': 'no changes',
  'web.phase.unmerged': 'unmerged',
  'web.phase.ready': 'ready',
  'web.phase.requeued': 'requeued',
  'web.phase.queued': 'queued',
  'web.phase.review': 'review',
  'web.phase.fixing': 'fixing',

  'web.kv.phase': 'Phase',
  'web.kv.stage': 'Stage',
  'web.kv.tokens_in': 'Tokens in',
  'web.kv.tokens_out': 'Tokens out',
  'web.kv.cost': 'Cost',
  'web.kv.requeues': 'Requeues',
  'web.kv.review_rounds': 'Review rounds',
  'web.kv.review': 'Review',
  'web.kv.review_waived': 'waived at the round cap',
  'web.kv.branch': 'Branch',
  'web.kv.files': 'Files',
  'web.kv.commit': 'Commit',
  'web.kv.error': 'Error',
  'web.kv.runs': 'Runs',
  'web.kv.run': 'Run',
  'web.kv.merged': 'Merged',
  'web.kv.pending': 'Pending',
  'web.kv.resolver': 'Resolver',
  'web.kv.used': 'used',
  'web.kv.conflicts': 'Conflicts',
  'web.kv.model': 'Model',
  'web.kv.outcome': 'Outcome',
  'web.kv.next': 'Next',
  'web.kv.from_judge': 'From judge',

  'web.drawer.logs': 'Logs',
  'web.drawer.condition': 'Condition:',

  'web.retry.timed_out': 'Timed out — re-run with a new time limit, or as-is.',
  'web.retry.failed': 'Failed — re-run this task.',
  'web.retry.new_timeout': 'New timeout (min)',
  'web.retry.go': 'Retry task',
  'web.retry.go_timeout': 'Retry with new timeout',
  'web.retry.toast': 'Retrying task #{id}…',
  'web.retry.finishing': 'Finishing run…',

  'web.budget.tip_head': 'huu may use up to {percent}% of RAM ({gib} GiB) across all runs.',
  'web.budget.tip_used': 'Used {used} of {total} GiB · PSI some {psi}',
  'web.budget.container_scope': 'container scope {scope}G of host {host}G',
  'web.budget.host_avail': '{avail}G avail',
  'web.budget.guard': 'guard: {reason}',
  'web.budget.agents_live': 'agents live {live} of budget B {budget}',
  'web.budget.reserved': '{count} judge/merge',
  'web.budget.footprint': 'footprint/agent ≈ {mib} MiB',
  'web.budget.chip_host': 'host {used}/{total}G',
  'web.budget.chip_agents': 'agents {live}/{budget}',
  'web.budget.chip_ram': 'RAM {percent}%',
  'web.budget.chip_huu': 'huu {used}/{total}G',
  'web.budget.host_limited': 'host-limited',
  'web.pressure.over_budget': 'over budget',
  'web.pressure.pressure': 'pressure',
  'web.pressure.thrash': 'thrash',

  'web.combo.inherit_hint': 'inherit the run model for conflict resolution',
  'web.combo.use_custom': 'Use “{id}”',
  'web.combo.custom_id': 'custom id',
  'web.combo.custom_model_id': 'custom model id',
  'web.combo.as_is': 'sent to OpenRouter as-is',
  'web.combo.reasoning': 'reasoning',
  'web.combo.thinking': 'thinking',
  'web.combo.no_tools': 'no tools',
  'web.combo.search_placeholder': 'Search or type any model id…',
  'web.combo.type_placeholder': 'Type a model id…',
  'web.combo.available_one': '{count} model available',
  'web.combo.available_other': '{count} models available',
  'web.combo.models_count': '{count} models',
  'web.combo.full_catalog': 'full OpenRouter catalog · or type any model id',
  'web.combo.catalog_offline':
    "Couldn't reach OpenRouter — showing recommended models; type any model id to use it anyway",

  'web.key.paste_value': 'paste value…',
  'web.key.validate_use': 'Validate & use',
  'web.key.expected_prefix': 'Expected to start with “{prefix}”.',
  'web.key.set': '✓ {label} set',
  'web.key.needed': '{label} needed',
  'web.key.change': 'change',
  'web.key.session_only':
    'Validated against the provider, then kept only in this browser tab — never written to disk.',
  'web.key.validated_session': 'Key validated ✓ — kept in this browser only',
  'web.key.rejected': 'Key rejected (HTTP {status}). Check it and paste again.',
  'web.key.wrong_provider':
    'That is a {label} key — not saved. Pick {label} as your provider, or paste the right key.',
  'web.key.unverified': "Couldn't verify the value ({reason}) — using it for this session anyway.",

  'web.history.title': 'Run history',
  'web.history.export': 'Export JSON',
  'web.history.none': 'No runs yet',
  'web.history.empty': 'No runs yet. Run a queue to build history.',
  'web.history.unavailable': 'History unavailable: {message}',
  'web.history.meta_one': '{count} run · ${total} total',
  'web.history.meta_other': '{count} runs · ${total} total',
  'web.history.cards': '{count} cards',
  'web.history.unmerged': 'unmerged',
  'web.history.col_kind': 'Kind',
  'web.history.col_card': 'Card',
  'web.history.col_phase': 'Phase',
  'web.history.col_tokens': 'Tokens',
  'web.history.col_cost': 'Cost',
  'web.history.no_cards': 'No cards recorded for this run.',
  'web.history.total_prefix': 'Project total',
  'web.history.card_sum': 'card costs sum ${sum}',
  'web.history.nothing_export': 'Nothing to export',
  'web.history.exported_one': 'Exported {count} run',
  'web.history.exported_other': 'Exported {count} runs',
  'web.history.confirm_clear': 'Clear all run history? This cannot be undone.',

  'web.settings.title': 'Settings',
  'web.settings.aria': 'Web UI settings',
  'web.settings.language': 'Language',
  'web.settings.language_hint':
    'Applies to this browser only. The terminal UI follows HUU_LANG.',
  'web.settings.language_changed': 'Language changed',
  'web.settings.timeout_hint':
    "Default for every run started from this browser, applied to the whole pipeline. Empty = the pipeline's default (10 min · 5 min for single-file tasks). A per-project value overrides this. Web UI only — the CLI keeps its own rules.",
  'web.settings.timeout_global': '{minutes} (global)',
  'web.settings.ram': 'RAM budget',
  'web.settings.ram_hint':
    'Share of total RAM huu may use across ALL concurrent runs on this machine (10–95). Applied IMMEDIATELY to running and queued runs, persisted on the server, and enforced by the pressure guard (the topbar chip shows the live value). Higher = more parallelism, thinner safety margin; the rest is reserved for the OS. Empty = 70%.',
  'web.settings.ram_applied': 'RAM budget: {percent}% — applied to all runs now',
  'web.settings.keys': 'Provider API keys',
  'web.settings.checking': 'Checking…',
  'web.settings.validate_add': 'Validate & add',
  'web.settings.validating': 'Validating…',
  'web.settings.keys_hint':
    'Checked against the selected provider first — a rejected key, or one that belongs to a different provider, is never saved. A valid key joins the pool and is used by every new run (this session and future huu starts); this tab starts using it immediately. With more than one key huu rotates per attempt, skipping burned and cooling ones. Validation results and any run problem are also logged in the terminal running huu.',
  'web.settings.in_use': 'in use',
  'web.settings.remove_key': 'Remove this key from the pool',
  'web.settings.pool_count_one': '{count} key in the pool · huu rotates per attempt, skipping burned and cooling ones.',
  'web.settings.pool_count_other': '{count} keys in the pool · huu rotates per attempt, skipping burned and cooling ones.',
  'web.settings.pool_reset': 'reset burned / cooldowns',
  'web.settings.pool_reset_done': 'Burned keys and cooldowns cleared',
  'web.settings.no_key': 'No {label} key yet — paste one below.',
  'web.settings.active_key': '✓ Active: {masked} — {source}',
  'web.settings.clear_saved': 'clear saved key',
  'web.settings.env_ignored':
    '⚠ {envVar} is set in the environment but IGNORED — the key above wins. Clear the saved key to fall back to it.',
  'web.settings.session_key':
    'This tab holds a validated session key and sends it with runs launched here.',
  'web.settings.status_unavailable': 'Key status unavailable: {message}',
  'web.settings.paste_first': 'Paste a {label} key first.',
  'web.settings.key_wrong_provider':
    'That is a {label} key, not a {expected} key — nothing was saved.',
  'web.settings.key_rejected':
    '{label} rejected this key (HTTP {status}) — nothing saved. Check it and paste again.',
  'web.settings.key_saved': 'Key validated ✓ and saved — every new run will use it',
  'web.settings.key_unverified':
    "Couldn't reach {label} to verify ({reason}) — key saved anyway; runs will try it.",
  'web.settings.key_removed': 'Key removed from the pool',
  'web.settings.key_cleared': 'Saved key cleared',
  'web.settings.key_cleared_note': 'Saved key cleared — {note}',

  'web.keysrc.options': 'saved via this Options screen (active now)',
  'web.keysrc.stored': 'saved key (config store)',
  'web.keysrc.secret_mount': 'forwarded from the host when huu started',
  'web.keysrc.env_file': 'file named by the _FILE env var',
  'web.keysrc.env': 'environment variable',

  'web.sim.title': 'Simulation',
  'web.sim.subtitle':
    'Watch the kanban, agents and live logs run end-to-end — fully synthetic: no branches, no API key, no cost. Pick your models, how many files, and how many agents run at once.',
  'web.sim.configure': 'Configure the simulation',
  'web.sim.models': 'Models',
  'web.sim.model_placeholder': 'e.g. deepseek/deepseek-chat — type and Add',
  'web.sim.files': 'Number of files',
  'web.sim.agents': 'Simultaneous agents',
  'web.sim.start': 'Start simulation',
  'web.sim.hint':
    'Each run randomly draws the full mix of scenarios — streaming, memory-guard requeues (↻), retries, stage merges and the judge’s rework loop.',
  'web.sim.back': '← Back to huu',

  // The methodology checkboxes. Keyed by `DevMethodology` field so the browser
  // renders the CATALOG's wording, not the raw English the server serves from
  // `methodology-registry.ts` — that registry declares WHICH options exist;
  // these keys declare how they READ. Built at run time from `opt.key`, so the
  // family is registered in coverage.test.ts's DYNAMIC_PREFIXES.
  // The side effect is IN the description on purpose. `--debate` is the only
  // option that adds no rubric and no gate of its own, so the critic switching
  // to HOLD is a behaviour the user gets without asking unless it is said here.
  
  /* NOT hidden, ANNOUNCED. The driver loads both as session metadata and neither
     is compiled into a drawing, so the honest UI is the panel still standing
     there with a sentence saying what it will and will not do. */

  /* The session panel, when the session is a DRAWING. `drawnMethod` arrives on
     the first frame; `graph` only once the drawing compiled. */

  /* The resume gate, when the session on disk was a DRAWING. */

  /* ---- The adversarial debate chat (`--debate` only) ---- */
  // THREE DIFFERENT FACTS, three different sentences. They used to collide:
  // `silent` was printed for a side that crashed AND for a round whose live
  // narration had simply scrolled out of memory, and both read as a deliberate
  // choice not to write. Only `silent` is a claim about the DEBATE (the server
  // read the file and there was none); the other two are claims about the agent
  // and about the UI.



  /* ── The method canvas (/graph) ────────────────────────────────────────────
     Chrome only. Every RULE the canvas states — why a connection was refused,
     what a validator issue means — arrives as a SENTENCE from `graph-model.js`
     or from the server and is shown verbatim, so those messages are not keys
     here. One table, one voice: a second copy of the 45 issue codes would be a
     second authority the moment either side is edited. */




  /* The method’s life cycle: the library, the id on disk, the compile. */

  /* Running the drawing. The canvas does not start the session itself: it hands
     the method to development mode, which owns the goal, the project and the
     model routing. See `web.dev.method_source_*` for the other end. */

  /* The research node: what it answers, and what each answer triggers. */

  /* The arms, and the behaviour registered for each one. */

  /* The action node: what it runs, over what, and how wide. */

  'web.builder.back': 'Pipelines',
  'web.builder.title': 'Pipeline builder',
  'web.builder.ai_model_chip': 'MiMo V2.6 Pro',
  'web.builder.draft_heading': 'Draft',
  'web.builder.name_label': 'Name',
  'web.builder.name_ph': 'e.g. Security audit',
  'web.builder.desc_label': 'Description',
  'web.builder.desc_ph': 'one line about what the pipeline does',
  'web.builder.add_step': 'Add step',
  'web.builder.remove_step': 'Remove step',
  'web.builder.remove_step_aria': 'Remove step {n}',
  'web.builder.step_name_aria': 'Step {n} name',
  'web.builder.step_name_ph': 'e.g. 1. Write tests',
  'web.builder.prompt_label': 'Prompt (what the agent does)',
  'web.builder.prompt_ph': 'imperative, self-contained, names inputs and outputs',
  'web.builder.scope_label': 'Scope',
  'web.builder.scope_project': 'project (one agent)',
  'web.builder.scope_per_file': 'per-file (fan-out)',
  'web.builder.scope_flexible': 'flexible (orchestrator decides)',
  'web.builder.scope_memory': 'memory (consumes a spec file)',
  'web.builder.depends_label': 'Depends on',
  'web.builder.depends_ph': 'comma-separated step names; empty = parallel',
  'web.builder.json_show': 'Show JSON',
  'web.builder.json_hide': 'Hide JSON',
  'web.builder.save': 'Save pipeline',
  'web.builder.save_hint': 'A name and at least one step are needed to save.',
  'web.builder.saved': 'Saved “{name}” — it is now in the gallery.',
  'web.builder.save_error': 'Could not save:',
  'web.builder.save_needs_name': 'Give the pipeline a name and fill at least one step.',
  'web.builder.unnamed': 'Untitled pipeline',
  'web.builder.ai_heading': 'AI editor',
  'web.builder.ai_intro': 'Describe what you want in plain language. The editor asks questions when something is open and returns the complete pipeline — nothing is applied until you confirm.',
  'web.builder.ai_input_ph': 'e.g. a pipeline that audits security and writes tests',
  'web.builder.ai_send': 'Send',
  'web.builder.ai_empty': 'Your requests and the editor’s replies appear here. Start with what the pipeline should DO — the editor translates intent into steps, and asks when a choice matters.',
  'web.builder.ai_error': 'The editor could not answer:',
  'web.builder.applied': 'Applied to the draft.',
  'web.builder.free_text_ph': 'Type your own answer…',
  'web.builder.free_text_send': 'Answer',
  'web.builder.apply_summary': 'Pipeline “{name}” · {n} step(s).',
  'web.builder.apply_use': 'Apply to draft',
  'web.builder.apply_dismiss': 'Dismiss',
  'web.builder.gallery_card_title': 'Build a pipeline',
  'web.builder.gallery_card_desc': 'Open the construction mode: edit by hand or tell the AI editor what you want.',
  'web.launch.search_ph': 'Filter pipelines…',
  'web.launch.search_aria': 'Filter pipelines',
  'web.launch.count_label': '{n} pipelines',
  'web.launch.count_filtered': '{n} of {total}',
  'web.launch.no_search_results': 'No pipeline matches this filter.',
  'web.launch.card_meta': '{work} work · {check} check · {steps} steps',
  'web.launch.default_badge': 'default',
  'web.launch.step_locked': 'Finish the previous steps first.',
  'web.launch.add_hint': 'Pick a pipeline first to add it to the queue.',
} as const;
