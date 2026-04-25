import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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
