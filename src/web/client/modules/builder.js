/* huu web UI — PIPELINE CONSTRUCTION MODE.
   Two panes, one draft:

     LEFT  the BUILDER FORM (name + steps: prompt, scope, dependsOn) with a
           JSON preview and the save action. This is the source of truth the
           user edits directly.
     RIGHT the AI EDITOR (Mimo V2.6 Pro): a plain-language input where the
           user says what they want. Each reply is ONE structured turn: a
           clarifying question (rendered as clickable options + free text) or
           the COMPLETE pipeline with a note. Nothing is applied until the user
           clicks "apply" — the assistant proposes, the human decides.

   All format knowledge lives in the SERVER prompt (pipeline-ai-editor.ts);
   this module only renders turns and keeps the draft honest. */
import { $, S, api, withTok, sessionKey, backendSpecName, DEFAULT_MODEL_ID } from './state.js';
import { esc, toast } from './utils.js';
import { t } from '../i18n.js';

/** @typedef {{ role: 'user'|'assistant', text: string }} HistoryEntry */

const SCOPES = ['project', 'per-file', 'flexible', 'memory'];
/** Literal keys (not template-built) so the i18n coverage scan sees them. */
const SCOPE_KEYS = {
  'project': 'web.builder.scope_project',
  'per-file': 'web.builder.scope_per_file',
  'flexible': 'web.builder.scope_flexible',
  'memory': 'web.builder.scope_memory',
};

function emptyStep(index) {
  return { name: `${index}. `, prompt: '', scope: 'project', dependsOn: '' };
}

function blankDraft() {
  return {
    name: '',
    description: '',
    steps: [emptyStep(1)],
  };
}

/** Draft → the shape the server validates (huu-pipeline-v2 subset the form owns).
 * @returns {{ name: string, description?: string, steps: Array<Record<string, unknown>> }} */
export function draftToPipeline(draft) {
  const steps = draft.steps
    .map((s) => {
      const name = String(s.name || '').trim();
      const prompt = String(s.prompt || '').trim();
      if (!name && !prompt) return null;
      /** @type {Record<string, unknown>} */
      const step = { name, prompt, files: ['**/*'] };
      const scope = String(s.scope || 'project').trim();
      if (scope && scope !== 'project') step.scope = scope;
      const deps = String(s.dependsOn || '')
        .split(',')
        .map((d) => d.trim())
        .filter(Boolean);
      if (deps.length > 0) step.dependsOn = deps;
      return step;
    })
    .filter(Boolean);
  const pipeline = { name: String(draft.name || '').trim() || t('web.builder.unnamed'), steps };
  const description = String(draft.description || '').trim();
  if (description) pipeline.description = description;
  return pipeline;
}

/** The full pipeline object (AI output) → the form's draft shape. */
export function pipelineToDraft(pipeline) {
  return {
    name: String(pipeline?.name ?? ''),
    description: String(pipeline?.description ?? ''),
    steps: (Array.isArray(pipeline?.steps) && pipeline.steps.length > 0 ? pipeline.steps : [{}]).map(
      (s, i) => ({
        name: String(s?.name ?? `${i + 1}. `),
        prompt: String(s?.prompt ?? s?.condition ?? ''),
        scope: String(s?.scope ?? (s?.type === 'check' ? 'project' : 'project')),
        dependsOn: Array.isArray(s?.dependsOn) ? s.dependsOn.join(', ') : '',
      }),
    ),
  };
}

/* ---------------- state ---------------- */

export function initBuilder() {
  if (!S.builder) {
    S.builder = {
      draft: blankDraft(),
      transcript: /** @type {HistoryEntry[]} */ ([]),
      busy: false,
      jsonOpen: false,
    };
  }
}

export function openBuilder() {
  initBuilder();
  showBuilder();
  renderBuilder();
  const input = /** @type {HTMLTextAreaElement|null} */ ($('builderAiInput'));
  if (input) input.focus();
}

function showBuilder() {
  $('viewLaunch').hidden = true;
  $('viewRun').hidden = true;
  $('viewSim').hidden = true;
  const v = $('viewBuilder');
  if (v) v.hidden = false;
}

export function closeBuilder() {
  const v = $('viewBuilder');
  if (v) v.hidden = true;
  $('viewLaunch').hidden = false;
  window.scrollTo({ top: 0 });
}

