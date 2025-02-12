import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockSelectHTMLElement = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasPreviousConnection: 'null',
    hasNextConnection: 'null',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/XML/XPath/Guides/Introduction_to_using_XPath_in_JavaScript',
    name: 'BlockSelectHTMLElement',
    fields: [
      {
        type: 'text',
        text: 'definir %1\n para %2(XPath)',
      },
      {
        type: 'field_variable',
        name: 'VARIABLE',
        variable: 'elemento',
        variableTypes: [''],
      },
      {
        type: 'field_input',
        name: 'VALUE',
        text: 'VALUE',
      }
    ],
    tooltip: 'Seleciona um elemento HTML a partir de um XPath.',
  });
};

export default setBlockSelectHTMLElement;
