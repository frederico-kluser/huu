# Ink: React no terminal, do zero ao dashboard

**Ink v6 transforma seu terminal em uma superfície React completa**, com Flexbox real (via Yoga), hooks para input de teclado, e o mesmo modelo mental de componentes que você já domina. A versão mais recente é a **v6.8.0** (fevereiro 2026), que exige **Node.js ≥ 20** e **React 19**, é 100% ESM e inclui recursos como rendering concorrente, protocolo de teclado Kitty e rendering incremental. Ferramentas como Claude Code (Anthropic), Gemini CLI (Google), Cloudflare Wrangler e Prisma já rodam sobre Ink em produção. Este tutorial cobre setup, componentes, layout, hooks, ecossistema e um exemplo integrador de dashboard multi-agente — tudo com TypeScript funcional.

---

## Setup mínimo em 3 minutos com TypeScript

A forma mais rápida de começar é via `create-ink-app`, que gera a estrutura completa com `tsconfig.json`, build via `tsc`, e entry point com shebang:

```bash
npx create-ink-app --typescript meu-cli
cd meu-cli
npm install ink@latest react@latest
```

> **Atenção:** o scaffold pode instalar Ink v4. Atualize manualmente para `ink@latest` e `react@latest` no `package.json`.

A estrutura gerada é enxuta:

```
meu-cli/
├── source/
│   ├── cli.tsx    # Entry point (#!/usr/bin/env node)
│   └── app.tsx    # Componente principal
├── tsconfig.json
└── package.json   # "type": "module"
```

O **entry point** (`source/cli.tsx`) apenas chama `render`:

```tsx
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import App from './app.js'; // .js mesmo para .tsx — exigência do ESM + tsc

render(<App />);
```

O **componente raiz** (`source/app.tsx`) é React puro:

```tsx
import React, { useState, useEffect } from 'react';
import { Text, Box } from 'ink';

export default function App() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setCount(c => c + 1), 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box padding={1} borderStyle="round" borderColor="green">
      <Text color="cyan">{count}</Text>
      <Text> testes passaram</Text>
    </Box>
  );
}
```

Para rodar: `npm run build && node dist/cli.js`, ou `tsc --watch` em um terminal e `node dist/cli.js` em outro. A função `render()` retorna um objeto com **`rerender`**, **`unmount`**, **`waitUntilExit`**, **`cleanup`** e **`clear`** — o `waitUntilExit()` retorna uma Promise que resolve quando o app desmonta, útil para encadear lógica pós-execução. Opções notáveis do `render()` incluem `exitOnCtrlC` (padrão `true`), `patchConsole` (redireciona `console.log` para não quebrar o layout), **`maxFps`** (padrão 30, adicionado na v6.3), **`incrementalRendering`** (só re-renderiza linhas alteradas, v6.5) e **`concurrent`** (habilita React Concurrent Rendering com Suspense, v6.7).

---

## Box, Text, Static e Spacer: os 4 componentes que fazem tudo

Ink tem poucos componentes built-in, mas cada um cobre um papel essencial. Dominar estes quatro já permite construir interfaces completas.

### `<Text>` — o único componente que pode conter texto

Todo texto visível **precisa** estar dentro de `<Text>`. Aceita estilização via props diretas, sem CSS:

```tsx
import React from 'react';
import { Text, Box } from 'ink';

export function StatusLine() {
  return (
    <Box gap={1}>
      <Text bold color="green">✔ deploy</Text>
      <Text dimColor>concluído em</Text>
      <Text color="#ff8800" underline>3.2s</Text>
      <Text backgroundColor="red" color="white" bold> ERRO </Text>
      <Text strikethrough>tarefa cancelada</Text>
    </Box>
  );
}
```

As props de estilo são: **`color`** e **`backgroundColor`** (nomes CSS, hex, rgb), `bold`, `italic`, `underline`, `strikethrough`, `dimColor`, `inverse`. A prop **`wrap`** controla truncamento: `'wrap'` (padrão), `'truncate'`, `'truncate-start'`, `'truncate-middle'`, `'truncate-end'`.

