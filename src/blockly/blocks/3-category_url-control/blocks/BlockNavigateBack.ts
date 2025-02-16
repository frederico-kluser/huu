import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockNavigateBack = () => {
    return blockConstructor({
        colour: Colors.URL,
        hasPreviousConnection: null,
        hasNextConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/History/back',
        name: 'BlockNavigateBack',
        fields: [
            {
                type: 'text',
                text: 'navegar para trás',
            }
        ],
        tooltip: 'Navega para a página anterior no histórico do navegador.',
        generator: function (block: Blockly.Block, generator: any) {
            return '/* not implemented yet */';
        },
    });
};

export default setBlockNavigateBack;
