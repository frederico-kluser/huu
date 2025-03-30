import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockWaitForElement = () => {
  return blockConstructor({
    colour: Colors.SELECTORS,
    hasPreviousConnection: null,
    hasNextConnection: null,
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver',
    message: 'esperar seletor %1\ntipo %2\n%3 por %4 segundos\nse encontrar %5\nse tempo esgotar %6',
    name: 'BlockWaitForElement',
    tooltip: 'Espera até que um elemento HTML apareça ou desapareça na página por um determinado tempo.',
    fields: [
      {
        type: 'input_value',
        name: 'SELECTOR',
        check: BlocklyTypes.STRING,
        shadow: {
          type: 'text',
          fields: {
            TEXT: 'div'
          }
        }
      },
      {
        type: 'field_dropdown',
        name: 'TARGET_SELECTOR',
        options: [
          ['CSS', 'css'],
          ['ID', 'id'],
          ['Class', 'class'],
          ['Tag', 'tag'],
        ],
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
      const selector = generator.valueToCode(block, 'SELECTOR', Order.ATOMIC) || '""';
      const targetSelector = block.getFieldValue('TARGET_SELECTOR');
      const condition = block.getFieldValue('CONDITION');
      const timeout = generator.valueToCode(block, 'TIMEOUT', Order.ATOMIC) || '10';
      const doIfFound = generator.statementToCode(block, 'DO_IF_FOUND');
      const doIfTimeout = generator.statementToCode(block, 'DO_IF_TIMEOUT');

      // Determina o código do seletor com base no tipo selecionado
      let elementSelectorCode = '';
      switch (targetSelector) {
        case 'css':
          elementSelectorCode = `document.querySelector(${selector})`;
          break;
        case 'id':
          elementSelectorCode = `document.getElementById(${selector})`;
          break;
        case 'class':
          elementSelectorCode = `document.getElementsByClassName(${selector})[0]`;
          break;
        case 'tag':
          elementSelectorCode = `document.getElementsByTagName(${selector})[0]`;
          break;
        default:
          elementSelectorCode = `document.querySelector(${selector})`;
      }

      // Determina a condição baseada na escolha (aparecer ou desaparecer)
      const checkCondition = condition === 'appear' ?
        `huu_var_element !== undefined && huu_var_element !== null` :
        `huu_var_element === undefined || huu_var_element === null`;

      // Constrói o código ES5 para a espera do elemento usando setTimeout para polling
      const code = `
(function() { 
  var huu_var_startTime = Date.now();
  var huu_var_timeoutMs = ${timeout} * 1000;
  
  function checkElement() {
    var huu_var_element = ${elementSelectorCode};
    
    if (${checkCondition}) {
      // Elemento encontrado, executar o bloco DO_IF_FOUND
      ${doIfFound.replace(/^  /gm, '      ')}
      return;
    }
    
    if (Date.now() - huu_var_startTime >= huu_var_timeoutMs) {
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