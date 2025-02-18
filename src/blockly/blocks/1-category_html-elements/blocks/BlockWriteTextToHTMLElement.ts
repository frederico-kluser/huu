import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyVariableNames from '../../../config/variable-names';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockWriteTextToHTMLElement = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl:
            'https://developer.mozilla.org/en-US/docs/Web/API/Node/textContent',
        message: 'escrever %1\nno elemento %2',
        name: 'BlockWriteTextToHTMLElement',
        tooltip:
            'Insere o texto de uma variável em um elemento HTML previamente salvo.',
        fields: [
            {
                type: 'input_value',
                name: 'TEXT',
                shadow: {
                    type: 'text',
                    fields: {
                        TEXT: 'Digite o texto'
                    }
                }
            },
            {
                type: 'field_variable',
                name: 'ELEMENT',
                variable: BlocklyVariableNames.htmlElement,
                variableTypes: [BlocklyTypes.HTML_ELEMENT],
                defaultType: BlocklyTypes.HTML_ELEMENT,
            }
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockWriteTextToHTMLElement;
