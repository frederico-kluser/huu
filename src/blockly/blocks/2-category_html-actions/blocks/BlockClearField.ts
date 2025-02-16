import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyTypes from '../../../config/types';

const setBlockClearField = () => {
    return blockConstructor({
        colour: Colors.HTML, // Utilizando a cor definida para HTML
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/reset',
        name: 'BlockClearField',
        fields: [
            {
                type: 'text',
                text: 'limpar o texto do elemento\n %1',
            },
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: BlocklyTypes.htmlElementVariable,
                variableTypes: [''], // TODO: criar um tipo para elemento HTML
            },
        ],
        tooltip: 'Limpa o conteúdo de um campo de texto ou formulário.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockClearField;