import { getItem, setItem } from ".";
import TypeAgent from "../../types/agent";
import { fetchActualWorkspaceName } from "./workspace";

export const fetchAgentById = async (agentId: string) => {
    return getItem<TypeAgent | null>(agentId);
};

export const fetchActualAgent = async () => {
    const agentId = await fetchActualWorkspaceName();
    return fetchAgentById(agentId);
};

export const saveOrUpdateAgent = (agentId: string, agent: TypeAgent) => {
    const agentData = {
        ...agent,
        lastUpdate: Date.now(),
    };

    console.log('Saving agent', agentId, agentData);

    return setItem<TypeAgent>(agentId, agentData);
};

export const updateAgentPartial = async (agentId: string, partial: Partial<TypeAgent>) => {
    const agent = await fetchAgentById(agentId);
    if (agent) {
        saveOrUpdateAgent(agentId, {
            ...agent,
            ...partial,
            lastUpdate: Date.now(),
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
    });
};