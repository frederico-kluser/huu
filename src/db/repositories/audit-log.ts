import type Database from 'better-sqlite3';
import type { AuditLogEntry, ResultStatus } from '../../types/index.js';

export interface CreateAuditLogParams {
  project_id: string;
  session_id?: string;
  agent_id: string;
  tool_name: string;
  params_json: string;
  result_json: string;
  result_status: ResultStatus;
  duration_ms?: number;
  message_id?: number;
  error_text?: string;
  prev_hash?: string;
  entry_hash?: string;
}

export class AuditLogRepository {
  constructor(private readonly db: Database.Database) {}

  /** Append an audit log entry. This is the only write operation allowed. */
  append(params: CreateAuditLogParams): AuditLogEntry {
    return this.db
      .prepare(
        `INSERT INTO audit_log (
           project_id, session_id, agent_id, tool_name,
           params_json, result_json, result_status,
           duration_ms, message_id, error_text, prev_hash, entry_hash
         ) VALUES (
           @project_id, @session_id, @agent_id, @tool_name,
           @params_json, @result_json, @result_status,
           @duration_ms, @message_id, @error_text, @prev_hash, @entry_hash
         )
         RETURNING *`,
      )
      .get({
        project_id: params.project_id,
        session_id: params.session_id ?? null,
        agent_id: params.agent_id,
        tool_name: params.tool_name,
        params_json: params.params_json,
        result_json: params.result_json,
        result_status: params.result_status,
        duration_ms: params.duration_ms ?? null,
        message_id: params.message_id ?? null,
        error_text: params.error_text ?? null,
        prev_hash: params.prev_hash ?? null,
        entry_hash: params.entry_hash ?? null,
      }) as AuditLogEntry;
  }

  getById(id: number): AuditLogEntry | undefined {
    return this.db
      .prepare('SELECT * FROM audit_log WHERE id = ?')
      .get(id) as AuditLogEntry | undefined;
  }

  /** List recent audit log entries for a project. */
  listRecent(projectId: string, limit: number = 100): AuditLogEntry[] {
    return this.db
      .prepare(
        `SELECT * FROM audit_log
         WHERE project_id = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(projectId, limit) as AuditLogEntry[];
  }

  /** List by agent and tool. */
  listByAgentTool(
    projectId: string,
    agentId: string,
    toolName: string,
    limit: number = 50,
  ): AuditLogEntry[] {
    return this.db
      .prepare(
        `SELECT * FROM audit_log
         WHERE project_id = ? AND agent_id = ? AND tool_name = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .all(projectId, agentId, toolName, limit) as AuditLogEntry[];
  }
}
