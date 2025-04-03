import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';

const setBlockFindElementByText = () => {
  return blockConstructor({
    colour: Colors.SELECTORS,
    hasOutput: 'String',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Document/querySelectorAll',
    message: 'encontrar elemento com seletor %1\nque contenha texto %2',
    name: 'BlockFindElementByText',
    output: BlocklyTypes.HTML_ELEMENT,
    tooltip: 'Localiza o primeiro elemento da página que corresponda ao seletor CSS (ex: "div", "p", ".classe") e contenha exatamente o texto especificado. Útil para encontrar elementos específicos baseados em seu conteúdo textual.',
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
        type: 'input_value',
        name: 'TEXT',
        check: BlocklyTypes.STRING,
        shadow: {
          type: 'text',
          fields: {
            TEXT: 'texto a encontrar'
          }
        }
      }
    ],
    generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
      const selector = generator.valueToCode(block, 'SELECTOR', Order.ATOMIC) || '""';
      const text = generator.valueToCode(block, 'TEXT', Order.ATOMIC) || '""';

      // Código que encontra o primeiro elemento com o texto especificado
      const code = `(function() {
  var elements = document.querySelectorAll(${selector});
  for (var i = 0; i < elements.length; i++) {
    if (elements[i].innerText.trim() === ${text}.trim()) {
      return elements[i];
    }
  }
  return null;
})()`;

      return [code, Order.FUNCTION_CALL];
    },
  });
};

export default setBlockFindElementByText;