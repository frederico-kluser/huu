import type Database from 'better-sqlite3';
import type { Relation } from '../../types/index.js';

export interface CreateRelationParams {
  project_id: string;
  from_entity_id: number;
  to_entity_id: number;
  relation_type: string;
  confidence?: number;
  metadata_json?: string;
  source_message_id?: number;
}

export class RelationRepository {
  constructor(private readonly db: Database.Database) {}

  /** Idempotent upsert: insert or update last_seen_at on conflict. */
  upsert(params: CreateRelationParams): Relation {
    return this.db
      .prepare(
        `INSERT INTO relations (
           project_id, from_entity_id, to_entity_id, relation_type,
           confidence, metadata_json, source_message_id
         ) VALUES (
           @project_id, @from_entity_id, @to_entity_id, @relation_type,
           @confidence, @metadata_json, @source_message_id
         )
         ON CONFLICT(project_id, from_entity_id, relation_type, to_entity_id) DO UPDATE SET
           last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
           confidence = excluded.confidence,
           metadata_json = excluded.metadata_json
         RETURNING *`,
      )
      .get({
        project_id: params.project_id,
        from_entity_id: params.from_entity_id,
        to_entity_id: params.to_entity_id,
        relation_type: params.relation_type,
        confidence: params.confidence ?? 0.7,
        metadata_json: params.metadata_json ?? '{}',
        source_message_id: params.source_message_id ?? null,
      }) as Relation;
  }

  /** Get relations originating from an entity. */
  getFromEntity(
    projectId: string,
    fromEntityId: number,
    relationType?: string,
  ): Relation[] {
    if (relationType) {
      return this.db
        .prepare(
          `SELECT * FROM relations
           WHERE project_id = ? AND from_entity_id = ? AND relation_type = ?`,
        )
        .all(projectId, fromEntityId, relationType) as Relation[];
    }
    return this.db
      .prepare(
        `SELECT * FROM relations
         WHERE project_id = ? AND from_entity_id = ?`,
      )
      .all(projectId, fromEntityId) as Relation[];
  }

  /** Get relations pointing to an entity. */
  getToEntity(
    projectId: string,
    toEntityId: number,
    relationType?: string,
  ): Relation[] {
    if (relationType) {
      return this.db
        .prepare(
          `SELECT * FROM relations
           WHERE project_id = ? AND to_entity_id = ? AND relation_type = ?`,
        )
        .all(projectId, toEntityId, relationType) as Relation[];
    }
    return this.db
      .prepare(
        `SELECT * FROM relations
         WHERE project_id = ? AND to_entity_id = ?`,
      )
      .all(projectId, toEntityId) as Relation[];
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM relations WHERE id = ?')
      .run(id);
    return result.changes > 0;
  }
}
