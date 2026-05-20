/**
 * Pre-flight reconnaissance catalog. Every "process" is a focused mission a
 * single agent can run against a static project digest, returning ≤6 short
 * bullets. The catalog is what the SELECTOR LLM picks from when deciding
 * which processes to fire for a given user intent — the model can either
 * cite a catalog id or request a fully custom mission via {title, prompt}.
 *
 * Each entry has:
 *   - id          stable key (used for matching + UI keying)
 *   - label       user-facing string in the recon UI
 *   - description one-liner shown to the selector LLM (drives its picks)
 *   - mission     verbatim body injected into the agent's system prompt
 *
 * Missions all follow the same contract: "OLHE APENAS <bloco>" so each
 * agent stays in its lane and doesn't redo what another covers.
 */

export type ReconCatalogId =
  | 'stack'
  | 'structure'
  | 'libraries'
  | 'conventions'
  | 'entry-points'
  | 'test-strategy'
  | 'build-deploy'
  | 'domain-model'
  | 'external-integrations'
  | 'ui-surface'
  | 'cli-surface'
  | 'auth-security'
  | 'git-workflow'
  | 'quality-tooling'
  | 'pain-points';

export interface ReconCatalogEntry {
  id: ReconCatalogId;
  /** User-facing label rendered next to the spinner in the recon screen. */
  label: string;
  /** One-liner shown to the selector LLM so it knows what each process covers. */
  description: string;
  /** Mission statement injected verbatim into the agent's system prompt. */
  mission: string;
}

/** Uniform shape for a runnable recon mission — catalog entry OR custom item. */
export interface ReconRunItem {
  /** Stable tag for UI state keying. Catalog items use their id; customs use `custom:<n>`. */
  tag: string;
  /** UI display label. */
  label: string;
  /** Mission body for the agent's system prompt. */
  mission: string;
  /** Where this item came from. */
  source: 'catalog' | 'custom';
}

