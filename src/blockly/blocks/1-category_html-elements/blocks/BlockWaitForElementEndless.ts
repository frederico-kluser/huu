import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyVariableNames from '../../../config/variable-names';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockWaitForElementEndless = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasNextConnection: 'null',
    hasPreviousConnection: 'null',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement',
    message: 'esperar %1 o\nelemento %2',
    name: 'BlockWaitForElementEndless',
    tooltip: 'Espera um elemento HTML aparecer ou desaparecer.',
    fields: [
      {
        type: 'field_dropdown',
        name: 'VALUE',
        options: [
          ['aparecer', 'aparecer'],
          ['desaparecer', 'desaparecer'],
        ],
      },
      { // TODO: preciso mudar, porque como eu posso ter uma variável de um elemento que nem existe ainda?
        type: 'field_variable',
        name: 'VARIABLE',
        variable: BlocklyVariableNames.htmlElement,
        variableTypes: [BlocklyTypes.htmlElement],
        defaultType: BlocklyTypes.htmlElement,
      },
    ],
    generator: function (block: Blockly.Block, generator: any) {
      return '/* not implemented yet */';
    },
  });
};

export default setBlockWaitForElementEndless;
