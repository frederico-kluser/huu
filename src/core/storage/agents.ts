import { getItem, setItem } from ".";
import TypeAgent from "../../types/agent";
import { fetchActualWorkspaceName, fetchWorkspaceNames } from "./workspace";
import { version } from "../../../package.json";

export const fetchAgentById = async (agentId: string) => {
    return getItem<TypeAgent | null>(agentId);
};

export const fetchActualAgent = async () => {
    const agentId = await fetchActualWorkspaceName();
    return fetchAgentById(agentId);
};

export const fetchAgentByNavigationBlockId = async (blockId: string) => {
    const workspaces = await fetchWorkspaceNames();

    const agents = await Promise.all(
        workspaces.map(async (workspace) => {
            const agent = await fetchAgentById(workspace);
            return agent;
        })
    );

    const activeAgent = agents.find((agent) => {
        if (!agent) {
            return false;
        }

        if (!agent.navigation) {
            return false;
        }

        return agent.navigation[blockId];
    });

    return activeAgent;
};

export const updateOrCreateAgent = (agentId: string, agent: TypeAgent) => {
    const agentData = {
        ...agent,
        lastUpdate: Date.now(),
    };

    console.log("agente atualizado", agentData);

    return setItem<TypeAgent>(agentId, agentData);
};

export const updateAgentAttributes = async (agentId: string, partial: Partial<TypeAgent>) => {
    const agent = await fetchAgentById(agentId);
    if (agent) {
        updateOrCreateAgent(agentId, {
            ...agent,
            ...partial,
            lastUpdate: Date.now(),
            agentVersion: version,
        });
    } else {
        throw new Error(`Agent ${agentId} not found`);
    }
};

export const createAgent = async (name: string, urls: string) => {
    return setItem<TypeAgent>(name, {
        name,
        urls,
        blocks: {},
        code: '',
        navigation: {},
        mode: '',
        active: false,
        lastUpdate: Date.now(),
        actualCode: 'initial',
        agentVersion: version,
    });
};