import * as Blockly from 'blockly/core';
import { javascriptGenerator } from 'blockly/javascript';
import blocklyOptions from './config/options';
import blocklyContextMenus from './config/contextMenu';
import BlocklyTypes from './config/types';
import { fetchAgentById, saveOrUpdateAgent } from '../core/storageAgents';
import TypeAgent, { TypeBlock } from '../types/agent';

var workspace: Blockly.Workspace;
var workspaceName = "";

blocklyContextMenus.forEach((item) => {
    Blockly.ContextMenuRegistry.registry.register(item);
});

export const getBlocklyState = (localWorkspaceName: string): Partial<TypeAgent> => fetchAgentById(localWorkspaceName) || {
    blocks: {},
}

export function loadWorkspace(wsName: string) {
    workspaceName = wsName;
    const { blocks } = getBlocklyState(workspaceName);
    Blockly.serialization.workspaces.load(blocks as TypeBlock, workspace);
}

function updateCode(event: any) {
    const code = javascriptGenerator.workspaceToCode(workspace);
    console.clear();
    console.log("code:");
    console.log(code);
    console.log("----");
    const blocks = Blockly.serialization.workspaces.save(workspace);

    // TODO: se eu usar o updateAgentPartial não preciso desse "as TypeAgent"
    const actualState = getBlocklyState(workspaceName) as TypeAgent;

    saveOrUpdateAgent(workspaceName, {
        ...actualState,
        blocks,
        code,
    });
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