import type Database from 'better-sqlite3';
import type { Observation, ToolPhase } from '../../types/index.js';

export interface CreateObservationParams {
  project_id: string;
  session_id: string;
  agent_id: string;
  tool_name: string;
  tool_phase: ToolPhase;
  input_summary?: string;
  output_summary?: string;
  success: boolean;
  latency_ms?: number;
  tokens_input?: number;
  tokens_output?: number;
  cost_usd?: number;
  metadata_json?: string;
}

export class ObservationRepository {
  constructor(private readonly db: Database.Database) {}

  create(params: CreateObservationParams): Observation {
    return this.db
      .prepare(
        `INSERT INTO observations (
           project_id, session_id, agent_id, tool_name, tool_phase,
           input_summary, output_summary, success,
           latency_ms, tokens_input, tokens_output, cost_usd, metadata_json
         ) VALUES (
           @project_id, @session_id, @agent_id, @tool_name, @tool_phase,
           @input_summary, @output_summary, @success,
           @latency_ms, @tokens_input, @tokens_output, @cost_usd, @metadata_json
         )
         RETURNING *`,
      )
      .get({
        project_id: params.project_id,
        session_id: params.session_id,
        agent_id: params.agent_id,
        tool_name: params.tool_name,
        tool_phase: params.tool_phase,
        input_summary: params.input_summary ?? null,
        output_summary: params.output_summary ?? null,
        success: params.success ? 1 : 0,
        latency_ms: params.latency_ms ?? null,
        tokens_input: params.tokens_input ?? null,
        tokens_output: params.tokens_output ?? null,
        cost_usd: params.cost_usd ?? null,
        metadata_json: params.metadata_json ?? '{}',
      }) as Observation;
  }

  getById(id: number): Observation | undefined {
    return this.db
      .prepare('SELECT * FROM observations WHERE id = ?')
      .get(id) as Observation | undefined;
  }

  /** List recent observations by agent and tool. */
  listByAgentTool(
    projectId: string,
    agentId: string,
    toolName: string,
    limit: number = 50,
  ): Observation[] {
    return this.db
      .prepare(
        `SELECT * FROM observations
         WHERE project_id = ? AND agent_id = ? AND tool_name = ?
         ORDER BY occurred_at DESC
         LIMIT ?`,
      )
      .all(projectId, agentId, toolName, limit) as Observation[];
  }

  /** Delete expired observations. Returns number of rows removed. */
  cleanupExpired(): number {
    const result = this.db
      .prepare(
        `DELETE FROM observations WHERE expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
      )
      .run();
    return result.changes;
  }
}
