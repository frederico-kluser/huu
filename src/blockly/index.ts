import * as Blockly from 'blockly/core';
import { javascriptGenerator } from 'blockly/javascript';
import blocklyOptions from './config/options';

var workspace: Blockly.Workspace;

function updateCode(event: any) {
    const code = javascriptGenerator.workspaceToCode(workspace);
    console.log(code);
}

const blocklySetup = () => {
    // Inject Blockly into the DOM.
    workspace = Blockly.inject('blocklyDiv', blocklyOptions);
    // workspace.updateToolbox(newTree); // Update toolbox
    workspace.addChangeListener(updateCode);
};

export default blocklySetup;