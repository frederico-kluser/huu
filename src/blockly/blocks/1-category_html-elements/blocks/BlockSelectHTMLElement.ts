import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import { Order } from 'blockly/javascript';
import BlocklyTypes from '../../../config/types';
import generateUUID from '../../../../helpers/generateUUID';

const setBlockSelectHTMLElement = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasOutput: 'String',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Variables',
    message: 'seletor de elemento %1\nTipo de seletor %2',
    name: 'BlockSelectHTMLElement',
    output: BlocklyTypes.HTML_ELEMENT,
    tooltip: 'Variável que armazena um elemento HTML.',
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
    ],
    generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
      const selector =
        generator.valueToCode(block, 'SELECTOR', Order.ATOMIC) || '""';
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
        default:
          code = `document.querySelector(${selector})`;
      }

      return [code, Order.ATOMIC];
    },
  });
};

type TypeSelectors = 'css' | 'id' | 'class' | 'tag';

export const getBlockSelectHTMLElement = (selector: TypeSelectors, value: string) => {
  return ({
    "type": "BlockSelectHTMLElement",
    "id": generateUUID(),
    "fields": {
      "TARGET_SELECTOR": selector
    },
    "inputs": {
      "SELECTOR": {
        "shadow": {
          "type": "text",
          "id": generateUUID(),
          "fields": {
            "TEXT": value,
          }
        }
      }
    }
  })
};

export default setBlockSelectHTMLElement;