### `<Box>` — o `div` flexbox do terminal

Toda `<Box>` é um flex container por padrão (`display: flex`). Aceita todas as props de layout Flexbox (detalhadas na próxima seção), bordas, padding, margin e gap:

```tsx
import React from 'react';
import { Box, Text } from 'ink';

export function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="blue"
      paddingX={2}
      paddingY={1}
      width={40}
    >
      <Text bold color="blue">{title}</Text>
      <Box marginTop={1}>{children}</Box>
    </Box>
  );
}
```

Estilos de borda disponíveis: `'single'`, `'double'`, `'round'`, `'bold'`, `'singleDouble'`, `'doubleSingle'`, `'classic'`. Cada lado pode ser ligado/desligado individualmente (`borderTop`, `borderBottom`, etc.) e colorido separadamente (`borderTopColor`, etc.). A partir da **v6.1**, `<Box>` aceita **`backgroundColor`** que preenche toda a área do box.

### `<Static>` — logs permanentes que não re-renderizam

`<Static>` renderiza itens de forma permanente acima do conteúdo dinâmico. Cada item é renderizado **uma única vez** — itens já exibidos nunca são re-renderizados. Ideal para logs de progresso, resultados de testes ou output de tarefas concluídas:

```tsx
import React, { useState, useEffect } from 'react';
import { Box, Text, Static } from 'ink';

interface LogEntry { id: number; message: string; timestamp: string }

export function TaskRunner() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [current, setCurrent] = useState('Inicializando...');

  useEffect(() => {
    const tasks = ['Build', 'Lint', 'Test', 'Deploy'];
    tasks.forEach((task, i) => {
      setTimeout(() => {
        setLogs(prev => [...prev, {
          id: i,
          message: `${task} concluído`,
          timestamp: new Date().toLocaleTimeString(),
        }]);
        setCurrent(tasks[i + 1] ?? 'Finalizado!');
      }, (i + 1) * 1000);
    });
  }, []);

  return (
    <Box flexDirection="column">
      <Static items={logs}>
        {(log) => (
          <Box key={log.id}>
            <Text dimColor>[{log.timestamp}]</Text>
            <Text color="green"> ✔ {log.message}</Text>
          </Box>
        )}
      </Static>
      <Box marginTop={1}>
        <Text color="yellow">⏳ {current}</Text>
      </Box>
    </Box>
  );
}
```

### `<Spacer>` — o `flex-grow: 1` como componente

`<Spacer />` expande para preencher todo o espaço disponível no eixo principal. Sem props. Perfeito para empurrar conteúdo para extremidades opostas:

```tsx
import React from 'react';
import { Box, Text, Spacer } from 'ink';

export function Header() {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text bold color="cyan">meu-cli v1.0</Text>
      <Spacer />
      <Text dimColor>Ctrl+C para sair</Text>
    </Box>
  );
}
```

Existe ainda o **`<Newline count={n}>`** (quebras de linha dentro de `<Text>`) e o **`<Transform transform={fn}>`** (transforma o texto renderizado linha a linha — ex: `output => output.toUpperCase()`).

---

## Flexbox real no terminal via Yoga engine

Ink usa o **Yoga** (motor Flexbox do Facebook/Meta, o mesmo do React Native) para calcular layout. Isso significa que toda `<Box>` se comporta exatamente como um `div` com `display: flex`. O `flexDirection` padrão é **`'row'`** (horizontal), diferente do CSS web onde `block` é o padrão.

### Layout multi-coluna com sidebar

