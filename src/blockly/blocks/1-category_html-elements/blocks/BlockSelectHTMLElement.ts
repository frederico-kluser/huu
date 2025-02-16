import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockSelectHTMLElement = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasOutput: 'String',
    name: 'BlockSelectHTMLElementCSS',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Variables',
    fields: [
      {
        type: 'text',
        text: 'seletor de elemento %1\nTipo de seletor %2',
      },
      {
        type: 'input_value',
        name: 'SELECTOR',
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
    tooltip: 'Variável que armazena um elemento HTML.',
    generator: function (block: Blockly.Block, generator: any) {
      return '/* not implemented yet */';
    },
  });
};

export default setBlockSelectHTMLElement;
