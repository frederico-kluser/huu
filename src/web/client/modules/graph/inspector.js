/* huu web UI — the inspector: everything about ONE node, and the method's life.
   =============================================================================

   THE REQUEST THIS FILE ANSWERS, in the user's own words: "teremos o bloco de
   pesquisar na internet onde definiremos o que será pesquisado e podemos usar o
   contexto para isso e isso volta como uma condicional que configuramos: se for
   uma pesquisa para definir uma afirmação então selecionamos que é booleana e
   conseguimos cadastrar comportamentos de sim e não na saída dela; se for de
   múltipla escolha podemos definir comportamentos para a saída; se for
   informativo não definimos nada e ela entra como contexto na próxima etapa."

   The canvas could already DRAW that shape and could not CONFIGURE it. This is
   the missing half: choose what a research node answers, register its outputs,
   and tie a behaviour to each one — plus the same treatment for the gate, the
   action node's fan-out, the arm that goes back, and the method's own life
   cycle (open, save, rename, compile).

   THE ONE RULE THIS FILE OBEYS: it decides NOTHING about graphs. Every mutation
   is one of the pure functions in `graph-model.js` (`updateNode`, `removeEdge`,
   `connect`) and every question about the graph is asked of that module too
   (`outcomesOf`, `ancestorsOf`, `outboundEdges`, `directPredecessors`,
   `graphIdIssue`). Where a helper here looks like a rule — "which arms would
   this node have if it became boolean" — it is a QUESTION forwarded to
   `outcomesOf` about a hypothetical node, never a second answer. A rule that
   lives in a React component is a rule no test in this repo can reach.

   WHY THE REFUSALS CARRY NO TRANSLATION KEY: `canConnect` and the server's
   validator write their own sentences, each naming the actual node, arm and
   target involved. They are shown VERBATIM. A second table of the 45 issue
   codes here would be a second authority the moment either side is edited —
   the same reasoning the i18n catalog states for `web.graph.*`. What IS
   translated is chrome: field names, the sentence explaining what a default
   outcome MEANS, and the warning before a destructive change.

   NO JSX, NO BUILD, ONE REACT. `h` is `React.createElement` and React comes out
   of `vendor/reactflow.js`; importing `react` from anywhere else would put a
   second instance in the page and break hooks with no error message. */

import { createElement as h, useEffect, useState } from '../../vendor/reactflow.js';

import { t } from '../../i18n.js';
import {
  ancestorsOf,
  connect,
  directPredecessors,
  graphIdIssue,
  nodeById,
  nodesOf,
  outboundEdges,
  outcomesOf,
  removeEdge,
  updateNode,
} from './graph-model.js';

/**
 * Which field carries a node's own text, per kind. The devgraph schema
 * (`graph-types.ts`) gives each kind exactly one, and the inspector edits that
 * one — `prompt` on an action is the OPTIONAL override of the block's template,
 * which is why clearing it DELETES the field instead of writing an empty string.
 */
const TEXT_FIELD = {
  prompt: 'goal',
  action: 'prompt',
  research: 'query',
  gate: 'condition',
};

/** Label for each of those fields. */
const TEXT_LABEL_KEY = {
  goal: 'web.graph.inspector.text_goal',
  prompt: 'web.graph.inspector.text_prompt',
  query: 'web.graph.inspector.text_query',
  condition: 'web.graph.inspector.text_condition',
};

/**
 * The three things a research node can answer, in the order the user described
 * them. The IDS are the schema's (`ResearchOutputKind`); the labels are chrome.
 */
const OUTPUT_KINDS = [
  { id: 'boolean', labelKey: 'web.graph.inspector.output_boolean' },
  { id: 'choice', labelKey: 'web.graph.inspector.output_choice' },
  { id: 'info', labelKey: 'web.graph.inspector.output_info' },
];

/** One sentence per output kind, saying what it DOES to the method. */
const OUTPUT_HINT_KEY = {
  boolean: 'web.graph.inspector.output_boolean_hint',
  choice: 'web.graph.inspector.output_choice_hint',
  info: 'web.graph.inspector.output_info_hint',
};

/**
 * `ActionScope`, translated. Written as a table of LITERAL keys rather than
 * `web.graph.inspector.scope_${scope}`: the i18n coverage test scans the source
 * for key literals, and a key it cannot see is reported as an orphan.
 */
const SCOPE_LABEL_KEY = {
  project: 'web.graph.inspector.scope_project',
  'per-file': 'web.graph.inspector.scope_per_file',
  memory: 'web.graph.inspector.scope_memory',
  flexible: 'web.graph.inspector.scope_flexible',
};

/**
 * The scopes the human may pick DIRECTLY. `memory` is deliberately absent: it
 * is not a scope you choose, it is what choosing a `fanOutFrom` MEANS
 * (`fanout-needs-memory-scope` / `scope-memory-needs-fanout` are the two halves
 * of that one rule). Offering it here would let the human build the error.
 */
const PICKABLE_SCOPES = ['project', 'per-file', 'flexible'];

// --- Pure helpers -----------------------------------------------------------

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** The field a node's arms live in — the schema uses two names for one idea. */
export function armsFieldOf(node) {
  if (!isRecord(node)) return null;
  if (node.kind === 'gate') return 'outcomes';
  if (node.kind === 'research' && node.outputKind === 'choice') return 'choices';
  return null;
}

/**
 * A slug for an arm the human just named.
 *
 * The id is a ROUTING CONTRACT — the compiled `CheckStep` routes on it and the
 * judge is instructed to answer with it — so it must satisfy
 * `DEVGRAPH_SLUG_PATTERN` or the compiler sanitizes it into something else
 * (`invalid-outcome-id` exists precisely because that silent rewrite once cost
 * an arm its route). Accents are folded rather than dropped so "Não" becomes
 * `nao` instead of `n`.
 *
 * @param {string} value the label the human typed
 * @returns {string} a slug, or `''` when nothing usable is left
 */
export function slugifyOutcomeId(value) {
  const raw = typeof value === 'string' ? value : '';
  const folded = raw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const slug = folded
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return /^[a-z0-9]/.test(slug) ? slug : '';
}