```tsx
import React from 'react';
import { Box, Text } from 'ink';

export function DashboardLayout() {
  return (
    <Box width={80} height={24}>
      {/* Sidebar fixa */}
      <Box
        flexDirection="column"
        width={20}
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
      >
        <Text bold color="white">Navegação</Text>
        <Text color="cyan"> ▸ Agentes</Text>
        <Text dimColor> ▸ Config</Text>
        <Text dimColor> ▸ Logs</Text>
      </Box>

      {/* Conteúdo principal expande */}
      <Box flexDirection="column" flexGrow={1} paddingLeft={1}>
        <Box borderStyle="round" borderColor="green" paddingX={1} height={10}>
          <Text>Painel principal — ocupa o espaço restante</Text>
        </Box>

        {/* Dois painéis lado a lado */}
        <Box gap={1} marginTop={1}>
          <Box flexGrow={1} borderStyle="single" paddingX={1} height={8}>
            <Text color="yellow">Métricas</Text>
          </Box>
          <Box flexGrow={1} borderStyle="single" paddingX={1} height={8}>
            <Text color="magenta">Alertas</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
}
```

### Props de layout completas do `<Box>`

As unidades são **caracteres** (largura) e **linhas** (altura). Strings como `'50%'` funcionam para `width`, `height` e `flexBasis`:

```tsx
// Centralização vertical e horizontal
<Box width={60} height={20} alignItems="center" justifyContent="center">
  <Text>Centralizado no terminal</Text>
</Box>

// Grid de 3 colunas iguais
<Box width="100%">
  <Box flexBasis="33%" borderStyle="single"><Text>Col 1</Text></Box>
  <Box flexBasis="33%" borderStyle="single"><Text>Col 2</Text></Box>
  <Box flexBasis="33%" borderStyle="single"><Text>Col 3</Text></Box>
</Box>

// Column com gap entre itens
<Box flexDirection="column" gap={1}>
  <Text>Linha 1</Text>
  <Text>Linha 2</Text>
  <Text>Linha 3</Text>
</Box>
```

**`justifyContent`** aceita: `'flex-start'`, `'center'`, `'flex-end'`, `'space-between'`, `'space-around'`, `'space-evenly'`. **`alignItems`** aceita: `'flex-start'`, `'center'`, `'flex-end'`. **`overflow`** (ou `overflowX`/`overflowY`) aceita `'visible'` ou `'hidden'` — essencial para painéis de tamanho fixo onde o conteúdo pode exceder os limites. A prop `flexWrap` suporta `'wrap'` e `'wrap-reverse'` para grids responsivos.

---

## Hooks do Ink: input, lifecycle e foco

### `useInput` — captura de teclas com tipagem completa

O hook mais usado do Ink. Recebe cada keystroke como `(input: string, key: Key)`:

```tsx
import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

type Tab = 'agents' | 'logs' | 'config';

export function TabNavigator() {
  const [tab, setTab] = useState<Tab>('agents');

  useInput((input, key) => {
    if (key.leftArrow || input === 'h') {
      setTab(t => t === 'logs' ? 'agents' : t === 'config' ? 'logs' : t);
    }
    if (key.rightArrow || input === 'l') {
      setTab(t => t === 'agents' ? 'logs' : t === 'logs' ? 'config' : t);
    }
  });

  return (
    <Box flexDirection="column">
      <Box gap={2}>
        {(['agents', 'logs', 'config'] as Tab[]).map(t => (
          <Text key={t} bold={tab === t} color={tab === t ? 'cyan' : 'gray'}>
            {tab === t ? `[${t}]` : ` ${t} `}
          </Text>
        ))}
      </Box>
      <Box marginTop={1} borderStyle="round" paddingX={1}>
        <Text>{tab === 'agents' ? '🤖 Lista de agentes' : tab === 'logs' ? '📋 Logs do sistema' : '⚙️ Configurações'}</Text>
      </Box>
    </Box>
  );
}
```

O objeto `key` expõe booleans: `leftArrow`, `rightArrow`, `upArrow`, `downArrow`, `return`, `escape`, `ctrl`, `shift`, `tab`, `backspace`, `delete`, `pageUp`, `pageDown`, `home`, `end`, `meta`. O segundo parâmetro `options` aceita **`isActive`** (boolean) para desabilitar a captura condicionalmente — crucial quando múltiplos componentes disputam input.