export const RECON_CATALOG: readonly ReconCatalogEntry[] = [
  {
    id: 'stack',
    label: 'Stack & ferramentas',
    description:
      'Linguagem primária, runtime alvo, package manager e scripts npm/yarn disponíveis.',
    mission:
      'OLHE APENAS o bloco `package.json` e `tsconfig.json` do digest. Liste: linguagem primária, runtime alvo, gerenciador de pacote, e os scripts disponíveis (nomes literais, p.ex. `npm run build`). NÃO infira nada do file tree nem de código-fonte. Se um item não estiver nos blocos citados, não invente.',
  },
  {
    id: 'structure',
    label: 'Estrutura & módulos',
    description:
      'Diretórios top-level de src/ e camadas arquiteturais documentadas.',
    mission:
      'OLHE APENAS o `## File tree` do digest e liste os diretórios TOP-LEVEL de `src/` (1 nível, não recurse). Se README/CLAUDE.md mencionar arquitetura em camadas explicitamente, cite UMA frase. NÃO descreva o conteúdo de cada módulo, NÃO infira responsabilidades a partir de nomes.',
  },
  {
    id: 'libraries',
    label: 'Bibliotecas-chave',
    description:
      'Bibliotecas runtime principais (de package.json dependencies) e seus papéis.',
    mission:
      'OLHE APENAS o objeto `dependencies` do bloco `package.json` (IGNORE `devDependencies`, IGNORE node_modules, IGNORE imports do source). Liste as 4-6 deps mais óbvias e atribua um papel curto (≤8 palavras) baseado APENAS no nome conhecido do pacote. Se não reconhece uma dep, escreva o nome com "uso não inferido".',
  },
  {
    id: 'conventions',
    label: 'Convenções & padrões',
    description:
      'Regras explícitas de commit, testes, lint e processos documentados em README/CLAUDE.md/AGENTS.md.',
    mission:
      'OLHE APENAS os blocos `README.md`, `CLAUDE.md` e `AGENTS.md` do digest. Extraia regras EXPLÍCITAS já escritas (commit, testes, agents docs, lint). Cite frases curtas literais quando possível. NÃO leia código, NÃO infira convenções a partir de nomes de arquivos.',
  },
  {
    id: 'entry-points',
    label: 'Entry points',
    description:
      'Bin, main, exports do package.json + arquivos cli/index/app na raiz de src/.',
    mission:
      'OLHE APENAS os campos `bin`, `main`, `module`, `exports` do `package.json` E o `## File tree` para arquivos como `cli.*`, `index.*`, `app.*` na raiz de `src/`. Liste cada entry point e o caminho relativo. Se nenhum entry point estiver explícito, retorne UM bullet "sem entry point declarado em package.json/file tree".',
  },
  {
    id: 'test-strategy',
    label: 'Estratégia de testes',
    description:
      'Framework de testes, localização (co-localizada vs separada) e comando de execução.',
    mission:
      'OLHE APENAS o `package.json` (devDependencies para frameworks como `vitest`, `jest`, `mocha`, `playwright`, `cypress` + scripts cujo nome contenha `test`) E o `## File tree` para padrões `*.test.*`, `*.spec.*`, `tests/`, `__tests__/`. Indique: framework usado, localização (co-localizado vs diretório separado), e o comando de execução literal. NÃO leia código de teste.',
  },
  {
    id: 'build-deploy',
    label: 'Build & deploy',
    description:
      'Scripts e procedimentos de build, release e deploy (incluindo Docker quando presente).',
    mission:
      'OLHE APENAS os scripts do `package.json` cujo nome contenha `build`, `release`, `deploy`, `bundle`, `dist`, `compile` E os blocos `README.md`/`CLAUDE.md` para instruções de release/deploy. Cite scripts e procedimentos LITERAIS. Mencione `Dockerfile`, `compose.yaml` ou similares APENAS se aparecerem no file tree. NÃO infira pipelines de CI a partir de nomes de arquivo isolados.',
  },
  {
    id: 'domain-model',
    label: 'Modelo de domínio',
    description:
      'Tipos, entidades e contratos centrais (contracts/, models/, types/, domain/, entities/).',
    mission:
      'OLHE APENAS o `## File tree` para diretórios `contracts/`, `models/`, `types/`, `domain/`, `entities/`, `schema*` dentro de `src/` e liste os arquivos visíveis (1 bullet por diretório com até 3 arquivos cada). Se nenhum desses diretórios existir, retorne UM bullet "sem diretório de domínio dedicado em src/". NÃO leia código-fonte, NÃO invente entidades.',
  },
  {
    id: 'external-integrations',
    label: 'Integrações externas',
    description:
      'SDKs e clients de serviços externos: APIs HTTP, DBs, message brokers, LLMs.',
    mission:
      'OLHE APENAS o `dependencies` do `package.json` para SDKs de APIs (axios, got, ofetch, openai, anthropic, langchain, stripe, twilio, etc.), bancos (pg, mysql2, mongodb, redis, sqlite), brokers (kafka, amqplib, nats), ou storage (aws-sdk, @google-cloud/*) E menções EXPLÍCITAS em README/CLAUDE.md a serviços externos. Liste cada integração em UM bullet (nome + papel). Se nada for evidente, retorne UM bullet "sem integrações externas detectadas".',
  },
  {
    id: 'ui-surface',
    label: 'Superfície UI',
    description:
      'Framework UI (web ou TUI), diretórios de componentes/screens e padrão de roteamento.',
    mission:
      'OLHE APENAS o `dependencies` para frameworks UI (`react`, `vue`, `svelte`, `solid-js`, `ink`, `htmx`, `next`, `nuxt`, `astro`, `remix`) E o `## File tree` para diretórios `ui/`, `components/`, `screens/`, `views/`, `pages/`, `routes/` em `src/`. Liste o framework detectado, top-level UI dirs visíveis, e padrão de roteamento se evidente. Se o projeto não tiver UI aparente, retorne UM bullet "sem framework de UI detectado".',
  },
  {
    id: 'cli-surface',
    label: 'Superfície CLI',
    description:
      'Comandos, flags e subcomandos da CLI (se o projeto for uma CLI).',
    mission:
      'OLHE APENAS o campo `bin` do `package.json` E o `dependencies` para libs de CLI (`commander`, `yargs`, `oclif`, `meow`, `cac`, `ink`) E qualquer bloco em README.md descrevendo flags/subcomandos. Liste comandos top-level e principais flags COM citação literal quando possível. Se o projeto não for CLI, retorne UM bullet "sem evidência clara em package.json bin/deps".',
  },
  {
    id: 'auth-security',
    label: 'Auth & secrets',
    description:
      'Auth, gerenciamento de secrets e tratamento de credenciais.',
    mission:
      'OLHE APENAS o `dependencies` para libs de auth (`jsonwebtoken`, `passport*`, `oauth*`, `bcrypt*`, `argon2`, `firebase-auth`, `next-auth`, `lucia`) E menções EXPLÍCITAS em README/CLAUDE.md a credenciais, secrets, API keys, ou variáveis de ambiente sensíveis. Liste pistas concretas em até 4 bullets. Se nada for evidente, retorne UM bullet "sem evidência clara em deps/docs".',
  },
  {
    id: 'git-workflow',
    label: 'Workflow git',
    description:
      'Regras de git documentadas: branch naming, commit style, hooks, tag policy.',
    mission:
      'OLHE APENAS os blocos `README.md`, `CLAUDE.md`, `AGENTS.md` para regras EXPLÍCITAS de git: branch naming, commit style (Conventional Commits etc.), hooks (`.githooks`, husky), tag policy, force-push rules, release flow. Cite frases literais quando possível. NÃO infira regras a partir do file tree.',
  },
  {
    id: 'quality-tooling',
    label: 'Qualidade & tooling',
    description:
      'Linting, formatting, type-checking, hooks e CI/CD.',
    mission:
      'OLHE APENAS o `package.json` para devDependencies de qualidade (`eslint*`, `prettier`, `biome`, `typescript`, `husky`, `lint-staged`) e scripts cujo nome contenha `lint`, `format`, `typecheck`, `check`. Mencione CI APENAS se README/CLAUDE.md citar explicitamente. Liste tooling + comando literal de cada um.',
  },
  {
    id: 'pain-points',
    label: 'Pontos de atenção',
    description:
      'Limitações conhecidas, TODOs, roadmap de melhorias e dívida técnica documentada.',
    mission:
      'OLHE APENAS o `## File tree` para arquivos como `TODO.md`, `ROADMAP.md`, `*roadmap*`, `hardening*`, `CHANGELOG.md` E qualquer bloco `README.md`/`CLAUDE.md` com seções "limitações", "TODO", "futuras melhorias", "known issues". Liste pistas concretas (nome do arquivo OU citação curta). Se nada for evidente, retorne UM bullet "sem pontos de atenção documentados".',
  },
];

