import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';

const setBlockSelectHTMLElement = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasOutput: 'String',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Variables',
    message: 'seletor de elemento %1\nTipo de seletor %2',
    name: 'BlockSelectHTMLElement',
    tooltip: 'Variável que armazena um elemento HTML.',
    fields: [
      {
        type: 'input_value',
        name: 'SELECTOR',
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
          ['XPath', 'xpath'],
          ['CSS', 'css'],
          ['ID', 'id'],
          ['Class', 'class'],
          ['Tag', 'tag'],
        ],
      },
    ],
    generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
      const selector =
        generator.valueToCode(block, 'SELECTOR', Order.ATOMIC) || '""';
      // Obtém o valor selecionado no dropdown 'TARGET_SELECTOR'
      const target = block.getFieldValue('TARGET_SELECTOR');
      let code = '';

      switch (target) {
        case 'css':
          code = `document.querySelector(${selector})`;
          break;
        case 'id':
          code = `document.getElementById(${selector})`;
          break;
        case 'class':
          code = `document.getElementsByClassName(${selector})[0]`;
          break;
        case 'tag':
          code = `document.getElementsByTagName(${selector})[0]`;
          break;
        case 'xpath':
          code = `document.evaluate(${selector}, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue`;
          break;
        default:
          code = `document.querySelector(${selector})`;
      }

      // Retorna o código gerado e a precedência
      return [code, Order.ATOMIC];
    },
  });
};

export default setBlockSelectHTMLElement;