### `useApp` — controle do lifecycle

```tsx
import React from 'react';
import { useApp, useInput, Text } from 'ink';

export function GracefulExit() {
  const { exit } = useApp();

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      exit(); // resolve waitUntilExit() com undefined
    }
    if (key.ctrl && input === 'c') {
      exit(new Error('Cancelado pelo usuário')); // rejeita waitUntilExit()
    }
  });

  return <Text dimColor>Pressione Q ou ESC para sair</Text>;
}
```

No entry point, encadeie com `waitUntilExit`:

```tsx
const instance = render(<App />);
try {
  const result = await instance.waitUntilExit();
  console.log('App encerrou com:', result);
} catch (err) {
  console.error('App falhou:', err);
  process.exit(1);
}
```

### `useFocus` e `useFocusManager` — navegação por Tab

`useFocus` torna um componente focável; `useFocusManager` permite controle programático:

```tsx
import React from 'react';
import { Box, Text, useFocus, useFocusManager } from 'ink';

function FocusablePanel({ label }: { label: string }) {
  const { isFocused } = useFocus();
  return (
    <Box
      borderStyle={isFocused ? 'bold' : 'single'}
      borderColor={isFocused ? 'cyan' : 'gray'}
      paddingX={1}
      width={25}
    >
      <Text color={isFocused ? 'cyan' : 'white'}>
        {isFocused ? '▸ ' : '  '}{label}
      </Text>
    </Box>
  );
}

export function FocusDemo() {
  const { focusNext, focusPrevious } = useFocusManager();
  // Tab e Shift+Tab já funcionam automaticamente
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>Use Tab / Shift+Tab para navegar</Text>
      <FocusablePanel label="Agente Alpha" />
      <FocusablePanel label="Agente Beta" />
      <FocusablePanel label="Agente Gamma" />
    </Box>
  );
}
```

`useFocus` aceita `{ autoFocus: boolean, isActive: boolean, id: string }`. O `useFocusManager` retorna `{ enableFocus, disableFocus, focusNext, focusPrevious, focus(id), activeId }` — o **`focus(id)`** permite focar um componente específico por ID programaticamente. Os hooks `useStdout` e `useStderr` retornam `{ stdout, write }` e `{ stderr, write }` respectivamente, permitindo escrever diretamente nos streams sem corromper o output do Ink.

---

## Componentes da comunidade e `@inkjs/ui`

Para Ink v6, a recomendação principal é **`@inkjs/ui`** — a biblioteca oficial de componentes do mesmo autor do Ink. Ela inclui Spinner, ProgressBar, Select, MultiSelect, TextInput, ConfirmInput, StatusMessage, Alert e sistema de temas. Os pacotes standalone (`ink-spinner`, `ink-text-input`, `ink-select-input`) declaram peer dependency no Ink 3.x, mas continuam funcionais em versões posteriores na prática.

### ink-spinner — indicador de carregamento animado

```bash
npm install ink-spinner
```

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';

export function LoadingTask({ task }: { task: string }) {
  return (
    <Box gap={1}>
      <Text color="green"><Spinner type="dots" /></Text>
      <Text>{task}</Text>
    </Box>
  );
}
```

A prop `type` aceita qualquer spinner de `cli-spinners` (70+ tipos): `'dots'`, `'line'`, `'star'`, `'hamburger'`, `'bouncingBar'`, etc. Alternativamente, via `@inkjs/ui`:

```tsx
import { Spinner } from '@inkjs/ui';
// <Spinner label="Processando..." />
```

### ink-text-input — campo de texto controlado

```bash
npm install ink-text-input
```

```tsx
import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

