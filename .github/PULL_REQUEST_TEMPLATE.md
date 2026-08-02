## Checklist do autor

Antes de pedir review, confirme:

- [ ] `npm run typecheck && npm test` passam localmente
- [ ] `scripts/gate.sh` passa (se disponível)
- [ ] Números do §1 do METODO.md conferem com `npx tsx scripts/check-metodo.ts`
- [ ] Mudanças em `types.ts` estão documentadas no corpo do PR
- [ ] Se é pipeline default novo ou alterado: `registry.test.ts` segue verde
- [ ] Se é skill nova ou alterada: `validate-skills.sh` passa e o `catalog.md` reflete
- [ ] Se é doc: o gêmeo (pt-BR ⇄ en) foi atualizado, e `diff <(rg -c '^## ' X.md) <(rg -c '^## ' X.en.md)` sai limpo
- [ ] CHANGELOG: entrada em `[Unreleased]` ou fragmento em `.changes/`

---

## A pergunta que não pode faltar

> **Se esta mudança desaparecer, o que fica vermelho?**

Responda no corpo do PR, em uma frase. Se a resposta for "nada", o PR precisa de um teste ou de um gate antes de mergear.
