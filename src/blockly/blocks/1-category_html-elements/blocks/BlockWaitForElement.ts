import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyVariableNames from '../../../config/variable-names';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockWaitForElement = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasNextConnection: 'null',
    hasPreviousConnection: 'null',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement',
    message: 'esperar %1 o\nelemento %2\npor %3 segundos',
    name: 'BlockWaitForElement',
    tooltip: 'Espera um elemento HTML aparecer ou desaparecer por um determinado tempo.',
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
        variableTypes: [BlocklyTypes.HTML_ELEMENT],
        defaultType: BlocklyTypes.HTML_ELEMENT,
        check: BlocklyTypes.HTML_ELEMENT,
      },
      {
        type: 'field_input',
        name: 'VALUE',
        text: '10',
      },
    ],
    generator: function (block: Blockly.Block, generator: any) {
      return '/* not implemented yet */';
    },
  });
};

export default setBlockWaitForElement;
