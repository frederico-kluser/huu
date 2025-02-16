import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockGetElementInnerText = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasOutput: 'String',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/innerText',
        message: 'obter o texto de\n%1',
        name: 'BlockGetElementInnerText',
        tooltip: 'Extrai o innerText de um elemento HTML armazenado em uma variável.',
        fields: [
            {
                type: 'field_variable',
                name: 'ELEMENT',
                variable: BlocklyTypes.htmlElementVariable,
                variableTypes: [''],
            }
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockGetElementInnerText;
