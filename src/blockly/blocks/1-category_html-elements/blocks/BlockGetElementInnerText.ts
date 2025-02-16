import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import BlocklyTypes from '../../../config/types';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockGetElementInnerText = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasOutput: 'String', // Este bloco retorna um valor (o innerText)
        name: 'BlockGetElementInnerText',
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/innerText',
        fields: [
            {
                type: 'text',
                text: 'obter o texto de\n%1',
            },
            {
                type: 'field_variable',
                name: 'ELEMENT',
                variable: BlocklyTypes.htmlElementVariable,
                variableTypes: [''], // TODO: definir um tipo específico para elemento HTML, se necessário
            }
        ],
        tooltip: 'Extrai o innerText de um elemento HTML armazenado em uma variável.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockGetElementInnerText;
