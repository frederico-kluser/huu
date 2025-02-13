import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockSelectHTMLElementCSS = () => {
  return blockConstructor({
    colour: Colors.HTML,
    hasNextConnection: null,
    hasPreviousConnection: null,
    name: 'BlockSelectHTMLElementCSS',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Scripting/Variables',
    fields: [
      {
        type: 'text',
        text: 'definir %1\ncomo %2 (Seletor CSS)',
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
        text: 'html > body',
      }
    ],
    tooltip: 'Variável que armazena um elemento HTML.',
  });
};

export default setBlockSelectHTMLElementCSS;