/* ---------------- rendering ---------------- */

export function renderBuilder() {
  initBuilder();
  renderDraftForm();
  renderJsonPreview();
  renderTranscript();
  const send = /** @type {HTMLButtonElement|null} */ ($('builderAiSend'));
  if (send) send.disabled = S.builder.busy;
  const busy = $('builderAiBusy');
  if (busy) busy.hidden = !S.builder.busy;
}

function renderDraftForm() {
  const wrap = $('builderSteps');
  if (!wrap) return;
  const d = S.builder.draft;
  const nameInput = /** @type {HTMLInputElement|null} */ ($('builderName'));
  if (nameInput && nameInput.value !== d.name) nameInput.value = d.name;
  const descInput = /** @type {HTMLInputElement|null} */ ($('builderDesc'));
  if (descInput && descInput.value !== d.description) descInput.value = d.description;

  wrap.innerHTML = d.steps
    .map(
      (s, i) => `
    <div class="builder-step" data-step="${i}">
      <div class="builder-step__head">
        <span class="builder-step__n">${i + 1}</span>
        <input class="builder-step__name" data-field="name" value="${esc(s.name)}"
               aria-label="${esc(t('web.builder.step_name_aria', { n: i + 1 }))}"
               placeholder="${esc(t('web.builder.step_name_ph'))}" />
        <button type="button" class="builder-step__remove" data-remove="${i}"
                aria-label="${esc(t('web.builder.remove_step_aria', { n: i + 1 }))}"
                title="${esc(t('web.builder.remove_step'))}">×</button>
      </div>
      <label class="field">
        <span>${t('web.builder.prompt_label')}</span>
        <textarea data-field="prompt" rows="2" placeholder="${esc(t('web.builder.prompt_ph'))}">${esc(s.prompt)}</textarea>
      </label>
      <div class="builder-step__row">
        <label class="field builder-step__scope">
          <span>${t('web.builder.scope_label')}</span>
          <select data-field="scope">
            ${SCOPES.map(
              (sc) =>
                `<option value="${sc}"${sc === s.scope ? ' selected' : ''}>${esc(t(SCOPE_KEYS[sc]))}</option>`,
            ).join('')}
          </select>
        </label>
        <label class="field builder-step__deps">
          <span>${t('web.builder.depends_label')}</span>
          <input data-field="dependsOn" value="${esc(s.dependsOn)}" placeholder="${esc(t('web.builder.depends_ph'))}" />
        </label>
      </div>
    </div>`,
    )
    .join('');
}

function renderJsonPreview() {
  const pre = $('builderJson');
  if (!pre) return;
  pre.textContent = JSON.stringify(draftToPipeline(S.builder.draft), null, 2);
  pre.hidden = !S.builder.jsonOpen;
  const toggle = $('builderJsonToggle');
  if (toggle) toggle.textContent = S.builder.jsonOpen ? t('web.builder.json_hide') : t('web.builder.json_show');
}

function renderTranscript() {
  const log = $('builderLog');
  if (!log) return;
  // Empty state (audit: every surface needs one).
  if (S.builder.transcript.length === 0) {
    log.innerHTML = `<div class="builder-log__empty">${esc(t('web.builder.ai_empty'))}</div>`;
    return;
  }
  log.innerHTML = '';
  for (const entry of S.builder.transcript) {
    log.appendChild(renderEntry(entry));
  }
  log.scrollTop = log.scrollHeight;
}

