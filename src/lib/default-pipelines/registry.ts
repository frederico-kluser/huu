// Catalog of default pipelines materialized into the user's repo on first
// run by `pipeline-bootstrap.ts`. Add a new bundled default by:
// 1. Creating its module in `src/lib/default-pipelines/huu-<topic>.ts`
//    exporting DEFAULT_PIPELINE_FILENAME, DEFAULT_PIPELINE_NAME,
//    getDefaultPipeline(), and getDefaultPipelineFileContent().
// 2. Importing it here and appending to DEFAULT_PIPELINES.
//
// Idempotency / non-overwrite is enforced by the bootstrap, not here.

import * as testSuite from './huu-test-suite.js';
import * as docsAudit from './huu-docs-audit.js';
import * as qualityAudit from './huu-quality-audit.js';
import * as performanceAudit from './huu-performance-audit.js';
import * as refactor from './huu-refactor.js';
import * as securityAudit from './huu-security-audit.js';
import type { Pipeline } from '../types.js';

export interface DefaultPipelineModule {
  DEFAULT_PIPELINE_FILENAME: string;
  DEFAULT_PIPELINE_NAME: string;
  getDefaultPipeline: () => Pipeline;
  getDefaultPipelineFileContent: () => string;
}

export const DEFAULT_PIPELINES: readonly DefaultPipelineModule[] = [
  testSuite,
  docsAudit,
  qualityAudit,
  performanceAudit,
  refactor,
  securityAudit,
];