/**
 * Why this arm cannot be added, or `null` when it can.
 *
 * `'invalid'` — the label leaves no slug behind (`invalid-outcome-id`).
 * `'taken'`   — the node already declares that id (`duplicate-choice-id` /
 *               `duplicate-outcome-id`). REFUSED rather than silently suffixed:
 *               two arms the human meant to be different, one of which quietly
 *               became `sim-2`, is worse than being told to rename it.
 *
 * @param {Array<Record<string, any>>} arms the arms already declared
 * @param {string} id the slug about to be added
 * @returns {'invalid'|'taken'|null}
 */
export function armIdIssue(arms, id) {
  if (!id) return 'invalid';
  const list = Array.isArray(arms) ? arms : [];
  return list.some((arm) => isRecord(arm) && arm.id === id) ? 'taken' : null;
}

/**
 * The arms `node` WOULD have if its `outputKind` became `kind`.
 *
 * Asked of `outcomesOf`, never re-derived: the two fixed boolean ids, the
 * `info`-means-no-arms rule and the choice list all stay in one place. Switching
 * TO `choice` starts with no arms at all — seeding two placeholder choices would
 * put words in the human's method that nobody underwrote.
 *
 * @returns {Array<{id: string, label: string}>|null} `null` = one way out
 */
export function armsAfterOutputKind(node, kind, catalog) {
  const probe = { ...node, outputKind: kind, choices: kind === 'choice' ? [] : undefined };
  return outcomesOf(probe, catalog);
}

/**
 * The edges that STOP BEING LEGAL when `nodeId`'s arms become `nextArms`.
 *
 * This is the honest half of switching a research node's output kind. An edge
 * that leaves an arm which no longer exists is `edge-outcome-unknown`; one that
 * names an arm on a node that stopped branching is `edge-outcome-forbidden`; one
 * that names NO arm on a node that started branching is `edge-outcome-required`.
 * All three are the same event to the human — "this connection cannot survive
 * the change" — so they are counted together, shown BEFORE the switch, and
 * removed with it.
 *
 * @param {Record<string, any>} graph
 * @param {string} nodeId
 * @param {Array<{id: string}>|null} nextArms
 * @returns {Array<Record<string, any>>} the edges, in declaration order
 */
export function edgesDroppedBy(graph, nodeId, nextArms) {
  const ids = nextArms === null ? null : new Set(nextArms.map((arm) => arm.id));
  return outboundEdges(graph, nodeId).filter((edge) => {
    const arm = text(edge.sourceOutcome);
    if (ids === null) return arm !== '' || edge.rework === true;
    return arm === '' || !ids.has(arm);
  });
}

/**
 * What an arm currently DOES: the edge that leaves it and the node it reaches.
 * `null` means the human has registered no behaviour for that output yet.
 */
export function armBehavior(graph, nodeId, armId) {
  const edge = outboundEdges(graph, nodeId).find((entry) => text(entry.sourceOutcome) === armId);
  if (!edge) return null;
  return { edge, target: nodeById(graph, edge.target) };
}

/** One entry of `catalog.blocks`, or `null`. The catalog is the ONLY source. */
export function blockOf(catalog, blockId) {
  const blocks = catalog && Array.isArray(catalog.blocks) ? catalog.blocks : [];
  return blocks.find((block) => isRecord(block) && block.id === blockId) || null;
}

/**
 * The nodes a `fanOutFrom` may name: ANCESTORS whose block writes a list.
 *
 * Both halves are rules the server enforces — `fanout-source-not-ancestor` and
 * `fanout-source-not-producer` — and both are asked here of their owners
 * (`ancestorsOf` for the first, the catalog's `produces` flag for the second).
 * A picker that offered the other nodes would be a picker whose every second
 * option is a validation error.
 *
 * @returns {Array<Record<string, any>>} candidate nodes, in graph order
 */
export function fanOutCandidates(graph, node, catalog) {
  if (!isRecord(node) || node.kind !== 'action') return [];
  const ancestors = ancestorsOf(graph, node.id);
  return nodesOf(graph).filter((entry) => {
    if (!ancestors.has(entry.id)) return false;
    if (entry.kind !== 'action') return false;
    const block = blockOf(catalog, entry.block);
    return !!block && block.produces === true;
  });
}

/**
 * Where a rework arm may point: the nodes that already ran.
 *
 * `rework-edge-not-backward` in reverse — the same `ancestorsOf` the validator
 * uses, so "go back to" offers exactly what the server will accept.
 */
export function reworkTargets(graph, nodeId) {
  const ancestors = ancestorsOf(graph, nodeId);
  return nodesOf(graph).filter((entry) => ancestors.has(entry.id));
}

// --- Composite mutations (all of them made of graph-model mutations) --------

/**
 * Switch a research node's output kind, taking the now-illegal edges with it.
 *
 * `defaultOutcome` follows: it is REQUIRED while the node branches
 * (`default-outcome-missing`) and meaningless once it does not. The first arm is
 * the seed, exactly as `seedNode` does for a fresh gate — and the UI says, right
 * under it, what a default outcome is for, so the human can move it.
 */
export function applyOutputKind(graph, node, kind, catalog) {
  const nextArms = armsAfterOutputKind(node, kind, catalog);
  let next = graph;
  for (const edge of edgesDroppedBy(graph, node.id, nextArms)) next = removeEdge(next, edge.id);
  return updateNode(next, node.id, {
    outputKind: kind,
    choices: kind === 'choice' ? [] : undefined,
    defaultOutcome: nextArms && nextArms.length > 0 ? nextArms[0].id : undefined,
  });
}

/**
 * Add one arm to a `choice` research node or to a gate.
 *
 * @returns {{graph: Record<string, any>, id?: string, issue?: 'invalid'|'taken'}}
 */
export function applyAddArm(graph, node, label) {
  const field = armsFieldOf(node);
  if (!field) return { graph };
  const arms = Array.isArray(node[field]) ? node[field] : [];
  const id = slugifyOutcomeId(label);
  const issue = armIdIssue(arms, id);
  if (issue) return { graph, issue, id };
  const next = [...arms, { id, label: text(label) || id }];
  /** @type {Record<string, any>} */
  const patch = { [field]: next };
  // The first arm of an empty branch becomes the default, so the node is never
  // left branching with no safe route (`default-outcome-missing`).
  if (!arms.some((arm) => arm.id === node.defaultOutcome)) patch.defaultOutcome = id;
  return { graph: updateNode(graph, node.id, patch), id };
}

