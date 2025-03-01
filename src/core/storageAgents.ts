import TypeAgent from "../types/agent";
import { getItem, setItem } from "./storage";

export const fetchAgentById = async (agentId: string) => {
    return getItem<TypeAgent | null>(agentId);
};

export const saveOrUpdateAgent = (agentId: string, agent: TypeAgent) => {
    return setItem<TypeAgent>(agentId, agent);
};

export const updateAgentPartial = async (agentId: string, partial: Partial<TypeAgent>) => {
    const agent = await fetchAgentById(agentId);
    if (agent) {
        saveOrUpdateAgent(agentId, {
            ...agent,
            ...partial,
        });
    } else {
        throw new Error(`Agent ${agentId} not found`);
    }
};