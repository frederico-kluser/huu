### Added
- Fundação open-source completa: `CONTRIBUTING.md` (+ gêmeo `CONTRIBUTING.en.md`), `SECURITY.md` (+ `SECURITY.en.md`) com canal privado de relato e política de disclosure coordenada, `CODE_OF_CONDUCT.md` (+ gêmeo) Contributor Covenant 2.1, `.github/CODEOWNERS` (revisão do responsável ligada ao ruleset `pull-request-rule`) e templates de issue (bug · ideia · `config.yml` com link de segurança).
- `.github/dependabot.yml` (github-actions + npm, semanal) e hook `commit-msg` em `.githooks/` que valida Commits Convencionais — habilite com `git config core.hooksPath .githooks` (junto do `pre-push`).

### Changed
- Workflows de CI endurecidos (postura OpenSSF): actions fixadas por SHA, bloco `permissions: contents: read` (menor privilégio) e o dogfood semanal usa `"provider": "openrouter"` — o backend `pi` foi removido e não existe mais.
- Documentação de CI/CLI corrigida para os dois eixos atuais (backend `jcode` | `stub` × provedor `deepseek` | `openrouter`): `docs/ci.*`, `docs/onboarding.*`, `docs/operations.*` e `docs/ARCHITECTURE.md` deixam de instruir o uso dos backends removidos `pi` / `copilot` / `azure` e passam a mostrar o eixo de credencial do provedor.
- README (pt-BR + EN): badge de CI e ligações para `CONTRIBUTING` · `CODE_OF_CONDUCT` · `SECURITY`; o gate `check-twins` passa a vigiar também os pares gêmeos da raiz (MANIFESTO, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT).
