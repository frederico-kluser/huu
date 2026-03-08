// Database connection, schema, and repositories

export { openDatabase, getDatabaseHealth, walCheckpoint } from './connection.js';
export { migrate, getAppliedMigrations } from './migrator.js';
export { MessageQueue } from './queue.js';
export type { EnqueueParams, DequeueOptions } from './queue.js';
export { SessionRepository } from './repositories/sessions.js';
export { EntityRepository } from './repositories/entities.js';
export { RelationRepository } from './repositories/relations.js';
export { ObservationRepository } from './repositories/observations.js';
export { InstinctRepository } from './repositories/instincts.js';
export { BeatStateRepository } from './repositories/beat-state.js';
export { AuditLogRepository } from './repositories/audit-log.js';
