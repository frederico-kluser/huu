#!/usr/bin/env npx tsx
/**
 * validate-ledger.ts — uncertainty ledger validator.
 *
 * Rules:
 *   1. ABERTO: pergunta, por_que_aberto, decisao_provisoria, verificacao,
 *      impacto_se_divergir must be non-empty; evidencia and data_resolucao
 *      must be empty strings.
 *   2. FECHADO: evidencia must contain a citable reference (regex) AND
 *      data_resolucao must be a valid ISO 8601 date (YYYY-MM-DD).
 *   3. Blacklist: "ok", "conferido", "conforme combinado" (case-insensitive
 *      whole-value match) are rejected as evidencia in any status.
 *   4. Anchors: every `// ABERTO HU-nnn` in src/ and scripts/ must match
 *      an existing ABERTO item in the ledger.
 *
 * Usage:
 *   npx tsx scripts/validate-ledger.ts
 *   npx tsx scripts/validate-ledger.ts --fixture fechado-sem-evidencia
 *   rg -o 'ABERTO HU-[0-9]+' -g '!.agents/ledger' src | sort -u | \
 *     npx tsx scripts/validate-ledger.ts --anchors-from -
 */

import { readFileSync, readdirSync, existsSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(join(__dirname, '..'));

// ── Types ────────────────────────────────────────────────────────────────────

interface LedgerItem {
  id: string;
  pergunta: string;
  por_que_aberto: string;
  decisao_provisoria: string;
  verificacao: string;
  impacto_se_divergir: string;
  status: 'ABERTO' | 'FECHADO' | 'INVIAVEL';
  evidencia: string;
  data_resolucao: string;
}

type ValidationError = { item: string; field: string; message: string };

// ── Constants ────────────────────────────────────────────────────────────────

const LEDGER_DIR = join(ROOT, '.agents', 'ledger', 'items');

const REQUIRED_FIELDS = [
  'id', 'pergunta', 'por_que_aberto', 'decisao_provisoria',
  'verificacao', 'impacto_se_divergir', 'status', 'evidencia', 'data_resolucao',
] as const;

const ABERTO_CONTEXT_FIELDS = [
  'pergunta', 'por_que_aberto', 'decisao_provisoria',
  'verificacao', 'impacto_se_divergir',
] as const;

const VALID_STATUSES = ['ABERTO', 'FECHADO', 'INVIAVEL'] as const;

const BLACKLIST_EVIDENCE = ['ok', 'conferido', 'conforme combinado'];

// ── Citable evidence regex ───────────────────────────────────────────────────

// Evidence must contain at least one citable reference:
//   - URL: https?://...
//   - file:line: path/to/file.ext:NNN
//   - commit hash: 7-40 hex chars bounded by word edges
//   - backtick-quoted content: `...`
const CITABLE_RE =
  /(?:https?:\/\/\S+)|(?:\S+\/\S+\.\w+:\d+)|(?:\b[a-f0-9]{7,40}\b)|(?:`[^`]+`)/;

// ISO 8601 date: YYYY-MM-DD
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Anchor pattern: // ABERTO HU-nnn
// - Captures group 1: full id (HU-nnn)
// - Captures group 2: number (nnn)
const ANCHOR_RE = /\/\/\s*ABERTO\s+(HU-\d+)/g;

// ── Helpers ──────────────────────────────────────────────────────────────────

function* walkDirs(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.huu', '.huu-worktrees'].includes(entry.name)) continue;
      yield* walkDirs(full);
    }
  }
  yield dir;
}

function isValidISODate(s: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

function loadItems(ledgerDir: string): { items: LedgerItem[]; errors: ValidationError[] } {
  const items: LedgerItem[] = [];
  const errors: ValidationError[] = [];

  if (!existsSync(ledgerDir)) {
    errors.push({ item: '(ledger)', field: 'directory', message: `${ledgerDir} does not exist` });
    return { items, errors };
  }

  const files = readdirSync(ledgerDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    errors.push({ item: '(ledger)', field: 'directory', message: `No .json items found in ${ledgerDir}` });
    return { items, errors };
  }

  for (const file of files.sort()) {
    const filePath = join(ledgerDir, file);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch (e: any) {
      errors.push({ item: file, field: 'parse', message: `Invalid JSON: ${e.message}` });
      continue;
    }

    if (typeof raw !== 'object' || raw === null) {
      errors.push({ item: file, field: 'type', message: 'Item must be a JSON object' });
      continue;
    }

    const obj = raw as Record<string, unknown>;

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
      if (!(field in obj)) {
        errors.push({ item: file, field, message: `Missing required field "${field}"` });
      }
    }

    // Check field types
    for (const field of [...REQUIRED_FIELDS]) {
      if (typeof obj[field] !== 'string') {
        if (field in obj) {
          errors.push({ item: file, field, message: `Field "${field}" must be a string, got ${typeof obj[field]}` });
        }
      }
    }

    // If basic structure is broken, skip deeper validation
    if (errors.some(e => e.item === file && ['parse', 'type'].includes(e.field))) continue;
    if (!VALID_STATUSES.includes(obj.status as any)) {
      errors.push({ item: file, field: 'status', message: `Invalid status "${obj.status}". Must be one of: ${VALID_STATUSES.join(', ')}` });
      continue;
    }

    const item = obj as unknown as LedgerItem;
    items.push(item);

    // Blacklist check on evidencia (all statuses)
    const evidenceLower = item.evidencia.trim().toLowerCase();
    for (const blacklisted of BLACKLIST_EVIDENCE) {
      if (evidenceLower === blacklisted.toLowerCase()) {
        errors.push({
          item: file,
          field: 'evidencia',
          message: `Evidence blacklisted: "${item.evidencia}". CONFIRMADO sem evidência anexada é pior que ABERTO.`,
        });
      }
    }

    // Status-specific validation
    if (item.status === 'ABERTO') {
      // Context fields must be non-empty
      for (const field of ABERTO_CONTEXT_FIELDS) {
        if (!item[field] || item[field].trim() === '') {
          errors.push({
            item: file,
            field,
            message: `Field "${field}" must be non-empty when status is ABERTO`,
          });
        }
      }
      // evidencia must be empty
      if (item.evidencia.trim() !== '') {
        errors.push({
          item: file,
          field: 'evidencia',
          message: 'evidencia must be empty when status is ABERTO',
        });
      }
      // data_resolucao must be empty
      if (item.data_resolucao.trim() !== '') {
        errors.push({
          item: file,
          field: 'data_resolucao',
          message: 'data_resolucao must be empty when status is ABERTO',
        });
      }
    }

    if (item.status === 'FECHADO') {
      // evidencia must contain a citable reference
      if (!item.evidencia.trim()) {
        errors.push({
          item: file,
          field: 'evidencia',
          message: 'evidencia must be non-empty when status is FECHADO',
        });
      } else if (!CITABLE_RE.test(item.evidencia)) {
        errors.push({
          item: file,
          field: 'evidencia',
          message: 'evidencia must contain a citable reference (URL, file:line, commit hash, or backtick-quoted content)',
        });
      }
      // data_resolucao must be valid ISO date
      if (!item.data_resolucao.trim()) {
        errors.push({
          item: file,
          field: 'data_resolucao',
          message: 'data_resolucao must be a valid ISO 8601 date (YYYY-MM-DD) when status is FECHADO',
        });
      } else if (!isValidISODate(item.data_resolucao.trim())) {
        errors.push({
          item: file,
          field: 'data_resolucao',
          message: `Invalid ISO date "${item.data_resolucao}". Expected format: YYYY-MM-DD`,
        });
      }
    }
  }

  return { items, errors };
}

function checkAnchors(
  items: LedgerItem[],
  scanDirs: string[],
  externalAnchors?: Set<string>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const itemIds = new Set(items.map(i => i.id));
  const abertoIds = new Set(items.filter(i => i.status === 'ABERTO').map(i => i.id));
  const foundAnchors = new Map<string, string>(); // id -> file where first found

  // External anchors (from stdin, e.g. rg output)
  if (externalAnchors) {
    for (const anchor of externalAnchors) {
      const m = anchor.match(/HU-\d+/);
      if (m) {
        foundAnchors.set(m[0], '(stdin)');
      }
    }
  }

  // Scan source files for anchors
  for (const dir of scanDirs) {
    const absDir = resolve(ROOT, dir);
    if (!existsSync(absDir)) continue;
    for (const scanDir of walkDirs(absDir)) {
      let entries: string[];
      try {
        entries = readdirSync(scanDir, { withFileTypes: true })
          .filter(e => e.isFile())
          .map(e => e.name);
      } catch {
        continue;
      }

      for (const entry of entries) {
        const filePath = join(scanDir, entry);
        let content: string;
        try {
          content = readFileSync(filePath, 'utf8');
        } catch {
          continue;
        }

        ANCHOR_RE.lastIndex = 0;
        let match;
        while ((match = ANCHOR_RE.exec(content)) !== null) {
          const anchorId = match[1];
          if (!foundAnchors.has(anchorId)) {
            foundAnchors.set(anchorId, relative(ROOT, filePath));
          }
        }
      }
    }
  }

  // Verify each found anchor
  for (const [anchorId, file] of foundAnchors) {
    if (!itemIds.has(anchorId)) {
      errors.push({
        item: anchorId,
        field: 'anchor',
        message: `Anchor // ABERTO ${anchorId} found in ${file} but no corresponding ledger item exists`,
      });
    } else if (!abertoIds.has(anchorId)) {
      const item = items.find(i => i.id === anchorId);
      errors.push({
        item: anchorId,
        field: 'anchor',
        message: `Anchor // ABERTO ${anchorId} found in ${file} but ledger item has status "${item?.status}" (expected ABERTO)`,
      });
    }
  }

  return errors;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function runFixture(fixtureName: string): void {
  const tmpDir = mkdtempSync('/tmp/huu-validate-ledger-fixture-');
  const itemsDir = join(tmpDir, 'items');

  try {
    mkdirSync(itemsDir, { recursive: true });
    if (fixtureName === 'fechado-sem-evidencia') {
      // Item FECHADO with empty evidencia — should fail
      writeFileSync(join(itemsDir, 'HU-001.json'), JSON.stringify({
        id: 'HU-001',
        pergunta: 'Test question?',
        por_que_aberto: 'Test reason',
        decisao_provisoria: 'Test decision',
        verificacao: 'Test verification',
        impacto_se_divergir: 'Test impact',
        status: 'FECHADO',
        evidencia: '',
        data_resolucao: '2026-07-30',
      }, null, 2), 'utf8');
    } else if (fixtureName === 'fechado-evidencia-blacklist') {
      // Item FECHADO with blacklisted evidence
      writeFileSync(join(itemsDir, 'HU-001.json'), JSON.stringify({
        id: 'HU-001',
        pergunta: 'Test question?',
        por_que_aberto: 'Test reason',
        decisao_provisoria: 'Test decision',
        verificacao: 'Test verification',
        impacto_se_divergir: 'Test impact',
        status: 'FECHADO',
        evidencia: 'ok',
        data_resolucao: '2026-07-30',
      }, null, 2), 'utf8');
    } else if (fixtureName === 'aberto-com-evidencia') {
      // Item ABERTO with non-empty evidencia — should fail
      writeFileSync(join(itemsDir, 'HU-001.json'), JSON.stringify({
        id: 'HU-001',
        pergunta: 'Test question?',
        por_que_aberto: 'Test reason',
        decisao_provisoria: 'Test decision',
        verificacao: 'Test verification',
        impacto_se_divergir: 'Test impact',
        status: 'ABERTO',
        evidencia: 'https://example.com',
        data_resolucao: '',
      }, null, 2), 'utf8');
    } else {
      console.error('Unknown fixture:', fixtureName);
      console.error('Available: fechado-sem-evidencia, fechado-evidencia-blacklist, aberto-com-evidencia');
      process.exit(1);
    }

    // Run validation against the fixture dir
    const self = fileURLToPath(import.meta.url);
    try {
      execSync(`npx tsx ${self} --ledger-dir ${itemsDir} --no-anchors`, {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      // Should NOT succeed
      console.log(`FAIL: validate-ledger accepted ${fixtureName} fixture (should have rejected)`);
      process.exit(1);
    } catch (e: any) {
      const output = (e.stdout || '') + (e.stderr || '');
      console.log(`OK: validate-ledger correctly rejected ${fixtureName} fixture`);
      if (process.env.DEBUG) console.log(output);
      process.exit(0);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // --fixture mode
  const fixtureIdx = process.argv.indexOf('--fixture');
  if (fixtureIdx >= 0) {
    const fixtureName = process.argv[fixtureIdx + 1] || '';
    if (!fixtureName) {
      console.error('Usage: validate-ledger.ts --fixture <name>');
      process.exit(1);
    }
    runFixture(fixtureName);
    return;
  }

  // --ledger-dir override (for fixtures)
  const dirIdx = process.argv.indexOf('--ledger-dir');
  const ledgerDir = dirIdx >= 0 ? resolve(process.argv[dirIdx + 1]) : LEDGER_DIR;

  // --no-anchors (for fixtures)
  const skipAnchors = process.argv.includes('--no-anchors');

  // --anchors-from <file|-> (read anchor list from file or stdin)
  const anchorsFromIdx = process.argv.indexOf('--anchors-from');
  let externalAnchors: Set<string> | undefined;
  if (anchorsFromIdx >= 0) {
    const source = process.argv[anchorsFromIdx + 1];
    if (source === '-') {
      // Read from stdin
      const lines: string[] = [];
      const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false });
      for await (const line of rl) {
        lines.push(line.trim());
      }
      externalAnchors = new Set(lines.filter(l => l.length > 0));
    } else if (source) {
      try {
        const content = readFileSync(source, 'utf8');
        externalAnchors = new Set(content.split('\n').map(l => l.trim()).filter(l => l.length > 0));
      } catch (e: any) {
        console.error(`Cannot read anchors file: ${source} — ${e.message}`);
        process.exit(1);
      }
    }
  }

  const { items, errors } = loadItems(ledgerDir);
  let exitCode = 0;

  // Print results
  const abertoCount = items.filter(i => i.status === 'ABERTO').length;
  const fechadoCount = items.filter(i => i.status === 'FECHADO').length;
  const inviavelCount = items.filter(i => i.status === 'INVIAVEL').length;

  console.log(`${items.length} items: ${abertoCount} ABERTO, ${fechadoCount} FECHADO, ${inviavelCount} INVIAVEL`);

  if (errors.length > 0) {
    console.error(`\n${errors.length} validation error(s):`);
    for (const err of errors) {
      console.error(`  ${err.item}: ${err.field} — ${err.message}`);
    }
    exitCode = 1;
  }

  // Anchor check
  if (!skipAnchors) {
    const anchorErrors = checkAnchors(items, ['src', 'scripts'], externalAnchors);
    if (anchorErrors.length > 0) {
      console.error(`\n${anchorErrors.length} anchor error(s):`);
      for (const err of anchorErrors) {
        console.error(`  ${err.item}: ${err.field} — ${err.message}`);
      }
      exitCode = 1;
    } else if (externalAnchors && externalAnchors.size > 0) {
      console.log(`\n${externalAnchors.size} anchor(s) from input: all matched`);
    }
  }

  // Summary
  if (exitCode === 0) {
    console.log('\nLedger OK');
  } else {
    console.error('\nLedger FAILED');
  }

  process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