export function PromptInput() {
  const [value, setValue] = useState('');
  const [submitted, setSubmitted] = useState('');

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <Text bold color="cyan">❯ </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={val => { setSubmitted(val); setValue(''); }}
          placeholder="Digite um comando..."
        />
      </Box>
      {submitted && <Text dimColor>Último comando: {submitted}</Text>}
    </Box>
  );
}
```

Props: **`value`** (string, obrigatório), **`onChange`** (obrigatório), `onSubmit`, `placeholder`, `focus` (boolean para rotear input), `showCursor`, `mask` (para senhas, ex: `mask="*"`), `highlightPastedText`. Existe também `UncontrolledTextInput` que gerencia state internamente.

### ink-select-input — lista selecionável com teclado

```bash
npm install ink-select-input
```

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';

const models = [
  { label: 'Claude 4 Sonnet', value: 'claude-4-sonnet' },
  { label: 'Claude 4 Opus', value: 'claude-4-opus' },
  { label: 'GPT-4o', value: 'gpt-4o' },
  { label: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
];

export function ModelSelector() {
  return (
    <Box flexDirection="column">
      <Text bold>Selecione o modelo:</Text>
      <SelectInput
        items={models}
        onSelect={item => console.log(`Selecionado: ${item.value}`)}
        limit={5}
      />
    </Box>
  );
}
```

Navegação: setas ↑↓ ou `j`/`k`, Enter para selecionar, teclas numéricas 1-9 para seleção direta. Props: `items`, `onSelect`, `onHighlight`, `isFocused`, `initialIndex`, `limit` (scroll), `indicatorComponent`, `itemComponent`.

### @inkjs/ui ProgressBar — barra de progresso moderna

O antigo `ink-progress-bar` é incompatível com Ink 3+. Use `@inkjs/ui`:

```bash
npm install @inkjs/ui
```

```tsx
import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { ProgressBar } from '@inkjs/ui';

export function DownloadProgress() {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setProgress(p => (p >= 100 ? 100 : p + 2));
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return (
    <Box flexDirection="column" gap={1}>
      <Text>Baixando modelo... <Text bold color="cyan">{progress}%</Text></Text>
      <Box width={40}>
        <ProgressBar value={progress} />
      </Box>
    </Box>
  );
}
```

O `@inkjs/ui` também oferece **`<Select>`** e **`<MultiSelect>`** como alternativas modernas ao `ink-select-input`, **`<StatusMessage variant="success|error|warning|info">`**, **`<Alert>`**, **`<Badge>`**, **`<ConfirmInput>`**, **`<PasswordInput>`** e **`<EmailInput>`** — todos com suporte a temas via `<ThemeProvider>`.

---

## Mini-dashboard de orquestração de agentes

Este exemplo integra tudo: layout multi-painel, `<Static>` para logs permanentes, `useInput` para controle, `useFocus` para navegação, spinners para status, e progresso para tarefas. Cada agente é um componente React independente com seu próprio estado.

