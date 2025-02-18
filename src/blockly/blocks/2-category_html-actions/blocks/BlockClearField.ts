import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';
import BlocklyVariableNames from '../../../config/variable-names';

const setBlockClearField = () => {
    return blockConstructor({
        colour: Colors.HTML,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/reset',
        message: 'limpar o texto do elemento\n %1',
        name: 'BlockClearField',
        tooltip: 'Limpa o conteúdo de um campo de texto ou formulário.',
        fields: [
            {
                type: 'field_variable',
                name: 'VARIABLE',
                variable: '',
                variableTypes: [''],
            },
        ],
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockClearField;