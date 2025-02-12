import blockConstructor from '../../../helpers/blockConstructor';

const setHTMLElementSelection = () => {
  return blockConstructor({
    colour: 100,
    hasPreviousConnection: 'null',
    hasNextConnection: 'null',
    helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/XML/XPath/Guides/Introduction_to_using_XPath_in_JavaScript',
    name: 'HTMLElementSelection',
    fields: [
      {
        type: 'text',
        text: 'Digite o XPath %1',
      },
      {
        type: 'input_value',
        name: 'VALUE',
      }
    ],
    tooltip: 'Seleciona um elemento HTML a partir de um XPath.',
  });
};

export default setHTMLElementSelection;