/** Rename an arm's LABEL. The id never moves — see `ArmRows` for why. */
export function applyRenameArm(graph, node, armId, label) {
  const field = armsFieldOf(node);
  if (!field) return graph;
  const arms = Array.isArray(node[field]) ? node[field] : [];
  return updateNode(graph, node.id, {
    [field]: arms.map((arm) => (arm.id === armId ? { ...arm, label } : arm)),
  });
}

/**
 * Drop one arm, and with it every edge that left it.
 *
 * The default follows the same rule as the switch above: an arm that is gone
 * cannot stay the safe route.
 */
export function applyRemoveArm(graph, node, armId) {
  const field = armsFieldOf(node);
  if (!field) return graph;
  const arms = Array.isArray(node[field]) ? node[field] : [];
  const kept = arms.filter((arm) => arm.id !== armId);
  let next = graph;
  for (const edge of outboundEdges(graph, node.id)) {
    if (text(edge.sourceOutcome) === armId) next = removeEdge(next, edge.id);
  }
  /** @type {Record<string, any>} */
  const patch = { [field]: kept };
  if (node.defaultOutcome === armId) {
    patch.defaultOutcome = kept.length > 0 ? kept[0].id : undefined;
  }
  return updateNode(next, node.id, patch);
}

// --- Small view helpers -----------------------------------------------------

function field(labelText, key, ...children) {
  return h('div', { className: 'gph-field', key }, h('label', null, labelText), ...children);
}

function hint(message, key, className) {
  return h('div', { className: className || 'gph-hint', key }, message);
}

/** A checkbox row: `[x] Label` with an explanation under it. */
function toggleRow(props) {
  return h(
    'div',
    { className: 'gph-field', key: props.key },
    h(
      'label',
      { className: 'gph-toggle' },
      h('input', {
        type: 'checkbox',
        className: props.className,
        checked: !!props.checked,
        onChange: () => props.onToggle(!props.checked),
      }),
      h('span', null, props.label),
    ),
    props.hint ? h('div', { className: 'gph-hint' }, props.hint) : null,
  );
}

/** A number field that DELETES its value when emptied. */
function numberRow(props) {
  return field(
    props.label,
    props.key,
    h('input', {
      type: 'number',
      min: props.min || 1,
      className: props.className,
      value: typeof props.value === 'number' ? String(props.value) : '',
      onChange: (ev) => {
        const raw = ev.target.value;
        if (raw.trim() === '') {
          props.onChange(undefined);
          return;
        }
        const parsed = Number(raw);
        // A non-finite number survives every clamp downstream and only dies at
        // the pipeline schema, where huu gets blamed for a value the drawing
        // carried (`invalid-number`). It never enters the graph from here.
        if (Number.isFinite(parsed)) props.onChange(parsed);
      },
    }),
    props.hint ? h('div', { className: 'gph-hint' }, props.hint) : null,
  );
}

// --- The arm list -----------------------------------------------------------

/**
 * One row per output, with THE BEHAVIOUR REGISTERED FOR IT.
 *
 * This is the user's "conseguimos cadastrar comportamentos de sim e não na
 * saída dela": for each arm, either the node it triggers today or, when nothing
 * is wired, the button that opens the palette ON THAT ARM. The reading and the
 * doing are in the same row, so "what happens if the answer is no" never
 * requires tracing an edge across the canvas.
 *
 * THE ID IS FROZEN AFTER CREATION, and that is deliberate. It is what every
 * edge's `sourceOutcome`, the node's `defaultOutcome` and the compiled
 * `CheckStep` route on; renaming it in place would orphan all three at once
 * (`edge-outcome-unknown` + `default-outcome-unknown`) with no way for the human
 * to see it coming. The LABEL — what the judge and the canvas read — is fully
 * editable.
 */
function ArmRows(props) {
  const { graph, node, arms, editable, onOpenPalette } = props;
  const min = 2;
  return h(
    'div',
    { className: 'gph-arms' },
    arms.map((arm) => {
      const behavior = armBehavior(graph, node.id, arm.id);
      const targetLabel = behavior && behavior.target ? behavior.target.label || behavior.target.id : '';
      const isRework = !!behavior && behavior.edge.rework === true;
      return h(
        'div',
        { className: 'gph-armrow', key: arm.id, 'data-arm': arm.id },
        h(
          'div',
          { className: 'gph-armrow__head' },
          editable
            ? h('input', {
                type: 'text',
                className: 'gph-armrow__label',
                'data-arm': arm.id,
                value: arm.label || '',
                onChange: (ev) => props.onRename(arm.id, ev.target.value),
              })
            : h('span', { className: 'gph-armrow__label' }, arm.label || arm.id),
          h('code', { className: 'gph-armrow__id', title: t('web.graph.inspector.arm_id_frozen') }, arm.id),
          editable
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn--ghost btn--sm gph-armrow__drop',
                  'data-arm': arm.id,
                  'aria-disabled': arms.length <= min ? 'true' : 'false',
                  onClick: () => props.onRemove(arm.id, arms.length <= min),
                },
                t('web.graph.inspector.arm_remove'),
              )
            : null,
        ),
        h(
          'div',
          { className: 'gph-armrow__behavior', 'data-arm': arm.id },
          behavior
            ? h(
                'span',
                { className: 'gph-armrow__target' },
                isRework
                  ? t('web.graph.inspector.arm_goes_back_to', { label: targetLabel })
                  : t('web.graph.inspector.arm_goes_to', { label: targetLabel }),
              )
            : h(
                'span',
                { className: 'gph-armrow__empty' },
                t('web.graph.inspector.arm_empty'),
              ),
          behavior
            ? null
            : h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn--ghost btn--sm gph-armrow__wire',
                  'data-arm': arm.id,
                  onClick: (ev) => onOpenPalette(node.id, arm.id, ev),
                },
                t('web.graph.inspector.arm_configure'),
              ),
        ),
      );
    }),
  );
}

/**
 * The default outcome, with the sentence that says what it IS.
 *
 * huu's forward-default rule, stated where the decision is made: the default
 * fires when the judge fails, times out or answers something unknown, so it has
 * to be the safe route FORWARD. A default on a rework arm turns a broken judge
 * into a run that spins backwards until `maxNodeExecutions` kills it — the
 * server calls it `default-outcome-is-rework`, and this picker refuses it here
 * rather than letting the human save it and read about it later.
 */
