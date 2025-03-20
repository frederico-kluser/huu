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
    return setItem<TypeAgent>(agentId, {
        ...agent,
        lastUpdate: Date.now(),
    });
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