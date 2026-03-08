import type Database from 'better-sqlite3';
import type { Entity } from '../../types/index.js';

export interface UpsertEntityParams {
  project_id: string;
  entity_type: string;
  canonical_key: string;
  display_name: string;
  summary?: string;
  metadata_json?: string;
  confidence?: number;
  source_message_id?: number;
}

export class EntityRepository {
  constructor(private readonly db: Database.Database) {}

  /** Idempotent upsert: insert or update last_seen_at + summary on conflict. */
  upsert(params: UpsertEntityParams): Entity {
    return this.db
      .prepare(
        `INSERT INTO entities (
           project_id, entity_type, canonical_key, display_name,
           summary, metadata_json, confidence, source_message_id
         ) VALUES (
           @project_id, @entity_type, @canonical_key, @display_name,
           @summary, @metadata_json, @confidence, @source_message_id
         )
         ON CONFLICT(project_id, canonical_key) DO UPDATE SET
           last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           summary = COALESCE(excluded.summary, entities.summary),
           display_name = excluded.display_name,
           metadata_json = excluded.metadata_json,
           confidence = excluded.confidence,
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         RETURNING *`,
      )
      .get({
        project_id: params.project_id,
        entity_type: params.entity_type,
        canonical_key: params.canonical_key,
        display_name: params.display_name,
        summary: params.summary ?? null,
        metadata_json: params.metadata_json ?? '{}',
        confidence: params.confidence ?? 0.7,
        source_message_id: params.source_message_id ?? null,
      }) as Entity;
  }

  getById(id: number): Entity | undefined {
    return this.db
      .prepare('SELECT * FROM entities WHERE id = ?')
      .get(id) as Entity | undefined;
  }

  getByCanonicalKey(
    projectId: string,
    canonicalKey: string,
  ): Entity | undefined {
    return this.db
      .prepare(
        'SELECT * FROM entities WHERE project_id = ? AND canonical_key = ?',
      )
      .get(projectId, canonicalKey) as Entity | undefined;
  }

  /** List entities by type, ordered by most recently seen. */
  listByType(projectId: string, entityType: string): Entity[] {
    return this.db
      .prepare(
        `SELECT * FROM entities
         WHERE project_id = ? AND entity_type = ?
         ORDER BY last_seen_at DESC`,
      )
      .all(projectId, entityType) as Entity[];
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM entities WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }
}
