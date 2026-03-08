import type Database from 'better-sqlite3';
import type { Instinct, InstinctState } from '../../types/index.js';

export interface CreateInstinctParams {
  project_id: string;
  title: string;
  instinct_text: string;
  confidence: number;
  state?: InstinctState;
  source_observation_id?: number;
  metadata_json?: string;
}

export interface UpdateInstinctParams {
  id: number;
  confidence?: number;
  state?: InstinctState;
  evidence_count?: number;
  contradiction_count?: number;
  instinct_text?: string;
}

export class InstinctRepository {
  constructor(private readonly db: Database.Database) {}

  create(params: CreateInstinctParams): Instinct {
    return this.db
      .prepare(
        `INSERT INTO instincts (
           project_id, title, instinct_text, confidence, state,
           source_observation_id, metadata_json
         ) VALUES (
           @project_id, @title, @instinct_text, @confidence, @state,
           @source_observation_id, @metadata_json
         )
         RETURNING *`,
      )
      .get({
        project_id: params.project_id,
        title: params.title,
        instinct_text: params.instinct_text,
        confidence: params.confidence,
        state: params.state ?? 'candidate',
        source_observation_id: params.source_observation_id ?? null,
        metadata_json: params.metadata_json ?? '{}',
      }) as Instinct;
  }

  getById(id: number): Instinct | undefined {
    return this.db
      .prepare('SELECT * FROM instincts WHERE id = ?')
      .get(id) as Instinct | undefined;
  }

  /** Update mutable fields. */
  update(params: UpdateInstinctParams): boolean {
    const fields: string[] = [];
    const values: Record<string, unknown> = { id: params.id };

    if (params.confidence !== undefined) {
      fields.push('confidence = @confidence');
      values['confidence'] = params.confidence;
    }
    if (params.state !== undefined) {
      fields.push('state = @state');
      values['state'] = params.state;
    }
    if (params.evidence_count !== undefined) {
      fields.push('evidence_count = @evidence_count');
      values['evidence_count'] = params.evidence_count;
    }
    if (params.contradiction_count !== undefined) {
      fields.push('contradiction_count = @contradiction_count');
      values['contradiction_count'] = params.contradiction_count;
    }
    if (params.instinct_text !== undefined) {
      fields.push('instinct_text = @instinct_text');
      values['instinct_text'] = params.instinct_text;
    }

    if (fields.length === 0) return false;

    fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
    fields.push("last_validated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");

    const result = this.db
      .prepare(`UPDATE instincts SET ${fields.join(', ')} WHERE id = @id`)
      .run(values);
    return result.changes > 0;
  }

  /** List active instincts for a project, ordered by confidence desc. */
  listActive(projectId: string): Instinct[] {
    return this.db
      .prepare(
        `SELECT * FROM instincts
         WHERE project_id = ? AND state = 'active'
         ORDER BY confidence DESC`,
      )
      .all(projectId) as Instinct[];
  }

  /** List by state. */
  listByState(projectId: string, state: InstinctState): Instinct[] {
    return this.db
      .prepare(
        `SELECT * FROM instincts
         WHERE project_id = ? AND state = ?
         ORDER BY confidence DESC`,
      )
      .all(projectId, state) as Instinct[];
  }
}
