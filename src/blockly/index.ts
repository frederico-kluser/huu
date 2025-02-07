import * as Blockly from 'blockly/core';
import { javascriptGenerator } from 'blockly/javascript';
import blocklyOptions from './config/options';

var workspace: Blockly.Workspace;

export function loadWorkspace() {
    const state = JSON.parse(localStorage.getItem('workspace') || '{}');
    Blockly.serialization.workspaces.load(state, workspace);
}

function updateCode(event: any) {
    const code = javascriptGenerator.workspaceToCode(workspace);
    console.log("code:");
    console.log(code);
    console.log("----");
    const state = Blockly.serialization.workspaces.save(workspace);
    console.log("state:");
    console.log(state);
    localStorage.setItem('workspace', JSON.stringify(state));
}

export const blocklySetup = () => {
    workspace = Blockly.inject('blocklyDiv', blocklyOptions);
    workspace.addChangeListener(updateCode);
};