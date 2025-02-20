import * as Blockly from 'blockly/core';
import { javascriptGenerator } from 'blockly/javascript';
import blocklyOptions from './config/options';
import blocklyContextMenus from './config/contextMenu';
import BlocklyTypes from './config/types';
import { getItem, setItem } from '../core/storage';

var workspace: Blockly.Workspace;
var workspaceName = "";

blocklyContextMenus.forEach((item) => {
    Blockly.ContextMenuRegistry.registry.register(item);
});

export function loadWorkspace(wsName: string) {
    workspaceName = wsName;
    const state = getItem(workspaceName) || {};
    Blockly.serialization.workspaces.load(state, workspace);
}

function updateCode(event: any) {
    const code = javascriptGenerator.workspaceToCode(workspace);
    console.clear();
    console.log("code:");
    console.log(code);
    console.log("----");
    const state = Blockly.serialization.workspaces.save(workspace);
    // console.log("state:");
    // console.log(state);
    setItem(workspaceName, state);
}

export const blocklySetup = () => {
    workspace = Blockly.inject('blocklyDiv', blocklyOptions);
    const Workspace = workspace as any;
    Workspace.registerButtonCallback('CREATE_HTML_VARIABLE', function (button: any) {
        Blockly.Variables.createVariableButtonHandler(
            button.getTargetWorkspace(),
            (variable) => { },
            BlocklyTypes.HTML_ELEMENT
        );
    });
    workspace.addChangeListener(updateCode);
};