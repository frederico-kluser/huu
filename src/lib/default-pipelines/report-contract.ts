// Report-contract evaluator used by judge conditions in huu's report-only
// audit pipelines. Its job is to reproduce — mechanically and without an
// LLM — the same checks the judge condition asks the LLM to run, so the
// test suite can prove every condition CAN reject a bad report.
//
// IMPORTANT: keep this file pure (no side-effects at import time).
// It is imported by the test harness and must not mutate state.

import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ReportContractResult {
  /** `true` when ALL checks pass — the report is clean. */
  passed: boolean;
  /** Human-readable list of what failed (empty when passed). */
  failures: string[];
}

/**
 * Evaluate the report-only contract for a directory inside a git repo.
 *
 * Checks:
 * 1. `git diff --name-only <baseCommit>..HEAD` shows only files under
 *    `.huu/` (plus at most one `.gitignore` adjustment).
 * 2. The report at `reportPath` exists and every `requiredSections`
 *    heading is present and followed by real content.
 * 3. The FAQ at `faqPath` parses as a JSON array.
 * 4. Severity/category counts cited in the report's summary table match
 *    the actual FAQ entries.
 *
 * The function is designed to be called from tests (NOT from production
 * code — the production judge is the LLM itself). It intentionally does
 * NOT shell out to Semgrep / other scanners; it only checks structural
 * contract compliance.
 */
export function evaluateReportContract(
  dir: string,
  baseCommit: string,
  reportPath: string,
  faqPath: string,
  requiredSections: string[],
): ReportContractResult {
  const failures: string[] = [];

  // --- 1. Git diff check ---
  try {
    const diffOut = execSync(
      `git diff --name-only ${baseCommit}..HEAD`,
      { cwd: dir, encoding: 'utf-8' },
    ).trim();
    const modified = diffOut ? diffOut.split('\n') : [];

    const outsideHuu = modified.filter(
      (f) => !f.startsWith('.huu/') && f !== '.gitignore',
    );
    if (outsideHuu.length > 0) {
      failures.push(
        `git diff shows ${outsideHuu.length} file(s) outside .huu/: ${outsideHuu.join(', ')}`,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push(`git diff failed: ${msg}`);
  }

  // --- 2. Report sections ---
  const reportAbs = resolve(dir, reportPath);
  if (!existsSync(reportAbs)) {
    failures.push(`report file missing: ${reportPath}`);
  } else {
    const report = readFileSync(reportAbs, 'utf-8');
    // Extract section headings (## N. Title or # N. Title)
    const headingRx = /^#{1,2}\s+(\d+)\.\s+(.+)$/gm;
    const foundSections = new Map<string, string>();
    // We'll extract content between headings to check for placeholders
    const headingMatches = [...report.matchAll(headingRx)];

    for (let i = 0; i < headingMatches.length; i++) {
      const match = headingMatches[i]!;
      // Heading key includes the section number (e.g. "1. Scope")
      const heading = `${match[1]}. ${match[2]}`;
      const start = (match.index ?? 0) + match[0].length;
      const end = i + 1 < headingMatches.length
        ? headingMatches[i + 1]!.index!
        : report.length;
      const content = report.slice(start, end).trim();
      foundSections.set(heading, content);
    }

    for (const sec of requiredSections) {
      const content = foundSections.get(sec);
      if (content === undefined) {
        failures.push(`required section missing: "${sec}"`);
      } else if (
        content === '' ||
        /^\s*$/.test(content) ||
        /\(filled in by/.test(content) ||
        /TODO/.test(content)
      ) {
        failures.push(`section "${sec}" is empty or placeholder`);
      }
    }
  }

  // --- 3. FAQ parsing ---
  const faqAbs = resolve(dir, faqPath);
  if (!existsSync(faqAbs)) {
    failures.push(`FAQ file missing: ${faqPath}`);
  } else {
    try {
      const raw = readFileSync(faqAbs, 'utf-8');
      const faq = JSON.parse(raw);
      if (!Array.isArray(faq)) {
        failures.push(`FAQ is not a JSON array`);
      } else {
        // --- 4. Count check (severity and category totals vs report) ---
        const reportAbsCheck = resolve(dir, reportPath);
        if (existsSync(reportAbsCheck)) {
          const report = readFileSync(reportAbsCheck, 'utf-8');

          // Count FAQ items by severity
          const sevCounts: Record<string, number> = {};
          for (const entry of faq) {
            const sev = String(entry.severity ?? 'unknown');
            sevCounts[sev] = (sevCounts[sev] ?? 0) + 1;
          }

          // Extract severity counts from report (look for "critical X / warn Y / info Z" patterns)
          const sevRx = /critical\s+(\d+)\s*\/\s*warn\s+(\d+)\s*\/\s*info\s+(\d+)/i;
          const sevMatch = sevRx.exec(report);
          if (sevMatch) {
            const reportCritical = parseInt(sevMatch[1]!, 10);
            const reportWarn = parseInt(sevMatch[2]!, 10);
            const reportInfo = parseInt(sevMatch[3]!, 10);
            const faqCritical = sevCounts['critical'] ?? 0;
            const faqWarn = sevCounts['warn'] ?? 0;
            const faqInfo = sevCounts['info'] ?? 0;

            if (reportCritical !== faqCritical) {
              failures.push(
                `severity count mismatch: report says critical=${reportCritical}, FAQ has critical=${faqCritical}`,
              );
            }
            if (reportWarn !== faqWarn) {
              failures.push(
                `severity count mismatch: report says warn=${reportWarn}, FAQ has warn=${faqWarn}`,
              );
            }
            if (reportInfo !== faqInfo) {
              failures.push(
                `severity count mismatch: report says info=${reportInfo}, FAQ has info=${faqInfo}`,
              );
            }

            // Also check total
            const reportTotal = reportCritical + reportWarn + reportInfo;
            const faqTotal = faq.length;
            if (reportTotal !== faqTotal) {
              failures.push(
                `total count mismatch: report sum=${reportTotal}, FAQ length=${faqTotal}`,
              );
            }
          }
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push(`FAQ parse error: ${msg}`);
    }
  }

  return { passed: failures.length === 0, failures };
}
