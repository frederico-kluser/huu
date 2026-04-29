import React from 'react';
import { render } from 'ink';
import { RunDashboard } from '../src/ui/components/RunDashboard.js';
import { stubAgentFactory } from '../src/orchestrator/stub-agent.js';
import type { Pipeline } from '../src/lib/types.js';

const pipeline: Pipeline = {
  name: 'demo',
  steps: [
    { name: 'stage1', prompt: 'process $file', files: ['src/a.ts', 'src/b.ts'] },
    { name: 'stage2', prompt: 'free run', files: [] },
  ],
};

render(
  <RunDashboard
    config={{ apiKey: 'stub', modelId: 'stub/demo-model' }}
    pipeline={pipeline}
    cwd={process.cwd()}
    agentFactory={stubAgentFactory}
    onComplete={(result) => {
      console.log('\n[SMOKE] finished:', result.manifest.status, 'in', result.duration, 'ms');
      console.log('[SMOKE] branch:', result.manifest.integrationBranch);
      console.log('[SMOKE] commits:', result.agents.filter((a) => a.commitSha).length);
      setTimeout(() => process.exit(0), 200);
    }}
    onAbort={() => process.exit(1)}
  />,
);