function DefaultPicker(props) {
  const { graph, node, arms } = props;
  return h(
    'div',
    { className: 'gph-field', key: 'default' },
    h('label', null, t('web.graph.inspector.default_outcome')),
    h(
      'div',
      { className: 'gph-default' },
      arms.map((arm) => {
        const behavior = armBehavior(graph, node.id, arm.id);
        const isRework = !!behavior && behavior.edge.rework === true;
        const isDefault = node.defaultOutcome === arm.id;
        return h(
          'button',
          {
            type: 'button',
            key: arm.id,
            className: `gph-default__opt${isDefault ? ' is-on' : ''}`,
            'data-outcome': arm.id,
            'aria-pressed': isDefault ? 'true' : 'false',
            'aria-disabled': isRework ? 'true' : 'false',
            onClick: () => props.onPick(arm.id, isRework),
          },
          arm.label || arm.id,
          isRework
            ? h('span', { className: 'gph-armrow__tag' }, t('web.graph.inspector.rework_tag'))
            : null,
        );
      }),
    ),
    hint(t('web.graph.inspector.default_hint'), 'defhint'),
  );
}

/**
 * The arm that goes back — the affordance that did not exist.
 *
 * `rework` was drawable in the FORMAT and stylable on the canvas, but nothing in
 * the UI could create one: a backwards drag is refused as `cycle`, which is
 * correct and unhelpful. Here the human names the verdict and the step it
 * returns to, and `connect(..., {rework: true})` decides — including every
 * refusal, shown in its own words.
 */
function ReworkBuilder(props) {
  const { graph, node, arms, catalog, draft, onDraft, onCreate } = props;
  const targets = reworkTargets(graph, node.id);
  const body =
    targets.length === 0
      ? hint(t('web.graph.inspector.rework_none'), 'none')
      : h(
          'div',
          { className: 'gph-rework', key: 'body' },
          h(
            'select',
            {
              className: 'gph-select gph-rework__arm',
              'aria-label': t('web.graph.inspector.rework_arm'),
              value: draft.arm,
              onChange: (ev) => onDraft({ ...draft, arm: ev.target.value }),
            },
            h('option', { value: '' }, t('web.graph.inspector.rework_arm')),
            arms.map((arm) =>
              h('option', { key: arm.id, value: arm.id }, arm.label || arm.id),
            ),
          ),
          h(
            'select',
            {
              className: 'gph-select gph-rework__target',
              'aria-label': t('web.graph.inspector.rework_target'),
              value: draft.target,
              onChange: (ev) => onDraft({ ...draft, target: ev.target.value }),
            },
            h('option', { value: '' }, t('web.graph.inspector.rework_target')),
            targets.map((entry) =>
              h('option', { key: entry.id, value: entry.id }, entry.label || entry.id),
            ),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'btn btn--ghost btn--sm gph-rework__create',
              onClick: () => onCreate(draft, catalog),
            },
            t('web.graph.inspector.rework_create'),
          ),
        );
  return h(
    'div',
    { className: 'gph-field', key: 'rework' },
    h('label', null, t('web.graph.inspector.rework_title')),
    hint(t('web.graph.inspector.rework_hint'), 'hint'),
    body,
  );
}

/** The warning that stands between the human and a destructive change. */
function ConfirmDrop(props) {
  const { graph, pending } = props;
  return h(
    'div',
    { className: 'gph-confirm', key: 'confirm' },
    h(
      'div',
      { className: 'gph-confirm__text' },
      t('web.graph.inspector.switch_warn', { count: pending.edges.length }),
    ),
    h(
      'ul',
      { className: 'gph-confirm__list' },
      pending.edges.map((edge) => {
        const target = nodeById(graph, edge.target);
        return h(
          'li',
          { key: edge.id, className: 'gph-confirm__row', 'data-edge': edge.id },
          `${text(edge.sourceOutcome) || '—'} → ${target ? target.label || target.id : edge.target}`,
        );
      }),
    ),
    h(
      'div',
      { className: 'gph-confirm__actions' },
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn--danger btn--sm gph-confirm__apply',
          onClick: props.onApply,
        },
        t('web.graph.inspector.switch_apply'),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn--ghost btn--sm gph-confirm__cancel',
          onClick: props.onCancel,
        },
        t('web.graph.inspector.switch_cancel'),
      ),
    ),
  );
}

// --- The inspector ----------------------------------------------------------

/**
 * Everything about the selected node.
 *
 * @param {Record<string, any>} props
 *   `graph`        the devgraph (read-only here)
 *   `node`         the selected node, or null
 *   `catalog`      `/api/graphs/catalog` — blocks WITH their promptTemplate
 *   `errors`/`warnings`  this node's slice of `groupIssues`
 *   `onPatch`      shallow patch through `updateNode`
 *   `onJoin`       join policy through `setJoin`
 *   `onGraph`      a whole new graph, for the composite mutations
 *   `onDelete`     remove the node
 *   `onNotify`     toast; refusal sentences travel through it VERBATIM
 *   `onOpenPalette` open the bolinha's menu on a given arm
 */
export function Inspector(props) {
  const { graph, node, catalog, errors, warnings, onPatch, onJoin, onDelete, onGraph } = props;
  const notify = typeof props.onNotify === 'function' ? props.onNotify : () => {};
  const openPalette = typeof props.onOpenPalette === 'function' ? props.onOpenPalette : () => {};

  const nodeId = node ? node.id : '';
  const [pending, setPending] = useState(null);
  const [newArm, setNewArm] = useState('');
  const [armIssue, setArmIssue] = useState('');
  const [rework, setRework] = useState({ arm: '', target: '' });

  // A half-finished decision belongs to the node it was started on. Selecting
  // another one must never carry a pending "remove 3 links" over to it.
  useEffect(() => {
    setPending(null);
    setNewArm('');
    setArmIssue('');
    setRework({ arm: '', target: '' });
  }, [nodeId]);

  if (!node) {
    return h(
      'aside',
      { className: 'gph-inspector', 'data-empty': 'true' },
      h('div', { className: 'gph-inspector__title' }, t('web.graph.inspector.title')),
      h('div', { className: 'gph-inspector__empty' }, t('web.graph.inspector.empty')),
    );
  }

  const arms = outcomesOf(node, catalog);
  const armsField = armsFieldOf(node);
  const textField = TEXT_FIELD[node.kind];
  const block = node.kind === 'action' ? blockOf(catalog, node.block) : null;

  /* ── Handlers ──────────────────────────────────────────────────────────── */

  /** Ask for the switch; only a switch that costs edges stops to ask. */
  function requestOutputKind(kind) {
    if (kind === node.outputKind) return;
    const dropped = edgesDroppedBy(graph, node.id, armsAfterOutputKind(node, kind, catalog));
    if (dropped.length === 0) {
      onGraph(applyOutputKind(graph, node, kind, catalog));
      return;
    }
    setPending({ type: 'output-kind', value: kind, edges: dropped });
  }

  function requestRemoveArm(armId, blocked) {
    if (blocked) {
      setArmIssue(t('web.graph.inspector.arm_min_two'));
      return;
    }
    setArmIssue('');
    const dropped = outboundEdges(graph, node.id).filter(
      (edge) => text(edge.sourceOutcome) === armId,
    );
    if (dropped.length === 0) {
      onGraph(applyRemoveArm(graph, node, armId));
      return;
    }
    setPending({ type: 'remove-arm', value: armId, edges: dropped });
  }

  function applyPending() {
    if (!pending) return;
    if (pending.type === 'output-kind') {
      onGraph(applyOutputKind(graph, node, pending.value, catalog));
    } else if (pending.type === 'remove-arm') {
      onGraph(applyRemoveArm(graph, node, pending.value));
    }
    setPending(null);
  }

  function addArm() {
    const res = applyAddArm(graph, node, newArm);
    if (res.issue === 'invalid') {
      setArmIssue(t('web.graph.inspector.arm_id_invalid'));
      return;
    }
    if (res.issue === 'taken') {
      setArmIssue(t('web.graph.inspector.arm_id_taken', { id: res.id }));
      return;
    }
    setArmIssue('');
    setNewArm('');
    onGraph(res.graph);
  }

  function pickDefault(armId, isRework) {
    if (isRework) {
      setArmIssue(t('web.graph.inspector.default_hint'));
      notify(t('web.graph.inspector.default_hint'), true);
      return;
    }
    setArmIssue('');
    onPatch({ defaultOutcome: armId });
  }

  function createRework(draft) {
    const res = connect(graph, node.id, draft.target, {
      sourceOutcome: draft.arm,
      rework: true,
      catalog,
    });
    // The refusal sentence is the product: `canConnect` names the node, the arm
    // and the reason, so it is shown exactly as written.
    if (res.error) {
      notify(res.error.message, true);
      return;
    }
    setRework({ arm: '', target: '' });
    onGraph(res.graph);
  }

  /* ── Sections ──────────────────────────────────────────────────────────── */

  const sections = [];

  sections.push(
    h(
      'div',
      { className: 'gph-field', key: 'label' },
      h('label', { htmlFor: 'gphLabel' }, t('web.graph.inspector.label')),
      h('input', {
        id: 'gphLabel',
        type: 'text',
        className: 'gph-inspector__label',
        value: node.label || '',
        onChange: (ev) => onPatch({ label: ev.target.value }),
      }),
    ),
  );

  if (textField) {
    sections.push(
      h(
        'div',
        { className: 'gph-field', key: 'text' },
        h('label', { htmlFor: 'gphText' }, t(TEXT_LABEL_KEY[textField])),
        h('textarea', {
          id: 'gphText',
          className: 'gph-inspector__text',
          'data-field': textField,
          value: typeof node[textField] === 'string' ? node[textField] : '',
          onChange: (ev) => {
            const value = ev.target.value;
            // An action's `prompt` is optional: emptying it must REMOVE the
            // override so the block's own template runs again. `updateNode`
            // deletes a field handed `undefined`.
            const optional = node.kind === 'action' && textField === 'prompt';
            onPatch({ [textField]: optional && value.trim() === '' ? undefined : value });
          },
        }),
      ),
    );
  }

  /* ── research ──────────────────────────────────────────────────────────── */
  if (node.kind === 'research') {
    sections.push(
      toggleRow({
        key: 'usectx',
        className: 'gph-inspector__usecontext',
        checked: node.useContext !== false,
        label: t('web.graph.inspector.use_context'),
        hint: t('web.graph.inspector.use_context_hint'),
        onToggle: (value) => onPatch({ useContext: value }),
      }),
    );

    sections.push(
      h(
        'div',
        { className: 'gph-field', key: 'outkind' },
        h('label', null, t('web.graph.inspector.output_kind')),
        h(
          'div',
          { className: 'gph-seg' },
          OUTPUT_KINDS.map((entry) =>
            h(
              'button',
              {
                type: 'button',
                key: entry.id,
                className: `gph-seg__btn${node.outputKind === entry.id ? ' is-on' : ''}`,
                'data-kind': entry.id,
                'aria-pressed': node.outputKind === entry.id ? 'true' : 'false',
                onClick: () => requestOutputKind(entry.id),
              },
              t(entry.labelKey),
            ),
          ),
        ),
        hint(
          t(OUTPUT_HINT_KEY[node.outputKind] || 'web.graph.inspector.output_info_hint'),
          'kindhint',
          'gph-hint gph-inspector__outputhint',
        ),
      ),
    );
  }

  if (pending) {
    sections.push(
      h(ConfirmDrop, {
        key: 'pending',
        graph,
        pending,
        onApply: applyPending,
        onCancel: () => setPending(null),
      }),
    );
  }

  /* ── the arms, for everything that branches ────────────────────────────── */
  if (arms !== null) {
    const titleKey =
      node.kind === 'gate'
        ? 'web.graph.inspector.outcomes'
        : node.outputKind === 'choice'
          ? 'web.graph.inspector.choices'
          : 'web.graph.inspector.arms';
    sections.push(
      h(
        'div',
        { className: 'gph-field', key: 'arms' },
        h('label', null, t(titleKey)),
        h(ArmRows, {
          graph,
          node,
          arms,
          editable: armsField !== null,
          onRename: (armId, label) => onGraph(applyRenameArm(graph, node, armId, label)),
          onRemove: requestRemoveArm,
          onOpenPalette: openPalette,
        }),
        armsField
          ? h(
              'div',
              { className: 'gph-addarm' },
              h('input', {
                type: 'text',
                className: 'gph-addarm__input',
                'aria-label': t('web.graph.inspector.arm_add_label'),
                placeholder: t('web.graph.inspector.arm_add_label'),
                value: newArm,
                onChange: (ev) => setNewArm(ev.target.value),
              }),
              h(
                'button',
                {
                  type: 'button',
                  className: 'btn btn--ghost btn--sm gph-addarm__btn',
                  onClick: addArm,
                },
                t('web.graph.inspector.arm_add'),
              ),
            )
          : null,
        armIssue ? h('div', { className: 'gph-addarm__issue' }, armIssue) : null,
      ),
    );

    sections.push(
      h(DefaultPicker, { key: 'default', graph, node, arms, onPick: pickDefault }),
    );

    sections.push(
      h(ReworkBuilder, {
        key: 'rework',
        graph,
        node,
        arms,
        catalog,
        draft: rework,
        onDraft: setRework,
        onCreate: createRework,
      }),
    );
  }

  if (node.kind === 'gate') {
    sections.push(
      numberRow({
        key: 'maxruns',
        className: 'gph-inspector__maxruns',
        label: t('web.graph.inspector.max_runs'),
        value: node.maxRuns,
        hint: t('web.graph.inspector.max_runs_hint'),
        onChange: (value) => onPatch({ maxRuns: value }),
      }),
    );
  }

  /* ── action ────────────────────────────────────────────────────────────── */
  if (node.kind === 'action') {
    sections.push(
      h(
        'div',
        { className: 'gph-field', key: 'block' },
        h('label', null, t('web.graph.inspector.block')),
        h('div', { className: 'gph-panel__id' }, node.block || ''),
      ),
    );

    // The template the node will ACTUALLY run, read-only. Hiding it would leave
    // the human overriding a prompt they cannot read — the difference between
    // underwriting the method and hoping.
    sections.push(
      h(
        'div',
        { className: 'gph-field', key: 'template' },
        h('label', null, t('web.graph.inspector.template')),
        block && text(block.promptTemplate)
          ? h('pre', { className: 'gph-tpl' }, block.promptTemplate)
          : hint(t('web.graph.inspector.template_missing'), 'tplmissing'),
      ),
    );

    const fanOut = fanOutCandidates(graph, node, catalog);
    sections.push(
      h(
        'div',
        { className: 'gph-field', key: 'fanout' },
        h('label', null, t('web.graph.inspector.fanout')),
        fanOut.length === 0 && !node.fanOutFrom
          ? hint(t('web.graph.inspector.fanout_none'), 'fanoutnone')
          : h(
              'select',
              {
                className: 'gph-select gph-inspector__fanout',
                value: typeof node.fanOutFrom === 'string' ? node.fanOutFrom : '',
                onChange: (ev) => {
                  const value = ev.target.value;
                  // Picking a producer MEANS `scope: 'memory'`; dropping it must
                  // take the scope with it, or the node keeps a memory scope with
                  // no list to read (`scope-memory-needs-fanout`).
                  onPatch(
                    value
                      ? { fanOutFrom: value, scope: 'memory' }
                      : { fanOutFrom: undefined, scope: undefined },
                  );
                },
              },
              h('option', { value: '' }, t('web.graph.inspector.fanout_off')),
              fanOut.map((entry) =>
                h('option', { key: entry.id, value: entry.id }, entry.label || entry.id),
              ),
            ),
        hint(t('web.graph.inspector.fanout_implies'), 'fanouthint'),
      ),
    );

    sections.push(
      h(
        'div',
        { className: 'gph-field', key: 'scope' },
        h('label', null, t('web.graph.inspector.scope')),
        h(
          'select',
          {
            className: 'gph-select gph-inspector__scope',
            // A fan-out IS the memory scope. Locking the control is how the
            // implication stays visible instead of becoming a validator error
            // the human meets three clicks later.
            disabled: typeof node.fanOutFrom === 'string',
            value: typeof node.scope === 'string' ? node.scope : '',
            onChange: (ev) => {
              const value = ev.target.value;
              onPatch({ scope: value === '' ? undefined : value });
            },
          },
          h(
            'option',
            { value: '' },
            t('web.graph.inspector.scope_default', {
              scope: block ? t(SCOPE_LABEL_KEY[block.defaultScope]) : '—',
            }),
          ),
          typeof node.fanOutFrom === 'string'
            ? h('option', { value: 'memory' }, t('web.graph.inspector.scope_memory'))
            : null,
          PICKABLE_SCOPES.map((scope) =>
            h('option', { key: scope, value: scope }, t(SCOPE_LABEL_KEY[scope])),
          ),
        ),
      ),
    );

    sections.push(
      field(
        t('web.graph.inspector.files'),
        'files',
        h('textarea', {
          className: 'gph-inspector__files',
          value: Array.isArray(node.files) ? node.files.join('\n') : '',
          onChange: (ev) => {
            const list = ev.target.value
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.length > 0);
            onPatch({ files: list.length > 0 ? list : undefined });
          },
        }),
      ),
    );

    sections.push(
      numberRow({
        key: 'maxfiles',
        className: 'gph-inspector__maxfiles',
        label: t('web.graph.inspector.max_files'),
        value: node.maxFiles,
        hint: t('web.graph.inspector.max_files_hint'),
        onChange: (value) => onPatch({ maxFiles: value }),
      }),
    );

    sections.push(
      toggleRow({
        key: 'review',
        className: 'gph-inspector__review',
        checked: node.review === undefined ? !!(block && block.review) : node.review === true,
        label: t('web.graph.inspector.review'),
        hint: t('web.graph.inspector.review_hint'),
        onToggle: (value) => onPatch({ review: value }),
      }),
    );
  }

  /* ── model, join, notes, issues ────────────────────────────────────────── */
  if (node.kind !== 'prompt') {
    sections.push(
      field(
        t('web.graph.inspector.model'),
        'model',
        h('input', {
          type: 'text',
          className: 'gph-inspector__model',
          value: typeof node.modelId === 'string' ? node.modelId : '',
          onChange: (ev) => {
            const value = ev.target.value.trim();
            onPatch({ modelId: value === '' ? undefined : ev.target.value });
          },
        }),
        hint(t('web.graph.inspector.model_hint'), 'modelhint'),
      ),
    );
  }

  sections.push(h(JoinField, { key: 'join', graph, node, onJoin }));

  sections.push(
    field(
      t('web.graph.inspector.notes'),
      'notes',
      h('textarea', {
        className: 'gph-inspector__notes',
        value: typeof node.notes === 'string' ? node.notes : '',
        onChange: (ev) => {
          const value = ev.target.value;
          onPatch({ notes: value.trim() === '' ? undefined : value });
        },
      }),
    ),
  );

  const issueRows = [
    ...(errors || []).map((issue, i) => issueItem(issue, i, 'err')),
    ...(warnings || []).map((issue, i) => issueItem(issue, i, 'warn')),
  ];
  if (issueRows.length > 0) {
    sections.push(
      h(
        'div',
        { className: 'gph-field', key: 'issues' },
        h('label', null, t('web.graph.inspector.issues')),
        h('ul', { className: 'gph-issues' }, issueRows),
      ),
    );
  }

  if (node.kind !== 'prompt') {
    sections.push(
      h(
        'button',
        {
          type: 'button',
          key: 'delete',
          className: 'btn btn--danger btn--sm gph-inspector__delete',
          onClick: () => onDelete(node.id),
        },
        t('web.graph.inspector.delete'),
      ),
    );
  }

  return h(
    'aside',
    { className: 'gph-inspector', 'data-node-id': node.id, 'data-kind': node.kind },
    h('div', { className: 'gph-inspector__title' }, t('web.graph.inspector.title')),
    sections,
  );
}

/**
 * One issue row. `code` is shown small and monospaced next to the sentence: it
 * is the SAME string the server reports and the one thing worth quoting when
 * asking for help.
 */
export function issueItem(issue, index, sev, className) {
  return h(
    'li',
    { key: `${sev}:${index}`, className, 'data-sev': sev, 'data-code': issue.code || '' },
    issue.code ? h('code', { className: 'gph-global__code' }, issue.code) : null,
    issue.message || '',
  );
}

/**
 * WHAT THIS STEP WAITS FOR — the user's second explicit request ("posso definir
 * o que esperamos com join ou não").
 */
function JoinField(props) {
  const { graph, node, onJoin } = props;
  const preds = directPredecessors(graph, node.id);
  const join = node.join && node.join.mode === 'subset' ? node.join : { mode: 'all' };
  const chosen = Array.isArray(join.of) ? join.of : [];

  /** Toggle one predecessor. Emptying the subset falls back to `all`, never to
   *  an empty subset — which is its own validator error (`join-subset-empty`)
   *  and the same repair `pruneDanglingRefs` performs server-side. */
  function togglePred(id) {
    const next = chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id];
    onJoin(next.length > 0 ? { mode: 'subset', of: next } : { mode: 'all' });
  }

  const body = [];
  if (node.kind === 'prompt') {
    body.push(
      h('div', { className: 'gph-join__note', key: 'root' }, t('web.graph.inspector.join_root')),
    );
  } else if (preds.length === 0) {
    body.push(
      h('div', { className: 'gph-join__note', key: 'none' }, t('web.graph.inspector.join_none')),
    );
  } else {
    body.push(
      h(
        'label',
        { className: 'gph-join__opt', key: 'all' },
        h('input', {
          type: 'radio',
          name: 'gph-join',
          className: 'gph-join__all',
          checked: join.mode === 'all',
          onChange: () => onJoin({ mode: 'all' }),
        }),
        h('span', null, t('web.graph.inspector.join_all')),
      ),
      h(
        'label',
        { className: 'gph-join__opt', key: 'subset' },
        h('input', {
          type: 'radio',
          name: 'gph-join',
          className: 'gph-join__subset',
          checked: join.mode === 'subset',
          // Opening the subset with EVERY predecessor ticked changes nothing on
          // its own: the human then unticks what this step must not wait for,
          // so the relaxation is always something they did deliberately.
          onChange: () => onJoin({ mode: 'subset', of: preds.slice() }),
        }),
        h('span', null, t('web.graph.inspector.join_subset')),
      ),
      h(
        'div',
        { className: 'gph-join__preds', key: 'preds' },
        preds.map((id) => {
          const pred = nodeById(graph, id);
          return h(
            'label',
            { className: 'gph-join__pred', key: id },
            h('input', {
              type: 'checkbox',
              'data-pred': id,
              disabled: join.mode !== 'subset',
              checked: join.mode === 'all' || chosen.includes(id),
              onChange: () => togglePred(id),
            }),
            h('span', null, (pred && pred.label) || id, ' ', h('code', null, id)),
          );
        }),
      ),
    );
    if (join.mode === 'subset') {
      body.push(
        h(
          'div',
          { className: 'gph-join__honest', key: 'honest' },
          t('web.graph.inspector.join_honest'),
        ),
      );
    }
  }

  return h(
    'div',
    { className: 'gph-field' },
    h('label', null, t('web.graph.inspector.join')),
    h('div', { className: 'gph-join' }, body),
  );
}

// --- The method's life cycle ------------------------------------------------

/**
 * Open another method, and change this one's id.
 *
 * THERE IS NO RENAME, and the UI has to say so. `PUT /api/graphs/:id` takes the
 * URL as the authority, so saving under a new id creates a SECOND file and
 * leaves the old one on disk. The only honest rename is `remove(old)` +
 * `save(new)`, in that order — a destructive operation the human is told about
 * BEFORE it runs, not after.
 *
 * @param {Record<string, any>} props
 *   `graph`, `graphApi`, `dir`, `onOpenGraph(doc)`, `onNotify(msg, isErr)`
 */
export function GraphLibrary(props) {
  const { graph, graphApi, dir } = props;
  const notify = typeof props.onNotify === 'function' ? props.onNotify : () => {};
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState('');
  const [draftId, setDraftId] = useState(graph.id || '');
  const [confirming, setConfirming] = useState(false);

  const graphId = graph.id || '';
  useEffect(() => {
    setDraftId(graphId);
    setConfirming(false);
  }, [graphId]);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (!graphApi || typeof graphApi.list !== 'function') return;
    setBusy('list');
    try {
      const res = await graphApi.list(dir);
      setItems(Array.isArray(res && res.graphs) ? res.graphs : []);
    } catch (err) {
      notify(t('web.graph.library_failed', { message: err.message }), true);
    } finally {
      setBusy('');
    }
  }

  async function openGraph(id) {
    setBusy('open');
    try {
      const res = await graphApi.read(id, dir);
      if (res && res.graph) {
        props.onOpenGraph(res.graph);
        setOpen(false);
      }
    } catch (err) {
      notify(t('web.graph.open_failed', { id, message: err.message }), true);
    } finally {
      setBusy('');
    }
  }

  /** The pre-flight: a reserved or malformed id is refused BEFORE the 400. */
  const idIssue = draftId !== graphId ? graphIdIssue(draftId) : null;

  async function rename() {
    const from = graphId;
    const to = text(draftId);
    setConfirming(false);
    setBusy('rename');
    let orphaned = '';
    try {
      // A method that was never saved has no file to delete, and that must not
      // stop the human from fixing its id. The failure is CARRIED, not hidden:
      // if the old file survived, the toast says both now exist.
      try {
        await graphApi.remove(from, dir);
      } catch (err) {
        orphaned = err.message || '';
      }
      const res = await graphApi.save({ ...graph, id: to }, dir);
      if (res && res.graph) props.onOpenGraph(res.graph);
      notify(
        orphaned
          ? t('web.graph.rename_orphan', { from, to, message: orphaned })
          : t('web.graph.renamed', { from, to }),
        !!orphaned,
      );
    } catch (err) {
      notify(t('web.graph.rename_failed', { message: err.message }), true);
    } finally {
      setBusy('');
    }
  }

  return h(
    'div',
    { className: 'gph-lib' },
    h(
      'div',
      { className: 'gph-lib__row' },
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn--ghost btn--sm gph-lib__btn',
          onClick: () => {
            void toggle();
          },
        },
        t('web.graph.library'),
      ),
      h('input', {
        type: 'text',
        className: 'gph-lib__id',
        'aria-label': t('web.graph.id_label'),
        value: draftId,
        onChange: (ev) => {
          setDraftId(ev.target.value);
          setConfirming(false);
        },
      }),
      draftId !== graphId && !idIssue
        ? h(
            'button',
            {
              type: 'button',
              className: 'btn btn--ghost btn--sm gph-lib__rename',
              disabled: busy !== '',
              onClick: () => setConfirming(true),
            },
            t('web.graph.rename'),
          )
        : null,
    ),
    idIssue ? h('div', { className: 'gph-lib__issue' }, idIssue.message) : null,
    confirming
      ? h(
          'div',
          { className: 'gph-confirm gph-lib__confirm' },
          h(
            'div',
            { className: 'gph-confirm__text' },
            t('web.graph.rename_warn', { from: graphId, to: text(draftId) }),
          ),
          h(
            'div',
            { className: 'gph-confirm__actions' },
            h(
              'button',
              {
                type: 'button',
                className: 'btn btn--danger btn--sm gph-lib__confirm-apply',
                onClick: () => {
                  void rename();
                },
              },
              t('web.graph.rename_apply'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'btn btn--ghost btn--sm gph-lib__confirm-cancel',
                onClick: () => setConfirming(false),
              },
              t('web.graph.inspector.switch_cancel'),
            ),
          ),
        )
      : null,
    open
      ? h(
          'ul',
          { className: 'gph-lib__list' },
          items.length === 0 && busy !== 'list'
            ? h('li', { className: 'gph-lib__empty' }, t('web.graph.library_empty'))
            : items.map((entry) =>
                h(
                  'li',
                  { key: entry.id, className: 'gph-lib__item' },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'gph-lib__open',
                      'data-graph-id': entry.id,
                      onClick: () => {
                        void openGraph(entry.id);
                      },
                    },
                    h('span', { className: 'gph-lib__name' }, entry.name || entry.id),
                    h(
                      'span',
                      { className: 'gph-lib__meta' },
                      t('web.graph.node_count', {
                        nodes: entry.nodeCount || 0,
                        edges: entry.edgeCount || 0,
                      }),
                    ),
                  ),
                ),
              ),
        )
      : null,
  );
}

