import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockWaitForElementEndless = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasPreviousConnection: 'null',
    hasNextConnection: 'null',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement',
    name: 'BlockWaitForElementEndless',
    fields: [
      {
        type: 'text',
        text: 'esperar %1 o\nelemento %2',
      },
      {
        type: 'field_dropdown',
        name: 'VALUE',
        options: [
          ['aparecer', 'aparecer'],
          ['desaparecer', 'desaparecer'],
        ],
      },
      {
        type: 'field_variable',
        name: 'VARIABLE',
        variable: BlocklyTypes.htmlElementVariable,
        variableTypes: [''], // TODO: criar um tipo para elemento HTML
      },
    ],
    tooltip: 'Espera um elemento HTML aparecer ou desaparecer.',
    generator: function (block: Blockly.Block, generator: any) {
      return '/* not implemented yet */';
    },
  });
};

export default setBlockWaitForElementEndless;
