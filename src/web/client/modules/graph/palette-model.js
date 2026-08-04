/* huu web UI — the brain behind the "bolinha".
   ============================================

   The interaction this module serves: the human clicks the little handle on a
   node, a menu opens with WHAT CAN COME NEXT, they pick one, and the new node
   lands ALREADY CONNECTED. Three questions, three functions — what to offer
   (`paletteFor`), how to lay it out (`groupPalette`), what happens on the click
   (`applyPaletteChoice`) — and none of them touches the DOM, so all three are
   pinned in Node by `palette-model.test.js`.

   THE PALETTE CARRIES NO CATALOG. Every block, every node kind, every label and
   description comes from `GET /api/graphs/catalog`, which serves the very
   `ACTION_BLOCKS` / `NODE_KINDS` the compiler and the validator read. A
   hand-copied list here would be a palette that can disagree with what actually
   runs — the exact drift `modules/dev.js` refuses ("o cliente renderiza a
   tabela, nunca carrega uma cópia que possa discordar do que roda"). Pass no
   catalog and you get an EMPTY palette; that is the honest failure, and it is
   also the proof that nothing is embedded.

   THE GROUPING IS DERIVED, NEVER LISTED. A block's group comes from its own
   FIELDS — `produces` (it writes a list a later node can fan out over) and
   `readOnly` (it audits and must not change code). The catalog grows by APPEND;
   a hard-coded id list here would silently drop every block added after this
   file was written, and nobody would notice because the palette would still
   look full. */

import {
  addNode,
  capsOf,
  connect,
  edgesOf,
  nodeById,
  nodesOf,
  outboundEdges,
  outcomesOf,
  suggestPosition,
} from './graph-model.js';

/**
 * One row of the menu. `group` / `description` are what the UI renders; `kind`
 * + `id` are what `applyPaletteChoice` acts on, which is why they are the only
 * two a hand-built item must carry.
 *
 * @typedef {{ kind: string, id: string, group?: string, label?: string, description?: string, block?: Record<string, any>, disabled?: boolean, code?: string, reason?: string } & Record<string, any>} PaletteItem
 */

/**
 * The four buckets, keyed by the FIELD that puts a block in one.
 *
 * `produce` before `audit` is load-bearing in the lookup below, not in the
 * display: a block that writes a findings list is a producer first (that is
 * what a later node fans out over), and the two flags are mutually exclusive in
 * the catalog anyway — writing a list needs the write tool.
 */
export const PALETTE_GROUPS = {
  produce: 'Achados e listas',
  audit: 'Auditar (não altera código)',
  code: 'Escrever código',
  kinds: 'Tipos de nó',
};

/**
 * Which bucket a block belongs to, from its own fields.
 * @param {Record<string, any>} block one entry of `catalog.blocks`
 * @returns {string}
 */
