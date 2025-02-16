import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockScrollToElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollIntoView',
        name: 'BlockScrollToElement',
        fields: [
            {
                type: 'text',
                text: 'scrollar para elemento\n%1',
            },
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyTypes.htmlElementVariable,
                variableTypes: [''], // TODO: criar um tipo para elemento HTML
            },
        ],
        tooltip: 'Rola a página até que o elemento selecionado esteja visível.',
        generator: function (block: Blockly.Block, generator: any) {
            const elementSelector = block.getFieldValue('ELEMENT');
            return `
(function(){
  var element = document.querySelector(${generator.quote_(elementSelector)});
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
})();
\n`;
        }
    });
};

export default setBlockScrollToElement;