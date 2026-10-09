# Contribuindo ao huu

> **English version:** [CONTRIBUTING.en.md](CONTRIBUTING.en.md)

Obrigado pelo interesse em contribuir. Este documento é o mapa do terreno:
o que o huu é (e não é), como preparar o ambiente, o que a CI exige e
quais convenções são inegociáveis. Leia o [MANIFESTO.md](MANIFESTO.md)
antes de propor qualquer coisa — ele define a identidade do projeto e
qualquer contribuição que contradiga o manifesto sem declarar a
divergência será recusada.

**Resumo da identidade:** o huu desenha pipelines que fazem agentes que
*pensam* seguirem um processo *determinístico*. Ele **não** é uma
ferramenta para construir features novas aleatórias — o foco são
auditorias, geração de testes, extração de conhecimento e qualquer
montagem em linha de produção com valor real e previsível. **O método é
humano; a inteligência é do modelo.** Nenhum planner de LLM inventa
escopo.

## Escopo — o que entra aqui

Bem-vindos:

- Correções de bugs e endurecimento do gate, da CI e do isolamento.
- Novos **pipelines empacotados** (auditorias, testes, conhecimento)
  com metodologia declarada e teste no `registry.test.ts`.
- Documentação (com o gêmeo pt-BR ⇄ EN atualizado — ver abaixo).
- Backend novo (`src/orchestrator/backends/<kind>/`) — o dispatch é por
  *kind* (`jcode` | `stub` hoje), nunca por vendor.

