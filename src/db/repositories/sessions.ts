import type Database from 'better-sqlite3';
import type { Session, SessionStatus } from '../../types/index.js';

export interface CreateSessionParams {
  id: string;
  project_id: string;
}

export interface EndSessionParams {
  id: string;
  status: Exclude<SessionStatus, 'running'>;
  summary_markdown?: string;
  summary_json?: string;
}

export class SessionRepository {
  constructor(private readonly db: Database.Database) {}

  create(params: CreateSessionParams): Session {
    return this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, status) VALUES (@id, @project_id, 'running') RETURNING *`,
      )
      .get(params) as Session;
  }

  getById(id: string): Session | undefined {
    return this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(id) as Session | undefined;
  }

  end(params: EndSessionParams): boolean {
    const result = this.db
      .prepare(
        `UPDATE sessions
         SET status = @status,
             ended_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
             summary_markdown = @summary_markdown,
             summary_json = @summary_json,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = @id AND status = 'running'`,
      )
      .run({
        id: params.id,
        status: params.status,
        summary_markdown: params.summary_markdown ?? null,
        summary_json: params.summary_json ?? '{}',
      });
    return result.changes > 0;
  }

  /** Increment counters atomically. */
  incrementCounters(
    id: string,
    deltas: {
      messages?: number;
      tool_calls?: number;
      cost_usd?: number;
    },
  ): boolean {
    const result = this.db
      .prepare(
        `UPDATE sessions
         SET total_messages = total_messages + @messages,
             total_tool_calls = total_tool_calls + @tool_calls,
             total_cost_usd = total_cost_usd + @cost_usd,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
         WHERE id = @id`,
      )
      .run({
        id,
        messages: deltas.messages ?? 0,
        tool_calls: deltas.tool_calls ?? 0,
        cost_usd: deltas.cost_usd ?? 0,
      });
    return result.changes > 0;
  }

  /** Get recent sessions within the 7-day retrieval window. */
  getRecent(projectId: string): Session[] {
    return this.db
      .prepare(
        `SELECT * FROM sessions
         WHERE project_id = ?
           AND ended_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 days')
         ORDER BY ended_at DESC`,
      )
      .all(projectId) as Session[];
  }
}