```tsx
// source/app.tsx
import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, Static, Spacer, useInput, useApp, useFocus } from 'ink';
import Spinner from 'ink-spinner';
import { ProgressBar } from '@inkjs/ui';

// ─── Tipos ───────────────────────────────────────────────
type AgentStatus = 'idle' | 'running' | 'done' | 'error';

interface LogEntry {
  id: string;
  agent: string;
  message: string;
  timestamp: string;
}

interface AgentState {
  name: string;
  status: AgentStatus;
  progress: number;
  currentTask: string;
  logs: string[];
}

// ─── Componente de cada Agente ───────────────────────────
function AgentPanel({ agent }: { agent: AgentState }) {
  const { isFocused } = useFocus();

  const statusIcon: Record<AgentStatus, React.ReactNode> = {
    idle: <Text color="gray">⏸</Text>,
    running: <Text color="green"><Spinner type="dots" /></Text>,
    done: <Text color="green">✔</Text>,
    error: <Text color="red">✖</Text>,
  };

  const statusColor: Record<AgentStatus, string> = {
    idle: 'gray', running: 'yellow', done: 'green', error: 'red',
  };

  return (
    <Box
      flexDirection="column"
      borderStyle={isFocused ? 'bold' : 'round'}
      borderColor={isFocused ? 'cyan' : statusColor[agent.status]}
      paddingX={1}
      paddingY={0}
      flexGrow={1}
      minWidth={30}
    >
      {/* Header do agente */}
      <Box>
        {statusIcon[agent.status]}
        <Text bold> {agent.name}</Text>
        <Spacer />
        <Text color={statusColor[agent.status]}>
          {agent.status.toUpperCase()}
        </Text>
      </Box>

      {/* Barra de progresso */}
      {agent.status === 'running' && (
        <Box marginTop={1} flexDirection="column">
          <Text dimColor>{agent.currentTask}</Text>
          <Box width="100%">
            <ProgressBar value={agent.progress} />
          </Box>
          <Text dimColor>{agent.progress}%</Text>
        </Box>
      )}

      {/* Últimos logs do agente */}
      <Box flexDirection="column" marginTop={1}>
        {agent.logs.slice(-3).map((log, i) => (
          <Text key={i} wrap="truncate" dimColor>
            {log}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

// ─── Hook de simulação de agentes ────────────────────────
function useAgentSimulation() {
  const [agents, setAgents] = useState<AgentState[]>([
    { name: 'Pesquisador', status: 'idle', progress: 0, currentTask: '', logs: [] },
    { name: 'Codificador', status: 'idle', progress: 0, currentTask: '', logs: [] },
    { name: 'Revisor', status: 'idle', progress: 0, currentTask: '', logs: [] },
  ]);
  const [completedLogs, setCompletedLogs] = useState<LogEntry[]>([]);

  const updateAgent = useCallback((index: number, update: Partial<AgentState>) => {
    setAgents(prev => prev.map((a, i) => i === index ? { ...a, ...update } : a));
  }, []);

  const addLog = useCallback((agentIndex: number, message: string) => {
    const agentName = ['Pesquisador', 'Codificador', 'Revisor'][agentIndex]!;
    setAgents(prev => prev.map((a, i) =>
      i === agentIndex ? { ...a, logs: [...a.logs, message] } : a
    ));
    setCompletedLogs(prev => [...prev, {
      id: `${Date.now()}-${agentIndex}`,
      agent: agentName,
      message,
      timestamp: new Date().toLocaleTimeString(),
    }]);
  }, []);

  // Simulação de progresso
  useEffect(() => {
    const tasks = [
      ['Buscando fontes...', 'Analisando papers...', 'Extraindo dados...'],
      ['Gerando código...', 'Otimizando funções...', 'Escrevendo testes...'],
      ['Revisando PR...', 'Checando tipos...', 'Validando lint...'],
    ];

    agents.forEach((agent, i) => {
      if (agent.status !== 'running') return;
      if (agent.progress >= 100) {
        updateAgent(i, { status: 'done', currentTask: 'Concluído' });
        addLog(i, '✔ Tarefa finalizada com sucesso');
        return;
      }

      const timer = setTimeout(() => {
        const taskIdx = Math.floor(agent.progress / 34);
        const currentTask = tasks[i]?.[taskIdx] ?? 'Finalizando...';
        const increment = Math.floor(Math.random() * 8) + 3;
        updateAgent(i, {
          progress: Math.min(agent.progress + increment, 100),
          currentTask,
        });
        if (Math.random() > 0.5) {
          addLog(i, currentTask);
        }
      }, 300 + Math.random() * 500);

      return () => clearTimeout(timer);
    });
  }, [agents, updateAgent, addLog]);

  const startAgent = useCallback((index: number) => {
    updateAgent(index, { status: 'running', progress: 0, currentTask: 'Iniciando...', logs: [] });
    addLog(index, '▸ Agente iniciado');
  }, [updateAgent, addLog]);

  const startAll = useCallback(() => {
    agents.forEach((_, i) => startAgent(i));
  }, [agents, startAgent]);

  return { agents, completedLogs, startAgent, startAll };
}

// ─── App Principal ───────────────────────────────────────
export default function App() {
  const { exit } = useApp();
  const { agents, completedLogs, startAll } = useAgentSimulation();
  const [started, setStarted] = useState(false);

  useInput((input, key) => {
    if (input === 'q' || key.escape) exit();
    if (input === 's' && !started) {
      setStarted(true);
      startAll();
    }
  });

  const allDone = started && agents.every(a => a.status === 'done');

  return (
    <Box flexDirection="column" padding={1}>
      {/* Logs permanentes (nunca re-renderizam) */}
      <Static items={completedLogs}>
        {(log) => (
          <Box key={log.id}>
            <Text dimColor>[{log.timestamp}]</Text>
            <Text color="blue"> [{log.agent}]</Text>
            <Text> {log.message}</Text>
          </Box>
        )}
      </Static>

      {/* Header */}
      <Box borderStyle="double" borderColor="cyan" paddingX={2} justifyContent="center">
        <Text bold color="cyan">🤖 Orquestrador de Agentes</Text>
        <Spacer />
        <Text dimColor>
          {!started ? 'Pressione S para iniciar' : allDone ? '✔ Completo!' : 'Executando...'}
        </Text>
        <Spacer />
        <Text dimColor>Q para sair | Tab para navegar</Text>
      </Box>

      {/* Painéis dos agentes lado a lado */}
      <Box marginTop={1} gap={1}>
        {agents.map((agent, i) => (
          <AgentPanel key={i} agent={agent} />
        ))}
      </Box>

      {/* Resumo */}
      <Box marginTop={1} gap={2}>
        {agents.map((a, i) => (
          <Text key={i} color={a.status === 'done' ? 'green' : a.status === 'error' ? 'red' : 'gray'}>
            {a.name}: {a.status === 'done' ? '100%' : `${a.progress}%`}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
```

