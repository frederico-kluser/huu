### Changed

- **A biblioteca de skills migra para a memória CoALA e é apagada.**
  `project-router` + 19 `SKILL.md` + `catalog.md` + `agent-skills.md` passaram
  a 22 registos `skill/<name>` na base CoALA local (conteúdo integral, zero
  perda) e os ficheiros foram removidos — o conhecimento do projeto vive só na
  memória (`coala.py recall/search/add`). `scripts/validate-skills.sh` (step do
  gate) passou a guardar o estado memory-only: um `SKILL.md`, `catalog.md`,
  `LEARNINGS.md` ou `agent-skills.md` que reapareça FALHA o gate (mutations e
  `skills-library.test.ts` reescritos para o contrato novo). AGENTS.md, METODO
  §0.4/§8.1, READMEs e docs/ repontados para a memória.
