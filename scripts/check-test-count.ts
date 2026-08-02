#!/usr/bin/env tsx
/**
 * check-test-count — reads the vitest JSON report written by the json reporter
 * (configured in vitest.config.ts to output `.vitest-report.json`) and fails
 * if the total assertion count drops below the floor. Called by `npm run
 * posttest` so the gate runs automatically after every `npm test` invocation.
 *
 * Floor rationale: the suite currently holds 1790 tests (2025-07-30).
 * The floor (1700) is 5% below that — enough headroom for intentional
 * reorganisation while catching accidental mass deletion.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const REPORT_PATH = resolve(process.cwd(), '.vitest-report.json');
const FLOOR = 1700;

interface AssertionResult {
  status: string;
}
interface SuiteResult {
  assertionResults: AssertionResult[];
}
interface JsonReport {
  testResults: SuiteResult[];
}

function main() {
  let raw: string;
  try {
    raw = readFileSync(REPORT_PATH, 'utf8').trim();
  } catch {
    console.error(`check-test-count: report not found at ${REPORT_PATH}. Did vitest run?`);
    process.exit(1);
  }

  if (!raw) {
    console.error('check-test-count: empty report file.');
    process.exit(1);
  }

  let report: JsonReport;
  try {
    report = JSON.parse(raw);
  } catch {
    console.error('check-test-count: failed to parse JSON report.');
    process.exit(1);
  }

  const total = report.testResults.reduce(
    (sum, s) => sum + s.assertionResults.length,
    0,
  );

  // Count tests that actually executed (not skipped).
  // A skipped-only run means a -t filter matched nothing — treat it as failure.
  const executed = report.testResults.reduce(
    (sum, s) =>
      sum +
      s.assertionResults.filter((r) => r.status !== 'skipped').length,
    0,
  );

  if (executed === 0) {
    console.error('check-test-count: FAILED — 0 tests executed (filter matched nothing?).');
    process.exit(1);
  }

  console.log(`check-test-count: ${total} assertions (${executed} executed, floor ${FLOOR})`);

  if (total < FLOOR) {
    console.error(
      `check-test-count: FAILED — assertion count ${total} dropped below floor ${FLOOR}. ` +
        `Did someone accidentally delete test files?`,
    );
    process.exit(1);
  }
}

main();
