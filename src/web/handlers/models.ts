// Model catalog for the web UI. The TUI consumes the catalog through
// `loadRecommendedModels` directly; we mirror that here and project
// the result into the wire-protocol's compact `ModelCatalogEntry`
// shape so the front-end doesn't need to depend on the richer
// `ModelEntry` zod type.

import { loadRecommendedModels } from '../../models/catalog.js';
import type { AgentBackendKind } from '../../lib/types.js';
import type { ModelCatalogEntry } from '../ws-protocol.js';

export function loadCatalog(
  cwd: string,
  backend: AgentBackendKind,
): ModelCatalogEntry[] {
  const entries = loadRecommendedModels(cwd, backend);
  return entries.map<ModelCatalogEntry>((m) => ({
    id: m.id,
    label: m.label,
    provider: m.provider ?? 'openrouter',
    pricing:
      m.inputPrice !== undefined && m.outputPrice !== undefined
        ? { in: m.inputPrice, out: m.outputPrice }
        : undefined,
  }));
}
