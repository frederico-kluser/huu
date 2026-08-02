### Fixed

- **Os números medidos do `METODO.md §1` e `§3` estavam até 97% fora e nada reprovava.** `scripts/check-metodo.ts` existia e detectava a deriva corretamente, mas não estava em nenhum gate — ninguém o executava. Todos os valores foram remedidos: total versionado 135.866 → **167.212** linhas, testes 116 → **142** arquivos, skills 20 → **22**, `AGENTS.md` 520 → **145** linhas. A linha "Verificação automática" ainda dizia **zero CI**.
- **A tabela de singletons do §3 descrevia arquivos que já não existem assim.** `src/web/client/app.js` era o pior ofensor com 3.723 linhas e hoje tem **113** (o cliente virou ~15 módulos ESM); `src/lib/types.ts` era 1.235 e hoje tem **84** (virou o diretório `src/lib/types/`). A tabela foi recalculada por churn×linhas e a prosa passou a registrar que o diagnóstico **foi executado** — hoje o pior singleton é `src/orchestrator/index.ts`.

### Added

- **`check-metodo` é o 9º passo do gate**, então a prosa medida do METODO passa a ser verificada em todo push/PR junto com o resto. Duas mudanças foram necessárias para que isso fosse honesto em vez de vermelho-por-construção:
  - **Tolerância de 10%** (`HUU_METODO_TOLERANCE`) nos números derivados. Igualdade exata ficaria vermelha no commit seguinte a cada atualização — foi exatamente assim que o `PENDENTE` do `gate.sh` ensinou o repositório a ignorar o vermelho. 10% pega prosa materialmente errada (esta tabela ficou 23% fora em dois dias) e sobrevive ao trabalho normal. A mensagem de erro passa a dizer o quanto está fora e qual a tolerância.
  - **O cheque de cabeçalho virou aviso.** Exigir que o commit anotado no METODO seja igual ao `HEAD` é insatisfazível: um arquivo não pode conter o hash do commit que o introduz. Como gate, ficaria vermelho para sempre. Quem guarda a verdade são os números, que são verificáveis contra a árvore de trabalho.
- **A contagem de `src/` passou a medir o que o documento declara.** O verificador contava só TS+TSX enquanto a linha do METODO diz "inclui client JS/CSS/HTML", e por isso emitia um WARN permanente — aviso que nunca sai é ruído que se aprende a ignorar.
