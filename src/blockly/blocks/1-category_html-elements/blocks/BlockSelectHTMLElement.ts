import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

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
        check: 'String',
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
    generator: function (block: Blockly.Block, generator: any) {
      return '/* not implemented yet */';
    },
  });
};

export default setBlockSelectHTMLElement;
