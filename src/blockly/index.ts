import * as Blockly from 'blockly/core';
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
    const { blocks, viewportState } = workspaceState;

    // Carregar os blocos
    Blockly.serialization.workspaces.load(blocks as TypeBlock, workspace);

    // Restaurar o estado do viewport se disponível
    if (viewportState) {
        (workspace as any).scale = viewportState.scale;
        (workspace as any).scrollX = viewportState.scrollX;
        (workspace as any).scrollY = viewportState.scrollY;

        // Forçar a atualização da visualização
        (workspace as any).scroll(viewportState.scrollX, viewportState.scrollY); // Isso força uma atualização da visualização
    }
}

const updateCode = async (event: any) => {
    const blocks = Blockly.serialization.workspaces.save(workspace);

    // TODO: se eu usar o updateAgentPartial não preciso desse "as TypeAgent"
    const actualState = await getBlocklyState(workspaceName) as TypeAgent;

    if (Object.keys(blocks).length === 0) {
        return;
    } else if (!blocks.blocks) {
        console.error('Sem blocos:', blocks);

        await updateOrCreateAgent(workspaceName, {
            ...actualState,
            name: workspaceName,
            blocks: {},
            code: '',
            navigation: {},
        });

        return;
    }

    const {
        initial,
        navigation,
    } = processBlocklyCode(blocks);

    const code = generateCodeFromBlocks(initial);

    Object.entries(navigation).forEach(([key, value]: [string, any]) => {
        try {
            const navigationCode = generateCodeFromBlocks(value);
            navigation[key] = navigationCode;
        } catch (error) {
            console.error(`Error generating code for navigation block ${key}:`, value, error);
        }
    });

    const viewportState = {
        scale: (workspace as any)?.scale,
        scrollX: (workspace as any)?.scrollX,
        scrollY: (workspace as any)?.scrollY
    };

    await updateOrCreateAgent(workspaceName, {
        ...actualState,
        name: workspaceName,
        blocks,
        code,
        navigation,
        viewportState,
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