/** @deprecated kept for backwards compatibility — prefer `RECON_CATALOG`. */
export const RECON_AGENTS = RECON_CATALOG;
/** @deprecated alias of `ReconCatalogEntry`. */
export type ReconAgent = ReconCatalogEntry;
/** @deprecated alias of `ReconCatalogId`. */
export type ReconAgentId = ReconCatalogId;

/**
 * Builds the system prompt fed to a single recon agent. Works for both
 * catalog entries (where `id` is a stable key) and custom items (where `id`
 * is the synthesized tag, e.g. "custom:0"). The mission body is the only
 * content that varies between agents — everything else (output format,
 * language, guardrails) stays constant.
 */
export function buildReconSystemPrompt(
  item: { id?: string; tag?: string; mission: string },
  projectName?: string,
): string {
  const projectRef = projectName ? ` "${projectName}"` : '';
  const idForHeader = item.id ?? item.tag ?? 'recon';
  return `Você é um agente de reconhecimento RÁPIDO chamado "${idForHeader}". Sua única missão:

${item.mission}

Modo de operação: VARREDURA FOCADA. Você recebe a seguir UM digest pronto do projeto${projectRef} (file tree truncado, package.json, README, CLAUDE.md, AGENTS.md, tsconfig). NÃO há ferramentas, NÃO há sistema de arquivos, NÃO há node_modules para explorar — o digest é tudo o que existe e tudo o que você precisa. Pense brevemente, mas vá direto ao ponto.

# Como trabalhar

- Leia com atenção os blocos citados na sua missão e extraia fatos verificáveis. Pode raciocinar internamente, mas seja conciso na saída.
- Use APENAS os blocos citados na missão. Os demais blocos do digest existem como contexto, mas não embase bullets neles.
- Se realmente não houver evidência clara para a missão, escreva UM bullet "sem evidência clara em <bloco>" e pare — não invente.
- Português brasileiro, direto. Sem adjetivos vazios ("robusto", "moderno", "completo").

# Formato de saída (obrigatório)

Retorne JSON estruturado:
{
  "bullets": [
    "<bullet 1 — fato concreto, ≤ 220 chars>",
    "<bullet 2 — fato concreto, ≤ 220 chars>",
    ...
  ]
}

# Regras

- Mínimo 2, máximo 6 bullets.
- Cada bullet ≤ 220 caracteres.
- Cada bullet é um FATO citável — script, dep, dir top-level, frase do doc. Sem opinião, sem síntese vazia, sem "provavelmente".
- NÃO repita o texto da missão como bullet.
- NÃO faça suposições sobre o que o usuário quer fazer — só liste o que existe no digest.
- NÃO adicione preâmbulo, NÃO adicione comentários fora do JSON, NÃO peça mais contexto.`;
}
