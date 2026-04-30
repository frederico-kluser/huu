import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Pipeline } from './types.js';
import { PipelineSchema } from './pipeline-io.js';

const APP_DIR = '.huu';
const MEMORY_FILE = 'pipeline-memory.json';

interface MemoryEntry {
  name: string;
  pipeline: Pipeline;
  savedAt: string;
}

interface MemoryFile {
  pipelines: MemoryEntry[];
}

function getMemoryFilePath(): string {
  return join(homedir(), APP_DIR, MEMORY_FILE);
}

function ensureDir(): void {
  const dir = join(homedir(), APP_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readMemory(): MemoryFile {
  const path = getMemoryFilePath();
  if (!existsSync(path)) {
    return { pipelines: [] };
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw && typeof raw === 'object' && Array.isArray(raw.pipelines)) {
      return raw as MemoryFile;
    }
  } catch {}
  return { pipelines: [] };
}

function writeMemory(memory: MemoryFile): void {
  ensureDir();
  writeFileSync(getMemoryFilePath(), JSON.stringify(memory, null, 2), 'utf8');
}

export function savePipelineToMemory(pipeline: Pipeline): void {
  const validated = PipelineSchema.parse(pipeline);
  const memory = readMemory();
  const existingIndex = memory.pipelines.findIndex((e) => e.name === validated.name);
  const entry: MemoryEntry = {
    name: validated.name,
    pipeline: validated,
    savedAt: new Date().toISOString(),
  };
  if (existingIndex >= 0) {
    memory.pipelines[existingIndex] = entry;
  } else {
    memory.pipelines.push(entry);
  }
  writeMemory(memory);
}

export function loadPipelineFromMemory(name: string): Pipeline | null {
  const memory = readMemory();
  const entry = memory.pipelines.find((e) => e.name === name);
  return entry?.pipeline ?? null;
}

export function deletePipelineFromMemory(name: string): boolean {
  const memory = readMemory();
  const before = memory.pipelines.length;
  memory.pipelines = memory.pipelines.filter((e) => e.name !== name);
  if (memory.pipelines.length < before) {
    writeMemory(memory);
    return true;
  }
  return false;
}

export function listPipelinesInMemory(): MemoryEntry[] {
  return readMemory().pipelines;
}

export function pipelineExistsInMemory(name: string): boolean {
  return readMemory().pipelines.some((e) => e.name === name);
}