/**
 * The pipeline this drawing becomes.
 *
 * The point of showing it is that the compilation is MECHANICAL: every step,
 * what it waits for and where each verdict routes. A human who can read the
 * pipeline can tell whether the method they drew is the method that will run —
 * which is the whole promise of drawing it by hand.
 *
 * @param {Record<string, any>} props `{ result, onClose }`
 */
export function CompileReport(props) {
  const { result } = props;
  if (!result || result.state === 'idle') return null;

  const steps =
    result.state === 'ok' && result.pipeline && Array.isArray(result.pipeline.steps)
      ? result.pipeline.steps
      : [];

  return h(
    'div',
    { className: 'gph-compile', 'data-state': result.state },
    h(
      'div',
      { className: 'gph-compile__head' },
      h(
        'span',
        { className: 'gph-compile__title' },
        result.state === 'busy'
          ? t('web.graph.compiling')
          : result.state === 'ok'
            ? t('web.graph.compile_ok', { count: steps.length })
            : t('web.graph.compile_failed', { message: result.message || '' }),
      ),
      h(
        'button',
        {
          type: 'button',
          className: 'btn btn--ghost btn--sm gph-compile__close',
          onClick: props.onClose,
        },
        t('web.graph.compile_close'),
      ),
    ),
    steps.length > 0
      ? h(
          'ol',
          { className: 'gph-compile__steps' },
          steps.map((step) =>
            h(
              'li',
              { key: step.name, className: 'gph-compile__step', 'data-step': step.name },
              h(
                'div',
                { className: 'gph-compile__srow' },
                h(
                  'span',
                  { className: 'gph-compile__kind' },
                  step.type === 'check'
                    ? t('web.graph.compile_check')
                    : t('web.graph.compile_work'),
                ),
                h('span', { className: 'gph-compile__name' }, step.name),
              ),
              Array.isArray(step.dependsOn) && step.dependsOn.length > 0
                ? h(
                    'div',
                    { className: 'gph-compile__dep' },
                    `${t('web.graph.compile_depends')} ${step.dependsOn.join(', ')}`,
                  )
                : null,
              Array.isArray(step.outcomes) && step.outcomes.length > 0
                ? h(
                    'ul',
                    { className: 'gph-compile__outs' },
                    step.outcomes.map((outcome) =>
                      h(
                        'li',
                        { key: outcome.label, className: 'gph-compile__out' },
                        `${outcome.label} → ${outcome.nextStepName}`,
                        outcome.default
                          ? h(
                              'span',
                              { className: 'gph-compile__default' },
                              t('web.graph.compile_default'),
                            )
                          : null,
                      ),
                    ),
                  )
                : null,
            ),
          ),
        )
      : null,
  );
}
