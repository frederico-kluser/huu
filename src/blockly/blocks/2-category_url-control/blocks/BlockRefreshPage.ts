import * as Blockly from 'blockly/core';
import Colors from '../../../config/colors';
import blockConstructor from '../../../helpers/blockConstructor';

const setBlockRefreshPage = () => {
    return blockConstructor({
        colour: Colors.URL,
        hasNextConnection: null,
        hasPreviousConnection: null,
        helpUrl: 'https://developer.mozilla.org/en-US/docs/Web/API/Location/reload',
        message: 'recarregar página',
        name: 'BlockRefreshPage',
        tooltip: 'Recarrega a página atual.',
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
    type: 'navigate-block-refresh',
    variables: variableValues,
});\n`;
            return code;
        },
    });
};

export default setBlockRefreshPage;