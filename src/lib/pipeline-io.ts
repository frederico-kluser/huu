import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { z } from 'zod';
import type { Pipeline } from './types.js';

const PromptStepSchema = z.object({
  name: z.string().min(1),
  prompt: z.string(),
  files: z.array(z.string()).default([]),
});

const PipelineSchema = z.object({
  name: z.string().min(1),
  steps: z.array(PromptStepSchema).min(1),
});

const FORMAT_TAG = 'programatic-agent-pipeline-v1';

const PipelineFileSchema = z.union([
  z.object({
    _format: z.literal(FORMAT_TAG),
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
}

export function listPipelines(dir: string): PipelineEntry[] {
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
      results.push({ fileName: entry, filePath, pipeline });
    } catch {}
  }

  return results.sort((a, b) => a.fileName.localeCompare(b.fileName));
}
