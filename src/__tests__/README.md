# Testes para o Projeto HUU

Este diretório contém os testes automatizados para garantir o funcionamento adequado das funcionalidades do projeto.

## Estrutura de Testes

Os testes seguem a mesma estrutura de diretórios do código-fonte para facilitar a navegação:

```
src/__tests__/
  ├── components/       # Testes para componentes React
  ├── core/             # Testes para o núcleo da aplicação
  │   └── storage/      # Testes para as funções de armazenamento
  ├── helpers/          # Testes para funções auxiliares
  └── pages/            # Testes para componentes de páginas
      └── Popup/        # Testes para a interface do popup
```

## Como Executar os Testes

Para executar todos os testes:

```bash
npm test
```

Para executar testes específicos:

```bash
npm test -- -t "nome do teste"
```

Para executar testes com cobertura:

```bash
npm run test:coverage
```

## Adicionando Novos Testes

Para adicionar novos testes, siga estas diretrizes:

1. Crie um arquivo com o nome `*.test.ts` ou `*.test.tsx` no diretório correspondente
2. Use as funções do Jest (`describe`, `it`, `test`, etc.) para estruturar seus testes
3. Use o React Testing Library para testar componentes React
4. Mock adequadamente as APIs externas (como a API do Chrome)

## Mocks

Os principais mocks estão definidos em:

- `jest-config/setup.js`: Mock global para a API do Chrome
- `jest-config/__mocks__/fileMock.js`: Mock para arquivos estáticos

## Cobertura de Código

A cobertura de código é gerada automaticamente ao executar os testes. O objetivo é aumentar gradualmente a cobertura para garantir que todas as funcionalidades sejam testadas.

Um relatório de cobertura é gerado na pasta `coverage/` após executar `npm run test:coverage`.

## Problemas Conhecidos

Alguns testes podem precisar de ajustes para corresponder exatamente ao comportamento atual:

1. `urlMatchesPattern.test.ts`: Verificar se o comportamento atual da função corresponde aos comportamentos esperados nos testes
2. `isValidJsonKey.test.ts`: Verificar o tratamento de strings vazias
3. `isValidPatterns.test.ts`: Verificar a validação de URLs malformadas