import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { Pipeline } from './types.js';

const PromptStepSchema = z.object({
  name: z.string().min(1),
  prompt: z.string(),
  files: z.array(z.string()).default([]),
  modelId: z.string().min(1).optional(),
});

const PipelineSchema = z.object({
  name: z.string().min(1),
  steps: z.array(PromptStepSchema).min(1),
  cardTimeoutMs: z.number().int().positive().optional(),
  singleFileCardTimeoutMs: z.number().int().positive().optional(),
  maxRetries: z.number().int().min(0).max(3).optional(),
});

const FORMAT_TAG = 'huu-pipeline-v1';
const LEGACY_FORMAT_TAG = 'programatic-agent-pipeline-v1';

const PipelineFileSchema = z.union([
  z.object({
    _format: z.union([z.literal(FORMAT_TAG), z.literal(LEGACY_FORMAT_TAG)]),
    exportedAt: z.string().optional(),
    pipeline: PipelineSchema,
  }),
  PipelineSchema,
]);

export function exportPipeline(pipeline: Pipeline, filePath: string): void {
  const validated = PipelineSchema.parse(pipeline);
  const payload = {
    _format: FORMAT_TAG,
    exportedAt: new Date().toISOString(),
    pipeline: validated,
  };
  writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

export function importPipeline(filePath: string): Pipeline {
  if (!existsSync(filePath)) throw new Error(`Arquivo nao encontrado: ${filePath}`);
  const raw = JSON.parse(readFileSync(filePath, 'utf8'));
  const parsed = PipelineFileSchema.parse(raw);
  if ('pipeline' in parsed) return parsed.pipeline;
  return parsed;
}

export interface PipelineEntry {
  fileName: string;
  filePath: string;
  pipeline: Pipeline;
  source: 'local' | 'global';
}

export function listPipelines(dir: string, source: 'local' | 'global' = 'local'): PipelineEntry[] {
  if (!existsSync(dir)) return [];
  const stat = statSync(dir);
  if (!stat.isDirectory()) return [];

  const entries = readdirSync(dir);
  const results: PipelineEntry[] = [];

  for (const entry of entries) {
    if (!entry.endsWith('.pipeline.json')) continue;
    const filePath = `${dir}/${entry}`;
    const fileStat = statSync(filePath);
    if (!fileStat.isFile()) continue;
    try {
      const pipeline = importPipeline(filePath);
      results.push({ fileName: entry, filePath, pipeline, source });
    } catch {}
  }

  return results.sort((a, b) => a.fileName.localeCompare(b.fileName));
}

const APP_DIR = '.huu';
const GLOBAL_PIPELINES_DIR = 'pipelines';

export function getGlobalPipelinesDir(): string {
  return join(homedir(), APP_DIR, GLOBAL_PIPELINES_DIR);
}

export function listGlobalPipelines(): PipelineEntry[] {
  return listPipelines(getGlobalPipelinesDir(), 'global');
}

export function listAllPipelines(localDir: string): PipelineEntry[] {
  const local = listPipelines(localDir, 'local');
  const global = listGlobalPipelines();
  const seen = new Set<string>();
  const results: PipelineEntry[] = [];
  for (const entry of [...local, ...global]) {
    if (seen.has(entry.pipeline.name)) continue;
    seen.add(entry.pipeline.name);
    results.push(entry);
  }
  return results;
}

export function syncGlobalPipelines(sourceDir: string): void {
  const targetDir = getGlobalPipelinesDir();
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }
  const entries = listPipelines(sourceDir, 'local');
  for (const entry of entries) {
    const targetPath = join(targetDir, basename(entry.filePath));
    copyFileSync(entry.filePath, targetPath);
  }
}
