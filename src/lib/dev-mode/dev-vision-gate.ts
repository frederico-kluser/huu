/**
 * Dev-mode vision gate — pure, no I/O, no fs.
 *
 * The dev mode takes screenshots (its own capture plus user-inserted prints)
 * and hands them to a vision side-call, so a text-only model makes the whole
 * mode a lie. The gate therefore REFUSES to start the mode unless every model
 * the session will use accepts image input — decided by ONE predicate over
 * catalog data (`modelAcceptsImage`), never over the model NAME.
 *
 * Strict on purpose, with a curated escape hatch. An id the catalog does not
 * know is UNKNOWN, and unknown gates as "no vision" (fail-safe text-only —
 * the same rule as `modelAcceptsImage`): the complaint is visible and fixable
 * (curate `inputModalities` in `recommended-models.json`, or pick a listed
 * vision model), while an image that dies mid-run — or gets silently dropped
 * — is neither. This is the "refuse with an actionable message" pattern the
 * research dossier settled on; the failure mode it exists to avoid is the
 * silent one.
 *
 * `--stub` never reaches here: a no-LLM dry run has no model to gate.
 */

export interface DevVisionGateInput {
  /** Model ids the session will use — run-level fallback first, then per-role routes. */
  readonly models: readonly string[];
  /** The capability predicate (injected: pure over catalog data). */
  readonly acceptsImage: (modelId: string) => boolean;
}

export type DevVisionGateResult =
  | { ok: true }
  | { ok: false; offenders: readonly string[]; message: string };

/**
 * Gate a dev session's models on image input. Returns the first refusal as a
 * single actionable message naming every offending id and every way out.
 */
export function checkDevVisionGate(input: DevVisionGateInput): DevVisionGateResult {
  const models = [...new Set(input.models.map((m) => m.trim()).filter(Boolean))];
  if (models.length === 0) {
    // Fail CLOSED: an empty model list is a caller bug (the parser requires
    // --model or full routing), and a gate that passes when it has nothing to
    // check is a gate that passes when its caller forgot to ask.
    return {
      ok: false,
      offenders: [],
      message:
        'huu dev: sem nenhum modelo resolvido para o modo DEV — não há gate de visão a fazer ' +
        'e a corrida morreria dentro do primeiro agente. Passe --model=<id> (ou roteie todos os papéis).',
    };
  }

  const offenders = models.filter((id) => !input.acceptsImage(id));
  if (offenders.length === 0) return { ok: true };

  const list = offenders.join(', ');
  return {
    ok: false,
    offenders,
    message:
      `huu dev: o modo DEV exige um modelo com VISÃO (analisar screenshots) e ${offenders.length === 1 ? 'o modelo' : 'os modelos'} ` +
      `${list} não ${offenders.length === 1 ? 'aceita' : 'aceitam'} imagem segundo o catálogo.\n` +
      '  Como resolver (uma de três):\n' +
      '  1) troque o modelo por um com visão (ex.: xiaomi/mimo-v2.6-pro — `--model=xiaomi/mimo-v2.6-pro`, ou roteie papéis);\n' +
      `  2) se souber que ${offenders.length === 1 ? 'este modelo aceita' : 'estes modelos aceitam'} imagem, declare-o no catálogo: ` +
      'adicionar `"inputModalities": ["text", "image"]` ao entry em recommended-models.json;\n' +
      '  3) para uma corrida sem LLM, use --stub.\n' +
      '  (Nunca seguimos em frente em silêncio: um print que morre a meio da corrida — ou que é descartado sem aviso — é pior que esta recusa.)',
  };
}
