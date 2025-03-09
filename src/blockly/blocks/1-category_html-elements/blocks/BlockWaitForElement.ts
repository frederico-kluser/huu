import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockWaitForElement = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasPreviousConnection: null,
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver',
    message: 'esperar elemento %1\n%2 por %3 segundos\nse encontrar %4\nse tempo esgotar %5',
    name: 'BlockWaitForElement',
    tooltip: 'Espera até que um elemento HTML apareça ou desapareça na página por um determinado tempo.',
    fields: [
      {
        type: 'input_value',
        name: 'ELEMENT_SELECTOR',
        check: BlocklyTypes.HTML_ELEMENT,
      },
      {
        type: 'field_dropdown',
        name: 'CONDITION',
        options: [
          ['aparecer', 'appear'],
          ['desaparecer', 'disappear'],
        ],
      },
      {
        type: 'input_value',
        name: 'TIMEOUT',
        check: BlocklyTypes.NUMBER,
        shadow: {
          type: 'math_number',
          fields: {
            NUM: 10
          }
        }
      },
      {
        type: 'input_statement',
        name: 'DO_IF_FOUND',
      },
      {
        type: 'input_statement',
        name: 'DO_IF_TIMEOUT',
      },
    ],
    generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
      const elementSelector = generator.valueToCode(block, 'ELEMENT_SELECTOR', Order.ATOMIC) || 'document.querySelector("")';
      const condition = block.getFieldValue('CONDITION');
      const timeout = generator.valueToCode(block, 'TIMEOUT', Order.ATOMIC) || '10';
      const doIfFound = generator.statementToCode(block, 'DO_IF_FOUND');
      const doIfTimeout = generator.statementToCode(block, 'DO_IF_TIMEOUT');

      // Determina a condição baseada na escolha (aparecer ou desaparecer)
      const checkCondition = condition === 'appear' ?
        `element !== undefined && element !== null` :
        `element === undefined || element === null`;

      // Constrói o código ES5 para a espera do elemento usando setTimeout para polling
      const code = `
(function() { 
  var startTime = Date.now();
  var timeoutMs = ${timeout} * 1000;
  
  function checkElement() {
    var element = ${elementSelector};
    
    if (${checkCondition}) {
      // Elemento encontrado, executar o bloco DO_IF_FOUND
      ${doIfFound.replace(/^  /gm, '      ')}
      return;
    } 
    
    if (Date.now() - startTime >= timeoutMs) {
      // Tempo esgotado, executar o bloco DO_IF_TIMEOUT
      ${doIfTimeout.replace(/^  /gm, '      ')}
      return;
    }
    
    // Continuar verificando
    setTimeout(checkElement, 100); // TODO: posso deixar a pessoa escolher o tempo de polling
  }
  
  // Iniciar a verificação
  checkElement();
})();
`;

      return code;
    },
  });
};

export default setBlockWaitForElement;