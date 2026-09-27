### Added

- **Memória CoALA/SQLite local do projeto** (`.agents/huu-coala-memory-agent-skill/`) — a memória durável do huu passou a viver numa base CoALA por projeto: registos episódicos (decisões e eventos datados), semânticos (factos e material ingerido) e procedimentais (como se faz aqui), com working memory orçamentada (`recall --budget`), busca híbrida FTS5+vetor fundida por RRF, proveniência (`owner` > `agent` > `untrusted`) e supersessão de factos por `--key`. O material do projeto (`MANIFESTO.md`, `METODO.md`, `AGENTS.md`, `README.md`, `docs/**`) é ingerido de forma idempotente via `ingest.json`, e o ciclo de desenvolvimento passou a ser orientar (`recall`) → recuperar → agir → aprender (`add`).

### Changed

- **A memória interna foi migrada e centralizada no CoALA (2026-09-27).** Os **304 aprendizados** dos 22 `LEARNINGS.md` por skill foram migrados para a base — com data, proveniência, task e estado originais (`promoted` → `semantic`; `probation`/`superseded` → `episodic`) — mais um registo-ARQUIVO por ficheiro com o conteúdo integral: zero perda. O passo `<evolution>` das task skills tornou-se `<aprender>` (`coala.py add`), o `project-router` orienta-se no CoALA no início de cada tarefa, e o `METODO.md` §8 regista o override com data.
- **`scripts/validate-skills.sh` (ex-`meta-skill-consolidate/scripts/`) passou a ser o gate mecânico da biblioteca em `scripts/`**, ligado ao `scripts/gate.sh`: além das checagens estruturais, de TTL e de liveness de backends removidos, agora **falha se um `LEARNINGS.md` reaparecer** em `.agents/skills/` ou se o projeto não tiver a skill de memória CoALA — a memória não volta a bifurcar-se em N ficheiros. Os testes (`src/lib/skills-library.test.ts`) e as mutations (`scripts/selfcheck/mutations/`) seguem o caminho novo.

### Removed

- **Skills de memória `meta-skill-consolidate` e `meta-skill-evolution`** (e o template de skill que a segunda carregava): a consolidação/evolução de aprendizados é agora o ciclo CoALA (supersessão por `--key`, nunca reescrita), e skills novas propõem-se à mão como diff não commitado para revisão humana.
- **Os 22 `LEARNINGS.md` por skill** (conteúdo migrado para o CoALA) e o `check-pending-evolution.sh` (sentinela do antigo passo `<evolution>` — a proposta em `.agents/workbench/stop-hook-proposal.md` fica marcada como superada).