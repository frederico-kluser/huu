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
            // Get all variables from the workspace
            const allVariables = block.workspace.getAllVariables();

            // Create variable collection code for runtime values
            let variableCollectionCode = 'var variableValues = {};\n';
            allVariables.forEach(v => {
                const varName = generator?.nameDB_?.getName(v.getId(), Blockly.VARIABLE_CATEGORY_NAME);
                variableCollectionCode += `variableValues["${varName}"] = ${varName};\n`;
            });

            const code = `${variableCollectionCode}
window.configNavigation({
    blockId: '${block.id}',
    type: 'back',
    variables: variableValues,
});\n`;
            return code;
        },
    });
};

export default setBlockNavigateBack;