import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockWaitForElement = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasPreviousConnection: 'null',
    hasNextConnection: 'null',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement',
    name: 'BlockWaitForElement',
    fields: [
      {
        type: 'text',
        text: 'esperar %1\nelemento %2\npor %3 segundos',
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
      {
        type: 'field_input',
        name: 'VALUE',
        text: '10',
      },
    ],
    tooltip: 'Seleciona um elemento HTML a partir de um XPath.',
  });
};

export default setBlockWaitForElement;