/** One transcript entry: plain text, a question card, or an apply card. */
function renderEntry(entry) {
  const el = document.createElement('div');
  el.className = `builder-msg builder-msg--${entry.role}`;
  if (entry.kind === 'question') {
    const turn = entry.turn;
    el.innerHTML = `
      <div class="builder-q">
        <p class="builder-q__text">${esc(turn.question)}</p>
        ${turn.rationale ? `<p class="builder-q__why">${esc(turn.rationale)}</p>` : ''}
        <div class="builder-q__options">
          ${turn.options
            .map(
              (o, i) =>
                `<button type="button" class="builder-q__opt${o.isFreeText ? ' is-free' : ''}" data-answer="${i}">${esc(o.label)}</button>`,
            )
            .join('')}
        </div>
        <div class="builder-q__free" hidden>
          <input type="text" class="builder-q__freeinput" placeholder="${esc(t('web.builder.free_text_ph'))}" />
          <button type="button" class="builder-q__freesend">${esc(t('web.builder.free_text_send'))}</button>
        </div>
      </div>`;
    return el;
  }
  if (entry.kind === 'apply') {
    const turn = entry.turn;
    const draft = pipelineToDraft(turn.pipeline);
    el.innerHTML = `
      <div class="builder-apply">
        <p class="builder-apply__note">${esc(turn.note)}</p>
        <p class="builder-apply__summary">${esc(
          t('web.builder.apply_summary', { name: draft.name, n: draft.steps.length }),
        )}</p>
        <div class="builder-apply__actions">
          <button type="button" class="builder-apply__use">${esc(t('web.builder.apply_use'))}</button>
          <button type="button" class="builder-apply__dismiss">${esc(t('web.builder.apply_dismiss'))}</button>
        </div>
      </div>`;
    return el;
  }
  el.innerHTML = `<p class="builder-msg__text">${esc(entry.text)}</p>`;
  return el;
}

/* ---------------- AI conversation ---------------- */

/** History payload for the server: text-only, capped — the draft travels once. */
function historyPayload() {
  return S.builder.transcript
    .filter((e) => e.kind === 'text')
    .slice(-10)
    .map((e) => ({ role: e.role, text: e.text }));
}

export async function sendBuilderMessage(text) {
  const message = String(text || '').trim();
  if (!message || S.builder.busy) return;
  initBuilder();
  S.builder.transcript.push({ role: 'user', kind: 'text', text: message });
  S.builder.busy = true;
  renderBuilder();
  try {
    const res = await api('/api/pipeline-ai', {
      method: 'POST',
      body: JSON.stringify({
        message,
        draft: draftToPipeline(S.builder.draft),
        history: historyPayload(),
        apiKey: sessionKey(backendSpecName(S, 'openrouter')),
        modelId: DEFAULT_MODEL_ID,
      }),
    });
    const turn = res.turn;
    if (turn && turn.done === false) {
      S.builder.transcript.push({ role: 'assistant', kind: 'question', turn });
    } else if (turn && turn.done === true) {
      S.builder.transcript.push({ role: 'assistant', kind: 'apply', turn });
    }
  } catch (err) {
    const message2 = err instanceof Error ? err.message : String(err);
    S.builder.transcript.push({
      role: 'assistant',
      kind: 'text',
      text: `${t('web.builder.ai_error')} ${message2}`,
    });
  } finally {
    S.builder.busy = false;
    renderBuilder();
    const input = /** @type {HTMLTextAreaElement|null} */ ($('builderAiInput'));
    if (input) { input.value = ''; input.focus(); }
  }
}

function applyTurn(turn) {
  S.builder.draft = pipelineToDraft(turn.pipeline);
  renderBuilder();
  toast(t('web.builder.applied'));
  const nameInput = /** @type {HTMLInputElement|null} */ ($('builderName'));
  if (nameInput) nameInput.focus();
}

/* ---------------- saving ---------------- */

export async function saveBuilderPipeline() {
  initBuilder();
  const pipeline = draftToPipeline(S.builder.draft);
  if (!pipeline.name || (pipeline.steps || []).length === 0) {
    toast(t('web.builder.save_needs_name'));
    return;
  }
  try {
    const res = await api('/api/pipelines/save', {
      method: 'POST',
      body: JSON.stringify({ pipeline }),
    });
    if (Array.isArray(res.pipelines)) {
      S.pipelines = res.pipelines;
      window.dispatchEvent(new CustomEvent('huu:pipelines-updated'));
    }
    toast(t('web.builder.saved', { name: res.name || pipeline.name }));
    closeBuilder();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    toast(`${t('web.builder.save_error')} ${message}`);
  }
}

/* ---------------- wiring (called once from app.js) ---------------- */