Fora de escopo: features que transformem o huu num agente geral de
produtividade (integrações Jira/Slack, MCP, modo "faça qualquer
coisa"). Discuta em uma issue antes de escrever código — para um
projeto deste tipo, o desenho vem antes da implementação.

## Antes de começar

1. **Abra uma issue** (ou comente numa existente) descrevendo o
   problema e a abordagem — mudanças estruturais nunca chegam como
   surpresa em um PR.
2. **Vulnerabilidade de segurança?** Nunca abra issue pública — siga
   [SECURITY.md](SECURITY.md).
3. Ao contribuir você concorda com o
   [Código de Conduta](CODE_OF_CONDUCT.md).

## Ambiente de desenvolvimento

- **Node.js ≥ 20**, `git` e **Docker** (o huu é docker por padrão;
  o contêiner traz o teto de memória e o isolamento de credenciais).
- Instale as dependências: `npm install`.
- Ative os hooks locais (uma vez por clone):
  `git config core.hooksPath .githooks` — eles trazem o `pre-push`
  (typecheck + testes) e o `commit-msg` (Commits Convencionais).

| Comando | Para quê |
|---|---|
| `npm run dev` | hot reload **nativo** (`HUU_DEV_NATIVE=1`) — loop de contribuidor; imprime banner porque o isolamento está OFF |
| `npm run dev:docker` | hot reload via Docker — o ensaio fiel do que o usuário recebe |
| `npm start` | roda o CLI (reconstrói a imagem `huu:local` antes — armadilha da imagem velha) |
| `npm run build` | compila para `dist/` |
| `npm run typecheck` | só o type-check (TS + client) |
| `npm test` | suíte Vitest (milhares de casos; ~minuto) |

## O gate — a mesma régua da CI

**Rode `bash scripts/gate.sh` antes de abrir o PR.** Ele reproduz a CI
(`.github/workflows/gate.yml`) exatamente — hoje **dez passos**:
typecheck · test · validate-skills · check-acceptance · smoke-defaults ·
validate-graph · check-pins · check-twins · check-metodo ·
check-dockerfile. `bash scripts/gate.sh --list-from-ci` lê o YAML do
workflow e imprime os passos que a CI roda, para que as duas listas não
divirjam em silêncio.

O mínimo do dia a dia — e o que o hook `pre-push` roda — é
`npm run typecheck && npm test` antes de **cada** commit. A CI é
backstop, não substituto: ela só avisa depois do push.

## Commits — Commits Convencionais

Formato: `tipo(escopo)!: descrição curta` (título ≤ 100 caracteres).

- **Tipos fechados:** `feat` `fix` `docs` `style` `refactor` `perf`
  `test` `build` `ci` `chore` `revert`.
- **BREAKING CHANGE:** marque com `!` após o escopo e descreva a
  ruptura no corpo (`BREAKING CHANGE: …`).
- O corpo explica o *porquê*, não o diff. Cite as issues com `#123`.
- Títulos de PR seguem o mesmo formato — em squash merge, a mensagem
  do squash é o título do PR.

O hook `commit-msg` rejeita mensagens fora do formato (e o `pre-push`
rejeita push sem a régua local verde). É o mesmo mecanismo em qualquer
clone, sem depender da CI.

## Branches, PRs e merge

- `main` é o trunk. **Nunca force-push em `main`.**
- Branch efémera (`feat/…`, `fix/…`, `docs/…`) → PR contra `main` →
  merge. O ruleset `pull-request-rule` do repositório exige **1
  aprovação** e revisão do CODEOWNER; os métodos de merge aceites são
  merge, squash e rebase.
- Use o template de PR (`.github/PULL_REQUEST_TEMPLATE.md`): o
  checklist é obrigatório e a pergunta *"se esta mudança desaparecer,
  o que fica vermelho?"* precisa de uma resposta honesta — se a
  resposta for "nada", o PR precisa de um teste ou de um gate.
- Histórico linear e mensagens convencionais valem mais que detalhes
  de implementação no diff — revise o commit, não só o código.

## Documentação em dois idiomas (gêmeos pt-BR ⇄ EN)

Todo documento de usuário existe em par: `README.md` ↔ `README.en.md`,
`MANIFESTO.md` ↔ `MANIFESTO.en.md`, `CONTRIBUTING.md` ↔
`CONTRIBUTING.en.md`, `SECURITY.md` ↔ `SECURITY.en.md`,
`CODE_OF_CONDUCT.md` ↔ `CODE_OF_CONDUCT.en.md`, e em `docs/` os pares
`X.md` ↔ `X.pt-BR.md` (inglês no nome canônico). **Mudou um, muda o
outro**, com os mesmos cabeçalhos `##` na mesma ordem — o gate
`check-twins` (`scripts/check-twins.ts`) falha na divergência. A
convenção de cor, magenta reservado a UI dirigida por IA e afins está
no README ("Visual conventions") e em `src/ui/theme.ts`.

## Conhecimento do projeto — memória CoALA

O conhecimento durável do projeto vive na memória CoALA
(`.agents/huu-coala-memory-agent-skill/`). Não há biblioteca de skills
no repositório — o gate `validate-skills` **falha** num `SKILL.md`,
`catalog.md`, `LEARNINGS.md` ou `agent-skills.md` solto.

- Antes de implementar: `python3 .agents/huu-coala-memory-agent-skill/scripts/coala.py recall "<tarefa>" --budget 1500`.
- No fim, registue o que for durável e verificado:
  `… add --type episodic|semantic|procedural --content "…" [--key <assunto>]`.
- Factos que mudam são **suplantados** (`--key`/`supersede`), nunca
  reescritos. Nunca guarde segredos na memória.

## Changelog — fragmentos em `.changes/`

O `CHANGELOG.md` segue Keep a Changelog e é consolidado a partir de
fragmentos: escreva um `.changes/<card>.md` com seções `### Added` /
`### Changed` / `### Fixed` / `### Removed` em vez de editar
`[Unreleased]` diretamente (evita conflito entre worktrees paralelas).
Valide com `npx tsx scripts/changelog.ts --check`; o mantenedor
consolida no release (`npx tsx scripts/changelog.ts`).

Releases são cortados pelo mantenedor: versão SemVer + CHANGELOG +
tag anotada + publicação em npm (`huu-pipe`) e GHCR. Não existem
GitHub Release objects — a tag é o release.

## Segurança e vulnerabilidades

Relatos de vulnerabilidade seguem [SECURITY.md](SECURITY.md):
**nunca** em issue pública, nunca com chaves ou credenciais no texto.
O huu lida com chaves de API de terceiros em runtime — trate qualquer
vazamento potencial como incidente.

## Licença das contribuições

O `huu` (o runner) é **Apache License 2.0** — veja [LICENSE](LICENSE).
Ao enviar uma contribuição você a licencia sob a mesma licença.
**Pipelines não são o runner**: o formato `huu-pipeline-v1` é uma
especificação aberta, e pipelines que você escreve são seus — a
convenção do cookbook é MIT ou CC0.
