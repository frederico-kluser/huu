import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockWaitForElement = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasPreviousConnection: null,
    hasNextConnection: null,
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver',
    message: 'esperar elemento %1\n%2 por %3 segundos',
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
    ],
    generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
      const elementSelector = generator.valueToCode(block, 'ELEMENT_SELECTOR', Order.ATOMIC) || 'document.querySelector("")';
      const condition = block.getFieldValue('CONDITION');
      const timeout = generator.valueToCode(block, 'TIMEOUT', Order.ATOMIC) || '10';

      // Determina a condição baseada na escolha (aparecer ou desaparecer)
      const checkCondition = condition === 'appear' ?
        `element !== null` :
        `element === null`;

      // Constrói o código para a espera do elemento usando Promise
      const code = `
await new Promise((resolve, reject) => {
  const startTime = Date.now();
  const timeoutMs = ${timeout} * 1000;
  
  const checkElement = () => {
    const element = ${elementSelector};
    if (${checkCondition}) {
      resolve();
      return;
    }
    
    if (Date.now() - startTime >= timeoutMs) {
      reject(new Error("Tempo esgotado esperando pelo elemento ${condition === 'appear' ? 'aparecer' : 'desaparecer'}"));
      return;
    }
    
    setTimeout(checkElement, 100);
  };
  
  checkElement();
}).catch(error => {
  console.error(error.message);
});
`;

      return code;
    },
  });
};

export default setBlockWaitForElement;