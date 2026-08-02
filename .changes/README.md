# Changelog fragments

Changes que ainda não foram lançadas moram aqui — um fragmento `.md` por
card/feature, consolidado pelo script `scripts/changelog.ts` depois do merge
no branch principal.

## Formato

Cada arquivo `.changes/<card>.md` contém uma ou mais seções, cada uma com um
heading `### <Section>` seguido de bullets `- descrição`:

```markdown
### Added
- nova feature X com suporte a Y

### Fixed
- crash ao iniciar com --flag inválido
```

As seções válidas são: **Added**, **Changed**, **Fixed**, **Removed**
(exatamente essas quatro, com inicial maiúscula).

Fragmentos são consolidados em ordem alfabética de nome de arquivo sob
`## [Unreleased]` no `CHANGELOG.md`.

## Por que fragmentos?

`CHANGELOG.md` é o arquivo mais tocado do repositório. O padrão "inserir no
topo da seção `[Unreleased]`" conflita sempre que duas worktrees paralelas
escrevem. Fragmentos eliminam esse conflito: cada card escreve no seu próprio
arquivo, e o script junta tudo deterministicamente.

## Script

```bash
# Validar formato de todos os fragmentos (sem alterar CHANGELOG.md)
npx tsx scripts/changelog.ts --check

# Ver o que seria consolidado (sem alterar CHANGELOG.md)
npx tsx scripts/changelog.ts --dry-run

# Consolidar fragmentos no CHANGELOG.md
npx tsx scripts/changelog.ts
```