export function groupOfBlock(block) {
  if (block && block.produces === true) return PALETTE_GROUPS.produce;
  if (block && block.readOnly === true) return PALETTE_GROUPS.audit;
  return PALETTE_GROUPS.code;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function recordsOf(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Why NOTHING can be added at this point, or `null` when the point is open.
 *
 * A blocked palette is still RENDERED — every item comes back `disabled` with
 * the reason attached, because a menu that empties itself teaches nothing while
 * a greyed row that says "this arm already goes to X" teaches the rule. The
 * codes are the server's own (`GraphErrorCode`), so the UI keeps one table.
 */
function blockedReason(graph, source, sourceOutcome, catalog) {
  const caps = capsOf(catalog);
  if (nodesOf(graph).length >= caps.maxNodes) {
    return {
      code: 'too-many-nodes',
      reason: `O grafo já tem ${caps.maxNodes} nós, que é o limite.`,
    };
  }
  if (edgesOf(graph).length >= caps.maxEdges) {
    return {
      code: 'too-many-edges',
      reason: `O grafo já tem ${caps.maxEdges} ligações, que é o limite.`,
    };
  }

  const outcomes = outcomesOf(source, catalog);
  const outcome = text(sourceOutcome);

  if (outcomes === null) {
    if (outcome) {
      return {
        code: 'edge-outcome-forbidden',
        reason: `"${source.label}" tem uma saída só, então não há braço "${outcome}".`,
      };
    }
    // A node with ONE way out may feed as many nodes as the human wants. This
    // is the parallelism the canvas exists for: several fronts leaving the same
    // point, merged by the wave at the end of the stage.
    return null;
  }

  if (!outcome) {
    return {
      code: 'edge-outcome-required',
      reason: `"${source.label}" ramifica: abra a bolinha do braço por onde o método deve seguir.`,
    };
  }
  const arm = outcomes.find((entry) => entry.id === outcome);
  if (!arm) {
    return {
      code: 'edge-outcome-unknown',
      reason: `"${source.label}" não declara o braço "${outcome}".`,
    };
  }
  const taken = outboundEdges(graph, source.id).filter(
    (edge) => text(edge.sourceOutcome) === outcome,
  );
  if (taken.length > 0) {
    const busy = nodeById(graph, taken[0].target);
    return {
      code: 'branch-outcome-multiple-edges',
      reason: `O braço "${text(arm.label) || arm.id}" já segue para "${
        busy ? busy.label : taken[0].target
      }". Uma verificação do huu roteia cada braço para UM passo só — ligue este braço a UM bloco e ramifique a partir dele.`,
    };
  }
  return null;
}

/** @returns {PaletteItem} */
function decorate(item, blocked) {
  if (!blocked) return item;
  return { ...item, disabled: true, code: blocked.code, reason: blocked.reason };
}

/**
 * What the palette offers when the bolinha of `sourceId` (arm `sourceOutcome`,
 * when the node branches) is opened.
 *
 * Order: the action blocks in CATALOG order — that order is contract, the
 * server appends to it and the human's muscle memory depends on it — then the
 * drawable node kinds. `prompt` is never offered: the root takes no inbound
 * edge, so it can never be the thing you hang off a bolinha. `action` is not
 * offered as a kind either — its blocks ARE the action entries.
 *
 * @param {Record<string, any>} graph the devgraph
 * @param {string} sourceId the node the bolinha belongs to
 * @param {string|null|undefined} sourceOutcome the arm, for a branching source
 * @param {Record<string, any>} [catalog] the `/api/graphs/catalog` payload
 *   (`{blocks, kinds, caps?}`) — the ONLY source of blocks and labels
 * @returns {PaletteItem[]}
 */
export function paletteFor(graph, sourceId, sourceOutcome, catalog) {
  const source = nodeById(graph, sourceId);
  if (!source) return [];
  const blocked = blockedReason(graph, source, sourceOutcome, catalog);
  /** @type {PaletteItem[]} */
  const items = [];

  for (const block of recordsOf(catalog && catalog.blocks)) {
    const id = text(block.id);
    if (!id) continue;
    items.push(
      decorate(
        {
          group: groupOfBlock(block),
          id,
          kind: 'action',
          label: text(block.label) || id,
          description: text(block.description),
          block,
        },
        blocked,
      ),
    );
  }

  for (const entry of recordsOf(catalog && catalog.kinds)) {
    const kind = text(entry.kind);
    if (kind !== 'research' && kind !== 'gate') continue;
    items.push(
      decorate(
        {
          group: PALETTE_GROUPS.kinds,
          id: kind,
          kind,
          label: text(entry.label) || kind,
          description: text(entry.description),
        },
        blocked,
      ),
    );
  }

  return items;
}

/**
 * Bucket palette items into renderable sections.
 *
 * Group order is FIRST APPEARANCE in `items`, so it follows the catalog's own
 * order rather than a list written here — append a block server-side and its
 * section appears where the catalog put it. Item order inside a group is
 * preserved. Same shape as `groupQueueItems` in `queue-util.js`.
 *
 * @param {any[]} items
 * @returns {Array<{group: string, items: PaletteItem[]}>}
 */
export function groupPalette(items) {
  const list = Array.isArray(items) ? items : [];
  const order = [];
  const byName = new Map();
  for (const item of list) {
    if (!isRecord(item)) continue;
    const name = text(item.group);
    let group = byName.get(name);
    if (!group) {
      group = { group: name, items: [] };
      byName.set(name, group);
      order.push(group);
    }
    group.items.push(item);
  }
  return order;
}

/**
 * Read a click into `{kind, id, label}`.
 *
 * The ITEM is the expected argument — it already carries the catalog's label,
 * which is the only place the client is allowed to get one. A bare string is
 * accepted as a convenience: `'research'` / `'gate'` name a node kind, anything
 * else is read as a block id and the new node opens with the fallback label
 * from `graph-model.js` until the human renames it.
 */
function normalizeChoice(choice) {
  if (typeof choice === 'string') {
    const id = choice.trim();
    if (!id) return null;
    if (id === 'research' || id === 'gate') return { kind: id, id, label: '' };
    return { kind: 'action', id, label: '' };
  }
  if (!isRecord(choice)) return null;
  const kind = text(choice.kind);
  const id = text(choice.id);
  const label = text(choice.label);
  if (kind === 'research' || kind === 'gate') return { kind, id: kind, label };
  if (kind === 'action' || (!kind && id)) {
    if (!id) return null;
    return { kind: 'action', id, label };
  }
  return null;
}

/**
 * The click: create the chosen node AND the edge that hangs it off the bolinha,
 * in one move.
 *
 * ATOMIC on purpose. If the connection is refused, the node is NOT left behind:
 * the original graph comes back with the refusal, because a node floating loose
 * on the canvas is a defect the human has to clean up after an action they
 * thought had failed.
 *
 * `position` is optional — omitted, the node lands one column to the right of
 * the source and one lane down per sibling already fanned out from it, so
 * "another one from the same point" reads as parallel instead of stacking.
 *
 * @param {Record<string, any>} graph
 * @param {string} sourceId
 * @param {string|null|undefined} sourceOutcome
 * @param {any} choice the clicked {@link PaletteItem} (or a bare id)
 * @param {Record<string, any>} [position] `{x, y}`
 * @returns {{graph: Record<string, any>, nodeId?: string, edgeId?: string, error?: {code: string, message: string}}}
 */
export function applyPaletteChoice(graph, sourceId, sourceOutcome, choice, position) {
  const item = normalizeChoice(choice);
  if (!item) {
    return {
      graph,
      error: { code: 'invalid-palette-choice', message: 'Escolha de paleta não reconhecida.' },
    };
  }

  const where = isRecord(position) ? position : suggestPosition(graph, sourceId);
  const seed = { label: item.label, position: where };
  if (item.kind === 'action') seed.block = item.id;

  const added = addNode(graph, item.kind, seed);
  if (added.error || !added.nodeId) {
    return { graph, error: added.error };
  }

  const linked = connect(added.graph, sourceId, added.nodeId, {
    sourceOutcome,
    rework: isRecord(choice) && choice.rework === true,
  });
  if (linked.error) return { graph, error: linked.error };

  return { graph: linked.graph, nodeId: added.nodeId, edgeId: linked.edgeId };
}
