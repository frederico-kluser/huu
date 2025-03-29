import * as Blockly from 'blockly';

/**
 * Checks if a variable is used in any block in the workspace
 * @param workspace The Blockly workspace
 * @param variableId The ID of the variable to check
 * @returns True if the variable is used in any block, false otherwise
 */
function isVariableUsed(workspace: Blockly.Workspace, variableId: string): boolean {
    // Get all blocks in the workspace
    const allBlocks = workspace.getAllBlocks(false);

    // Check if any block uses this variable
    for (const block of allBlocks) {
        // Check if this block is a variable getter or setter
        if ((block.type === 'variables_get' || block.type === 'variables_set') &&
            block.getFieldValue('VAR') === variableId) {
            return true;
        }

        // Check for custom blocks that might use variables
        // Look through all fields that might reference variables
        for (let i = 0; i < block.inputList.length; i++) {
            const input = block.inputList[i];
            for (let j = 0; j < input.fieldRow.length; j++) {
                const field = input.fieldRow[j];
                if (field.name === 'VAR' && field.getValue() === variableId) {
                    return true;
                }
            }
        }
    }

    return false;
}

export default isVariableUsed;