#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import { App } from './app.js';
import { importPipeline } from './lib/pipeline-io.js';
import { stubAgentFactory } from './orchestrator/stub-agent.js';
import { realAgentFactory } from './orchestrator/real-agent.js';
import type { AgentFactory } from './orchestrator/types.js';
import type { Pipeline } from './lib/types.js';

function printUsage(): void {
  console.log(`programatic-agent — TUI de execucao guiada com kanban

Uso:
  programatic-agent                       Abre a TUI no estado inicial
  programatic-agent run <pipeline.json>   Carrega pipeline e vai direto pro seletor de modelo
  programatic-agent --stub                Forca o agent stub (sem LLM real)
  programatic-agent --help                Mostra esta ajuda

Variaveis de ambiente:
  OPENROUTER_API_KEY    Sua chave OpenRouter. Sem isso, sera pedida na TUI.
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useStub = args.includes('--stub');
  const filtered = args.filter((a) => a !== '--stub');

  if (filtered.includes('--help') || filtered.includes('-h')) {
    printUsage();
    return;
  }

  let initialPipeline: Pipeline | undefined;
  let autoStart = false;

  if (filtered[0] === 'run') {
    const path = filtered[1];
    if (!path) {
      console.error('Uso: programatic-agent run <pipeline.json>');
      process.exit(1);
    }
    try {
      initialPipeline = importPipeline(path);
      autoStart = true;
    } catch (err) {
      console.error(`Falha ao importar pipeline: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  }

  const agentFactory: AgentFactory = useStub ? stubAgentFactory : realAgentFactory;
  // Stub agents can't resolve merge conflicts; only enable the LLM resolver
  // when running with the real factory.
  const conflictResolverFactory: AgentFactory | undefined = useStub ? undefined : realAgentFactory;

  const { waitUntilExit } = render(
    <App
      initialPipeline={initialPipeline}
      agentFactory={agentFactory}
      conflictResolverFactory={conflictResolverFactory}
      requiresApiKey={!useStub}
      autoStart={autoStart}
    />,
  );
  await waitUntilExit();
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
