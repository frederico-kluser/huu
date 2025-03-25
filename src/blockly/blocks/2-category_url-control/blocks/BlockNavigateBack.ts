import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockNavigateBack = () => {
    return blockConstructor({
        colour: Colors.URL,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/History/back',
        message: 'voltar para a página anterior',
        name: 'BlockNavigateBack',
        tooltip: 'Navega para a página anterior no histórico do navegador.',
        fields: [],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            const code = `window.configNavigation({
            \tblockId: '${block.id}',
            \ttype: 'back',
        });\n`;
            return code;
        },
    });
};

export default setBlockNavigateBack;