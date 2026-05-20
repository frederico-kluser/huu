#!/usr/bin/env node
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncGlobalPipelines } from '../src/lib/pipeline-io.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sourceDir = join(__dirname, '..', 'pipelines');
syncGlobalPipelines(sourceDir);
console.log('Pipelines linked to global directory successfully.');