export function wireBuilder() {
  const root = $('viewBuilder');
  if (!root) return;

  $('builderBack')?.addEventListener('click', () => closeBuilder());
  $('builderName')?.addEventListener('input', (ev) => {
    S.builder.draft.name = /** @type {HTMLInputElement} */ (ev.target).value;
    renderJsonPreview();
  });
  $('builderDesc')?.addEventListener('input', (ev) => {
    S.builder.draft.description = /** @type {HTMLInputElement} */ (ev.target).value;
    renderJsonPreview();
  });
  $('builderAddStep')?.addEventListener('click', () => {
    S.builder.draft.steps.push(emptyStep(S.builder.draft.steps.length + 1));
    renderDraftForm();
    renderJsonPreview();
  });
  $('builderSteps')?.addEventListener('input', (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    const holder = target.closest('[data-step]');
    if (!holder) return;
    const idx = Number(holder.getAttribute('data-step'));
    const field = target.getAttribute('data-field');
    if (!field || !S.builder.draft.steps[idx]) return;
    S.builder.draft.steps[idx][field] = /** @type {any} */ (target).value;
    renderJsonPreview();
  });
  $('builderSteps')?.addEventListener('change', (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    const holder = target.closest('[data-step]');
    if (!holder) return;
    const idx = Number(holder.getAttribute('data-step'));
    const field = target.getAttribute('data-field');
    if (!field || !S.builder.draft.steps[idx]) return;
    S.builder.draft.steps[idx][field] = /** @type {any} */ (target).value;
    renderJsonPreview();
  });
  $('builderSteps')?.addEventListener('click', (ev) => {
    const target = /** @type {HTMLElement} */ (ev.target);
    const remove = target.closest('[data-remove]');
    if (remove) {
      const idx = Number(remove.getAttribute('data-remove'));
      S.builder.draft.steps.splice(idx, 1);
      if (S.builder.draft.steps.length === 0) S.builder.draft.steps.push(emptyStep(1));
      renderDraftForm();
      renderJsonPreview();
      return;
    }
    // Question option buttons (delegated: entries are re-rendered often).
    const opt = target.closest('[data-answer]');
    if (opt) {
      const entryEl = opt.closest('.builder-msg');
      const qIndex = Array.from($('builderLog').children).indexOf(entryEl);
      const entry = S.builder.transcript[qIndex];
      if (entry && entry.kind === 'question') {
        const answerIndex = Number(opt.getAttribute('data-answer'));
        const option = entry.turn.options[answerIndex];
        if (option && option.isFreeText) {
          const free = /** @type {HTMLElement|null} */ (entryEl.querySelector('.builder-q__free'));
          if (free) {
            free.hidden = false;
            /** @type {HTMLInputElement|null} */ (entryEl.querySelector('.builder-q__freeinput'))?.focus();
          }
          return;
        }
        if (option) sendBuilderMessage(option.label);
      }
      return;
    }
    const freeSend = target.closest('.builder-q__freesend');
    if (freeSend) {
      const entryEl = freeSend.closest('.builder-msg');
      const input = /** @type {HTMLInputElement|null} */ (entryEl?.querySelector('.builder-q__freeinput'));
      if (input && input.value.trim()) sendBuilderMessage(input.value);
      return;
    }
    const use = target.closest('.builder-apply__use');
    if (use) {
      const entryEl = use.closest('.builder-msg');
      const qIndex = Array.from($('builderLog').children).indexOf(entryEl);
      const entry = S.builder.transcript[qIndex];
      if (entry && entry.kind === 'apply') applyTurn(entry.turn);
      return;
    }
    const dismiss = target.closest('.builder-apply__dismiss');
    if (dismiss) {
      const entryEl = dismiss.closest('.builder-msg');
      if (entryEl) entryEl.remove();
    }
  });
  $('builderAiSend')?.addEventListener('click', () => {
    const input = /** @type {HTMLTextAreaElement|null} */ ($('builderAiInput'));
    if (input) sendBuilderMessage(input.value);
  });
  $('builderAiInput')?.addEventListener('keydown', (ev) => {
    if (/** @type {KeyboardEvent} */ (ev).key === 'Enter' && !/** @type {KeyboardEvent} */ (ev).shiftKey) {
      ev.preventDefault();
      sendBuilderMessage(/** @type {HTMLTextAreaElement} */ (ev.target).value);
    }
  });
  $('builderJsonToggle')?.addEventListener('click', () => {
    S.builder.jsonOpen = !S.builder.jsonOpen;
    renderJsonPreview();
  });
  $('builderSave')?.addEventListener('click', () => saveBuilderPipeline());
}