```tsx
// source/cli.tsx
#!/usr/bin/env node
import React from 'react';
import { render } from 'ink';
import App from './app.js';

const instance = render(<App />, { exitOnCtrlC: true });

try {
  await instance.waitUntilExit();
  console.log('\nDashboard encerrado.');
} catch (err) {
  console.error('\nErro:', err);
  process.exit(1);
}
```

O padrão arquitetural aqui é direto: **cada agente é um componente React puro** que recebe estado via props e usa `useFocus` para interatividade. A lógica de negócio vive em um **custom hook** (`useAgentSimulation`) que gerencia o array de agentes e expõe `startAgent`/`startAll`. Os logs finalizados vão para `<Static>` e nunca são re-renderizados — o que mantém a performance mesmo com centenas de entradas. Para apps fullscreen (tipo htop), adicione o pacote `fullscreen-ink` e troque `render()` por `withFullScreen(<App />).start()`, que usa o alternate screen buffer e restaura o terminal ao sair.

---

## Conclusão

Ink v6 atingiu maturidade suficiente para ser a escolha padrão em CLIs interativas sérias — a adoção pelo Claude Code e Gemini CLI confirma isso. A chave para produtividade é tratar o terminal como uma superfície React limitada em pixels: use `<Box>` como `div` flexbox, `<Text>` como o único portador de texto, `<Static>` para output acumulativo, e `useInput` como seu event listener universal. O ecossistema `@inkjs/ui` cobre a maioria dos widgets que você precisaria construir do zero. Para dashboards de agentes, o padrão de **custom hook por domínio + componentes focáveis independentes + `<Static>` para logs** escala bem e mantém a arquitetura familiar a qualquer desenvolvedor React. O rendering incremental (v6.5) e o concurrent mode (v6.7) resolvem os gargalos de performance que existiam em versões anteriores para interfaces complexas.