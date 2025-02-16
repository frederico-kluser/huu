import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockWriteTextToHTMLElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        name: 'BlockWriteTextToHTMLElement',
        helpUrl:
            'https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent',
        fields: [
            {
                type: 'text',
                text: 'escrever %1 no elemento\n%2'
            },
            {
                type: 'input_value',
                name: 'TEXT',
            },
            {
                type: 'field_variable',
                name: 'ELEMENT',
                variable: BlocklyTypes.htmlElementVariable,
                variableTypes: [''] // TODO: criar um tipo para elemento HTML, se necessário
            }
        ],
        tooltip:
            'Insere o texto de uma variável em um elemento HTML previamente salvo.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockWriteTextToHTMLElement;
