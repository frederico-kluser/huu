import * as Blockly from 'blockly/core';
import { javascriptGenerator } from 'blockly/javascript';
import blocklyOptions from './config/options';
import blocklyContextMenus from './config/contextMenu';
import BlocklyTypes from './config/types';
import TypeAgent, { TypeBlock } from '../types/agent';
import { fetchAgentById, updateOrCreateAgent } from '../core/storage/agents';
import processBlocklyCode from '../helpers/processBlocklyCode';
import generateCodeFromBlocks from '../helpers/generateCodeFormBlocks';

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
    const blocks = Blockly.serialization.workspaces.save(workspace);
    const {
        initial,
        navigation,
    } = processBlocklyCode(blocks);

    const code = generateCodeFromBlocks(initial);

    Object.entries(navigation).forEach(([key, value]: [string, any]) => {
        const navigationCode = generateCodeFromBlocks(value);
        navigation[key] = navigationCode;
    });

    // TODO: se eu usar o updateAgentPartial não preciso desse "as TypeAgent"
    const actualState = await getBlocklyState(workspaceName) as TypeAgent;

    await updateOrCreateAgent(workspaceName, {
        ...actualState,
        name: workspaceName,
        blocks,
        code,
        navigation,
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