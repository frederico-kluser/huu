# Guia de Testes para o Projeto HUU

Este documento descreve a estratégia de testes para o projeto HUU.

## Visão Geral

O projeto utiliza Jest e React Testing Library para os testes automatizados. A estrutura de testes inclui:

- **Testes unitários**: Para funções individuais e componentes
- **Testes de integração**: Para interações entre componentes e módulos
- **Mocks**: Para APIs externas e navegador (Chrome API)

## Configuração

O ambiente de testes é configurado com:

- **Jest**: Framework de testes
- **React Testing Library**: Para testes de componentes React
- **Mocks**: Para APIs externas (Chrome) e recursos estáticos

## Ferramentas de Teste

- **Jest**: `npm test` para executar testes
- **Cobertura de Código**: `npm run test:coverage` para gerar relatório de cobertura

## Tipos de Testes

### Testes Unitários

Testam funções e componentes isoladamente:

- **Funções Auxiliares**: Validadores, formatadores, etc.
- **Componentes de UI**: Botões, campos, etc.
- **Funções de Armazenamento**: Leitura/escrita no storage

### Testes de Integração

Testam a interação entre componentes e módulos:

- **Fluxos de Usuário**: Criação de agentes, navegação, etc.
- **Integração com Armazenamento**: Persistência de dados
- **Comunicação entre Módulos**: Mensagens entre background/content

## Cobertura de Código

O objetivo é aumentar gradualmente a cobertura, priorizando:

1. **Funções críticas**: Relacionadas a persistência e execução de agentes
2. **Componentes principais**: Interface de usuário principal
3. **Manipulação de erros**: Validações e tratamento de exceções

## Melhores Práticas

- **Organização**: Testes devem seguir a mesma estrutura de diretórios do código-fonte
- **Nomenclatura**: Arquivos de teste terminam com `.test.ts` ou `.test.tsx`
- **Mocking**: Isolar dependências externas (especialmente API do Chrome)
- **Asserções**: Usar asserções claras e específicas

## Como Executar os Testes

```bash
# Executar todos os testes
npm test

# Executar testes com watch mode
npm run test:watch

# Gerar relatório de cobertura
npm run test:coverage
```

## Adicionando Novos Testes

Para adicionar um novo teste:

1. Crie um arquivo com nome adequado (`*.test.ts` ou `*.test.tsx`)
2. Importe funções e componentes a serem testados
3. Use `describe` para agrupar testes relacionados
4. Use `it` ou `test` para casos de teste específicos
5. Use mocks quando necessário para isolamento

## Continuous Integration

Recomenda-se configurar CI para executar testes a cada pull request ou commit:

- Verificar se todos os testes passam
- Verificar a cobertura de código
- Bloquear PRs com testes falhos

## Exemplos

Veja exemplos de testes em `src/__tests__/` para entender a estrutura e o estilo recomendados para novos testes.