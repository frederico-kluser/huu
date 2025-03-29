import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockNavigate = () => {
    return blockConstructor({
        colour: Colors.URL,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Learn_web_development/Core/Structuring_content/Creating_links',
        message: 'mudou de página',
        name: 'BlockNavigate',
        tooltip: 'Adicione esse bloco quando a página mudar.',
        fields: [],
        generator: function (block: Blockly.Block, generator: Blockly.CodeGenerator) {
            // Get all variables from the workspace
            const allVariables = block.workspace.getAllVariables();

            // Create variable collection code for runtime values
            let variableCollectionCode = 'var variableValues = {};\n';
            allVariables.forEach(v => {
                const varName = generator?.nameDB_?.getName(v.getId(), Blockly.VARIABLE_CATEGORY_NAME);
                variableCollectionCode += `try { variableValues["${varName}"] = ${varName}; } catch(e) { /* Variable not defined in scope */ }\n`;
            });

            const code = `${variableCollectionCode}
window.configNavigation({
    blockId: '${block.id}',
    type: 'navigate-block-none',
    variables: variableValues, 
});\n`;
            return code;
        },
    });
};

export default setBlockNavigate;