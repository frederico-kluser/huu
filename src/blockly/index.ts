import * as Blockly from 'blockly/core';
import { javascriptGenerator } from 'blockly/javascript';
import blocklyOptions from './config/options';
import blocklyContextMenus from './config/contextMenu';
import BlocklyTypes from './config/types';
import TypeAgent, { TypeBlock } from '../types/agent';
import { fetchAgentById, saveOrUpdateAgent } from '../core/storage/agents';

var workspace: Blockly.Workspace;
var workspaceName = "";

blocklyContextMenus.forEach((item) => {
    Blockly.ContextMenuRegistry.registry.register(item);
});

export const getBlocklyState = async (localWorkspaceName: string): Promise<Partial<TypeAgent>> => {
    const workspaceState = await fetchAgentById(localWorkspaceName);
    const mockWorkspaceState: Partial<TypeAgent> = {
        blocks: {},
    };

    return workspaceState || mockWorkspaceState;
}

export const loadWorkspace = async (wsName: string) => {
    workspaceName = wsName;
    const workspaceState = await getBlocklyState(wsName);
    const { blocks } = workspaceState;
    Blockly.serialization.workspaces.load(blocks as TypeBlock, workspace);
}

const updateCode = async (event: any) => {
    const code = javascriptGenerator.workspaceToCode(workspace);
    // console.clear();
    console.log("code:");
    console.log(code);
    console.log("----");
    const blocks = Blockly.serialization.workspaces.save(workspace);

    // TODO: se eu usar o updateAgentPartial não preciso desse "as TypeAgent"
    const actualState = await getBlocklyState(workspaceName) as TypeAgent;

    await saveOrUpdateAgent(workspaceName, {
        ...actualState,
        name: workspaceName,
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