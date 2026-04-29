# F14 · Prometheus / OpenTelemetry

> **Tier:** 2 (Professional) · **Esforço:** 3 dias
> **Dependências:** F12 (hooks/event bus exposed).

## Project Paths

- **`huu`:** `/home/ondokai/Projects/huu.worktrees/ai-task-1777469117`
- **Bernstein:** `/home/ondokai/Projects/bernstein`

## Context

Equipes que rodam `huu` em produção (CI, daemon mode F10) querem
métricas no Grafana, traces no Jaeger. Esta feature adiciona
exporter Prometheus + OTel sem custo se desabilitado.

## Current state in `huu`

- Logs only. Sem `/metrics`, sem traces.

## Bernstein reference

- `/home/ondokai/Projects/bernstein/` — dependencies incluem
  `prometheus-client` e `opentelemetry-exporter-otlp` (presumido).
- Métricas concretas não totalmente catalogadas; vamos definir as nossas.

## Dependencies (DAG)

- **F12** — telemetry é subscriber do event bus / hooks system.

## What to build

### New files

| Path | Purpose |
|---|---|
| `src/telemetry/metrics.ts` | Prometheus metric registry. |
| `src/telemetry/otel.ts` | OTel SDK setup. |
| `src/telemetry/server.ts` | `/metrics` HTTP endpoint. |
| `dashboards/grafana-huu.json` | Dashboard sample shipping. |

### Métricas mínimas

```typescript
// src/telemetry/metrics.ts
import { Counter, Histogram, Gauge, register } from 'prom-client';

export const runTotal = new Counter({
  name: 'huu_run_total',
  help: 'Total runs',
  labelNames: ['status'] as const,
});

export const taskDuration = new Histogram({
  name: 'huu_task_duration_seconds',
  help: 'Per-task duration',
  labelNames: ['step', 'model'] as const,
  buckets: [1, 5, 15, 30, 60, 120, 300, 600],
});

export const tokensTotal = new Counter({
  name: 'huu_tokens_total',
  help: 'Total tokens by direction',
  labelNames: ['direction', 'model'] as const,
});

export const costTotal = new Counter({
  name: 'huu_cost_usd_total',
  help: 'Total USD cost',
  labelNames: ['model'] as const,
});

export const gateFailures = new Counter({
  name: 'huu_gate_failures_total',
  help: 'Quality gate failures',
  labelNames: ['gate'] as const,
});

export const concurrency = new Gauge({
  name: 'huu_concurrency',
  help: 'Current parallel agent count',
});

export { register };
```

### Subscriber do event bus

```typescript
// src/telemetry/index.ts
import type { EventBus } from '../orchestrator/event-bus.js';
import { runTotal, taskDuration, tokensTotal, costTotal, gateFailures, concurrency } from './metrics.js';

export function attachTelemetry(bus: EventBus): () => void {
  let agentStartTimes = new Map<number, number>();
  let activeAgents = 0;

  const offs = [
    bus.on('agent_spawned', (e) => {
      agentStartTimes.set(e.agentId, e.ts);
      activeAgents++;
      concurrency.set(activeAgents);
    }),
    bus.on('agent_finished', (e) => {
      const start = agentStartTimes.get(e.agentId);
      if (start) {
        taskDuration.observe({ step: 'unknown', model: 'unknown' }, (e.ts - start) / 1000);
      }
      tokensTotal.inc({ direction: 'in', model: 'unknown' }, e.tokensIn);
      tokensTotal.inc({ direction: 'out', model: 'unknown' }, e.tokensOut);
      costTotal.inc({ model: 'unknown' }, e.costUsd);
      activeAgents--;
      concurrency.set(activeAgents);
    }),
    bus.on('gate_finished', (e) => {
      if (!e.passed) gateFailures.inc({ gate: e.gateName });
    }),
    bus.on('run_finished', (e) => {
      runTotal.inc({ status: e.status });
    }),
  ];
  return () => offs.forEach((f) => f());
}
```

### `/metrics` HTTP endpoint

```typescript
// src/telemetry/server.ts
import { createServer } from 'node:http';
import { register } from './metrics.js';

export function startMetricsServer(port: number): void {
  const server = createServer(async (req, res) => {
    if (req.url === '/metrics' && req.method === 'GET') {
      res.setHeader('Content-Type', register.contentType);
      res.end(await register.metrics());
    } else {
      res.statusCode = 404;
      res.end('Not Found');
    }
  });
  server.listen(port, '127.0.0.1');
}
```

### OTel sketch

```typescript
// src/telemetry/otel.ts
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

let sdk: NodeSDK | null = null;

export function startOtel(otlpUrl: string): void {
  sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: otlpUrl }),
  });
  sdk.start();
}

export async function shutdownOtel(): Promise<void> {
  await sdk?.shutdown();
}
```

### Wire into orchestrator

```typescript
// src/orchestrator/index.ts
import { attachTelemetry } from '../telemetry/index.js';
import { startMetricsServer } from '../telemetry/server.js';

if (opts.metricsPort) {
  startMetricsServer(opts.metricsPort);
  const offTelemetry = attachTelemetry(this.bus);
  // remember to call off on shutdown
}
```

### CLI flag

`huu run --metrics-port 9091 pipeline.json` exposes `:9091/metrics`.
`huu run --otel-endpoint https://otlp.host.com pipeline.json` enables OTel.

## Libraries

- `prom-client@^15.x` — Prometheus metrics.
- `@opentelemetry/sdk-node@^0.x` + `@opentelemetry/exporter-trace-otlp-http`
  (verificar versões compatíveis).

## Tests

```typescript
import { describe, it, expect } from 'vitest';
import { register, runTotal } from './metrics.js';

describe('metrics', () => {
  it('exposes huu_run_total', async () => {
    runTotal.inc({ status: 'done' });
    const out = await register.metrics();
    expect(out).toMatch(/huu_run_total\{status="done"\} \d+/);
  });
});
```

## Acceptance criteria

- [ ] `huu run --metrics-port 9091` exposes Prometheus scrape.
- [ ] Métricas: `huu_run_total`, `huu_task_duration_seconds`, `huu_tokens_total`, `huu_cost_usd_total`, `huu_gate_failures_total`, `huu_concurrency`.
- [ ] OTel via `--otel-endpoint`.
- [ ] Sample Grafana dashboard funcionando.
- [ ] Default off (precisa flag explícita).

## Out of scope

- ❌ Push gateway (sempre pull).
- ❌ Auth no `/metrics` (bind 127.0.0.1 basta).
- ❌ Custom metrics user-defined (post-MVP).

## Risk register

| Risco | Mitigação |
|---|---|
| Cardinality explosion (model labels) | Cap distinct models; replace com "other" se >50. |
| OTel deps são pesadas | Lazy import; só carrega se `--otel-endpoint`. |

## Estimated effort

3 dias.

## After this task is merged

`huu` plugável em stack observability existente (Prom/Grafana/Jaeger).
