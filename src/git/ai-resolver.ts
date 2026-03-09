import { createHash } from 'node:crypto';
import type { ConflictContextBundle, FileRiskClass, Side } from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────

export interface AIResolutionResult {
  resolved: boolean;
  files: Array<{
    path: string;
    resolvedContent: string;
    rationale: string;
    confidence: number;
  }>;
  modelId: string;
  promptHash: string;
  tokenUsage?: { input: number; output: number };
}

export interface AIResolverConfig {
  /** Function to call the AI model. Accepts a prompt and returns structured response. */
  callModel: (prompt: string, systemPrompt: string) => Promise<string>;
  /** Model identifier for audit trail. */
  modelId: string;
  /** Maximum context lines around conflict hunks. */
  maxContextLines?: number;
  /** Maximum retries on validation failure. */
  maxRetries?: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// ── Prompt template ──────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are a precise merge conflict resolver. Your task is to resolve Git merge conflicts by analyzing both sides and producing the correct merged result.

RULES:
1. Output ONLY a JSON object with the resolved files. No explanations outside the JSON.
2. Only modify files that have conflicts. Do NOT touch non-conflicted files.
3. The resolution must be minimal — only resolve the conflict, do not refactor or improve code.
4. Provide a confidence score (0.0-1.0) and brief rationale for each file.
5. If you cannot confidently resolve a conflict, set resolved to false for that file.

OUTPUT FORMAT:
{
  "files": [
    {
      "path": "file/path.ts",
      "resolved": true,
      "content": "full file content with conflict resolved",
      "rationale": "brief explanation of resolution choice",
      "confidence": 0.85
    }
  ]
}`;
}

function buildUserPrompt(bundle: ConflictContextBundle): string {
  const fileDescriptions = bundle.files.map((f) => {
    const hunks = f.conflictHunks.map((h, i) => `
--- Conflict Hunk ${i + 1} ---
BASE:
${h.base}
OURS:
${h.ours}
THEIRS:
${h.theirs}
SURROUNDING CONTEXT:
${h.surrounding}
`).join('\n');

    const historyDesc = f.history.length > 0
      ? `\nPast resolutions: ${f.history.map((h) => `${h.strategy}→${h.outcome}${h.resolvedSide ? `(${h.resolvedSide})` : ''}`).join(', ')}`
      : '';

    return `
## File: ${f.path} (${f.language}, risk: ${f.riskClass})${historyDesc}
${hunks}`;
  }).join('\n');

  const constraintsDesc = bundle.constraints.length > 0
    ? `\nProject constraints:\n${bundle.constraints.map((c) => `- ${c}`).join('\n')}`
    : '';

  const failingDesc = bundle.failingChecks.length > 0
    ? `\nFailing checks:\n${bundle.failingChecks.map((c) => `- ${c}`).join('\n')}`
    : '';

  return `Resolve the following merge conflicts.

Merge metadata:
- Base SHA: ${bundle.mergeBaseSha}
- Ours SHA: ${bundle.oursSha}
- Theirs SHA: ${bundle.theirsSha}
- Queue Item: ${bundle.queueItemId}

${fileDescriptions}
${constraintsDesc}
${failingDesc}

Respond with ONLY the JSON object as specified in the system prompt.`;
}

// ── Parsing & validation ─────────────────────────────────────────────

interface ParsedResolution {
  files: Array<{
    path: string;
    resolved: boolean;
    content: string;
    rationale: string;
    confidence: number;
  }>;
}

function parseAIResponse(response: string): ParsedResolution | null {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = response.trim();
    const jsonMatch = /```(?:json)?\s*([\s\S]*?)```/.exec(jsonStr);
    if (jsonMatch) {
      jsonStr = jsonMatch[1]!.trim();
    }

    const parsed = JSON.parse(jsonStr) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;

    const obj = parsed as Record<string, unknown>;
    if (!Array.isArray(obj['files'])) return null;

    const files = (obj['files'] as Array<Record<string, unknown>>).map((f) => ({
      path: String(f['path'] ?? ''),
      resolved: Boolean(f['resolved']),
      content: String(f['content'] ?? ''),
      rationale: String(f['rationale'] ?? ''),
      confidence: Number(f['confidence'] ?? 0),
    }));

    return { files };
  } catch {
    return null;
  }
}

/**
 * Validate that AI resolution only touches allowed files and produces valid content.
 */
export function validateResolution(
  parsed: ParsedResolution,
  allowedPaths: Set<string>,
): ValidationResult {
  const errors: string[] = [];

  if (parsed.files.length === 0) {
    errors.push('Resolution contains no files');
  }

  for (const file of parsed.files) {
    if (!allowedPaths.has(file.path)) {
      errors.push(`Resolution touches non-conflicted file: ${file.path}`);
    }

    if (file.resolved && file.content.length === 0) {
      errors.push(`Empty content for resolved file: ${file.path}`);
    }

    if (file.resolved && file.content.includes('<<<<<<<')) {
      errors.push(`Unresolved conflict markers remain in: ${file.path}`);
    }

    if (file.confidence < 0 || file.confidence > 1) {
      errors.push(`Invalid confidence ${file.confidence} for: ${file.path}`);
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── AI Resolver ──────────────────────────────────────────────────────

export class AIResolver {
  private readonly config: Required<AIResolverConfig>;

  constructor(config: AIResolverConfig) {
    this.config = {
      callModel: config.callModel,
      modelId: config.modelId,
      maxContextLines: config.maxContextLines ?? 50,
      maxRetries: config.maxRetries ?? 1,
    };
  }

  /**
   * Attempt to resolve conflicts using AI.
   * Returns null if resolution fails after all retries.
   */
  async resolve(bundle: ConflictContextBundle): Promise<AIResolutionResult | null> {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(bundle);
    const promptHash = createHash('sha256')
      .update(systemPrompt + userPrompt)
      .digest('hex')
      .slice(0, 16);

    const allowedPaths = new Set(bundle.files.map((f) => f.path));
    let lastErrors: string[] = [];

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      const fullPrompt = attempt === 0
        ? userPrompt
        : `${userPrompt}\n\nPrevious attempt failed validation:\n${lastErrors.map((e) => `- ${e}`).join('\n')}\n\nPlease fix these issues.`;

      try {
        const response = await this.config.callModel(fullPrompt, systemPrompt);
        const parsed = parseAIResponse(response);

        if (!parsed) {
          lastErrors = ['Failed to parse AI response as valid JSON'];
          continue;
        }

        const validation = validateResolution(parsed, allowedPaths);
        if (!validation.valid) {
          lastErrors = validation.errors;
          continue;
        }

        // Success
        const resolvedFiles = parsed.files.filter((f) => f.resolved);
        return {
          resolved: resolvedFiles.length > 0,
          files: resolvedFiles.map((f) => ({
            path: f.path,
            resolvedContent: f.content,
            rationale: f.rationale,
            confidence: f.confidence,
          })),
          modelId: this.config.modelId,
          promptHash,
        };
      } catch (err) {
        lastErrors = [err instanceof Error ? err.message : String(err)];
      }
    }

    // All retries exhausted
    return null;
  }
}

// ── Context extraction helpers ───────────────────────────────────────

/**
 * Extract conflict hunks from a file with conflict markers.
 */
export function extractConflictHunks(
  fileContent: string,
  contextLines: number = 10,
): Array<{ base: string; ours: string; theirs: string; surrounding: string }> {
  const hunks: Array<{ base: string; ours: string; theirs: string; surrounding: string }> = [];
  const lines = fileContent.split('\n');

  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.startsWith('<<<<<<<')) {
      const startLine = i;
      let oursLines: string[] = [];
      let baseLines: string[] = [];
      let theirsLines: string[] = [];
      let section: 'ours' | 'base' | 'theirs' = 'ours';

      i++; // skip <<<<<<< marker
      while (i < lines.length) {
        if (lines[i]!.startsWith('|||||||')) {
          section = 'base';
          i++;
          continue;
        }
        if (lines[i]!.startsWith('=======')) {
          section = 'theirs';
          i++;
          continue;
        }
        if (lines[i]!.startsWith('>>>>>>>')) {
          break;
        }

        if (section === 'ours') oursLines.push(lines[i]!);
        else if (section === 'base') baseLines.push(lines[i]!);
        else theirsLines.push(lines[i]!);
        i++;
      }

      // Extract surrounding context
      const ctxStart = Math.max(0, startLine - contextLines);
      const ctxEnd = Math.min(lines.length, i + 1 + contextLines);
      const surrounding = lines.slice(ctxStart, startLine).join('\n') +
        '\n...[CONFLICT]...\n' +
        lines.slice(i + 1, ctxEnd).join('\n');

      hunks.push({
        base: baseLines.join('\n'),
        ours: oursLines.join('\n'),
        theirs: theirsLines.join('\n'),
        surrounding,
      });
    }
    i++;
  }

  return hunks;
}

/**
 * Detect the programming language from file extension.
 */
export function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
    md: 'markdown', sql: 'sql', sh: 'shell', bash: 'shell',
    css: 'css', scss: 'scss', html: 'html', xml: 'xml',
  };
  return langMap[ext] ?? 'text';
}
