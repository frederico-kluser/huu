# Dependências Técnicas (.dp)

Esta pasta contém documentação sobre dependências técnicas e problemas não resolvidos no código-fonte do projeto Huu. A estrutura da pasta espelha a estrutura da pasta `src` para facilitar a localização das dependências.

## Propósito

O objetivo desta documentação é:

1. Identificar problemas potenciais no código-fonte
2. Explicar por que cada problema é importante
3. Sugerir soluções para resolver cada problema
4. Servir como referência para desenvolvedores trabalhando no projeto

## Estrutura

Cada arquivo `.txt` corresponde a um arquivo de código-fonte com o mesmo nome na pasta `src`. O arquivo contém:

- Uma descrição do problema ou dependência técnica
- O local exato do problema no código (número da linha)
- Uma explicação de por que é um problema
- Soluções recomendadas para resolver o problema

## Problemas Documentados

1. **CSS :contains() não padronizado**  
   `/helpers/createUniqueElementSelector.ts` - Uso de seletor CSS não padrão que falha em navegadores

2. **Acesso inseguro a propriedades**  
   `/blockly/index.ts` - Acesso a propriedades sem verificação adequada

3. **Manipulação inadequada de arrays**  
   `/core/IA/engine.request.ts` - Assume que um array contém elementos sem verificação

4. **Tipagem incorreta de callbacks**  
   `/core/IA/index.ts` - Callbacks tipados incorretamente como retornando objetos vazios

5. **Referência a componentes inexistentes**  
   `/helpers/processBlocklyCode.ts` - Referência a bloco Blockly que não existe

6. **Manipulação inadequada de código assíncrono**  
   `/core/executeCode.ts` - Problemas no tratamento de funções assíncronas no contexto do eval5

7. **Cast inseguro para o tipo any**  
   `/pages/Popup/Popup.tsx` - Uso de cast inseguro para tipagem de localização

8. **Manipulação inadequada de respostas da API**  
   `/core/IA/request/gpt.request.ts` - Assume estrutura específica na resposta da API sem validação

9. **Tratamento inadequado de erros em blocos de integração com IA**  
   `/blockly/blocks/3-category_ai-integration/blocks/BlockAiGenerateText.ts` - Falta de tratamento de erros em callbacks

## Como Usar Esta Documentação

1. Ao trabalhar em um arquivo, verifique se existe documentação na pasta `.dp`
2. Se estiver corrigindo um problema, use a documentação como referência para entender o problema e possíveis soluções
3. Após resolver um problema, atualize ou remova o arquivo de documentação correspondente